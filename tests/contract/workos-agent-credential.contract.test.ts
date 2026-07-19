import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const workos = vi.hoisted(() => ({
  validateCredential: vi.fn(),
  getRegistration: vi.fn(),
  constructor: vi.fn(),
}))

vi.mock("@workos-inc/node", () => ({
  WorkOS: class {
    agents = {
      validateCredential: workos.validateCredential,
      getRegistration: workos.getRegistration,
    }
    constructor(...args: Array<unknown>) {
      workos.constructor(...args)
    }
  },
}))

import { validateWorkosAgentCredential } from "@/infrastructure/workos-agent-credential.server"

describe("WorkOS auth.md adapter", () => {
  beforeEach(() => {
    process.env.WORKOS_CLIENT_ID = "client_test"
    process.env.WORKOS_API_KEY = "sk_test"
    process.env.WORKOS_REDIRECT_URI = "https://fairlend.test/callback"
    process.env.WORKOS_COOKIE_PASSWORD = "a".repeat(32)
    process.env.WORKOS_ORGANIZATION_ID = "org_fairlend"
    workos.validateCredential.mockReset()
    workos.getRegistration.mockReset()
    workos.constructor.mockClear()
  })

  afterEach(() => {
    for (const key of [
      "WORKOS_CLIENT_ID",
      "WORKOS_API_KEY",
      "WORKOS_REDIRECT_URI",
      "WORKOS_COOKIE_PASSWORD",
      "WORKOS_ORGANIZATION_ID",
    ])
      delete process.env[key]
  })

  it("validates opaque API keys remotely and resolves a verified registration", async () => {
    workos.validateCredential.mockResolvedValue({
      valid: true,
      registrationId: "agent_reg_1",
      claims: null,
      expiresAt: null,
    })
    workos.getRegistration.mockResolvedValue({
      id: "agent_reg_1",
      status: "verified",
      organizationId: "org_fairlend",
      agentIdentity: { id: "agent_identity_1" },
    })

    await expect(
      validateWorkosAgentCredential("wk_agent_secret")
    ).resolves.toEqual({
      subject: "workos-agent:agent_identity_1",
      organizationId: "org_fairlend",
      credentialId: "workos-registration:agent_reg_1",
    })
    expect(workos.validateCredential).toHaveBeenCalledWith({
      type: "api_key",
      credential: "wk_agent_secret",
    })
  })

  it("checks access-token revocation and rejects revoked registrations", async () => {
    workos.validateCredential.mockResolvedValue({
      valid: true,
      registrationId: "agent_reg_2",
      claims: { jti: "agent_token_jti" },
      expiresAt: "2027-01-01T00:00:00Z",
    })
    workos.getRegistration.mockResolvedValue({
      id: "agent_reg_2",
      status: "revoked",
      organizationId: "org_fairlend",
      agentIdentity: { id: "agent_identity_2" },
    })

    await expect(
      validateWorkosAgentCredential("header.payload.signature")
    ).resolves.toBeNull()
    expect(workos.validateCredential).toHaveBeenCalledWith({
      type: "access_token",
      credential: "header.payload.signature",
      checkForRevoked: true,
    })
  })
})
