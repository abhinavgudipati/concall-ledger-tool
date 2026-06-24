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
import re
import time

import hashlib
import hmac

import jwt as pyjwt
from jwt import PyJWKClient
import sys, types as _types
if "pkg_resources" not in sys.modules:
    _pr = _types.ModuleType("pkg_resources")
    _pr.DistributionNotFound = Exception
    _pr.get_distribution = lambda *a, **kw: None
    sys.modules["pkg_resources"] = _pr
import razorpay
import requests
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
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

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    logger.warning(
        "DATABASE_URL is not set. Consistency scoring and extraction history "
        "will be disabled — extraction itself will still work normally."
    )

RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET")
rzp_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)) if RAZORPAY_KEY_ID else None

TIER_PRICES_INR = {
    "growth": 19900,   # paise
    "pro":    49900,
    "elite":  99900,
}

SUPABASE_URL = os.getenv("SUPABASE_URL", "https://iqlzvhqumjcfbulgjgqb.supabase.co")
_jwks_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
_jwks_client = PyJWKClient(_jwks_url, cache_keys=True)
logger.info(f"JWKS client initialised: {_jwks_url}")


def get_current_user(authorization: str = Header(None)) -> str | None:
    """
    Verifies the Supabase JWT using their public JWKS endpoint (supports
    ES256 and RS256). Returns the user UUID, or None for guest requests.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None  # guest — allowed, extractions work but aren't saved per-user
    token = authorization.split(" ", 1)[1]
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        payload = pyjwt.decode(
            token,
            signing_key,
            algorithms=["ES256", "RS256", "HS256"],
            options={"verify_aud": False},
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token has no subject claim.")
        return user_id
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired. Please sign in again.")
    except pyjwt.InvalidTokenError as e:
        logger.error(f"JWT verification failed: {type(e).__name__}: {e}")
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


def get_current_user_with_email(authorization: str = Header(None)) -> tuple[str, str] | tuple[None, None]:
    """Returns (user_id, email) from JWT, or (None, None) for guests."""
    if not authorization or not authorization.startswith("Bearer "):
        return None, None
    token = authorization.split(" ", 1)[1]
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        payload = pyjwt.decode(token, signing_key, algorithms=["ES256", "RS256", "HS256"], options={"verify_aud": False})
        user_id = payload.get("sub")
        email = payload.get("email", "")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token has no subject claim.")
        return user_id, email
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired. Please sign in again.")
    except pyjwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


def get_db_connection():
    """
    Opens a new connection per call rather than holding one open long-term.
    At this app's current scale this is simpler and safer than managing a
    persistent pool ourselves — Supabase's own pooler (note port 6543 in
    DATABASE_URL) already handles connection reuse on its end.
    """
    import psycopg2
    return psycopg2.connect(DATABASE_URL)


def save_extraction(company_name: str, quarter_year: str, filename: str, row: dict, user_id: str | None = None) -> None:
    """
    Persists one row per extracted field. Failures here are logged but never
    raised — a database hiccup should not break the actual extraction
    response the user is waiting on.
    """
    if not DATABASE_URL:
        return

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        for field_name, field_data in row.items():
            if field_name == "Quarter and Year":
                continue
            value = field_data.get("value", "") if isinstance(field_data, dict) else str(field_data)
            source_quote = field_data.get("source_quote", "") if isinstance(field_data, dict) else ""
            confidence = field_data.get("confidence", "") if isinstance(field_data, dict) else ""
            mgmt_confidence = field_data.get("mgmt_confidence", 0) if isinstance(field_data, dict) else 0
            mgmt_confidence_reason = field_data.get("mgmt_confidence_reason", "") if isinstance(field_data, dict) else ""
            cur.execute(
                """
                DELETE FROM extractions
                WHERE company_name = %s
                  AND quarter_year = %s
                  AND field_name = %s
                  AND (user_id = %s OR (user_id IS NULL AND %s IS NULL))
                """,
                (company_name, quarter_year, field_name, user_id, user_id),
            )
            cur.execute(
                """
                INSERT INTO extractions
                    (company_name, quarter_year, field_name, value, source_quote, source_page, confidence, mgmt_confidence, mgmt_confidence_reason, filename, user_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (company_name, quarter_year, field_name, value, source_quote,
                 field_data.get("source_page", 0) if isinstance(field_data, dict) else 0,
                 confidence, mgmt_confidence, mgmt_confidence_reason, filename, user_id),
            )
        conn.commit()
        cur.close()
        conn.close()
        logger.info(f"Saved extraction history for '{company_name}' {quarter_year}")
    except Exception:
        logger.exception(f"Failed to save extraction history for '{company_name}' {quarter_year}")


def previous_adjacent_quarter(quarter_year: str) -> str | None:
    """
    Returns the immediately preceding quarter in "Q<N>-<YYYY>" format.
    Q2-2026 → Q1-2026, Q1-2026 → Q4-2025. Returns None if unparseable.
    """
    import re as _re
    m = _re.match(r"Q([1-4])-(\d{4})$", quarter_year.strip())
    if not m:
        return None
    n, year = int(m.group(1)), int(m.group(2))
    if n == 1:
        return f"Q4-{year - 1}"
    return f"Q{n - 1}-{year}"


def get_adjacent_quarter_value(company_name: str, adjacent_quarter_year: str, field_name: str, user_id: str | None = None) -> dict | None:
    """
    Fetches the stored value for a specific company + quarter + field, scoped
    to the requesting user. Returns None if not found or DB unavailable.
    """
    if not DATABASE_URL:
        return None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT quarter_year, value, extracted_at
            FROM extractions
            WHERE company_name = %s
              AND field_name = %s
              AND quarter_year = %s
              AND (user_id = %s OR (%s IS NULL AND user_id IS NULL))
            LIMIT 1
            """,
            (company_name, field_name, adjacent_quarter_year, user_id, user_id),
        )
        row = cur.fetchone()
        cur.close()
        conn.close()
        if not row:
            return None
        return {"quarter_year": row[0], "value": row[1], "extracted_at": row[2].isoformat()}
    except Exception:
        logger.exception(f"Failed to fetch adjacent quarter for '{company_name}' / '{field_name}' / '{adjacent_quarter_year}'")
        return None


def get_prior_quarter_values(company_name: str, exclude_quarter_year: str, field_name: str, limit: int = 3, user_id: str | None = None) -> list[dict]:
    """
    Fetches the most recent prior extractions of one field for a company,
    excluding the quarter currently being processed (in case of re-runs).
    Returns most-recent-first. Returns [] on any failure or if DB is unset —
    callers should treat that as "no history available" rather than an error.
    """
    if not DATABASE_URL:
        return []

    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT quarter_year, value, extracted_at
            FROM extractions
            WHERE company_name = %s
              AND field_name = %s
              AND quarter_year != %s
              AND (user_id = %s OR (%s IS NULL AND user_id IS NULL))
            ORDER BY extracted_at DESC
            LIMIT %s
            """,
            (company_name, field_name, exclude_quarter_year, user_id, user_id, limit),
        )
        results = [
            {"quarter_year": r[0], "value": r[1], "extracted_at": r[2].isoformat()}
            for r in cur.fetchall()
        ]
        cur.close()
        conn.close()
        return results
    except Exception:
        logger.exception(f"Failed to fetch prior quarters for '{company_name}' / '{field_name}'")
        return []


app = FastAPI(title="Concall Insight Extractor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/ping")
def ping():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Razorpay — create order
# ---------------------------------------------------------------------------

class CreateOrderRequest(BaseModel):
    tier: str  # "growth" | "pro" | "elite"

@app.post("/create-order")
def create_order(body: CreateOrderRequest, user_id: str | None = Depends(get_current_user)):
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to upgrade.")
    if not rzp_client:
        raise HTTPException(status_code=503, detail="Payments not configured.")
    tier = body.tier.lower()
    amount = TIER_PRICES_INR.get(tier)
    if not amount:
        raise HTTPException(status_code=400, detail=f"Unknown tier: {tier}")
    order = rzp_client.order.create({
        "amount": amount,
        "currency": "INR",
        "notes": {"user_id": user_id, "tier": tier},
    })
    return {"order_id": order["id"], "amount": amount, "currency": "INR", "key_id": RAZORPAY_KEY_ID}


# ---------------------------------------------------------------------------
# Razorpay — webhook (called by Razorpay after successful payment)
# ---------------------------------------------------------------------------

@app.post("/razorpay-webhook")
async def razorpay_webhook(request: Request):
    body_bytes = await request.body()
    sig = request.headers.get("X-Razorpay-Signature", "")
    expected = hmac.new(RAZORPAY_KEY_SECRET.encode(), body_bytes, hashlib.sha256).hexdigest() if RAZORPAY_KEY_SECRET else ""  # noqa: S324
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(status_code=400, detail="Invalid signature.")

    event = json.loads(body_bytes)
    if event.get("event") != "payment.captured":
        return {"status": "ignored"}

    notes = event["payload"]["payment"]["entity"].get("notes", {})
    user_id = notes.get("user_id")
    tier = notes.get("tier")
    payment_id = event["payload"]["payment"]["entity"]["id"]
    order_id = event["payload"]["payment"]["entity"]["order_id"]

    if not user_id or not tier:
        logger.warning("Webhook missing user_id or tier in notes")
        return {"status": "ignored"}

    if DATABASE_URL:
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO user_tiers (user_id, tier, razorpay_payment_id, razorpay_order_id, updated_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (user_id) DO UPDATE
                SET tier = EXCLUDED.tier,
                    razorpay_payment_id = EXCLUDED.razorpay_payment_id,
                    razorpay_order_id = EXCLUDED.razorpay_order_id,
                    reports_used_this_month = 0,
                    billing_cycle_start = CURRENT_DATE,
                    updated_at = now()
            """, (user_id, tier, payment_id, order_id))
            conn.commit()
            cur.close()
            conn.close()
            logger.info(f"Upgraded user {user_id} to {tier}")
        except Exception:
            logger.exception("Failed to update user tier after payment")

    return {"status": "ok"}

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

# A marker we inject between pages of the transcript before sending it to
# the model. The model is told (in the prompt) what this marker means, so
# it can report which page a given source_quote was found on.
PAGE_MARKER_TEMPLATE = "\n\n[[PAGE {n}]]\n\n"


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
    """
    Pull plain text out of a PDF using pypdf. Returns '' if the PDF is
    image-only. Each page's text is preceded by a [[PAGE n]] marker (n is
    1-indexed) so the model can cite which page a quote came from.
    """
    start = time.monotonic()
    logger.info(f"PDF parse starting, file size: {len(file_bytes)} bytes")
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        text_parts = []
        for i, page in enumerate(reader.pages, start=1):
            page_text = page.extract_text() or ""
            text_parts.append(PAGE_MARKER_TEMPLATE.format(n=i) + page_text)
        text = "".join(text_parts).strip()
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

EXTRACT THE FOLLOWING:
{numbered_fields}

GUIDANCE TIERS — use exactly one of these value formats per field:
1. EXPLICIT: Management made a direct, forward-looking commitment for a named period. Write the value in management's own words (under 20 words). Example: "18-20% revenue growth in FY27"
2. IMPLIED: Management gave a strong directional signal without a hard commitment — e.g. "comfortable with consensus", "broadly similar to last year", "expect improvement". Prefix the value with "Implied: " and summarise in under 15 words. Example: "Implied: margins expected to improve, no specific target given"
3. NONE: No guidance or signal of any kind on this topic. Write "No explicit guidance".

RULES:
- "Quarter and Year" must be normalized to the exact format "Q<N>-<YYYY>" (e.g. "Q1-2026", "Q4-2026"), using the fiscal quarter and fiscal year stated in the transcript (e.g. "Q4FY26 Earnings Conference Call" becomes "Q4-2026"; "Q3 FY '26" becomes "Q3-2026"). If the transcript states a calendar period instead of a fiscal quarter (e.g. "quarter ended March 31, 2026"), infer the correct fiscal quarter label only if the fiscal year convention is unambiguous from context; otherwise write "Unclear from transcript".
- Use management's own framing wherever possible.
- If a range is given, keep the range (e.g. "20-25%").
- Standing long-term policies not reaffirmed for a specific upcoming period should be treated as IMPLIED at most, not EXPLICIT.
- Mechanical or one-off effects (e.g. day-count quirks, base-effect comparisons) are not guidance — use NONE.
- Do not add your own forecast or opinion.
- "Company Name" should be the actual company name found in the transcript.

EXCLUSION NOTE — for each of these fields: {citation_field_list}
- Also provide an "exclusion_note": if value is "No explicit guidance", write a brief phrase (under 12 words) explaining what, if anything, management said about this topic and why it did not qualify — e.g. "Referenced GDP-linked target but not for a named period" or "Topic not discussed". If guidance was found (explicit or implied), set exclusion_note to "".

PAGE MARKERS:
- The transcript below contains markers like "[[PAGE 4]]" inserted at the start of each page. These markers are NOT part of the actual transcript content — never quote them or include them in any value or source_quote.
- Use them only to determine which page number a given source_quote falls on (the page whose marker appears immediately before the quoted text in the document).

CITATIONS — for each of these fields: {citation_field_list}
- Also provide a "source_quote": a short, VERBATIM excerpt (under 20 words, copied exactly, no paraphrasing) from the transcript that the value was drawn from.
- Also provide a "source_page": the integer page number (from the nearest preceding [[PAGE n]] marker) where that source_quote appears.
- If the value is "No explicit guidance", set source_quote to an empty string "" and source_page to 0.
- For "Key Takeaway" (a synthesized summary, not a direct quote), source_quote should be the single most representative verbatim sentence from the transcript that best supports the takeaway, and source_page its page number.
- Never invent or paraphrase a quote — if you cannot find an exact supporting sentence, set source_quote to "" and source_page to 0.

MANAGEMENT CONFIDENCE SCORE — for each of these fields: {citation_field_list}
- Also provide a "mgmt_confidence" integer from 1 to 10 reflecting how strongly management expressed conviction in this guidance, based solely on language, tone, and specificity in the transcript.
- Also provide a "mgmt_confidence_reason": a short phrase (under 10 words) explaining the score.
- Scoring rubric:
  9-10: Firm commitment, specific number or range, no hedges, possibly repeated
  7-8:  Specific but with minor qualifiers or a broad range
  5-6:  General direction given, meaningful hedges or uncertainty present
  3-4:  Tentative, heavily conditional, or dependent on external factors
  1-2:  Speculative, "hope to", aspirational, or no real commitment
- If value is "No explicit guidance", set mgmt_confidence to 0 and mgmt_confidence_reason to "".

TRANSCRIPT:
{transcript_text[:MAX_TRANSCRIPT_CHARS]}"""


def call_gemini(prompt: str, columns: list[str]) -> dict:
    # Build a strict JSON schema. Every field except "Quarter and Year" is
    # returned as {value, source_quote, source_page} so the UI can show
    # where each extracted fact came from in the transcript, page included.
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
                    "source_page": {"type": "integer"},
                    "mgmt_confidence": {"type": "integer"},
                    "mgmt_confidence_reason": {"type": "string"},
                    "exclusion_note": {"type": "string"},
                },
                "required": ["value", "source_quote", "source_page", "mgmt_confidence", "mgmt_confidence_reason", "exclusion_note"],
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
                temperature=0.0,
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


def classify_consistency(current_value: str, prior_value: str | None) -> str:
    """
    Compares this quarter's value against the most recent prior quarter's
    value for the same field. Returns one of:
      NEW        - no prior value exists at all
      REAFFIRMED - same guidance, essentially unchanged (including when
                   both quarters explicitly gave no guidance)
      CHANGED    - both quarters gave guidance, but it differs
      DROPPED    - prior quarter gave guidance, this quarter does not
      RESUMED    - prior quarter gave none, this quarter newly does
    """
    if prior_value is None:
        return "NEW"

    current_is_none = current_value == "No explicit guidance"
    prior_is_none = prior_value == "No explicit guidance"

    if current_is_none and prior_is_none:
        return "REAFFIRMED"
    if current_is_none and not prior_is_none:
        return "DROPPED"
    if not current_is_none and prior_is_none:
        return "RESUMED"

    def normalize(s: str) -> str:
        s = s.lower()
        s = re.sub(r"[^a-z0-9.%\s]", "", s)
        return re.sub(r"\s+", " ", s).strip()

    norm_current = normalize(current_value)
    norm_prior = normalize(prior_value)

    if norm_current == norm_prior:
        return "REAFFIRMED"

    def extract_numbers(s: str) -> list[str]:
        return re.findall(r"\d+\.?\d*%?", s)

    current_numbers = extract_numbers(norm_current)
    prior_numbers = extract_numbers(norm_prior)

    if current_numbers and current_numbers == prior_numbers:
        return "REAFFIRMED"

    return "CHANGED"


def build_consistency_note(status: str, current_value: str, prior_value: str | None, prior_quarter: str | None) -> str:
    """A short, human-readable one-liner explaining the consistency label."""
    if status == "NEW":
        return "No prior quarter on record for this field."
    if status == "REAFFIRMED":
        return f"Consistent with {prior_quarter}: \"{prior_value}\""
    if status == "DROPPED":
        return f"{prior_quarter} gave guidance (\"{prior_value}\"); this quarter does not."
    if status == "RESUMED":
        return f"{prior_quarter} gave no guidance; this quarter newly provides it."
    if status == "CHANGED":
        return f"{prior_quarter} said: \"{prior_value}\""
    return ""


def compute_confidence(value: str, source_quote: str, transcript_text: str) -> str:
    """
    Confidence is derived from whether the model's source_quote can actually
    be found in the real transcript text — it is NOT the model's own
    self-reported certainty (LLMs are unreliable at rating their own
    accuracy, and will confidently "rate" a fabricated answer highly).

    HIGH:   source_quote appears verbatim (normalized for whitespace/case)
            in the transcript.
    MEDIUM: most significant words of the quote appear in the transcript,
            suggesting a real but paraphrased reference.
    LOW:    the quote does not meaningfully match the transcript at all.
    N/A:    no guidance was given for this field.
    """
    if not source_quote or value == "No explicit guidance":
        return "N/A"

    def normalize(s: str) -> str:
        s = re.sub(r"\[\[PAGE \d+\]\]", " ", s)
        return re.sub(r"\s+", " ", s.strip().lower())

    norm_quote = normalize(source_quote)
    norm_transcript = normalize(transcript_text)

    if norm_quote in norm_transcript:
        return "HIGH"

    quote_words = norm_quote.split()
    if len(quote_words) < 4:
        return "LOW"

    significant_words = [w for w in quote_words if len(w) > 3]
    if not significant_words:
        return "LOW"

    matches = sum(1 for w in significant_words if w in norm_transcript)
    overlap_ratio = matches / len(significant_words)

    return "MEDIUM" if overlap_ratio >= 0.8 else "LOW"


@app.get("/health")
def health_check():
    return {"status": "ok"}


def _resolve_columns(columns: str | None) -> list[str]:
    if columns:
        parsed = [c.strip() for c in columns.split(",") if c.strip()]
        if parsed:
            return parsed
    return DEFAULT_COLUMNS


def get_cached_extraction(company_name: str, quarter_year: str, columns: list[str], user_id: str) -> dict | None:
    """
    Returns a fully reconstructed row dict from DB if all requested fields
    exist for this user + company + quarter. Returns None if anything is missing.
    Only available for signed-in users — guests never get cached results.
    """
    if not DATABASE_URL or not user_id:
        return None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        citable = [c for c in columns if c not in ("Company Name", "Quarter and Year")]
        cur.execute(
            """
            SELECT field_name, value, source_quote, source_page, confidence, mgmt_confidence, mgmt_confidence_reason
            FROM extractions
            WHERE company_name = %s
              AND quarter_year = %s
              AND user_id = %s
              AND field_name = ANY(%s)
            """,
            (company_name, quarter_year, user_id, citable),
        )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        if len(rows) < len(citable):
            return None
        row = {
            "Company Name": {"value": company_name, "source_quote": "", "source_page": 0, "mgmt_confidence": 0, "mgmt_confidence_reason": "", "exclusion_note": ""},
            "Quarter and Year": quarter_year,
        }
        for field_name, value, source_quote, source_page, confidence, mgmt_confidence, mgmt_confidence_reason in rows:
            row[field_name] = {
                "value": value or "",
                "source_quote": source_quote or "",
                "source_page": source_page or 0,
                "confidence": confidence or "N/A",
                "mgmt_confidence": mgmt_confidence or 0,
                "mgmt_confidence_reason": mgmt_confidence_reason or "",
                "exclusion_note": "",
            }
        logger.info(f"Cache HIT for '{company_name}' {quarter_year} user={user_id}")
        return row
    except Exception:
        logger.exception(f"Cache lookup failed for '{company_name}' {quarter_year}")
        return None


TIER_LIMITS = {
    "free":   10,
    "growth": 50,
    "pro":    150,
    "elite":  None,  # unlimited
}

def check_and_increment_usage(user_id: str | None, email: str = ""):
    """
    For signed-in users: enforce monthly limits based on their tier.
    Raises HTTPException(402) if limit exceeded.
    """
    if not user_id or not DATABASE_URL:
        return
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        # Upsert user into user_tiers if not present, reset if new billing cycle
        cur.execute("""
            INSERT INTO user_tiers (user_id, email, tier, reports_used_this_month, billing_cycle_start)
            VALUES (%s, %s, 'free', 0, date_trunc('month', CURRENT_DATE))
            ON CONFLICT (user_id) DO UPDATE
            SET reports_used_this_month = CASE
                WHEN user_tiers.billing_cycle_start < date_trunc('month', CURRENT_DATE)
                THEN 0
                ELSE user_tiers.reports_used_this_month
            END,
            billing_cycle_start = CASE
                WHEN user_tiers.billing_cycle_start < date_trunc('month', CURRENT_DATE)
                THEN date_trunc('month', CURRENT_DATE)
                ELSE user_tiers.billing_cycle_start
            END,
            email = COALESCE(EXCLUDED.email, user_tiers.email)
        """, (user_id, email or None))
        conn.commit()

        cur.execute("SELECT tier, reports_used_this_month FROM user_tiers WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
        if not row:
            cur.close(); conn.close(); return
        tier, used = row
        limit = TIER_LIMITS.get(tier, 10)
        if limit is not None and used >= limit:
            cur.close(); conn.close()
            raise HTTPException(
                status_code=402,
                detail=f"LIMIT_REACHED|{tier}|{used}|{limit}"
            )
        cur.execute("UPDATE user_tiers SET reports_used_this_month = reports_used_this_month + 1, updated_at = now() WHERE user_id = %s", (user_id,))
        conn.commit()
        cur.close(); conn.close()
    except HTTPException:
        raise
    except Exception:
        logger.exception("Failed to check/increment usage — allowing extraction")


def _extract_one(filename: str, file_bytes: bytes, active_columns: list[str], user_id: str | None = None, force_refresh: bool = False) -> dict:
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

    # Quick peek at company + quarter from filename/text to attempt cache lookup
    # before paying the Gemini cost. We do a lightweight pre-parse for this.
    if not force_refresh and user_id:
        # Try to infer company+quarter from a fast Gemini mini-call or skip —
        # instead we do the full extraction but check cache after we know the key.
        pass

    prompt = build_prompt(active_columns, text)

    try:
        row = call_gemini(prompt, active_columns)
    except Exception as e:
        logger.error(f"Extraction failed for '{filename}': {type(e).__name__}: {e}")
        raise HTTPException(status_code=502, detail=f"Extraction failed: {e}")

    company_name = row.get("Company Name", {}).get("value", "") if isinstance(row.get("Company Name"), dict) else ""
    quarter_year = row.get("Quarter and Year", "") if isinstance(row.get("Quarter and Year"), str) else ""

    # Check cache after we know company+quarter — if cached, return that instead
    if not force_refresh and user_id and company_name and quarter_year:
        cached = get_cached_extraction(company_name, quarter_year, active_columns, user_id)
        if cached:
            return cached

    for field_name, field_data in row.items():
        if isinstance(field_data, dict) and "value" in field_data:
            field_data["confidence"] = compute_confidence(
                field_data.get("value", ""),
                field_data.get("source_quote", ""),
                text,
            )

    if company_name and quarter_year:
        save_extraction(company_name, quarter_year, filename, row, user_id=user_id)

    logger.info(f"=== Finished extraction for '{filename}' successfully ===")
    return row


@app.post("/extract", response_model=ExtractResponse)
async def extract_transcript(
    file: UploadFile = File(...),
    columns: str = None,
    force_refresh: bool = False,
    user_and_email: tuple = Depends(get_current_user_with_email),
):
    user_id, email = user_and_email
    check_and_increment_usage(user_id, email)
    active_columns = _resolve_columns(columns)
    file_bytes = await file.read()
    row = await run_in_threadpool(_extract_one, file.filename, file_bytes, active_columns, user_id, force_refresh)
    return ExtractResponse(filename=file.filename, row=row)


class UrlExtractRequest(BaseModel):
    url: str
    columns: str | None = None


@app.post("/extract-from-url", response_model=ExtractResponse)
async def extract_transcript_from_url(
    payload: UrlExtractRequest,
    user_id: str | None = Depends(get_current_user),
):
    if not payload.url.strip():
        raise HTTPException(status_code=400, detail="No URL provided.")

    active_columns = _resolve_columns(payload.columns)

    try:
        file_bytes = await run_in_threadpool(download_pdf_from_url, payload.url)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=str(e))

    filename = payload.url.rstrip("/").split("/")[-1] or "downloaded.pdf"
    row = await run_in_threadpool(_extract_one, filename, file_bytes, active_columns, user_id)
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
    user_id: str | None = Depends(get_current_user),
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
            row = await run_in_threadpool(_extract_one, f.filename, file_bytes, active_columns, user_id)
            results.append(BatchRowResult(filename=f.filename, ok=True, row=row))
        except HTTPException as e:
            results.append(BatchRowResult(filename=f.filename, ok=False, error=str(e.detail)))
        except Exception as e:
            results.append(BatchRowResult(filename=f.filename, ok=False, error=str(e)))

    return BatchExtractResponse(results=results)


class PriorQuartersResponse(BaseModel):
    company_name: str
    field_name: str
    history: list[dict]


@app.get("/reports")
def get_reports(user_id: str | None = Depends(get_current_user)):
    """Returns all distinct company+quarter reports for the signed-in user, most recent first."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to view your reports.")
    if not DATABASE_URL:
        return {"reports": []}
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        logger.info(f"Fetching reports for user_id='{user_id}'")
        cur.execute(
            """
            SELECT company_name, quarter_year, MAX(extracted_at) as extracted_at
            FROM extractions
            WHERE user_id = %s
            GROUP BY company_name, quarter_year
            ORDER BY MAX(extracted_at) DESC
            """,
            (user_id,),
        )
        rows = cur.fetchall()
        logger.info(f"Found {len(rows)} reports for user_id='{user_id}'")
        cur.close()
        conn.close()
        return {"reports": [{"company_name": r[0], "quarter_year": r[1], "extracted_at": r[2].isoformat()} for r in rows]}
    except Exception:
        logger.exception("Failed to fetch reports list")
        return {"reports": []}


@app.get("/report")
def get_report(
    company_name: str,
    quarter_year: str,
    columns: str = None,
    user_id: str | None = Depends(get_current_user),
):
    """Returns the full cached extraction for a specific company+quarter."""
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to view your reports.")
    active_columns = _resolve_columns(columns)
    cached = get_cached_extraction(company_name, quarter_year, active_columns, user_id)
    if not cached:
        raise HTTPException(status_code=404, detail="Report not found.")
    return {"row": cached}


@app.get("/history", response_model=PriorQuartersResponse)
def get_history(
    company_name: str,
    field_name: str,
    exclude_quarter_year: str = "",
    limit: int = 3,
    user_id: str | None = Depends(get_current_user),
):
    history = get_prior_quarter_values(company_name, exclude_quarter_year, field_name, limit, user_id=user_id)
    return PriorQuartersResponse(company_name=company_name, field_name=field_name, history=history)


class ConsistencyResponse(BaseModel):
    status: str  # NEW | REAFFIRMED | CHANGED | DROPPED | RESUMED
    note: str
    prior_quarter: str | None = None
    prior_value: str | None = None


@app.get("/consistency", response_model=ConsistencyResponse)
def get_consistency(
    company_name: str,
    field_name: str,
    current_value: str,
    current_quarter_year: str = "",
    user_id: str | None = Depends(get_current_user),
):
    adj_quarter = previous_adjacent_quarter(current_quarter_year)
    prior = get_adjacent_quarter_value(company_name, adj_quarter, field_name, user_id=user_id) if adj_quarter else None

    if not prior:
        return ConsistencyResponse(status="NEW", note=build_consistency_note("NEW", current_value, None, None))

    prior_quarter = prior["quarter_year"]
    prior_value = prior["value"]
    status = classify_consistency(current_value, prior_value)
    note = build_consistency_note(status, current_value, prior_value, prior_quarter)

    return ConsistencyResponse(
        status=status, note=note, prior_quarter=prior_quarter, prior_value=prior_value
    )