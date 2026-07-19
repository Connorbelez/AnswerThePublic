import { describe, expect, it } from "vitest"

import { isSubstantialRewrite } from "./productMetricClassification"

describe("product metric classification", () => {
  it("ignores formatting and small editorial changes", () => {
    expect(
      isSubstantialRewrite(
        "FairLend can answer the borrower with a clear mortgage explanation.",
        "FairLend can answer the borrower with a clear, mortgage explanation."
      )
    ).toBe(false)
  })

  it("classifies materially replaced language as a substantial rewrite", () => {
    expect(
      isSubstantialRewrite(
        "Explain portability, qualification, timing, and the lender approval process.",
        "Use a short social post focused entirely on payment flexibility and renewal strategy."
      )
    ).toBe(true)
  })
})
