-- Prepared locally only. Verify on an isolated development database before use.
-- Feedback is private. Publication permission does not automatically publish a quote.
BEGIN;

CREATE TABLE IF NOT EXISTS workshop_feedback (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workshop_slug TEXT NOT NULL CHECK (workshop_slug = 'ai-demystified-free'),
    takeaway TEXT NOT NULL CHECK (length(trim(takeaway)) BETWEEN 1 AND 2000),
    improvement TEXT NOT NULL DEFAULT '' CHECK (length(improvement) <= 2000),
    first_name TEXT NOT NULL DEFAULT '' CHECK (length(first_name) <= 80),
    publication_permission TEXT NOT NULL CHECK (publication_permission IN ('named', 'anonymous', 'private')),
    permission_version TEXT NOT NULL,
    permission_prompt TEXT NOT NULL,
    permission_choice TEXT NOT NULL,
    permission_recorded_at TIMESTAMPTZ NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'reviewed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (publication_permission <> 'named' OR length(trim(first_name)) > 0)
);

CREATE TABLE IF NOT EXISTS workshop_feedback_rate_limits (
    key TEXT PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

-- Only the trusted database owner may access feedback through the server.
ALTER TABLE workshop_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE workshop_feedback_rate_limits ENABLE ROW LEVEL SECURITY;

COMMIT;
