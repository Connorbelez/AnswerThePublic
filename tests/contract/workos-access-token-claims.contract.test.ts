import { describe, expect, it } from "vitest"

import { readWorkosAccessTokenClaims } from "@/infrastructure/workos-access-token-claims.server"

function unsignedToken(payload: Record<string, unknown>) {
  return [
    Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "signature",
  ].join(".")
}

describe("WorkOS access token diagnostics", () => {
  it("returns only provider-matching claims", () => {
    const claims = readWorkosAccessTokenClaims(
      unsignedToken({
        iss: "https://api.workos.com/",
        aud: "client_default",
        client_id: "client_fairlend",
        sub: "user_private",
        email: "private@example.com",
      })
    )

    expect(claims).toEqual({
      issuer: "https://api.workos.com/",
      audience: "client_default",
      clientId: "client_fairlend",
    })
    expect(claims).not.toHaveProperty("sub")
    expect(claims).not.toHaveProperty("email")
  })

  it("fails closed for malformed tokens", () => {
    expect(readWorkosAccessTokenClaims("not-a-jwt")).toEqual({
      issuer: null,
      audience: null,
      clientId: null,
    })
  })
})
