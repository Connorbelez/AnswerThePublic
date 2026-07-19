import { describe, expect, it, vi } from "vitest"

import { createScoutIngestionHandler } from "@/application/scout-ingestion-http"
import type { ScoutIngestionService } from "@/application/scout-ingestions"
import { parseScoutReport } from "@/domain/scout-report"
import { normalizeSourceUrl } from "../../shared/url-normalization"
import { runContentRequestsCli } from "@/cli/content-requests"
import { AuthenticationRequiredError } from "@/application/workspace-session"

export const VALID_SCOUT_REPORT = `# FairLend Community + Media Opportunity Report — 2026-07-18 09:00 ET

## Executive summary

- Qualified community questions: 1
- Live journalist/source requests: 1
- Beat-aligned journalist/editorial prospects: 1
- Journalist story leads: 1
- New search-demand signals: 1
- Highest-priority action: Answer the renewal question.
- Run notes: Reddit and public editorial sources searched.

## A. Community questions to answer

### A1. Renewal affordability — Score: 92/100 — Act by: while active

- **Thread:** [Can I afford my renewal?](https://Example.com:443/r/Mortgages/comments/42/?utm_source=scout&sort=new#comments)
- **Source:** r/MortgagesCanada; 2026-07-18; one hour old; active
- **Question:** How can a borrower prepare for a much higher renewal payment?
- **Why FairLend can help:** Canadian mortgage renewal expertise.
- **What is missing from existing replies:** A decision framework.
- **Compliance/moderation check:** Medium; disclose affiliation and avoid individualized advice.
- **Recommended response:** Answer without link
- **Optional FairLend resource:** None
- **SEO/content signal:** Durable renewal affordability question and content gap.

**Draft response**

> This text must never become Elie's deliverable.

**Evidence used**

- [Bank of Canada policy rate](https://bank.example/rates?utm_campaign=x) — current benchmark context

## B. Live journalist/source requests

### B1. Jane Example / Daily News renewal story — Score: 88/100 — Deadline: 2026-07-19 17:00 ET

- **Request:** [Public request](https://news.example/source-request/7?gclid=tracker)
- **Reporter/publication:** Jane Example, Daily News
- **Need:** A mortgage expert interview.
- **Fit:** Elie can explain renewal tradeoffs.
- **Credibility/deadline check:** Reporter page verified; deadline live.
- **What FairLend can contribute:** Renewal scenarios; borrower preparation checklist.
- **Risks:** Avoid client-specific advice.
- **Recommended action:** Respond now

**Draft pitch**

> Draft pitch excluded from deliverables.

**Evidence pack**

- [Reporter profile](https://news.example/jane) — identity and role

## C. Beat-aligned journalist/editorial prospects

### C1. John Example / Canadian Finance — Prospect fit: 78/100 — Priority prospect

- **Identity/current role:** [John Example](https://finance.example/authors/john), housing editor
- **Canonical work:** [Renewals](https://finance.example/renewals); [Rates](https://finance.example/rates)
- **Demonstrated beat:** Canadian housing finance.
- **Why FairLend is relevant:** Front-line mortgage operations context.
- **Potential future angles:** Renewal shock; qualification friction.
- **Public editorial channel:** [Tips](https://finance.example/tips)
- **Risks/constraints:** Confirm current assignment before outreach.
- **Recommended action:** Monitor

## D. Journalist story leads from community discussions

### D1. Renewal shock is changing household budgets — Score: 80/100

- **Community evidence:** [Thread](https://community.example/t/renewal-shock) from 2026-07-18
- **Observed pattern:** Several borrowers describe cutting expenses before renewal.
- **Why it may matter now:** A large renewal cohort is approaching.
- **What is known vs. unverified:** Posts are anecdotal; prevalence is unknown.
- **Reporting path:** Validate with Bank of Canada and CMHC datasets.
- **FairLend contribution:** Anonymized aggregate operational context.
- **Suggested journalist framing:** How households prepare for payment resets.
- **Risk check:** Avoid generalizing from a small sample.

## E. Content-demand ledger

| Audience phrase/question | Source | Intent | Geography | Frequency this run | Existing FairLend answer? | Recommended content action |
|---|---|---|---|---:|---|---|
| Can I afford renewal? | Reddit | Learn | Canada | 1 | No | add FAQ section to a relevant page |

## F. Needs manual verification

- None.

## G. Rejected high-surface-area leads

- None.

## H. No-op status

- Not applicable; qualified opportunities are listed above.
`

describe("Scout report parser and adapters", () => {
  it("normalizes only transport and known tracking noise", () => {
    expect(
      normalizeSourceUrl(
        "HTTPS://Example.COM:443/path/?b=2&utm_source=scout&a=1#discussion"
      )
    ).toBe("https://example.com/path/?b=2&a=1#discussion")
    expect(
      normalizeSourceUrl("https://example.com/search?q=renewal&ref=real")
    ).toBe("https://example.com/search?q=renewal&ref=real")
  })

  it("parses every actionable section and excludes generated drafts", () => {
    const result = parseScoutReport(VALID_SCOUT_REPORT)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("Expected a valid report")
    expect(result.report.opportunities.map((item) => item.section)).toEqual([
      "A",
      "B",
      "C",
      "D",
    ])
    expect(result.report.opportunities[0]).toMatchObject({
      itemId: "A1",
      score: 92,
      normalizedSourceUrl:
        "https://example.com/r/Mortgages/comments/42/?sort=new#comments",
      question: "How can a borrower prepare for a much higher renewal payment?",
      deliveryHints: ["Answer without link"],
    })
    expect(
      JSON.stringify(
        result.report.opportunities.map((item) => item.talkingPoints)
      )
    ).not.toContain("must never become Elie's deliverable")
  })

  it("collects line-addressed diagnostics for the complete document", () => {
    const malformed = VALID_SCOUT_REPORT.replace(
      "## D. Journalist story leads from community discussions",
      "## Missing D"
    )
      .replace("## Executive summary", "## Summary")
      .replace("- **Question:**", "- **Wrong label:**")
    const result = parseScoutReport(malformed)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("Expected diagnostics")
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "MISSING_SECTION", path: "section.D" }),
        expect.objectContaining({
          code: "MISSING_SECTION",
          path: "section.executive_summary",
        }),
        expect.objectContaining({ code: "MISSING_FIELD", path: "A1.Question" }),
      ])
    )
    expect(result.diagnostics.every((item) => item.line >= 1)).toBe(true)
  })

  it("rejects malformed headings and duplicate canonical sources", () => {
    const malformedHeading = parseScoutReport(
      VALID_SCOUT_REPORT.replace("### A1.", "### A1 -")
    )
    expect(malformedHeading).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_HEADING",
          path: "A1.heading",
        }),
      ]),
    })
    const missingIdentifier = parseScoutReport(
      VALID_SCOUT_REPORT.replace("### A1.", "###")
    )
    expect(missingIdentifier).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_HEADING" }),
        expect.objectContaining({
          code: "COUNT_MISMATCH",
          path: "executive_summary.A",
        }),
      ]),
    })
    const duplicated = parseScoutReport(
      VALID_SCOUT_REPORT.replace(
        "https://news.example/source-request/7?gclid=tracker",
        "https://Example.com:443/r/Mortgages/comments/42/?utm_source=duplicate&sort=new#comments"
      )
    )
    expect(duplicated).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "DUPLICATE_SOURCE",
          path: "B1.Request",
        }),
      ]),
    })
  })

  it("enforces maintained qualification thresholds", () => {
    const result = parseScoutReport(
      VALID_SCOUT_REPORT.replace("Score: 92/100", "Score: 69/100")
    )
    expect(result).toMatchObject({
      ok: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "BELOW_THRESHOLD", path: "A1.score" }),
      ]),
    })
  })

  it("returns 422 diagnostics without calling the repository", async () => {
    const ingest = vi.fn()
    const service = {
      authorize: vi.fn(),
      ingest,
    } satisfies ScoutIngestionService
    const handler = createScoutIngestionHandler(async () => service)
    const response = await handler.POST({
      request: new Request("https://fairlend.test/api/v1/scout-ingestions", {
        method: "POST",
        body: JSON.stringify({
          markdown: "# incomplete",
          idempotencyKey: "run-1",
        }),
      }),
    })
    expect(response.status).toBe(422)
    expect(ingest).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_SCOUT_REPORT", diagnostics: expect.any(Array) },
    })
  })

  it("authenticates before reading the scout payload and caps streamed bodies", async () => {
    const unauthorized = createScoutIngestionHandler(async () => {
      throw new AuthenticationRequiredError()
    })
    const unauthenticated = await unauthorized.POST({
      request: new Request("https://fairlend.test/api/v1/scout-ingestions", {
        method: "POST",
        body: "not even json",
      }),
    })
    expect(unauthenticated.status).toBe(401)

    const service = {
      authorize: vi.fn(),
      ingest: vi.fn(),
    } satisfies ScoutIngestionService
    const bounded = createScoutIngestionHandler(async () => service)
    const oversized = await bounded.POST({
      request: new Request("https://fairlend.test/api/v1/scout-ingestions", {
        method: "POST",
        body: JSON.stringify({
          markdown: "x".repeat(400_001),
          idempotencyKey: "too-large",
        }),
      }),
    })
    expect(oversized.status).toBe(413)
    expect(service.ingest).not.toHaveBeenCalled()
  })

  it("posts a complete report through the CLI with explicit idempotency", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: { status: "applied", created: 4 } })
      )
    const output: Array<string> = []
    const exitCode = await runContentRequestsCli(
      [
        "ingest",
        "--file",
        "report.md",
        "--idempotency-key",
        "scout-20260718-am",
      ],
      {
        fetchImpl,
        readFile: vi.fn().mockResolvedValue(VALID_SCOUT_REPORT),
        env: {
          CONTENT_REQUESTS_API_URL: "https://fairlend.test",
          CONTENT_REQUESTS_ACCESS_TOKEN: "token",
        },
        io: { writeOut: (value) => output.push(value), writeError: vi.fn() },
      }
    )
    expect(exitCode).toBe(0)
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://fairlend.test/api/v1/cli/scout-ingestions",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          markdown: VALID_SCOUT_REPORT,
          idempotencyKey: "scout-20260718-am",
        }),
      })
    )
    expect(JSON.parse(output[0])).toMatchObject({ data: { status: "applied" } })
  })
})
