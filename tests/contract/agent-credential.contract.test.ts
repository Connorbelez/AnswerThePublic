import { afterEach, describe, expect, it, vi } from "vitest"

import { createContentRequestServiceForApiRequest } from "@/application/content-request-api-service.server"
import { createScoutIngestionServiceForRequest } from "@/application/scout-ingestion-service-request.server"
import { AuthenticationRequiredError } from "@/application/workspace-session"

describe("WorkOS agent installation credential contract", () => {
  afterEach(() => {
    delete process.env.FAIRLEND_CONVEX_AGENT_ADMIN_KEY
  })

  it("validates an opaque auth.md key before constructing an agent-editor service", async () => {
    process.env.FAIRLEND_CONVEX_AGENT_ADMIN_KEY = "server-only-admin-key"
    const validateCredential = vi.fn().mockResolvedValue({
      subject: "workos-agent:agent_identity_1",
      organizationId: "org_fairlend",
      credentialId: "workos-registration:agent_reg_1",
    })
    const service = await createContentRequestServiceForApiRequest(
      new Request("https://fairlend.test/api/v1/control", {
        headers: { authorization: "Bearer wk_agent_installation_secret" },
      }),
      "http_api",
      validateCredential
    )

    expect(validateCredential).toHaveBeenCalledWith(
      "wk_agent_installation_secret"
    )
    expect(service.createManual).toBeTypeOf("function")
  })

  it("rejects an invalid or revoked opaque installation key", async () => {
    await expect(
      createContentRequestServiceForApiRequest(
        new Request("https://fairlend.test/api/v1/control", {
          headers: { authorization: "Bearer revoked_agent_key" },
        }),
        "http_api",
        vi.fn().mockResolvedValue(null)
      )
    ).rejects.toBeInstanceOf(AuthenticationRequiredError)
  })

  it("never falls back to Convex auth for a revoked WorkOS agent JWT", async () => {
    const payload = btoa(
      JSON.stringify({ sub: "agent_reg_revoked", org_id: "org_fairlend" })
    )
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
    await expect(
      createContentRequestServiceForApiRequest(
        new Request("https://fairlend.test/api/v1/control", {
          headers: {
            authorization: `Bearer header.${payload}.signature`,
          },
        }),
        "http_api",
        vi.fn().mockResolvedValue(null)
      )
    ).rejects.toBeInstanceOf(AuthenticationRequiredError)
  })

  it("applies the same WorkOS agent validation to scout ingestion", async () => {
    process.env.FAIRLEND_CONVEX_AGENT_ADMIN_KEY = "server-only-admin-key"
    const installation = {
      subject: "workos-agent:agent_identity_1",
      organizationId: "org_fairlend",
      credentialId: "workos-registration:agent_reg_1",
    }
    const validateCredential = vi.fn().mockResolvedValue(installation)
    const scout = await createScoutIngestionServiceForRequest(
      new Request("https://fairlend.test/api/v1/cli/scout-ingestions", {
        headers: { authorization: "Bearer wk_agent_installation_secret" },
      }),
      validateCredential
    )

    expect(validateCredential).toHaveBeenCalledWith(
      "wk_agent_installation_secret"
    )
    expect(scout.ingest).toBeTypeOf("function")
    await expect(
      createScoutIngestionServiceForRequest(
        new Request("https://fairlend.test/api/v1/cli/scout-ingestions", {
          headers: { authorization: "Bearer revoked_agent_key" },
        }),
        vi.fn().mockResolvedValue(null)
      )
    ).rejects.toBeInstanceOf(AuthenticationRequiredError)
  })
})
