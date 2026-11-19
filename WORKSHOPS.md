# Workshop bookings

## Current state

Paid availability and reservations now use `/api/workshop-bookings`.
Development uses **tamara-rocks**, project `green-leaf-76513978`, isolated branch
`br-holy-mud-b2kyk93l` (`codex/paid-workshop-bookings-2026-11-19`).
The owner explicitly approved the production database migration on 19 November
2026. The schema is applied to production branch `br-patient-mode-b20u3di5`.
The booking flow and private dashboard are deployed at https://www.tamara.rocks.
Production uses the existing database and Resend credentials; test settings were
not deployed. Live endpoint checks verify sessions, admin authentication and the worker.

The existing `.env.local` points to **Konda Academy**. It was left untouched.
Do not use it for this feature. Ignored `.env.bookings.local` contains the isolated
branch connection and local settings. Never upload or commit this file.

## Local development

Run `npm run dev`, or `node --env-file=.env.bookings.local scripts/local-preview.cjs`.

- Workshops: http://127.0.0.1:4173/workshops
- Private bookings: http://127.0.0.1:4173/workshop-admin.html
- **Open test bookings locally** works only in explicit local mode, from a
  loopback connection, with a matching origin. Production requires an access key.
- Paid reservations persist in the test database across refreshes and browsers.
- Local mail delivery is always disabled; the private view labels test mode.
- Free signups, visitor counts and feedback remain mocked locally. The free
  signup code and table are unchanged by the paid-booking implementation.

## Schema

`migrations/20261119_workshop_bookings.sql` creates four paid-booking tables:

- `workshop_sessions`: paid dates, 90 minutes, EUR 49, capacity eight.
- `workshop_bookings`: attendee, session, timezone, consent, status, payment
  invitation/deadline, paid timestamp and hashed cancellation token.
- `workshop_booking_email_outbox`: transactional email jobs and delivery state.
- `workshop_booking_rate_limits`: hashed rate-limit keys.

`workshop_signups` remains exclusively for the free workshop. The earlier
`paid_workshop_requests` migration and endpoint are unused by this flow; do not
apply that migration as a prerequisite.

Paid dates: 25 November 2026 at 19:00 CET and 28 November at 18:00 CET.
The free workshop remains 26 November at 18:00 CET, 45 minutes, without a cap.
No recording is promised.

## Capacity and lifecycle

Allocation locks the session and serializes duplicate requests across dates.
Active bookings own unique, constrained, numbered seats. The first eight
applicants reserve places; later applicants join the waiting list. Repeating an
email for the same cohort does not create another place or another email.

Statuses: reserved, payment_pending, paid, waitlisted, cancelled, expired.
Initial reservations do not expire while checkout is being set up. Payment
invitations are queued; the 48-hour deadline starts after successful email-provider
acceptance. Availability ignores expired payment holds immediately, and allocation
and administration reconcile their database status.

Cancelling an unpaid reservation releases its seat. Management links have a random
token in the URL fragment; only its hash is stored on the booking. GET never changes
a booking; a separate POST confirms cancellation. Paid bookings require the owner
to handle refunds separately. Waiting-list promotion is explicit and ordered by
registration. New applicants cannot jump ahead of people already waiting.

## Private management

The private page shows both sessions, names, emails, statuses and delivery issues,
with filters and CSV export. It can send Stripe payment invitations, manually mark
payments received, cancel unpaid reservations and promote the first person waiting.
Actions have confirmation dialogs.

Production has a randomly generated `WORKSHOP_ADMIN_SECRET` of 64 characters.
Sign-in uses a signed, eight-hour HttpOnly/Secure/SameSite cookie; the key is never
put in a URL or browser storage. Login is rate limited. The page has no indexing
or analytics and is not linked in public navigation. Its API authenticates all
participant reads and mutations.

The owner can open https://www.tamara.rocks/workshop-admin.html and retrieve the
access key from the ignored `.vercel/workshop-dashboard-access.txt` local file.
This file is excluded from both Git and deployment uploads.

## Mail and payment

Reservation/waitlist messages and an owner notification are queued in the same
transaction as a booking. Resend sends after saving. Failure never rolls back
the booking. Queue leases and provider idempotency keys prevent concurrent duplicate
sends. Backoff retries stop after eight attempts. Superseded participant messages
are skipped when a booking changes state.

Required production variables: `DATABASE_URL` (the existing Tamara Rocks connection),
`RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `WORKSHOP_ADMIN_SECRET`, `SITE_URL`.
Optional `BOOKINGS_DATABASE_URL` overrides the database for this feature only.
Owner notifications default to `tamara@nosastra.co`; override using
`WORKSHOP_NOTIFY_EMAIL`. Reply-To remains `tamara@nosastra.co`.
Optional Turnstile needs the workshops meta key and `TURNSTILE_SECRET_KEY`.

The authenticated `/api/workshop-booking-jobs` endpoint expires payment holds
and retries queued mail. `CRON_SECRET` is configured in Vercel. An active Vercel
cron invokes this endpoint every ten minutes with its authenticated header.
The private page can also retry queued mail. After eight failures, inspect the
provider/error before manually resetting that job.

Stripe checkout and webhooks are not connected. Once billing is ready, enter an
HTTPS Stripe Payment Link for each reserved booking. Verify the payment in Stripe
before clicking **Mark paid**. No card details are collected, and payment
reconciliation is manual. Joining links must be sent separately.

## Validation and launch

1. `npm run test:bookings` plus the existing free-signup and unsubscribe tests.
2. Integration tests use `BOOKING_INTEGRATION=true` with the isolated development
   environment. They create synthetic records in separate test cohorts. They cover
   simultaneous submissions, duplicates across dates, waitlist order, cancellation,
   payment expiry and status. The free signup count is verified unchanged.
3. Browser checks verified reservation, 8 → 7 after refresh, private tracking,
   a queued payment invitation and cancellation restoring the count to eight.
4. The tested migration was applied atomically to production after explicit owner
   approval. Both advertised sessions have eight seats and no synthetic records.
5. Production secrets, authenticated cron and dashboard are configured. HTTP checks
   verify public availability, private access, request validation, expiry/retry
   health, free signup validation and preserved feedback. Verification did not
   create a production booking or send a test email. Existing production email
   credentials were retained; unit tests cover delivery success and retry failure.

The migration is idempotent and preserves existing session and booking data.
