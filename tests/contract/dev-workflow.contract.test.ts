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

  it("keeps the React module graph singular without pinning the HMR socket", () => {
    const viteConfig = readFileSync(
      new URL("../../vite.config.ts", import.meta.url),
      "utf8"
    )

    expect(viteConfig).toContain('dedupe: ["react", "react-dom"]')
    expect(viteConfig).toContain('host: "127.0.0.1"')
    expect(viteConfig).not.toMatch(/hmr:\s*{[^}]*port:/s)
    expect(viteConfig).toContain("noDiscovery: true")
  })

  it("documents the complete production backfill dependency order", () => {
    const runbook = readFileSync(
      new URL("../../docs/v1-operations-runbook.md", import.meta.url),
      "utf8"
    )
    const migrationGate = runbook.split("## Migration deployment gate")[1]
    expect(migrationGate).toBeTruthy()
    const commands = [
      "migrations:backfillAssignmentFields",
      "migrations:backfillContentRequestTypes",
      "migrations:backfillNormalizedSourceUrls",
      "migrations:backfillPrimaryDeliverables",
      "migrations:backfillOriginalDeliveryTargets",
      "migrations:backfillFounderHandoffs",
      "migrations:backfillAgentJobClaimability",
      "migrations:backfillActiveVoiceCaptureCounts",
      "migrations:backfillOperatorWorkspace",
      "migrations:validateV1Invariants",
    ]
    const positions = commands.map((command) =>
      (migrationGate ?? "").indexOf(command)
    )

    expect(positions).not.toContain(-1)
    expect(positions).toEqual(
      [...positions].sort((left, right) => left - right)
    )
  })

  it("routes guest evidence recovery through the authenticated asset workspace without promising transcription notifications", () => {
    const runbook = readFileSync(
      new URL("../../docs/v1-operations-runbook.md", import.meta.url),
      "utf8"
    )
    const operationalResponse = runbook.split("## Operational response")[1]
    const normalizedOperationalResponse = operationalResponse
      ?.replaceAll("**", "")
      .replaceAll(/\s+/g, " ")

    expect(normalizedOperationalResponse).toContain(
      "authenticated request workspace"
    )
    expect(normalizedOperationalResponse).toContain("Guest responses")
    expect(normalizedOperationalResponse).toContain("Response evidence")
    expect(normalizedOperationalResponse).toContain(
      "Transcription failures do not create administrator notifications"
    )
    expect(operationalResponse).not.toMatch(
      /failed guest upload or transcription: follow the administrator notification deep link/i
    )
  })
})
