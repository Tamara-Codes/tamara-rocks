-- Existing production table; keep schema setup separate from signup requests.
CREATE TABLE IF NOT EXISTS workshop_signup_rate_limits (
  key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
