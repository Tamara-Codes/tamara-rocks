# Workshop mailing lists

Export recipients from the production Neon `public.workshop_mailable_signups` view immediately before a send. This view excludes addresses in `public.workshop_email_suppressions`, even if an address has subsequently been re-added to `workshop_signups`. Intersect the view with the intended workshop cohort and exclude prior sends of the same reminder.

```sql
SELECT email, created_at
FROM public.workshop_mailable_signups
ORDER BY created_at, email;
```

For confirmed permanent delivery failures, save the address, failure reason, SMTP status, diagnostic, Gmail bounce message ID, and original signup ID and timestamp in `workshop_email_suppressions`. Remove the corresponding active signup in the same transaction. Retain suppression records for future sends and review a corrected address before lifting a suppression.

Check the full delivery-status report. Missing, disabled, or unavailable recipient mailboxes should be suppressed; a temporary deferral or sender-policy problem requires separate review. A sent message is not proof of delivery.

The current signup handler does not consult the suppression table. The mailing view provides the exclusion for exports, including re-added addresses. New Gmail bounce notices must still be reviewed and recorded; this migration does not add automatic Gmail monitoring.

Website unsubscribe requests remove active signups from Neon. Always use a fresh mailing view and respect direct removal requests, rather than reusing an older CSV.
