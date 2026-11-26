-- Phase 2: persistent instruction configuration.
-- The permanent layers (identity, constitution, personality profile) live in versioned source code.
-- instruction_revisions is an append-only ledger of which (version, content hash) each running
-- build has used, so silent edits are detectable and every deliberate update leaves a record.

CREATE TABLE instruction_revisions (
  id           TEXT PRIMARY KEY,
  layer        TEXT NOT NULL CHECK (layer IN ('identity', 'constitution', 'personality')),
  version      TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  recorded_at  TEXT NOT NULL,
  UNIQUE (layer, content_hash)
);
CREATE INDEX idx_instruction_revisions_layer ON instruction_revisions(layer, version);

-- Adjustable personality settings (JSON), one row per user. `revision` increments on every change.
CREATE TABLE personality_settings (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  settings   TEXT NOT NULL,
  revision   INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

-- Layer 4: the user's standing preferences. Screened on write and again on every assembly.
CREATE TABLE user_preferences (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_user_preferences_user ON user_preferences(user_id, created_at);
