# 06 — Capture audio, attachments, and transcripts

**What to build:** Let a respondent add durable voice and file evidence to either the batch response or a specific Interview Question. Uploads and transcription run safely alongside text work, expose progress and recovery, remain isolated to the grant, and become immutable evidence when submitted.

**Blocked by:** 03 — Answer and autosave text in both response modes.

**Status:** completed

- [x] Respondents can record audio or attach permitted files in batch scope or against a stable Interview Question ID.
- [x] Assets persist grant, workspace, scope, MIME type, size, upload state, transcription state, and retry history.
- [x] The UI exposes recording, upload, transcription, success, and failure states without blocking unrelated text work.
- [x] Failed uploads provide retry or discard recovery and create no duplicate assets on exact retries.
- [x] MIME allowlists, size limits, and request/grant authorization are enforced server-side.
- [x] Transcripts remain attributable to their source capture and cannot be silently merged into respondent text.
- [x] Administrators can inspect provisional assets and transcripts read-only and attach feedback to an asset.
- [x] Submission snapshots reference settled asset/transcript versions and reject submission while a required operation is unresolved.
- [x] Submitted asset evidence is immutable and never visible to another grant.
- [x] Upload, failure recovery, transcription, projection, security, and browser tests cover the complete path.
