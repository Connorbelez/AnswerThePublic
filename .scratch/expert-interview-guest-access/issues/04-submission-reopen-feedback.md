# 04 — Submit, reopen, and comment on response evidence

**What to build:** Complete the evidence lifecycle for a text Response Workspace. The respondent explicitly confirms submission, producing an immutable attributed Submission and locking future edits. Administrators can leave separate targeted feedback and reopen the workspace for later additions without changing prior Submissions.

**Blocked by:** 03 — Answer and autosave text in both response modes.

**Status:** completed

- [x] A clear bottom-of-screen Submit action opens an accessible “Are you sure?” confirmation explaining that the snapshot becomes read-only.
- [x] Submission validates the current workspace revision and settled required operations before succeeding.
- [x] Submission creates an immutable snapshot of batch/per-question answers, question versions, respondent attribution, and submission time.
- [x] The workspace becomes read-only after submission and rejects autosave mutations while locked.
- [x] Administrators can leave attributable feedback scoped to the workspace or an Interview Question without editing respondent content.
- [x] Respondents see feedback in context while retaining authorship of their answers.
- [x] An administrator can reopen a valid workspace; future edits create later evidence without mutating the previous Submission.
- [x] Submission, feedback, locking, and reopening are audited with stable domain errors and idempotent retry behavior.
- [x] Admin, guest, persistence, immutability, and browser tests demonstrate the complete lifecycle.
