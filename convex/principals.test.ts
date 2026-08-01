// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

describe("principals Convex contract", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
    process.env.WORKOS_CLIENT_ID = "client_fairlend"
  })

  it("rejects anonymous writes", async () => {
    const t = convexTest(schema, modules)

    await expect(t.mutation(api.principals.syncCurrent)).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    })
  })

  it("idempotently upserts and retrieves the authenticated principal by subject", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "user_elie",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "founder",
    })

    const first = await t.mutation(api.principals.syncCurrent)
    const second = await t.mutation(api.principals.syncCurrent)

    expect(second.principalId).toBe(first.principalId)
    await expect(t.query(api.principals.getCurrent)).resolves.toEqual(second)
    await expect(
      t.run(async (ctx) => ctx.db.query("principals").collect())
    ).resolves.toHaveLength(1)
  })

  it("provisions the configured founder as one searchable default Person", async () => {
    process.env.FAIRLEND_ELIE_EMAIL = "elie@fairlend.ca"
    process.env.FAIRLEND_PRINCIPAL_PROVISIONING_KEY =
      "principal-provisioning-test-key"
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity({
      subject: "founder-provisioning-operator",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "operator-editor",
      email: "operator@fairlend.ca",
    })
    await operator.mutation(api.principals.syncCurrent)

    const first = await operator.mutation(api.principals.seedFounder, {
      provisioningKey: "principal-provisioning-test-key",
      email: "elie@fairlend.ca",
      subject: "user_elie",
    })
    const second = await operator.mutation(api.principals.seedFounder, {
      provisioningKey: "principal-provisioning-test-key",
      email: "elie@fairlend.ca",
      subject: "user_elie",
    })
    const directory = await operator.query(api.people.search, {
      query: "elie",
      limit: 10,
    })

    expect(second).toEqual({ principalId: first.principalId, created: false })
    expect(directory.defaultPersonId).toBeTruthy()
    expect(directory.people).toEqual([
      expect.objectContaining({
        displayName: "Elie Tchitava",
        email: "elie@fairlend.ca",
        principalId: first.principalId,
        isFounder: true,
      }),
    ])
    await expect(
      operator.run((ctx) => ctx.db.query("people").collect())
    ).resolves.toHaveLength(1)
  })

  it("maps the WorkOS default admin role to administrator", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "user_admin",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "admin",
      client_id: "client_fairlend",
    })

    await expect(t.mutation(api.principals.syncCurrent)).resolves.toMatchObject(
      {
        subject: "user_admin",
        organizationId: "org_fairlend",
        role: "administrator",
      }
    )
  })

  it("rejects a valid role from another WorkOS organization", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "agent_01",
      issuer: "https://api.workos.com/",
      org_id: "org_external",
      role: "agent-editor",
    })

    await expect(t.mutation(api.principals.syncCurrent)).rejects.toMatchObject({
      data: { code: "ORGANIZATION_ACCESS_DENIED" },
    })
  })

  it("rejects a token issued for another app in the shared WorkOS environment", async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: "user_external_app",
      issuer: "https://api.workos.com/",
      client_id: "client_other_app",
      org_id: "org_fairlend",
      role: "founder",
    })

    await expect(t.mutation(api.principals.syncCurrent)).rejects.toMatchObject({
      data: { code: "APPLICATION_ACCESS_DENIED" },
    })
  })

  it("attributes agent mutations to the individually revocable WorkOS token jti", async () => {
    const agent = convexTest(schema, modules).withIdentity({
      subject: "agent_installation",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "agent-editor",
      jti: "workos-installation-credential-17",
    })
    await agent.mutation(api.principals.syncCurrent)
    await agent.mutation(api.contentRequests.createManual, {
      title: "Agent-created request",
      origin: "http_api",
      correlationId: "agent-create-1",
    })
    const events = await agent.run((ctx) =>
      ctx.db.query("auditEvents").collect()
    )

    expect(events).toHaveLength(1)
    expect(events[0]?.credentialId).toBe("workos-installation-credential-17")
  })
})
