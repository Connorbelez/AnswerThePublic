import { spawnSync } from "node:child_process"
import { describe, expect, it } from "vitest"

describe("scout report CLI argument parsing", () => {
  it("treats another option after --file as a missing value", () => {
    const result = spawnSync(
      "bun",
      ["scripts/orchestrate-scout-report.ts", "--file", "--validate-only"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
      }
    )

    expect(result.status).toBe(3)
    expect(result.stderr).toContain("--file <report.md>")
    expect(result.stderr).not.toContain("ENOENT")
  })
})
