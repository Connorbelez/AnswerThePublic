import { ConvexError } from "convex/values"

import type { Doc } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"
import { enqueueNotification } from "./notificationOutbox"
import { refreshOperatorWorkspaceProjection } from "./operatorWorkspaceProjection"

type CompletionPrincipal = {
  _id: Doc<"principals">["_id"]
  credentialId: string
  organizationId: string
}

export async function completeAgentJobWithVersion(
  ctx: MutationCtx,
  input: {
    job: Doc<"agentJobs">
    request: Doc<"contentRequests">
    principal: CompletionPrincipal
    leaseToken: string
    leaseGeneration: number
    versionId: Doc<"deliverableVersions">["_id"]
    correlationId: string
    now: number
  }
) {
  const {
    job,
    request,
    principal,
    leaseToken,
    leaseGeneration,
    versionId,
    correlationId,
    now,
  } = input
  if (
    job.organizationId !== principal.organizationId ||
    job.requestId !== request._id
  )
    throw new ConvexError({ code: "NOT_FOUND" })
  if (
    job.status !== "running" ||
    job.leaseToken !== leaseToken.trim() ||
    !leaseToken.trim() ||
    job.claimedByPrincipalId !== principal._id ||
    job.leaseGeneration !== leaseGeneration ||
    (job.leaseExpiresAt ?? 0) <= now
  )
    throw new ConvexError({ code: "LEASE_LOST" })

  await ctx.db.patch(job._id, {
    status: "completed",
    claimableAt: undefined,
    reapableAt: undefined,
    resultVersionId: versionId,
    leaseToken: undefined,
    leaseExpiresAt: undefined,
    completedAt: now,
    updatedAt: now,
  })
  const afterVersion = request.aggregateVersion + 1
  await ctx.db.patch(request._id, {
    lifecycle:
      request.lifecycle === "responded" ? "responded" : "ready_to_respond",
    aggregateVersion: afterVersion,
    updatedAt: now,
  })
  await ctx.db.insert("auditEvents", {
    organizationId: principal.organizationId,
    requestId: request._id,
    requestHumanId: request.humanId,
    actorPrincipalId: principal._id,
    credentialId: principal.credentialId,
    operation: "agent_job.completed",
    correlationId,
    occurredAt: now,
    beforeVersion: request.aggregateVersion,
    afterVersion,
  })

  if (request.lifecycle !== "responded") {
    const [operators, administrators] = await Promise.all([
      ctx.db
        .query("principals")
        .withIndex("by_organization_role", (query) =>
          query
            .eq("organizationId", request.organizationId)
            .eq("role", "operator_editor")
        )
        .collect(),
      ctx.db
        .query("principals")
        .withIndex("by_organization_role", (query) =>
          query
            .eq("organizationId", request.organizationId)
            .eq("role", "administrator")
        )
        .collect(),
    ])
    for (const recipient of [...operators, ...administrators])
      await enqueueNotification(ctx, request, recipient, "response_ready", now)
  }
  await refreshOperatorWorkspaceProjection(ctx, request._id)
  return afterVersion
}
