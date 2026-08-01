import { afterEach, describe, expect, it } from "vitest"

import { resolveGuestAccessNetworkSource } from "@/application/guest-access-network.server"
import { createGuestAccessResolveArguments } from "@/infrastructure/convex-guest-access-repository"

afterEach(() => {
  delete process.env.GUEST_ACCESS_RESOLVE_SECRET
})

describe("Guest Access resolve boundary", () => {
  it("prefers the trusted edge header and falls back to the first forwarded address", () => {
    expect(
      resolveGuestAccessNetworkSource((name) =>
        name === "cf-connecting-ip" ? " 203.0.113.10 " : "198.51.100.5"
      )
    ).toBe("203.0.113.10")
    expect(
      resolveGuestAccessNetworkSource((name) =>
        name === "x-forwarded-for" ? "198.51.100.5, 10.0.0.1" : undefined
      )
    ).toBe("198.51.100.5")
  })

  it("rejects oversized edge values instead of truncating them into signable sources", () => {
    expect(
      resolveGuestAccessNetworkSource((name) =>
        name === "cf-connecting-ip"
          ? "x".repeat(257)
          : name === "x-forwarded-for"
            ? "198.51.100.6, 10.0.0.1"
            : undefined
      )
    ).toBe("198.51.100.6")
    expect(
      resolveGuestAccessNetworkSource((name) =>
        name === "x-forwarded-for" ? "x".repeat(257) : undefined
      )
    ).toBe("unattributed")
  })

  it("uses one fail-closed unattributed bucket when proxy headers are absent", () => {
    const first = resolveGuestAccessNetworkSource(() => undefined)
    const second = resolveGuestAccessNetworkSource(() => undefined)

    expect(first).toBe("unattributed")
    expect(second).toBe("unattributed")
  })

  it("rejects malformed payloads before requiring or using the signing secret", async () => {
    await expect(
      createGuestAccessResolveArguments("x".repeat(100_000), "198.51.100.20")
    ).rejects.toThrow("43-character bearer token")
    await expect(
      createGuestAccessResolveArguments(
        "x".repeat(43),
        `source-${"x".repeat(256)}`
      )
    ).rejects.toThrow("1 to 256 trimmed characters")
    await expect(
      createGuestAccessResolveArguments(
        "x".repeat(43),
        "198.51.100.20",
        Number.POSITIVE_INFINITY
      )
    ).rejects.toThrow("safe integer")
  })

  it("signs the server-derived source, token, and timestamp without exposing the secret", async () => {
    process.env.GUEST_ACCESS_RESOLVE_SECRET =
      "guest-access-resolve-contract-secret-at-least-32-bytes"

    const resolved = await createGuestAccessResolveArguments(
      "x".repeat(43),
      "198.51.100.20",
      1_785_260_000_000
    )

    expect(resolved).toEqual({
      token: "x".repeat(43),
      networkSource: "198.51.100.20",
      networkTimestamp: 1_785_260_000_000,
      networkProof: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(JSON.stringify(resolved)).not.toContain(
      process.env.GUEST_ACCESS_RESOLVE_SECRET
    )
  })
})
