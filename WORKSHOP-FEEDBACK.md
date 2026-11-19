# Workshop feedback

Original UI branch: `codex/workshop-feedback`. The feedback-only release is prepared on `codex/workshop-feedback-live` from current production source.

Run `npm run dev` and open `/workshop-feedback`. The shared local preview server
validates responses and simulates success, but never loads environment files,
connects to the database, sends mail, or saves responses. A preview banner and
the thank-you screen identify test submissions. All three publication choices
can be tried using “Try the form again.”

The form is for AI Demystified's free introductory workshop. It collects one
required takeaway, an optional improvement, an optional first name, and a
publication choice. Private is selected by default. Choosing named publication
requires a first name. There is no email collection, newsletter signup or upsell.

The production handler is POST-only. It validates bounded fields, checks browser
origins, uses a honeypot and a durable hashed-IP rate limit, and records the
permission wording, version, chosen option and timestamp with each response.
Workshop identity and `unreviewed` status are set by the server. There is no public
read endpoint or automatic publishing. Anonymous permission means a published
quote must omit the name even if the participant supplied it privately.

## Checks

`node --test tests/workshop-feedback.test.cjs`

Tests stub the database driver; they never use `.env.local` or the real database.

## Before a future deployment

- Verify `migrations/20261119_workshop_feedback.sql` on an isolated development
  database, then apply it through the existing database migration workflow.
  The migration and real handler have been verified on the isolated Neon branch
  `dev/workshop-feedback-2026-11-19`.
- Use the existing server-only `DATABASE_URL` (and `RATE_LIMIT_SALT` if configured).
  Never include these in the page or client script.
- Test a real submission and review the saved choice before sharing the live URL.
- Share the `/workshop-feedback` link in Meet chat and the follow-up email.
- Review feedback privately in the database. This change does not add an admin UI.
  Select a quote manually, honor its permission, and identify it as feedback from
  the free introductory workshop. Substantial edits need the author's approval.

The page uses `noindex, nofollow`, is not added to navigation or the sitemap,
and contains no analytics or visitor-counter script.

## Storage verification

`scripts/verify-feedback-storage.cjs` accepts one JSON line on stdin with a private
`connection`, its verified `expectedHost`, and `mode`. Use `verify` only for a
development branch; `apply` applies the same atomic migration without test rows.
Credentials must never be written to a tracked file or included in shell arguments.
The migration enables row-level security with no public policies; only the trusted
database owner used by the server can access these records.
