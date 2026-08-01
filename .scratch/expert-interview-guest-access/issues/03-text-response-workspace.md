# 03 — Answer and autosave text in both response modes

**What to build:** Turn the token-scoped guest brief into the production Focused Proofline response experience. A respondent can inspect every Interview Question and motivation, choose **Answer all at once** or **Answer one at a time**, enter text, see progress, switch or navigate safely, and resume autosaved work. Each grant owns one isolated Response Workspace. Administrators can inspect provisional text and progress read-only.

**Blocked by:** 02 — Generate a Person-assigned response link.

**Status:** completed

- [x] The mobile-first brief shows title, topic, summary, audience, framing, FairLend posture, founder contribution, every question, and every motivation.
- [x] Question rows appear beneath progress and support accessible progressive disclosure.
- [x] A sticky split action exposes **Answer all at once** and **Answer one at a time** without obscuring final content.
- [x] Batch mode expands every question and motivation above one shared composer.
- [x] One-at-a-time mode preserves a stable answer per Interview Question ID and lets any question be opened.
- [x] Batch and per-question material remain independent when switching modes; neither is silently converted or deleted.
- [x] Text, mode, progress, and revisions autosave idempotently and survive reload/navigation.
- [x] Stale revisions return a recoverable conflict rather than overwriting newer work.
- [x] Administrators can inspect provisional text and progress but cannot mutate respondent evidence.
- [x] Two grants for the same request cannot observe or mutate one another’s workspace.
- [x] Browser, application contract, persistence, isolation, and accessibility tests cover the complete workflow.
