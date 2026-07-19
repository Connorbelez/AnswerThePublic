import { ConvexHttpClient } from "convex/browser"
import { ConvexError } from "convex/values"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type {
  AssignRequestInput,
  ContentRequestRepository,
  PersistManualRequestInput,
} from "@/application/content-requests"

type TokenProvider = () => Promise<string | null>

export function createConvexContentRequestRepository({
  getAccessToken,
}: {
  getAccessToken: TokenProvider
}): ContentRequestRepository {
  async function client() {
    const convexUrl = process.env.VITE_CONVEX_URL
    if (!convexUrl) {
      throw new Error("VITE_CONVEX_URL is required for Content Request access.")
    }
    const accessToken = await getAccessToken()
    if (!accessToken) {
      throw new Error("An access token is required for Content Request access.")
    }
    const convex = new ConvexHttpClient(convexUrl)
    convex.setAuth(accessToken)
    return convex
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
    async listOperatorWorkspace(input) {
      return (await client()).query(api.operatorWorkspace.list, {
        queue: input?.queue,
        search: input?.search,
        priority: input?.priority,
        origin: input?.origin,
        lifecycle: input?.lifecycle,
        disposition: input?.disposition,
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
    async listAssignablePrincipals() {
      return (await client()).query(
        api.contentRequests.listAssignablePrincipals,
        {}
      )
    },
    async listMyNotifications() {
      return (await client()).query(api.contentRequests.listMyNotifications, {})
    },
    async markNotificationRead(notificationId) {
      await (
        await client()
      ).mutation(api.contentRequests.markNotificationRead, {
        notificationId: notificationId as Id<"notifications">,
      })
    },
    async listContext(humanId) {
      return (await client()).query(api.scoutIngestions.listContext, {
        humanId,
      })
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
      leaseGeneration
    ) {
      return (await client()).mutation(api.agentJobs.fail, {
        jobId: jobId as Id<"agentJobs">,
        leaseToken,
        errorCode,
        transient,
        correlationId,
        leaseGeneration,
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
