import { describe, expect, it } from "vitest"

import { createWorkosAuthConfig } from "../../convex/lib/workosAuthConfig"

describe("WorkOS Convex auth configuration", () => {
  it("keeps Convex audience validation for the shared WorkOS issuer", () => {
    const authConfig = createWorkosAuthConfig("client_fairlend")
    const sessionProvider = authConfig.providers.find(
      (provider) => provider.issuer === "https://api.workos.com/"
    )

    expect(sessionProvider).toBeDefined()
    expect(sessionProvider).toHaveProperty("applicationID", "client_fairlend")
  })

  it("keeps the legacy WorkOS User Management issuer during migration", () => {
    const authConfig = createWorkosAuthConfig("client_fairlend")

    expect(authConfig.providers).toContainEqual({
      type: "customJwt",
      issuer: "https://api.workos.com/user_management/client_fairlend",
      algorithm: "RS256",
      jwks: "https://api.workos.com/sso/jwks/client_fairlend",
    })
  })
})
