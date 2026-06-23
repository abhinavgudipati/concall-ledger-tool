# Concalls.in

Track and compare management guidance across quarterly earnings calls.

Upload a conference call transcript PDF and get a structured breakdown of what management said — revenue guidance, margins, capex, order book, key risks, and more. Sign in to track how guidance changes quarter over quarter.

---

## What it does

- Extracts structured metrics from earnings call PDFs using Gemini AI
- Classifies guidance as Explicit, Implied, or None
- Scores each field with a confidence level (HIGH / MEDIUM / LOW)
- Rates management conviction on a 1–10 scale with reasoning
- Tracks consistency across adjacent quarters (Q1↔Q2, Q4↔Q1 of next year)
- Flags when guidance is reaffirmed, revised, withdrawn, or reinstated
- Exports results as CSV, Excel, PDF, or Markdown

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite |
| Backend | FastAPI (Python) |
| AI | Google Gemini (gemini-2.5-flash-lite, temperature=0) |
| Auth | Supabase Auth (Google OAuth, ES256 JWT) |
| Database | PostgreSQL via Supabase |
| Hosting | Netlify (frontend) + custom backend |

---

## Pricing

| Tier | India | International | Reports/mo |
|---|---|---|---|
| Free | ₹0 | $0 | 10 |
| Growth | ₹199/mo | $2/mo | 50 |
| Pro | ₹499/mo | $5/mo | 150 |
| Elite | ₹999/mo | $9/mo | Unlimited |

---

## Local development

### Prerequisites

- Python 3.11+
- Node.js 18+
- Conda (recommended for backend env)
- A Supabase project
- A Google Gemini API key

### Backend setup

```bash
cd concall-ledger-tool
conda activate concall-backend
pip install -r requirements.txt
```

Create a `.env` file in the root:

```
GEMINI_API_KEY=your_gemini_key
DATABASE_URL=postgresql://user:password@host:port/dbname
SUPABASE_JWT_SECRET=your_supabase_jwt_secret
```

Run the backend:

```bash
uvicorn main:app --reload
```

### Frontend setup

```bash
cd concall-frontend
npm install
```

Create a `.env.local` file in `concall-frontend/`:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_API_BASE_URL=http://localhost:8000
```

Run the frontend:

```bash
npm run dev
```

---

## Database setup

Run `supabase_migration.sql` in your Supabase SQL editor to create the extractions table, enable Row Level Security, and set up the correct unique index per user.

---

## Environment variables summary

| Variable | Where | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `.env` | Gemini AI access |
| `DATABASE_URL` | `.env` | PostgreSQL connection |
| `SUPABASE_JWT_SECRET` | `.env` | Kept for reference (JWKS used instead) |
| `VITE_SUPABASE_URL` | `.env.local` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `.env.local` | Supabase public anon key |
| `VITE_API_BASE_URL` | `.env.local` | Backend API URL |

---

## Auth flow

- Users can use the tool without signing in (10 free extractions)
- Google Sign-In via Supabase OAuth — no password required
- JWT tokens verified server-side using Supabase's JWKS endpoint (ES256)
- All extractions are scoped to the authenticated user via Row Level Security

---

## Deployment

- Frontend deployed on Netlify with auto-deploy from GitHub
- Custom domain: concalls.in (GoDaddy → Netlify DNS)
- Add `https://concalls.in` to Supabase Auth redirect URLs
- Add `https://concalls.in` to Google OAuth authorized redirect URIs
