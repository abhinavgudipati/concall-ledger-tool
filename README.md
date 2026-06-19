# Concall Insight Extractor — Backend (Phase 1)

A FastAPI backend that takes a concall transcript PDF, extracts the text,
and calls Google's Gemini API to pull out structured guidance into a
table row — the exact same logic as the ConcallTool artifact, but running
as a standalone API you control, powered by Gemini 3.1 Flash-Lite (chosen
for being the cheapest model that's reliable enough for this kind of
structured extraction task).

## What's here

- `main.py` — the FastAPI app (one real endpoint: `POST /extract`)
- `requirements.txt` — pinned dependency versions
- `.env.example` — template for your API key

## 1. Setup (one-time)

This assumes you have [Anaconda or Miniconda](https://docs.conda.io/en/latest/miniconda.html)
already installed. Check with `conda --version` in your terminal first.

```bash
# from inside this folder
conda env create -f environment.yml
conda activate concall-backend
```

This creates an isolated environment named `concall-backend` with Python
3.11 and all required packages. You'll need to run `conda activate concall-backend`
again any time you open a new terminal to work on this.

To remove the environment later if you want to start fresh:
```bash
conda deactivate
conda env remove -n concall-backend
```

Get a free API key from https://aistudio.google.com/apikey, then:

```bash
cp .env.example .env
# open .env and paste your real key in place of the placeholder
```

**Note on cost:** this calls the Gemini API directly, which bills based
on tokens used (Gemini 3.1 Flash-Lite is roughly $0.25 per million input
tokens and $1.50 per million output tokens as of mid-2026 — a typical
transcript extraction costs a small fraction of a cent). Google AI Studio
often includes some free-tier quota before billing kicks in. Check current
pricing at https://ai.google.dev/gemini-api/docs/pricing before running
this against a large batch, since pricing and free-tier limits do change.

## 2. Run it

```bash
uvicorn main:app --reload --port 8000
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

## 3. Test it

**Option A — interactive docs (easiest):**
Open http://localhost:8000/docs in your browser. Click on `POST /extract`,
click "Try it out", upload a PDF, and hit Execute.

**Option B — command line:**
```bash
curl -X POST http://localhost:8000/extract \
  -F "file=@/path/to/your/transcript.pdf"
```

**Option C — with custom fields for that run:**
```bash
curl -X POST "http://localhost:8000/extract?columns=Company%20Name,Margin%20Guidance,Capex%20Plans" \
  -F "file=@/path/to/your/transcript.pdf"
```

Expected response shape:
```json
{
  "filename": "transcript.pdf",
  "row": {
    "Company Name": "Sample Industries Ltd",
    "Growth Guidance": "Management expects 28% revenue growth in FY27.",
    "Margin Guidance": "Management expects 18-19% EBITDA margin in FY27.",
    "Capex/Expansion": "INR 150 crores planned over next two years for Gujarat facility.",
    "Order Book": "Current order book stands at INR 800 crores.",
    "Key Risk": "Raw material price volatility in steel and aluminium.",
    "Key Takeaway": "Strong FY27 growth guided alongside margin expansion plans."
  }
}
```

## What's intentionally NOT here yet (later phases)

- No frontend — this is API-only for now. You can test it via `/docs`,
  curl, or Postman.
- No auth / user accounts — anyone who can reach this server can call it.
  Fine for local testing; not fine once it's on the public internet.
- No usage limits / tiers — every call goes straight to your Gemini
  bill with no cap. Don't deploy this publicly yet without adding limits.
- No database — nothing is saved between requests. Each call is stateless.
- Only handles text-based PDFs — scanned/image-only PDFs will return a
  422 error rather than silently failing.

## Troubleshooting

- **"GEMINI_API_KEY is not set"** — you haven't created `.env`, or it's
  in the wrong folder. It must sit next to `main.py`.
- **403 / "Host not in allowlist" or similar network errors** — if you're
  running this inside a sandboxed or corporate network with restricted
  outbound access, `generativelanguage.googleapis.com` needs to be allowed.
  On a normal home/personal machine this won't come up.
- **401 / invalid API key** — your key in `.env` is wrong, expired, or has
  a typo. Double check against https://aistudio.google.com/apikey.
- **422 "Could not extract text"** — the PDF is likely scanned/image-only.
  pypdf can only read embedded text, not pixels. (OCR support would be a
  future addition if this comes up often.)
- **CORS errors once you build a frontend** — `main.py` currently allows
  all origins (`allow_origins=["*"]`) so this shouldn't happen locally,
  but tighten this before deploying publicly.
