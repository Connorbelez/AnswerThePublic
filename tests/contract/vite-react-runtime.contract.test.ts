import { describe, expect, it } from "vitest"
import { resolveConfig } from "vite"

const reactRuntimeEntries = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "use-sync-external-store/shim",
  "use-sync-external-store/shim/with-selector",
]

const automergeRuntimeEntries = [
  "@automerge/automerge/automerge.wasm.base64",
  "@automerge/automerge/slim",
  "@automerge/automerge-repo/slim",
  "fast-sha256",
]

describe("Vite React runtime identity", () => {
  it("prebundles every React browser entry before serving application modules", async () => {
    const config = await resolveConfig(
      { configFile: "vite.config.ts", mode: "development" },
      "serve"
    )

    expect(config.resolve.dedupe).toEqual(
      expect.arrayContaining(["react", "react-dom"])
    )
    expect(config.optimizeDeps.noDiscovery).toBe(true)
    expect(config.optimizeDeps.include).toEqual(
      expect.arrayContaining([
        ...reactRuntimeEntries,
        ...automergeRuntimeEntries,
      ])
    )
    expect(config.optimizeDeps.ignoreOutdatedRequests).not.toBe(true)
    expect(config.optimizeDeps.exclude).toContain(
      "@workos/authkit-tanstack-react-start"
    )

    expect(config.optimizeDeps.include).not.toContain("@automerge/automerge")
    expect(config.server.hmr).not.toEqual(
      expect.objectContaining({ port: expect.any(Number) })
    )
  }, 15_000)
})
