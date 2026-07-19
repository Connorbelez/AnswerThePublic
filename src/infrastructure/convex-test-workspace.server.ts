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

export function getPublicConvexTestWorkspace() {
  return workspace
}

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

export async function createPublicShareE2e(identity: ExternalIdentity) {
  process.env.PUBLIC_SHARE_TOKEN_SECRET =
    "e2e-only-public-share-secret-at-least-32-bytes"
  const authenticated = await getConvexTestWorkspace(identity)
  const request = await authenticated.mutation(
    api.contentRequests.createManual,
    {
      title: "Public FairLend response",
      origin: "manual",
      correlationId: crypto.randomUUID(),
    }
  )
  const [primary] = await authenticated.query(api.deliverables.list, {
    humanId: request.humanId,
  })
  await authenticated.mutation(api.deliverables.createVersion, {
    deliverableId: primary.deliverableId,
    body: "This is the explicitly approved public response.",
    correlationId: crypto.randomUUID(),
  })
  await authenticated.mutation(api.deliverables.createVersion, {
    deliverableId: primary.deliverableId,
    body: "PRIVATE_CANDIDATE_SECRET",
    correlationId: crypto.randomUUID(),
  })
  await authenticated.run(async (ctx) => {
    const principal = await ctx.db.query("principals").first()
    if (!principal) throw new Error("Missing E2E principal")
    await ctx.db.insert("founderInputDocuments", {
      organizationId: identity.organizationId,
      requestId: request.requestId,
      founderPrincipalId: principal._id,
      text: "PRIVATE_FOUNDER_BROWSER_SECRET",
      revision: 1,
      hasMeaningfulDraft: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  })
  return authenticated.mutation(api.publicShares.create, {
    humanId: request.humanId,
    contextItemIds: [],
    deliverableIds: [primary.deliverableId],
    correlationId: crypto.randomUUID(),
  })
}

export async function revokePublicShareE2e(
  identity: ExternalIdentity,
  shareId: string
) {
  const authenticated = await getConvexTestWorkspace(identity)
  return authenticated.mutation(api.publicShares.revoke, {
    shareId:
      shareId as import("../../convex/_generated/dataModel").Id<"publicShares">,
    correlationId: crypto.randomUUID(),
  })
}
