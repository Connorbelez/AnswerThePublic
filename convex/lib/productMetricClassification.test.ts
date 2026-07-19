import { describe, expect, it } from "vitest"

import { isSubstantialRewrite } from "./productMetricClassification"

describe("product metric classification", () => {
  it.each([
    {
      label: "empty bodies",
      original: "",
      revised: " \n ",
      substantial: false,
    },
    {
      label: "formatting-equivalent bodies",
      original:
        "FairLend can answer the borrower with a clear mortgage explanation.",
      revised:
        "FAIRLEND can answer the borrower with a clear, mortgage explanation!",
      substantial: false,
    },
    {
      label: "one of ten changed tokens below the threshold",
      original: "one two three four five six seven eight nine ten",
      revised: "one two three four five six seven eight nine replacement",
      substantial: false,
    },
    {
      label: "two of ten changed tokens at the threshold",
      original: "one two three four five six seven eight nine ten",
      revised: "one two three four five six seven eight replacement alternate",
      substantial: true,
    },
    {
      label: "three of ten changed tokens above the threshold",
      original: "one two three four five six seven eight nine ten",
      revised:
        "one two three four five six seven replacement alternate revised",
      substantial: true,
    },
    {
      label: "materially replaced language",
      original:
        "Explain portability, qualification, timing, and the lender approval process.",
      revised:
        "Use a short social post focused entirely on payment flexibility and renewal strategy.",
      substantial: true,
    },
  ])("classifies $label", ({ original, revised, substantial }) => {
    expect(isSubstantialRewrite(original, revised)).toBe(substantial)
  })
})
