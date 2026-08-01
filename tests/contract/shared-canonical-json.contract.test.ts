import { describe, expect, it } from "vitest"

import { canonicalJson } from "../../shared/canonical-json"

describe("canonicalJson", () => {
  it("recursively sorts object keys while preserving array order", () => {
    expect(
      canonicalJson({
        z: 1,
        a: {
          omitted: undefined,
          values: [{ y: 2, x: 1 }, null, false],
        },
      })
    ).toBe('{"a":{"values":[{"x":1,"y":2},null,false]},"z":1}')
  })

  it("produces the same canonical value for differently ordered input", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 })
    )
  })
})
