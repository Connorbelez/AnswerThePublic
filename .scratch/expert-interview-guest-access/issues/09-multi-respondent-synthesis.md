# 09 — Synthesize selected multi-respondent Submissions

**What to build:** Let administrators and local agents process several independent Expert Interview Submissions without flattening provenance. Administrators explicitly include or exclude each Submission. MCP, CLI, HTTP, and UI obtain the same attributed evidence bundle and grounded synthesis prompt, and completion creates a provenance-linked immutable Deliverable Version.

**Blocked by:** 01 — Make Expert Interviews first-class Content Requests; 04 — Submit, reopen, and comment on response evidence.

**Status:** completed

- [x] Administrators can list every immutable Submission with its assigned Person, submission time, progress/source summary, and inclusion state.
- [x] Inclusion and exclusion are explicit, attributable decisions; no Submission is silently selected.
- [x] Processing validates that every selected Submission belongs to the target Expert Interview.
- [x] Processing input contains the Interview Brief, Knowledge Gaps, citations, questions, motivations, selected answer snapshots, and asset/transcript metadata.
- [x] Operator instructions appear before agent defaults and cannot be overridden by inference.
- [x] The synthesis prompt separates sourced facts, practitioner claims, and editorial inference; preserves material disagreement; and calls out unresolved gaps.
- [x] The prompt forbids invented quotations, case details, outcomes, and regulatory conclusions.
- [x] MCP publishes the multi-Submission processing schema and native synthesis prompt; CLI and HTTP use the same shared operation.
- [x] Completion creates a new article Deliverable or immutable version and records selected Submission and context-version provenance.
- [x] Existing single-founder processing migrates to this Submission model rather than remaining a parallel path.
- [x] Multi-respondent, conflicting-evidence, provenance, agent-discovery, CLI, and Deliverable-version tests cover the end-to-end behavior.
