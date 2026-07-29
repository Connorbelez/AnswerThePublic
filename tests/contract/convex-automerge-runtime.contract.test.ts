import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

describe("Convex Automerge runtime compatibility", () => {
  it("avoids Automerge's browser ESM-WASM entry in Convex functions", () => {
    const source = readFileSync(
      new URL("../../convex/founderInputs.ts", import.meta.url),
      "utf8"
    )

    expect(source).toContain('from "@automerge/automerge/slim"')
    expect(source).toContain(
      'from "@automerge/automerge/automerge.wasm.base64"'
    )
    expect(source).not.toContain('from "@automerge/automerge"')
    expect(source).toContain("await ensureAutomergeInitialized()")
  })
})
