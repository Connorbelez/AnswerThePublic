# 04 — Ingest and deduplicate scout reports

**What to build:** Agents can turn a complete maintained scout Markdown report into structured Content Requests atomically without losing source evidence or creating duplicate opportunities.

**Blocked by:** 02 — Create, retrieve, and find Content Requests

**Status:** ready-for-agent

- [ ] The complete Markdown document is validated before any write occurs.
- [ ] Invalid reports write nothing and return structured diagnostics.
- [ ] Valid reports atomically upsert source, context, research, citations, urgency, and delivery hints.
- [ ] Source URLs are conservatively normalized and deduplicated.
- [ ] Re-ingestion preserves immutable source snapshots and founder input.
- [ ] A matching manual request upgrades the existing request to manual/Critical without duplicating it.
- [ ] CLI and HTTP ingestion expose idempotency and machine-readable results.
