-- Phase 3: AI usage ledger.
-- One row per attempt to call the model provider. It serves three purposes:
--   1. zero-cost protection: request and token limits and provider cool-downs are enforced from it,
--      across restarts and across stateless Worker instances;
--   2. usage accounting: tokens as reported by the provider;
--   3. traceability: which instruction (fingerprints and versions) produced each reply, with request id.
-- It stores NO prompts, NO message text and NO instruction text. Phase 4 will store the same trace in
-- messages.metadata next to each stored assistant message; this table does not replace that.

CREATE TABLE ai_usage (
  id                     TEXT PRIMARY KEY,
  user_id                TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id             TEXT NOT NULL,
  provider               TEXT NOT NULL,
  model                  TEXT NOT NULL,
  status                 TEXT NOT NULL CHECK (status IN ('started', 'completed', 'incomplete', 'error', 'rate_limited', 'quota_exhausted', 'cancelled', 'timeout')),
  error_kind             TEXT,
  attempt                INTEGER NOT NULL DEFAULT 1,
  estimated_tokens       INTEGER NOT NULL DEFAULT 0,
  input_tokens           INTEGER,
  output_tokens          INTEGER,
  total_tokens           INTEGER,
  latency_ms             INTEGER,
  blocked_until          TEXT,
  permanent_fingerprint  TEXT,
  instruction_fingerprint TEXT,
  instruction_versions   TEXT,
  day                    TEXT NOT NULL,
  created_at             TEXT NOT NULL,
  completed_at           TEXT
);
CREATE INDEX idx_ai_usage_day ON ai_usage(day);
CREATE INDEX idx_ai_usage_created ON ai_usage(created_at);
CREATE INDEX idx_ai_usage_blocked ON ai_usage(provider, model, blocked_until);
CREATE INDEX idx_ai_usage_request ON ai_usage(request_id);
