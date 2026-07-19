import { afterEach, describe, expect, it } from "vitest"

import {
  buildWorkosSignInOptions,
  getOptionalWorkosServerConfig,
} from "@/config/workos-runtime-config"

const keys = [
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_REDIRECT_URI",
  "WORKOS_COOKIE_PASSWORD",
  "WORKOS_ORGANIZATION_ID",
] as const
const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

afterEach(() => {
  for (const key of keys) {
    const value = original[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

describe("WorkOS runtime configuration", () => {
  it("allows a deliberately unconfigured test runtime", () => {
    for (const key of keys) delete process.env[key]

    expect(getOptionalWorkosServerConfig()).toBeNull()
  })

  it("fails precisely when configuration is only partial", () => {
    for (const key of keys) delete process.env[key]
    process.env.WORKOS_CLIENT_ID = "client_test"

    expect(() => getOptionalWorkosServerConfig()).toThrow(
      /Incomplete WorkOS configuration.*WORKOS_API_KEY/
    )
  })

  it("scopes every hosted sign-in to the configured FairLend organization", () => {
    process.env.WORKOS_CLIENT_ID = "client_test"
    process.env.WORKOS_API_KEY = "sk_test"
    process.env.WORKOS_REDIRECT_URI = "https://fairlend.test/api/auth/callback"
    process.env.WORKOS_COOKIE_PASSWORD = "a".repeat(32)
    process.env.WORKOS_ORGANIZATION_ID = "org_fairlend"

    expect(buildWorkosSignInOptions("/app/new")).toEqual({
      data: {
        organizationId: "org_fairlend",
        returnPathname: "/app/new",
      },
    })
    expect(buildWorkosSignInOptions(null)).toEqual({
      data: { organizationId: "org_fairlend" },
    })
  })
})
