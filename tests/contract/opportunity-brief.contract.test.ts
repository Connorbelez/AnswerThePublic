import { describe, expect, it } from "vitest"

import { extractOpportunityBrief } from "@/lib/opportunity-brief"

describe("opportunity brief projection", () => {
  it("turns a scout report into operator decision sections", () => {
    const brief = extractOpportunityBrief(`
## A1. Mortgage payoff — Score: 78/100 — Act by: while active

- Source: r/CanadaPersonalFinance; posted 2026-07-19; approximately five hours old at verification
- Why FairLend can help: Mortgage administration and Ontario discharge mechanics are inside FairLend's expertise.
- What is missing from existing replies: Replies confuse a zero balance with a registered discharge.
- Compliance/moderation check: Medium risk because title registration touches legal advice.

## Draft response

Paying the loan balance to zero does not automatically remove the registered charge.

Ask the lender for written confirmation and get proof the discharge was registered.

## Evidence used

- [FCAC mortgage discharge](https://example.com) — paying a balance does not remove the charge
`)

    expect(brief).toEqual(
      expect.objectContaining({
        score: 78,
        ageLabel: "5h",
        risk: "medium",
        whyItMatters:
          "Mortgage administration and Ontario discharge mechanics are inside FairLend's expertise.",
        responseGap:
          "Replies confuse a zero balance with a registered discharge.",
        draftResponse: expect.stringContaining(
          "Paying the loan balance to zero"
        ),
        evidenceCount: 1,
      })
    )
  })
})
