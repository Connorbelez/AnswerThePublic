import { ConvexHttpClient } from "convex/browser"
import { ConvexError } from "convex/values"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type {
  AssignRequestInput,
  ContentRequestRepository,
  PersistManualRequestInput,
  UpdateRequestInput,
} from "@/application/content-requests"

type TokenProvider = () => Promise<string | null>
type AdminIdentityProvider = () => Promise<{
  adminKey: string
  subject: string
  organizationId: string
  credentialId: string
} | null>

export function createConvexContentRequestRepository({
  getAccessToken,
  getAdminIdentity,
}: {
  getAccessToken: TokenProvider
  getAdminIdentity?: AdminIdentityProvider
}): ContentRequestRepository {
  let cachedClient: Promise<ConvexHttpClient> | null = null
  async function createClient() {
    const convexUrl = process.env.VITE_CONVEX_URL
    if (!convexUrl) {
      throw new Error("VITE_CONVEX_URL is required for Content Request access.")
    }
    const [accessToken, adminIdentity] = await Promise.all([
      getAccessToken(),
      getAdminIdentity?.() ?? null,
    ])
    if (!accessToken && !adminIdentity) {
      throw new Error("An access token is required for Content Request access.")
    }
    const convex = new ConvexHttpClient(convexUrl)
    if (adminIdentity) {
      ;(
        convex as ConvexHttpClient & {
          setAdminAuth(token: string, identity: Record<string, string>): void
        }
      ).setAdminAuth(adminIdentity.adminKey, {
        subject: adminIdentity.subject,
        issuer: "https://api.workos.com/agents",
        org_id: adminIdentity.organizationId,
        role: "agent-editor",
        jti: adminIdentity.credentialId,
        tokenIdentifier: adminIdentity.credentialId,
      })
      await convex.mutation(api.principals.syncCurrent, {})
    } else {
      convex.setAuth(accessToken!)
    }
    return convex
  }
  function client() {
    cachedClient ??= createClient()
    return cachedClient
  }

  return {
    async createManual(input: PersistManualRequestInput) {
      return (await client()).mutation(api.contentRequests.createManual, input)
    },
    async getByHumanId(humanId) {
      return (await client()).query(api.contentRequests.getByHumanId, {
        humanId,
      })
    },
    async list(limit) {
      return (await client()).query(api.contentRequests.list, { limit })
    },
    async listPage(cursor, limit) {
      const result = await (
        await client()
      ).query(api.contentRequests.listPage, {
        paginationOpts: { numItems: limit, cursor },
      })
      return {
        page: result.page,
        nextCursor: result.isDone ? null : result.continueCursor,
      }
    },
    async listOperatorWorkspace(input) {
      return (await client()).query(api.operatorWorkspace.list, {
        queue: input?.queue,
        search: input?.search,
        priority: input?.priority,
        origin: input?.origin,
        lifecycle: input?.lifecycle,
        disposition: input?.disposition,
        retention: input?.retention,
        assigneePrincipalId: input?.assigneePrincipalId as
          | Id<"principals">
          | undefined,
        deliveryChannel: input?.deliveryChannel,
        paginationOpts: {
          numItems: Math.min(Math.max(input?.limit ?? 50, 1), 100),
          cursor: input?.cursor ?? null,
        },
      })
    },
    async resolve(query) {
      return (await client()).query(api.contentRequests.resolve, { query })
    },
    async update(input: UpdateRequestInput) {
      return (await client()).mutation(api.contentRequests.update, input)
    },
    async assign(input: AssignRequestInput) {
      const convex = await client()
      const current = await convex.query(api.contentRequests.getByHumanId, {
        humanId: input.humanId,
      })
      if (!current) throw new ConvexError({ code: "NOT_FOUND" })
      const result = await convex.mutation(
        api.semanticConflicts.proposeAssigneeChange,
        {
          humanId: input.humanId,
          expectedAssigneePrincipalId: current.assignee
            .principalId as Id<"principals">,
          proposedAssigneePrincipalId:
            input.assigneePrincipalId as Id<"principals">,
          watcherPrincipalIds: input.watcherPrincipalIds?.map(
            (principalId) => principalId as Id<"principals">
          ),
          reason: input.reason,
          correlationId: input.correlationId,
        }
      )
      if (result.outcome === "attention_required") {
        throw new ConvexError({
          code: "SEMANTIC_CONFLICT",
          conflict: result.conflict,
        })
      }
      const saved = await convex.query(api.contentRequests.getByHumanId, {
        humanId: input.humanId,
      })
      if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
      return saved
    },
    async open(humanId, correlationId) {
      return (await client()).mutation(api.contentRequests.open, {
        humanId,
        correlationId,
      })
    },
    async setExpiration(humanId, expiresAt, correlationId) {
      return (await client()).mutation(api.requestDisposition.setExpiration, {
        humanId,
        expiresAt,
        correlationId,
      })
    },
    async expire(humanId, reason, correlationId, expectedAggregateVersion) {
      return (await client()).mutation(api.requestDisposition.expire, {
        humanId,
        reason,
        correlationId,
        expectedAggregateVersion,
      })
    },
    async restoreExpired(humanId, expiresAt, correlationId) {
      return (await client()).mutation(api.requestDisposition.restoreExpired, {
        humanId,
        expiresAt,
        correlationId,
      })
    },
    async archive(humanId, correlationId, expectedAggregateVersion) {
      return (await client()).mutation(api.requestDisposition.archive, {
        humanId,
        correlationId,
        expectedAggregateVersion,
      })
    },
    async restoreArchived(humanId, correlationId) {
      return (await client()).mutation(api.requestDisposition.restoreArchived, {
        humanId,
        correlationId,
      })
    },
    async createFollowUp(input) {
      return (await client()).mutation(
        api.requestDisposition.createFollowUp,
        input
      )
    },
    async getRelations(humanId) {
      return (await client()).query(api.requestDisposition.getRelations, {
        humanId,
      })
    },
    async listAssignablePrincipals() {
      return (await client()).query(
        api.contentRequests.listAssignablePrincipals,
        {}
      )
    },
    async listMyNotifications() {
      return (await client()).query(api.contentRequests.listMyNotifications, {})
    },
    async listMyNotificationsPage(cursor, limit) {
      const result = await (
        await client()
      ).query(api.contentRequests.listMyNotificationsPage, {
        paginationOpts: { numItems: limit, cursor },
      })
      return {
        page: result.page,
        nextCursor: result.isDone ? null : result.continueCursor,
      }
    },
    async markNotificationRead(notificationId, correlationId) {
      await (
        await client()
      ).mutation(api.contentRequests.markNotificationRead, {
        notificationId: notificationId as Id<"notifications">,
        correlationId,
      })
    },
    async listAuditEvents(humanId, cursor, limit) {
      const result = await (
        await client()
      ).query(api.contentRequests.listAuditEventsPage, {
        humanId,
        paginationOpts: { numItems: limit, cursor },
      })
      return {
        page: result.page,
        nextCursor: result.isDone ? null : result.continueCursor,
      }
    },
    async getProductMetrics(input) {
      return (await client()).query(api.productMetrics.get, input ?? {})
    },
    async listContext(humanId) {
      return (await client()).query(api.scoutIngestions.listContext, {
        humanId,
      })
    },
    async upsertContext(input) {
      return (await client()).mutation(api.scoutIngestions.upsertContext, input)
    },
    async listContextVersions(contextId, cursor, limit) {
      const result = await (
        await client()
      ).query(api.scoutIngestions.listContextVersions, {
        contextId: contextId as Id<"contextItems">,
        paginationOpts: { numItems: limit, cursor },
      })
      return {
        page: result.page,
        nextCursor: result.isDone ? null : result.continueCursor,
      }
    },
    async getContextDeckPreferences(humanId) {
      return (await client()).query(
        api.scoutIngestions.getContextDeckPreferences,
        { humanId }
      )
    },
    async saveContextDeckPreferences(humanId, preferences, correlationId) {
      return (await client()).mutation(
        api.scoutIngestions.saveContextDeckPreferences,
        { humanId, ...preferences, correlationId }
      )
    },
    async getFounderInput(humanId) {
      return (await client()).query(api.founderInputs.getMine, { humanId })
    },
    async saveFounderText(humanId, text, correlationId) {
      return (await client()).mutation(api.founderInputs.saveText, {
        humanId,
        text,
        correlationId,
      })
    },
    async pullFounderAutomergeChanges(humanId, documentId) {
      return (await client()).query(api.founderInputs.pullAutomergeChanges, {
        humanId,
        documentId,
      })
    },
    async submitFounderAutomergeChanges(input) {
      return (await client()).mutation(
        api.founderInputs.submitAutomergeChanges,
        input
      )
    },
    async getFounderVersionHistory(humanId) {
      return (await client()).query(api.founderInputs.getVersionHistory, {
        humanId,
      })
    },
    async listFounderArchivedVersions(humanId, cursor) {
      return (await client()).query(api.founderInputs.listArchivedVersions, {
        humanId,
        paginationOpts: { numItems: 20, cursor },
      })
    },
    async restoreFounderArchivedVersion(humanId, versionId, correlationId) {
      return (await client()).mutation(
        api.founderInputs.restoreArchivedVersion,
        {
          humanId,
          versionId: versionId as Id<"founderInputVersions">,
          correlationId,
        }
      )
    },
    async createFounderVoiceUploadUrl(humanId) {
      return (await client()).mutation(api.voiceCaptures.createUploadUrl, {
        humanId,
      })
    },
    async finalizeFounderVoiceCapture(input) {
      return (await client()).mutation(api.voiceCaptures.finalizeUpload, {
        ...input,
        storageId: input.storageId as Id<"_storage">,
      })
    },
    async listFounderVoiceCaptures(humanId) {
      return (await client()).query(api.voiceCaptures.listMine, { humanId })
    },
    async retryFounderVoiceCapture(humanId, captureId) {
      return (await client()).mutation(api.voiceCaptures.retry, {
        humanId,
        captureId: captureId as Id<"founderVoiceCaptures">,
      })
    },
    async markFounderVoiceTranscriptMerged(humanId, captureId) {
      return (await client()).mutation(api.voiceCaptures.markTranscriptMerged, {
        humanId,
        captureId: captureId as Id<"founderVoiceCaptures">,
      })
    },
    async discardFounderVoiceCapture(humanId, captureId) {
      return (await client()).mutation(api.voiceCaptures.discard, {
        humanId,
        captureId: captureId as Id<"founderVoiceCaptures">,
      })
    },
    async undoFounderInput(humanId, correlationId) {
      return (await client()).mutation(api.founderInputs.undo, {
        humanId,
        correlationId,
      })
    },
    async redoFounderInput(humanId, correlationId) {
      return (await client()).mutation(api.founderInputs.redo, {
        humanId,
        correlationId,
      })
    },
    async assertFounderInputSynced(humanId, heads) {
      return (await client()).query(api.founderInputs.assertDurablySynced, {
        humanId,
        heads,
      })
    },
    async submitFounderInput(humanId, heads, correlationId) {
      return (await client()).mutation(api.agentJobs.submitFounderInput, {
        humanId,
        heads,
        correlationId,
      })
    },
    async listAgentJobs() {
      return (await client()).query(api.agentJobs.list, {})
    },
    async listAgentJobsPage(cursor, limit) {
      const result = await (
        await client()
      ).query(api.agentJobs.listPage, {
        paginationOpts: { numItems: limit, cursor },
      })
      return {
        page: result.page,
        nextCursor: result.isDone ? null : result.continueCursor,
      }
    },
    async claimAgentJob(leaseToken, leaseMs) {
      return (await client()).mutation(api.agentJobs.claim, {
        leaseToken,
        leaseMs,
      })
    },
    async heartbeatAgentJob(jobId, leaseToken, leaseMs, leaseGeneration) {
      return (await client()).mutation(api.agentJobs.heartbeat, {
        jobId: jobId as Id<"agentJobs">,
        leaseToken,
        leaseMs,
        leaseGeneration,
      })
    },
    async getAgentJobInput(jobId) {
      return (await client()).query(api.agentJobs.getInput, {
        jobId: jobId as Id<"agentJobs">,
      })
    },
    async completeAgentJob(
      jobId,
      leaseToken,
      body,
      correlationId,
      leaseGeneration
    ) {
      return (await client()).mutation(api.agentJobs.complete, {
        jobId: jobId as Id<"agentJobs">,
        leaseToken,
        body,
        correlationId,
        leaseGeneration,
      })
    },
    async failAgentJob(
      jobId,
      leaseToken,
      errorCode,
      transient,
      correlationId,
      leaseGeneration,
      expectedAggregateVersion
    ) {
      return (await client()).mutation(api.agentJobs.fail, {
        jobId: jobId as Id<"agentJobs">,
        leaseToken,
        errorCode,
        transient,
        correlationId,
        leaseGeneration,
        expectedAggregateVersion,
      })
    },
    async listDeliverables(humanId) {
      return (await client()).query(api.deliverables.list, { humanId })
    },
    async createDerivativeDeliverable(input) {
      return (await client()).mutation(api.deliverables.createDerivative, input)
    },
    async createDeliverableVersion(input) {
      return (await client()).mutation(api.deliverables.createVersion, {
        ...input,
        deliverableId: input.deliverableId as Id<"deliverables">,
      })
    },
    async promoteDeliverableVersion(input) {
      return (await client()).mutation(api.deliverables.promote, {
        ...input,
        deliverableId: input.deliverableId as Id<"deliverables">,
        versionId: input.versionId as Id<"deliverableVersions">,
        expectedPromotedVersionId:
          input.expectedPromotedVersionId as Id<"deliverableVersions"> | null,
      })
    },
    async setPrimaryDeliverable(input) {
      return (await client()).mutation(api.deliverables.setPrimary, {
        ...input,
        deliverableId: input.deliverableId as Id<"deliverables">,
        expectedPrimaryDeliverableId:
          input.expectedPrimaryDeliverableId as Id<"deliverables">,
      })
    },
    async listDeliveryTargets(humanId) {
      return (await client()).query(api.deliveryTracking.list, { humanId })
    },
    async listArchivedDeliveryTargets(humanId, cursor) {
      const result = await (
        await client()
      ).query(api.deliveryTracking.listArchived, {
        humanId,
        paginationOpts: { numItems: 50, cursor },
      })
      return {
        page: result.page,
        nextCursor: result.isDone ? null : result.continueCursor,
      }
    },
    async createDeliveryTarget(input) {
      return (await client()).mutation(api.deliveryTracking.createTarget, {
        ...input,
        deliverableId: input.deliverableId as Id<"deliverables">,
      })
    },
    async setDeliveryTargetRequired(input) {
      return (await client()).mutation(api.deliveryTracking.setRequired, {
        ...input,
        targetId: input.targetId as Id<"deliveryTargets">,
      })
    },
    async setDeliveryTargetRetention(input) {
      return (await client()).mutation(api.deliveryTracking.setRetention, {
        ...input,
        targetId: input.targetId as Id<"deliveryTargets">,
      })
    },
    async listPublicShares(humanId) {
      return (await client()).mutation(api.publicShares.list, { humanId })
    },
    async createPublicShare(input) {
      return (await client()).mutation(api.publicShares.create, {
        ...input,
        contextItemIds: input.contextItemIds as Array<Id<"contextItems">>,
        deliverableIds: input.deliverableIds as Array<Id<"deliverables">>,
      })
    },
    async revokePublicShare(shareId, correlationId, expectedAggregateVersion) {
      return (await client()).mutation(api.publicShares.revoke, {
        shareId: shareId as Id<"publicShares">,
        correlationId,
        expectedAggregateVersion,
      })
    },
    async confirmDeliveryTarget(input) {
      return (await client()).mutation(api.deliveryTracking.confirm, {
        ...input,
        targetId: input.targetId as Id<"deliveryTargets">,
        versionId: input.versionId as Id<"deliverableVersions">,
        integrationSuccessId: input.integrationSuccessId as
          | Id<"integrationDeliverySuccesses">
          | undefined,
      })
    },
    async reopenDeliveryTarget(input) {
      return (await client()).mutation(api.deliveryTracking.reopen, {
        ...input,
        targetId: input.targetId as Id<"deliveryTargets">,
      })
    },
    async proposeAssigneeChange(input) {
      return (await client()).mutation(
        api.semanticConflicts.proposeAssigneeChange,
        {
          ...input,
          expectedAssigneePrincipalId:
            input.expectedAssigneePrincipalId as Id<"principals">,
          proposedAssigneePrincipalId:
            input.proposedAssigneePrincipalId as Id<"principals">,
          watcherPrincipalIds: input.watcherPrincipalIds?.map(
            (principalId) => principalId as Id<"principals">
          ),
        }
      )
    },
    async listOpenSemanticConflicts(humanId) {
      return (await client()).query(api.semanticConflicts.listOpen, { humanId })
    },
    async resolveSemanticConflict(input) {
      return (await client()).mutation(api.semanticConflicts.resolve, {
        ...input,
        conflictId: input.conflictId as Id<"semanticConflicts">,
      })
    },
  }
}
