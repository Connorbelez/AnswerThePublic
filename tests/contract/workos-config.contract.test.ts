import { afterEach, describe, expect, it } from "vitest"

import { getOptionalWorkosServerConfig } from "@/config/workos-runtime-config"

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
})
