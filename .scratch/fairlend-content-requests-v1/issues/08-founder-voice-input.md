# 08 — Capture founder voice input

**What to build:** Elie can provide the same single founder submission through voice, including reliable recording controls, offline-safe capture, and a transcript that agents can consume.

**Blocked by:** 07 — Support offline editing, versioning, and conflicts

**Status:** ready-for-agent

- [ ] Elie can record, pause, resume, and stop with clear state and elapsed time.
- [ ] Switching between voice and keyboard does not discard either form of input.
- [ ] Recording captured offline is queued for durable synchronization.
- [ ] The resulting transcript and audio reference belong to the single founder-input document.
- [ ] Failed upload or transcription is recoverable and does not corrupt typed input.
- [ ] Browser tests cover permission denial and reduced-capability environments.
