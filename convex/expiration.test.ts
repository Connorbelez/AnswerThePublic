import { describe, expect, it } from "vitest"

import { expirationTimingIdentity, inferExpirationAt } from "./lib/expiration"

describe("conservative expiration inference", () => {
  it("preserves explicit dates even when already due", () => {
    expect(inferExpirationAt("Act by 2026-07-17", Date.UTC(2026, 6, 19))).toBe(
      Date.parse("2026-07-17T23:59:59.999Z")
    )
  })

  it("accepts bounded relative durations and rejects ambiguous language", () => {
    const now = Date.UTC(2026, 6, 19)
    expect(inferExpirationAt("Respond within 36 hours", now)).toBe(
      now + 36 * 60 * 60 * 1_000
    )
    expect(inferExpirationAt("while active", now)).toBeUndefined()
    expect(inferExpirationAt("as soon as possible", now)).toBeUndefined()
    expect(
      inferExpirationAt("We reply within 2 days after submission", now)
    ).toBeUndefined()
    expect(
      inferExpirationAt("Reviewed within 7 days after the deadline", now)
    ).toBeUndefined()
    expect(inferExpirationAt("Not within 2 days", now)).toBeUndefined()
  })

  it("rejects normalized impossible dates but accepts real leap days", () => {
    const now = Date.UTC(2026, 6, 19)
    expect(inferExpirationAt("Deadline 2026-02-31", now)).toBeUndefined()
    expect(inferExpirationAt("Deadline 2025-02-29", now)).toBeUndefined()
    expect(inferExpirationAt("Deadline 2028-02-29", now)).toBe(
      Date.parse("2028-02-29T23:59:59.999Z")
    )
    expect(
      inferExpirationAt("Opens 2026-07-20; closes 2026-07-25", now)
    ).toBeUndefined()
    expect(
      expirationTimingIdentity("Opens 2026-07-20; closes 2026-07-25")
    ).toBeUndefined()
  })

  it("normalizes equivalent relative deadline formatting", () => {
    expect(expirationTimingIdentity("within 36 hours")).toBe(
      expirationTimingIdentity("Respond within 36 HOURS.")
    )
  })
})
