-- Bank Feedback Aggregator — Postgres schema
-- Target: Postgres 13+
--
-- Run once against your target database:
--   psql "$DATABASE_URL" -f sql/schema.sql
--
-- Design notes:
--   * `hash` is the dedup key: SHA256(source + feedback_text + review_date) hex-encoded (64 chars).
--   * UNIQUE(hash) is the authoritative dedup guard — the n8n workflow's pre-check
--     is an optimization; ON CONFLICT DO NOTHING is the correctness guarantee.
--   * `review_date` is stored as `timestamptz`; the n8n workflow normalizes to UTC ISO.
--   * `sentiment` is constrained to the three labels the classifier emits.
--   * Indexes target the two hot access patterns: per-bank recent feed, and
--     negative-feedback triage.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

CREATE TABLE IF NOT EXISTS bank_customer_feedback (
    id              BIGSERIAL PRIMARY KEY,
    hash            CHAR(64)     NOT NULL UNIQUE,
    bank_name       TEXT         NOT NULL,
    branch          TEXT,
    rating          NUMERIC(2,1),
    feedback_text   TEXT         NOT NULL,
    author          TEXT,
    sentiment       TEXT         CHECK (sentiment IN ('positive', 'neutral', 'negative')),
    sentiment_score NUMERIC(4,3) CHECK (sentiment_score IS NULL OR (sentiment_score >= 0 AND sentiment_score <= 1)),
    source          TEXT         NOT NULL,
    source_url      TEXT,
    review_date     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bcf_bank_date
    ON bank_customer_feedback (bank_name, review_date DESC);

CREATE INDEX IF NOT EXISTS idx_bcf_sentiment_rating
    ON bank_customer_feedback (sentiment, rating)
    WHERE sentiment = 'negative';

CREATE INDEX IF NOT EXISTS idx_bcf_source
    ON bank_customer_feedback (source, review_date DESC);

-- Per-execution audit table.  One row per workflow run; updated at end-of-run
-- by the main workflow and on failure by the error-handler workflow.
CREATE TABLE IF NOT EXISTS bank_feedback_run_log (
    run_id            UUID PRIMARY KEY,
    started_at        TIMESTAMPTZ NOT NULL,
    finished_at       TIMESTAMPTZ,
    total_fetched     INTEGER,
    total_inserted    INTEGER,
    total_duplicates  INTEGER,
    total_alerts      INTEGER,
    status            TEXT NOT NULL DEFAULT 'running'
);

CREATE INDEX IF NOT EXISTS idx_run_log_started
    ON bank_feedback_run_log (started_at DESC);

-- Convenience view: latest 100 negative reviews per bank.
CREATE OR REPLACE VIEW vw_recent_negative_feedback AS
SELECT bank_name, branch, rating, sentiment_score, source, review_date, feedback_text, source_url
FROM   bank_customer_feedback
WHERE  sentiment = 'negative'
ORDER  BY review_date DESC NULLS LAST
LIMIT  500;
