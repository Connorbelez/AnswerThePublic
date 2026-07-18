# 16 — Expose the private ChatGPT App

**What to build:** Authorized users and agents can perform the complete Content Request workflow from ChatGPT's web interface without a desktop agent running.

**Blocked by:** 15 — Complete the agent CLI and HTTP control plane

**Status:** ready-for-agent

- [ ] Private ChatGPT App tools cover full authorized V1 create, read, update, archive, restore, search, drafting, promotion, and delivery workflows.
- [ ] Tool schemas are concise, stable-ID based, and return human summaries plus machine data.
- [ ] Consequential promotion, delivery confirmation, share creation, and archival actions have explicit confirmation boundaries.
- [ ] WorkOS and API authorization rules match other adapters.
- [ ] Fuzzy lookup ambiguity is surfaced rather than guessed.
- [ ] Contract tests prove parity with the shared application service.
