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
    "Growth Guidance",
    "Margin Guidance",
    "Capex/Expansion",
    "Order Book",
    "Key Risk",
    "Key Takeaway",
]

MAX_TRANSCRIPT_CHARS = 100_000  # rough cap to keep prompts within model context comfortably


class ExtractResponse(BaseModel):
    filename: str
    row: dict


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
    numbered_fields = "\n".join(f"{i+1}. {c}" for i, c in enumerate(columns))
    return f"""You are analyzing a company earnings conference call transcript. Extract management's forward-looking guidance and commentary with precision.

EXTRACT THE FOLLOWING (only if explicitly stated by management — do not infer or estimate):
{numbered_fields}

RULES:
- Use management's own framing (e.g. "Management expects 80% revenue growth in FY27" not "the company will grow")
- If a range is given, keep the range (e.g. "20-25%")
- If no explicit guidance was given on a category, write "No explicit guidance"
- Do not add your own forecast or opinion
- Keep each value under 20 words
- "Company Name" should be the actual company name found in the transcript

TRANSCRIPT:
{transcript_text[:MAX_TRANSCRIPT_CHARS]}"""


def call_gemini(prompt: str, columns: list[str]) -> dict:
    # Build a strict JSON schema so Gemini returns exactly the fields we asked for,
    # as plain strings, with no markdown fences or preamble to strip.
    response_schema = {
        "type": "object",
        "properties": {c: {"type": "string"} for c in columns},
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