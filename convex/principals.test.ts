// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

describe("principals Convex contract", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("rejects anonymous writes", async () => {
    const t = convexTest(schema, modules)

    await expect(
      t.mutation(api.principals.syncCurrent)
    ).rejects.toMatchObject({
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
})
