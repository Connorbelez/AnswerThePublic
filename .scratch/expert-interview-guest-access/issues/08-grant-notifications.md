# 08 — Deliver actionable grant notifications

**What to build:** Notify administrators only when Guest Access Grant activity needs action: a respondent submits, an unfinished grant approaches expiry, or an audio/attachment upload fails. Notifications use the existing in-app and transactional outbox behavior, remain idempotent, and avoid noise from normal work.

**Blocked by:** 04 — Submit, reopen, and comment on response evidence; 06 — Capture audio, attachments, and transcripts; 07 — Support expiry, revocation, renewal, and grant history.

**Status:** completed

- [x] A new immutable Submission creates one actionable administrator notification with a deep link to the request and source grant.
- [x] An unfinished grant creates one approaching-expiry notification inside the configurable threshold, initially the final 12 hours.
- [x] A failed audio or attachment upload creates one actionable notification with the affected grant and asset context.
- [x] Repeated schedulers, retries, or duplicate failure callbacks cannot create duplicate notifications.
- [x] Opens, autosaves, ordinary progress, successful uploads, transcription progress, and lease heartbeats create no notifications.
- [x] Revoked, submitted, or renewed-out-of-window grants do not produce stale expiry notifications.
- [x] Notification projections never expose plaintext tokens or respondent content beyond the minimum safe summary.
- [x] Existing notification read, email outbox, and deep-link behavior is reused rather than reimplemented.
- [x] Time-controlled notification, outbox, retry, privacy, and browser tests cover all three signals and excluded noise.
