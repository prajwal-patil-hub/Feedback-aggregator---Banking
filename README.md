# Bank Feedback Aggregator (n8n)

An industry-grade [n8n](https://n8n.io) workflow that aggregates customer
feedback for Indian banks from multiple online sources, normalizes it,
deduplicates, classifies sentiment, stores it in Postgres, and alerts on
strongly negative feedback via Slack.

## What it does

Every **6 hours** the workflow:

1. Loads a config-driven list of banks (HDFC, ICICI, SBI, Axis, Kotak — edit
   the *Banks Config* node to add more).
2. Fans out to four data sources **in parallel**:
   - **Google Maps / Google Business reviews** via Google Places API v1
     (`places:searchText` → `places/{id}` details with `reviews` field mask)
   - **Twitter / X** via `GET /2/tweets/search/recent` (last 24h)
   - **Reddit** — public `.json` endpoint searching posts in
     `r/IndiaInvestments`, `r/personalfinanceindia`, `r/india`,
     `r/IndianStreetBets` (last 30 days). No auth required, just a
     `User-Agent` header. Subreddit is stored in the `branch` field as
     `r/IndiaInvestments` etc.
   - **Generic scraper intake** — an HTTP endpoint returning JSON for sites
     like MouthShut, Trustpilot, BankBazaar, ConsumerComplaintsIndia. Ships
     pointed at the mock dataset in `mock-data/reviews.json`. Swap in an
     Apify actor URL or your own scraper to go live.
3. Merges all branches into a **unified schema**:
   ```
   { bank_name, branch, rating, feedback_text, author,
     review_date, source, source_url }
   ```
4. Computes a SHA-256 **dedup hash** = `sha256(source + feedback_text + review_date)`
   and skips rows that already exist in Postgres.
5. Calls **Groq** (`llama-3.1-8b-instant`, JSON mode, OpenAI-compatible API,
   free tier) for sentiment classification (`positive` / `neutral` /
   `negative`, score 0–1). Swap the URL + model to use OpenAI, Gemini, or any
   other OpenAI-compatible endpoint.
6. **Inserts** into `bank_customer_feedback` with `ON CONFLICT (hash) DO NOTHING`
   as the hard dedup guarantee.
7. Sends a **Slack alert** when `sentiment = negative` AND `rating <= 2`.
8. Writes a per-run **audit row** to `bank_feedback_run_log`.
9. Returns a summary payload:
   ```
   { total_reviews_fetched, total_inserted, total_duplicates_skipped,
     total_alerts, total_errors, run_id, run_started_at, run_finished_at }
   ```

A dedicated **error-handler workflow** catches any uncaught exception,
posts to `#bank-feedback-ops` on Slack, and stamps an `error` row in the
run log.

## Repository layout

```
workflows/
  bank-feedback-aggregator.json   # main workflow — import this
  error-handler.json              # wired via settings.errorWorkflow
sql/
  schema.sql                      # tables, indexes, view
.env.example                      # placeholders for every secret
.gitignore
README.md
```

## Prerequisites

| Component | Version |
| --- | --- |
| n8n | 1.50+ (self-hosted or cloud) |
| Postgres | 13+ (uses `pgcrypto` for `gen_random_uuid()`) |
| Google Cloud project | Places API v1 enabled |
| X / Twitter developer account | v2 API, Basic tier or higher |
| OpenAI account | Any tier with `gpt-4o-mini` access |
| Slack workspace | Bot with `chat:write` scope |

## Setup

### 1. Provision Postgres

```bash
createdb bank_feedback
psql "$DATABASE_URL" -f sql/schema.sql
```

### 2. Configure n8n credentials

Create these five credentials in the n8n UI. Names **must** match exactly —
the workflow references them by name.

| Credential name | Type | Configuration |
| --- | --- | --- |
| `Google Places API` | HTTP Header Auth | Name: `X-Goog-Api-Key`  Value: `<GOOGLE_PLACES_API_KEY>` |
| `Twitter Bearer` | HTTP Header Auth | Name: `Authorization`  Value: `Bearer <TWITTER_BEARER_TOKEN>` |
| `Groq API` | HTTP Header Auth | Name: `Authorization`  Value: `Bearer <GROQ_API_KEY>` |
| `Postgres Main` | Postgres | Host/port/db/user/password from `.env` |
| `Slack Bot` | Slack (OAuth2 or API token) | Bot token with `chat:write` |

### 3. Configure environment variables

The workflow reads a few `$env.*` values at runtime:

| Variable | Used where | Default |
| --- | --- | --- |
| `SCRAPER_URL` | Generic Scraper Intake HTTP node | `https://scraper.internal.example.com/reviews` |
| `SLACK_ALERT_CHANNEL` | Slack negative-feedback alerts | `#bank-feedback-alerts` |
| `SLACK_OPS_CHANNEL` | Error-handler Slack post | `#bank-feedback-ops` |

Set them in your n8n environment (Docker env, systemd unit, cloud env pane).

### 4. Import the workflows

In n8n UI: **Workflows → Import from File**

1. Import `workflows/error-handler.json` **first**, rename nothing.
2. Import `workflows/bank-feedback-aggregator.json`.
3. Open the main workflow → **Settings** → confirm *Error Workflow* points to
   the Error Handler (the JSON references it by slug, but the UI may need a
   one-time click).

### 5. Smoke test

Open the main workflow → **Execute Workflow**. Expected on a fresh DB:

- Each branch returns data (or logs a handled error and continues).
- Rows appear in `bank_customer_feedback` with unique hashes.
- Running a second time within 24h inserts ~zero new rows (dedup working).

To force a Slack alert, insert a low-rated negative row manually, then the
next live fetch of the same text will be deduped — seed via API call to
`SCRAPER_URL` for a clean end-to-end test:

```bash
curl -XPOST "$SCRAPER_URL/seed" -H 'Content-Type: application/json' -d '{
  "reviews": [{
    "review_text": "Worst branch experience. Staff is rude and ATM never works.",
    "rating": 1,
    "author": "test user",
    "date": "'$(date -u +%FT%TZ)'",
    "url": "https://example.com/review/1",
    "source_name": "MouthShut"
  }]
}'
```

### 6. Activate

Toggle the main workflow **Active**. The cron starts firing every 6 hours.

## Querying the results

```sql
-- Sentiment breakdown per bank, last 7 days
SELECT bank_name,
       sentiment,
       COUNT(*)                     AS n,
       ROUND(AVG(rating)::numeric,2) AS avg_rating
FROM   bank_customer_feedback
WHERE  review_date >= NOW() - INTERVAL '7 days'
GROUP  BY bank_name, sentiment
ORDER  BY bank_name, sentiment;

-- Most recent negative feedback needing triage
SELECT * FROM vw_recent_negative_feedback LIMIT 20;

-- Run history
SELECT * FROM bank_feedback_run_log ORDER BY started_at DESC LIMIT 20;
```

## Schema reference

See [`sql/schema.sql`](sql/schema.sql). Key columns of
`bank_customer_feedback`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `BIGSERIAL` | PK |
| `hash` | `CHAR(64)` | `UNIQUE`, dedup key |
| `bank_name` | `TEXT` | e.g. `HDFC Bank` |
| `branch` | `TEXT` | nullable (Twitter rows have no branch) |
| `rating` | `NUMERIC(2,1)` | 0.0–5.0; `NULL` for tweets |
| `feedback_text` | `TEXT` | trimmed to 8000 chars by workflow |
| `author` | `TEXT` | display name; never profile URL |
| `sentiment` | `TEXT` | `positive` / `neutral` / `negative` |
| `sentiment_score` | `NUMERIC(4,3)` | 0–1, classifier confidence |
| `source` | `TEXT` | `Google Maps`, `Twitter`, `MouthShut`, … |
| `source_url` | `TEXT` | permalink |
| `review_date` | `TIMESTAMPTZ` | UTC |
| `created_at` | `TIMESTAMPTZ` | ingestion time |

## Operational notes

- **Retries**: every HTTP node has `retryOnFail: true`, 3 tries, 5s backoff,
  and `continueOnFail: true` so one dead source doesn't abort the run.
- **Rate limits**: a 2s `Wait` node throttles between banks; tune down if you
  expand the bank list.
- **Sentiment cost**: `llama-3.1-8b-instant` on Groq's free tier covers this
  workload (~400 reviews/day) with headroom. Upgrade to a paid tier or swap
  in `llama-3.3-70b-versatile` for higher accuracy; both use the same
  OpenAI-compatible endpoint.
- **PII**: only display names are stored. Do not add profile URLs or handle
  strings that could re-identify end users beyond what's already public on
  the review platform.
- **Idempotency**: safe to re-run manually at any time; `ON CONFLICT (hash)
  DO NOTHING` protects the table.

## Extending

Add a new source by:

1. Adding an HTTP Request node + a *Map To Raw* Code node (copy the Twitter
   pair as a template).
2. Routing its output into a new input index of **Merge All Sources**.
3. Ensuring the raw row has: `bank_name, run_id, branch, rating,
   feedback_text, author, review_date, source, source_url`.

Add a new bank by editing the `banks` array in the **Banks Config** node.
No code changes elsewhere.
