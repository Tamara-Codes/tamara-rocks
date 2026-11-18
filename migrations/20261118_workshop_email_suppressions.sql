CREATE TABLE IF NOT EXISTS public.workshop_email_suppressions (
  email TEXT PRIMARY KEY CHECK (email = lower(btrim(email))),
  reason TEXT NOT NULL CHECK (reason IN ('invalid_mailbox', 'disabled_mailbox', 'mailbox_unavailable')),
  smtp_status TEXT NOT NULL,
  diagnostic TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  original_signup_id BIGINT,
  original_created_at TIMESTAMPTZ,
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE OR REPLACE VIEW public.workshop_mailable_signups AS
SELECT w.id, w.email, w.created_at
FROM public.workshop_signups w
WHERE NOT EXISTS (
  SELECT 1 FROM public.workshop_email_suppressions s
  WHERE s.email = lower(btrim(w.email))
);
