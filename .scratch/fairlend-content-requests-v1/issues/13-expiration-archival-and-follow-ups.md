# 13 — Handle expiration, archival, and follow-ups

**What to build:** Stale and completed work leaves active queues without being destroyed, while genuine new response obligations preserve their relationship to the original.

**Blocked by:** 02 — Create, retrieve, and find Content Requests; 12 — Build the operator action workspace

**Status:** ready-for-agent

- [ ] Automated unstarted requests expire from active queues at expires-at.
- [ ] Manual and meaningfully started requests never auto-expire.
- [ ] Unclaimed jobs cancel on expiration; started jobs surface for operator disposition.
- [ ] Editors can restore an expired request and replace its expiration.
- [ ] Requests and related records archive and restore without ordinary hard deletion.
- [ ] Genuine follow-ups create linked child requests; reopening remains limited to failed or incorrect delivery.
- [ ] All disposition changes are authorized and audited.
