import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

describe("local development workflow", () => {
  it("starts Vite under the Convex watcher so backend functions stay synchronized", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    ) as { scripts?: Record<string, string> }
    const devCommand = packageJson.scripts?.dev ?? ""

    expect(devCommand).toContain("auth:sync-dev")
    expect(devCommand).toContain("convex dev")
    expect(devCommand).toContain("--codegen disable")
    expect(devCommand).toContain("--start")
    expect(devCommand).toContain("vite dev --port 3000")
  })
})
