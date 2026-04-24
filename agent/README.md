# Bank Feedback Insights Agent

A free, browser-deployable AI agent that sits on top of the feedback dataset
produced by the n8n workflow in the parent repo. Ask natural-language questions
— the agent answers them by calling typed tools over the reviews.

## Stack (all free, zero laptop installs)

| Layer | Choice | Why |
| --- | --- | --- |
| Editor | **GitHub Codespaces** (browser VS Code) | 60 hrs/mo free, no local setup |
| Framework | **Next.js 15** (App Router) | Streaming, edge-friendly |
| Agent runtime | **Vercel AI SDK** (`ai`, `@ai-sdk/google`) | Tool calls + streaming out of the box |
| LLM | **Google Gemini** via AI Studio | Free tier, no credit card |
| Hosting | **Vercel** (Hobby) | Git push → live URL |
| Data | `mock-data/reviews.json` from parent repo | Swap for Supabase/Postgres later |

## What the agent can do

Four typed tools are exposed to Gemini:

- `search_feedback(query, bank?, sentiment?, days?, limit?)` — keyword search
- `sentiment_summary(banks?, days?)` — aggregates counts + avg rating per bank
- `top_complaints(bank?, branch?, days?, limit?)` — worst negative reviews
- `branch_hotspots(bank?, days?, limit?)` — branches with most negative reviews

Try:
- *"Top 3 complaints about HDFC Bank this week"*
- *"Compare sentiment: ICICI vs SBI"*
- *"Which branches have the most 1-star feedback?"*
- *"Find NEFT / UPI issues across all banks"*

## Browser-only deployment (no terminal)

### 1. Open this repo in Codespaces
On the GitHub repo page, press `.` or click **Code → Codespaces → Create**.
A full VS Code opens in your browser.

### 2. Get a free Gemini key
Go to https://aistudio.google.com/app/apikey → **Create API key**. Copy it.

### 3. Install deps + run (inside Codespaces terminal panel — still browser)
```
cd agent
npm install
cp .env.example .env.local   # paste GOOGLE_GENERATIVE_AI_API_KEY
npm run dev
```
Codespaces auto-forwards port 3000 → a preview URL in your browser.

> If you want to avoid *any* terminal at all: skip step 3 and go straight to
> Vercel (step 4). Vercel runs `npm install` + `next build` for you.

### 4. Deploy to Vercel (pure browser)
1. Push this branch (Codespaces' Source Control pane → Sync).
2. Visit https://vercel.com/new → **Import Git Repository** → select the repo.
3. Set **Root Directory** = `agent` (important — the app lives in a subfolder).
4. Add environment variable `GOOGLE_GENERATIVE_AI_API_KEY` = your key.
5. Click **Deploy**. ~60s later you get `https://<project>.vercel.app`.

Every subsequent `git push` triggers an automatic redeploy.

### 5. (Optional) Swap mock data for live Postgres
The parent `sql/schema.sql` defines `bank_customer_feedback`. To read live:
1. Spin up free Postgres: https://supabase.com → New project (all browser).
2. Run `sql/schema.sql` in Supabase's SQL editor.
3. Replace `lib/data.ts` with a Supabase client query; keep the `tools.ts`
   signatures identical so the agent surface doesn't change.

## File layout

```
agent/
  app/
    api/chat/route.ts   # Vercel AI SDK streaming endpoint w/ tools
    layout.tsx
    page.tsx            # chat UI using @ai-sdk/react useChat
    globals.css
  lib/
    data.ts             # loads mock-data/reviews.json
    tools.ts            # 4 typed tools, zod-validated
  package.json
  tsconfig.json
  next.config.mjs
  .env.example
```

## Cost

- Gemini: free tier (plenty for development + light production)
- Vercel: Hobby plan, $0
- Codespaces: 60 free hours/month

Total: **$0**.
