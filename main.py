"""
Concall Insight Extractor — Backend API

Run locally with:
    uvicorn main:app --reload --port 8000

Then open http://localhost:8000/docs for an interactive API tester.
"""

import io
import json
import logging
import os
import time

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader

from google import genai
from google.genai import types as genai_types

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("concall")

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise RuntimeError(
        "GEMINI_API_KEY is not set. Create a .env file (see .env.example) "
        "with your key before starting the server."
    )

client = genai.Client(api_key=GEMINI_API_KEY)
MODEL_NAME = "gemini-3.1-flash-lite"

app = FastAPI(title="Concall Insight Extractor API")

# Allow the local frontend (and later, your deployed frontend) to call this API.
# Tighten this list before going to production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: restrict to your real frontend domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEFAULT_COLUMNS = [
    "Company Name",
    "Quarter and Year",
    "Growth Guidance",
    "Margin Guidance",
    "Capex/Expansion",
    "Order Book",
    "Key Risk",
    "Key Takeaway",
]

MAX_TRANSCRIPT_CHARS = 100_000  # rough cap to keep prompts within model context comfortably
MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024  # 25MB cap on fetched PDFs to avoid abuse/huge files
DOWNLOAD_TIMEOUT_SECONDS = 20


class ExtractResponse(BaseModel):
    filename: str
    row: dict


def download_pdf_from_url(url: str) -> bytes:
    """
    Download a PDF from a direct link (e.g. a BSE/NSE filing URL copied from
    Screener.in). Some exchange sites apply bot detection to non-browser
    requests, so we send headers that resemble a real browser. This is not
    guaranteed to work on every source — if it's blocked, we raise a clear
    error rather than failing silently.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/pdf,*/*",
        # Some exchange sites check that the request appears to originate
        # from a browser session that was already on their domain.
        "Referer": "https://www.bseindia.com/",
    }

    start = time.monotonic()
    logger.info(f"URL download starting: {url}")
    try:
        response = requests.get(
            url, headers=headers, timeout=DOWNLOAD_TIMEOUT_SECONDS, stream=True
        )
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        elapsed = time.monotonic() - start
        logger.error(f"URL download FAILED after {elapsed:.2f}s: {type(e).__name__}: {e}")
        raise ValueError(
            f"Could not download the PDF from this link. The source site may be "
            f"blocking automated requests. ({type(e).__name__})"
        )

    chunks = []
    total_size = 0
    for chunk in response.iter_content(chunk_size=8192):
        total_size += len(chunk)
        if total_size > MAX_DOWNLOAD_BYTES:
            raise ValueError(
                f"This file exceeds the {MAX_DOWNLOAD_BYTES // (1024*1024)}MB size limit."
            )
        chunks.append(chunk)

    file_bytes = b"".join(chunks)

    # Content-Type headers are unreliable across different filing systems
    # (some serve PDFs as application/octet-stream), so we verify the actual
    # file signature instead: real PDFs always start with the bytes "%PDF".
    if not file_bytes.startswith(b"%PDF"):
        content_type = response.headers.get("content-type", "unknown")
        logger.error(f"Downloaded content is not a PDF. Content-Type: {content_type}")
        raise ValueError(
            "This link did not return a valid PDF file. It may be a webpage "
            "rather than a direct PDF link, or the source site may require "
            "a browser session to access it."
        )

    elapsed = time.monotonic() - start
    logger.info(f"URL download finished in {elapsed:.2f}s, {total_size} bytes")
    return file_bytes


def extract_pdf_text(file_bytes: bytes) -> str:
    """Pull plain text out of a PDF using pypdf. Returns '' if the PDF is image-only."""
    start = time.monotonic()
    logger.info(f"PDF parse starting, file size: {len(file_bytes)} bytes")
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        text_parts = []
        for page in reader.pages:
            page_text = page.extract_text() or ""
            text_parts.append(page_text)
        text = "\n".join(text_parts).strip()
        elapsed = time.monotonic() - start
        logger.info(f"PDF parse finished in {elapsed:.2f}s, extracted {len(text)} chars, {len(reader.pages)} pages")
        return text
    except Exception:
        elapsed = time.monotonic() - start
        logger.exception(f"PDF parse FAILED after {elapsed:.2f}s")
        raise


def build_prompt(columns: list[str], transcript_text: str) -> str:
    citation_fields = [c for c in columns if c != "Quarter and Year"]
    numbered_fields = "\n".join(f"{i+1}. {c}" for i, c in enumerate(columns))
    citation_field_list = ", ".join(f'"{c}"' for c in citation_fields)
    return f"""You are analyzing a company earnings conference call transcript. Extract management's forward-looking guidance and commentary with precision.

EXTRACT THE FOLLOWING (only if explicitly stated by management — do not infer or estimate):
{numbered_fields}

RULES:
- "Quarter and Year" must be normalized to the exact format "Q<N>-<YYYY>" (e.g. "Q1-2026", "Q4-2026"), using the fiscal quarter and fiscal year stated in the transcript (e.g. "Q4FY26 Earnings Conference Call" becomes "Q4-2026"; "Q3 FY '26" becomes "Q3-2026"). If the transcript states a calendar period instead of a fiscal quarter (e.g. "quarter ended March 31, 2026"), infer the correct fiscal quarter label only if the fiscal year convention is unambiguous from context; otherwise write "Unclear from transcript".
- Use management's own framing (e.g. "Management expects 80% revenue growth in FY27" not "the company will grow")
- If a range is given, keep the range (e.g. "20-25%")
- Only count a statement as guidance if it is a forward-looking commitment for an upcoming, named period (e.g. "FY27", "next quarter", "next 18 months"). Exclude standing long-term policies, philosophies, or historical ratios that are not framed as a new commitment for the period ahead — for example, "we target 1.5x to 2x nominal GDP growth" is a standing policy, not FY27 guidance, unless management explicitly reaffirms it as the target for the specific period in question.
- Mechanical or one-off effects (e.g. day-count quirks, base-effect comparisons, calendar timing) are not strategic guidance, even if management quantifies their short-term impact. Only extract genuine strategic targets.
- If no explicit guidance was given on a category for the relevant period, write "No explicit guidance"
- Do not add your own forecast or opinion
- Keep each value under 20 words
- "Company Name" should be the actual company name found in the transcript

CITATIONS — for each of these fields: {citation_field_list}
- Also provide a "source_quote": a short, VERBATIM excerpt (under 20 words, copied exactly, no paraphrasing) from the transcript that the value was drawn from.
- If the value is "No explicit guidance", set source_quote to an empty string "".
- For "Key Takeaway" (a synthesized summary, not a direct quote), source_quote should be the single most representative verbatim sentence from the transcript that best supports the takeaway.
- Never invent or paraphrase a quote — if you cannot find an exact supporting sentence, set source_quote to "".

TRANSCRIPT:
{transcript_text[:MAX_TRANSCRIPT_CHARS]}"""


def call_gemini(prompt: str, columns: list[str]) -> dict:
    # Build a strict JSON schema. Every field except "Quarter and Year" is
    # returned as {value, source_quote} so the UI can show where each
    # extracted fact actually came from in the transcript.
    properties = {}
    for c in columns:
        if c == "Quarter and Year":
            properties[c] = {"type": "string"}
        else:
            properties[c] = {
                "type": "object",
                "properties": {
                    "value": {"type": "string"},
                    "source_quote": {"type": "string"},
                },
                "required": ["value", "source_quote"],
            }

    response_schema = {
        "type": "object",
        "properties": properties,
        "required": columns,
    }

    start = time.monotonic()
    logger.info(f"Gemini call starting, prompt length: {len(prompt)} chars, model: {MODEL_NAME}")
    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=response_schema,
            ),
        )
        elapsed = time.monotonic() - start
        logger.info(f"Gemini call finished in {elapsed:.2f}s")
    except Exception:
        elapsed = time.monotonic() - start
        logger.exception(f"Gemini call FAILED/RAISED after {elapsed:.2f}s")
        raise

    if not response.text:
        logger.error(f"Gemini returned empty text. Full response object: {response}")
        raise ValueError("Gemini returned no text content")

    try:
        row = json.loads(response.text)
    except json.JSONDecodeError as e:
        logger.error(f"Could not parse Gemini output as JSON. Raw text: {response.text[:1000]}")
        raise ValueError(f"Could not parse model output as JSON: {e}\nRaw: {response.text[:500]}")

    return row


@app.get("/health")
def health_check():
    return {"status": "ok"}


def _resolve_columns(columns: str | None) -> list[str]:
    if columns:
        parsed = [c.strip() for c in columns.split(",") if c.strip()]
        if parsed:
            return parsed
    return DEFAULT_COLUMNS


def _extract_one(filename: str, file_bytes: bytes, active_columns: list[str]) -> dict:
    """Shared logic for a single file. Raises HTTPException on failure."""
    logger.info(f"=== Starting extraction for '{filename}' ===")

    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported right now.")

    try:
        text = extract_pdf_text(file_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {e}")

    if len(text) < 50:
        raise HTTPException(
            status_code=422,
            detail="Could not extract text from this PDF — it may be scanned/image-based.",
        )

    prompt = build_prompt(active_columns, text)

    try:
        row = call_gemini(prompt, active_columns)
    except Exception as e:
        logger.error(f"Extraction failed for '{filename}': {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail=f"Extraction failed: {e}")

    logger.info(f"=== Finished extraction for '{filename}' successfully ===")
    return row


@app.post("/extract", response_model=ExtractResponse)
async def extract_transcript(
    file: UploadFile = File(...),
    columns: str = None,  # comma-separated string, optional override
):
    active_columns = _resolve_columns(columns)
    file_bytes = await file.read()
    # _extract_one makes a blocking (synchronous) call to the Gemini SDK.
    # Running it via run_in_threadpool keeps the event loop free to respond
    # to health checks and other requests while this one is in flight —
    # without this, a slow model call can stall the whole server.
    row = await run_in_threadpool(_extract_one, file.filename, file_bytes, active_columns)
    return ExtractResponse(filename=file.filename, row=row)


class UrlExtractRequest(BaseModel):
    url: str
    columns: str | None = None


@app.post("/extract-from-url", response_model=ExtractResponse)
async def extract_transcript_from_url(payload: UrlExtractRequest):
    """
    Accepts a direct link to a PDF (e.g. a BSE/NSE filing URL) instead of an
    uploaded file. Downloads the PDF server-side, then runs the same
    extraction logic as /extract.

    Note: some exchange/IR sites apply bot detection to non-browser requests.
    This is not guaranteed to work on every source.
    """
    if not payload.url.strip():
        raise HTTPException(status_code=400, detail="No URL provided.")

    active_columns = _resolve_columns(payload.columns)

    try:
        file_bytes = await run_in_threadpool(download_pdf_from_url, payload.url)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))

    # Use the URL's last path segment as a stand-in filename for logging/display.
    filename = payload.url.rstrip("/").split("/")[-1] or "downloaded.pdf"
    row = await run_in_threadpool(_extract_one, filename, file_bytes, active_columns)
    return ExtractResponse(filename=filename, row=row)


class BatchRowResult(BaseModel):
    filename: str
    ok: bool
    row: dict | None = None
    error: str | None = None


class BatchExtractResponse(BaseModel):
    results: list[BatchRowResult]


@app.post("/extract-batch", response_model=BatchExtractResponse)
async def extract_transcripts_batch(
    files: list[UploadFile] = File(...),
    columns: str = None,
):
    """
    Accepts multiple PDFs in one request and processes them sequentially.
    Each file's success/failure is reported independently — one bad PDF
    doesn't abort the rest of the batch.
    """
    active_columns = _resolve_columns(columns)
    results: list[BatchRowResult] = []

    for f in files:
        file_bytes = await f.read()
        try:
            row = await run_in_threadpool(_extract_one, f.filename, file_bytes, active_columns)
            results.append(BatchRowResult(filename=f.filename, ok=True, row=row))
        except HTTPException as e:
            results.append(BatchRowResult(filename=f.filename, ok=False, error=str(e.detail)))
        except Exception as e:
            results.append(BatchRowResult(filename=f.filename, ok=False, error=str(e)))

    return BatchExtractResponse(results=results)