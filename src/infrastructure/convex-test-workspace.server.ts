import { convexTest } from "convex-test"
import timelineTest from "convex-timeline/test"

import { api } from "../../convex/_generated/api"
import { requestQueueSortKey } from "../../convex/lib/requestOrdering"
import schema from "../../convex/schema"
import type { ExternalIdentity } from "@/application/workspace-session"
import { authorizeExternalIdentity } from "@/application/workspace-session"

const modules = import.meta.glob([
  "../../convex/**/*.ts",
  "!../../convex/**/*.test.ts",
  "!../../convex/**/*.config.ts",
  "!../../convex/**/*.setup.ts",
])

const workspace = convexTest(schema, modules)
timelineTest.register(workspace)

export async function getConvexTestWorkspace(
  identity: ExternalIdentity,
  configuredOrganizationId = process.env.FAIRLEND_E2E_ORGANIZATION_ID
) {
  const expectedOrganizationId = configuredOrganizationId
  if (!expectedOrganizationId) {
    throw new Error(
      "FAIRLEND_E2E_ORGANIZATION_ID is required for browser tests."
    )
  }
  authorizeExternalIdentity(identity, expectedOrganizationId)
  process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = expectedOrganizationId
  const authenticated = workspace.withIdentity({
    issuer: "https://api.workos.com/",
    subject: identity.subject,
    org_id: identity.organizationId,
    role: identity.workosRole ?? undefined,
    email: identity.email,
  })
  await authenticated.mutation(api.principals.syncCurrent)
  return authenticated
}

export async function createAutomatedE2eRequest(
  identity: ExternalIdentity,
  title: string,
  assigneeSubject: string
) {
  const authenticated = await getConvexTestWorkspace(identity)
  const createdAt = Date.now()
  const created = await authenticated.mutation(
    api.contentRequests.createManual,
    {
      title,
      origin: "manual",
      correlationId: crypto.randomUUID(),
    }
  )
  await authenticated.run(async (ctx) => {
    const request = await ctx.db.get(created.requestId)
    const assignee = await ctx.db
      .query("principals")
      .withIndex("by_organization_subject", (index) =>
        index
          .eq("organizationId", identity.organizationId)
          .eq("subject", assigneeSubject)
      )
      .unique()
    if (!request || !assignee) throw new Error("E2E fixture setup failed.")
    await ctx.db.patch(request._id, {
      origin: "automated_scout",
      priority: "normal",
      assigneePrincipalId: assignee._id,
      queueSortKey: requestQueueSortKey("automated_scout", "normal", createdAt),
      createdAt,
      updatedAt: createdAt,
    })
  })
  return { humanId: created.humanId }
}
