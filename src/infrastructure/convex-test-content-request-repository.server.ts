import { api, internal } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type {
  AssignRequestInput,
  ContentRequestRepository,
  PersistManualRequestInput,
  UpdateRequestInput,
} from "@/application/content-requests"
import type { ExternalIdentity } from "@/application/workspace-session"
import { getConvexTestWorkspace } from "@/infrastructure/convex-test-workspace.server"

export async function createConvexTestContentRequestRepository(
  identity: ExternalIdentity
): Promise<ContentRequestRepository> {
  const backend = await getConvexTestWorkspace(identity)
  async function finishArchiveTransition(humanId: string) {
    const request = await backend.query(api.contentRequests.getByHumanId, {
      humanId,
    })
    if (!request) throw new Error("Content Request not found")
    const transition = await backend.run((ctx) =>
      ctx.db.get(request.requestId as Id<"contentRequests">)
    )
    if (
      !transition?.archiveTransitionToken ||
      !transition.archiveTransitionMode ||
      !transition.archiveTransitionMarker
    )
      return request
    const resources =
      transition.archiveTransitionMode === "archive"
        ? ([
            "deliverables",
            "delivery_targets",
            "agent_jobs",
            "search_rows",
          ] as const)
        : ([
            "deliverables",
            "delivery_targets",
            "agent_jobs",
            "voice_captures",
            "search_rows",
          ] as const)
    for (const resource of resources)
      await backend.mutation(
        internal.requestDisposition.continueArchiveChildren,
        {
          requestId: transition._id,
          marker: transition.archiveTransitionMarker,
          transitionToken: transition.archiveTransitionToken,
          mode: transition.archiveTransitionMode,
          resource,
        }
      )
    if (transition.archiveTransitionMode === "restore") {
      await backend.mutation(internal.requestDisposition.activateRestoredJobs, {
        requestId: transition._id,
        marker: transition.archiveTransitionMarker,
      })
      await backend.mutation(
        internal.requestDisposition.resumeRestoredVoiceCaptures,
        { requestId: transition._id }
      )
    }
    const settled = await backend.query(api.contentRequests.getByHumanId, {
      humanId,
    })
    if (!settled) throw new Error("Content Request not found")
    return settled
  }
  return {
    async createManual(input: PersistManualRequestInput) {
      return backend.mutation(api.contentRequests.createManual, input)
    },
    async createExpertInterview(input) {
      const created = await backend.mutation(api.expertInterviews.create, input)
      return {
        request: created.request,
        expertInterview: {
          package: created.package,
          brief: created.brief,
          gaps: created.gaps,
          questions: created.questions,
          instructions: created.instructions,
        },
      }
    },
    async saveExpertInterviewPackage(input) {
      return backend.mutation(api.expertInterviews.savePackage, input)
    },
    async getExpertInterview(humanId) {
      return backend.query(api.expertInterviews.getByHumanId, { humanId })
    },
    async listExpertInterviewSubmissions(humanId) {
      return backend.mutation(api.expertSynthesis.listSubmissions, { humanId })
    },
    async listExpertInterviewContextVersionIds(humanId) {
      return backend.query(api.expertSynthesis.listContextVersionIds, {
        humanId,
      })
    },
    async createExpertSynthesisProcessingSnapshot(input) {
      return backend.mutation(
        api.expertSynthesis.createProcessingSnapshot,
        input
      )
    },
    async verifyExpertSynthesisProcessingSnapshot(input) {
      return backend.query(api.expertSynthesis.verifyProcessingSnapshot, input)
    },
    async commitExpertSynthesis(input) {
      return backend.mutation(api.expertSynthesis.completeProcessing, {
        ...input,
        jobId: input.jobId as Id<"agentJobs"> | undefined,
        deliverableId: input.deliverableId as Id<"deliverables"> | undefined,
      })
    },
    async setExpertInterviewSubmissionInclusion(input) {
      return backend.mutation(api.expertSynthesis.setSubmissionInclusion, input)
    },
    async searchPeople(query, limit) {
      return backend.query(api.people.search, { query, limit })
    },
    async createPerson(input) {
      return backend.mutation(api.people.create, input)
    },
    async listGuestAccessGrants(humanId) {
      return backend.mutation(api.guestAccess.list, { humanId })
    },
    async createGuestAccessGrant(input) {
      return backend.mutation(api.guestAccess.create, {
        ...input,
        personId: input.personId as Id<"people">,
      })
    },
    async revokeGuestAccessGrant(input) {
      return backend.mutation(api.guestAccess.revoke, {
        ...input,
        grantId: input.grantId as Id<"guestAccessGrants">,
      })
    },
    async renewGuestAccessGrant(input) {
      return backend.mutation(api.guestAccess.renew, {
        ...input,
        grantId: input.grantId as Id<"guestAccessGrants">,
      })
    },
    async inspectGuestResponseWorkspace(grantId) {
      const id = grantId as Id<"guestAccessGrants">
      const [response, evidence] = await Promise.all([
        backend.query(api.guestAccess.inspectResponseWorkspace, {
          grantId: id,
        }),
        backend.query(api.guestEvidence.inspectForAdmin, { grantId: id }),
      ])
      return response && evidence
        ? { ...response, assets: evidence.assets }
        : response
    },
    async addGuestResponseAssetFeedback(input) {
      return backend.mutation(api.guestEvidence.addAssetFeedback, {
        ...input,
        grantId: input.grantId as Id<"guestAccessGrants">,
        assetId: input.assetId as Id<"responseAssets">,
      })
    },
    async addGuestResponseFeedback(input) {
      return backend.mutation(api.guestAccess.addResponseFeedback, {
        ...input,
        grantId: input.grantId as Id<"guestAccessGrants">,
      })
    },
    async reopenGuestResponseWorkspace(input) {
      return backend.mutation(api.guestAccess.reopenResponseWorkspace, {
        ...input,
        grantId: input.grantId as Id<"guestAccessGrants">,
      })
    },
    async getByHumanId(humanId) {
      return backend.query(api.contentRequests.getByHumanId, { humanId })
    },
    async list(limit) {
      return backend.query(api.contentRequests.list, { limit })
    },
    async listFounderWorkspace(founderEmail, limit) {
      return backend.query(api.contentRequests.listFounderWorkspace, {
        founderEmail,
        limit,
      })
    },
    async listPage(cursor, limit) {
      const result = await backend.query(api.contentRequests.listPage, {
        paginationOpts: { numItems: limit, cursor },
      })
      return {
        page: result.page,
        nextCursor: result.isDone ? null : result.continueCursor,
      }
    },
    async getProductMetrics(input) {
      return backend.query(api.productMetrics.get, input ?? {})
    },
    async listOperatorWorkspace(input) {
      return backend.query(api.operatorWorkspace.list, {
        queue: input?.queue,
        search: input?.search,
        priority: input?.priority,
        origin: input?.origin,
        lifecycle: input?.lifecycle,
        disposition: input?.disposition,
        retention: input?.retention,
        assigneePrincipalId: input?.assigneePrincipalId as
          Id<"principals"> | undefined,
        deliveryChannel: input?.deliveryChannel,
        paginationOpts: {
          numItems: Math.min(Math.max(input?.limit ?? 50, 1), 100),
          cursor: input?.cursor ?? null,
        },
      })
    },
    async getCurrentFounderHandoff(humanId) {
      return backend.query(api.founderHandoffs.getCurrent, { humanId })
    },
    async finalizeFounderHandoff(input) {
      return backend.mutation(api.founderHandoffs.finalize, {
        ...input,
        recipientPrincipalId: input.recipientPrincipalId as Id<"principals">,
      })
    },
    async resolve(query) {
      return backend.query(api.contentRequests.resolve, { query })
    },
    async update(input: UpdateRequestInput) {
      return backend.mutation(api.contentRequests.update, input)
    },
    async assign(input: AssignRequestInput) {
      const current = await backend.query(api.contentRequests.getByHumanId, {
        humanId: input.humanId,
      })
      if (!current) throw new Error("Content Request not found")
      const result = await backend.mutation(
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
        throw new Error(`Attention required: ${result.conflict.conflictId}`)
      }
      const saved = await backend.query(api.contentRequests.getByHumanId, {
        humanId: input.humanId,
      })
      if (!saved)
        throw new Error("Content Request disappeared after assignment")
      return saved
    },
    async open(humanId, correlationId) {
      return backend.mutation(api.contentRequests.open, {
        humanId,
        correlationId,
      })
    },
    async setExpiration(humanId, expiresAt, correlationId) {
      return backend.mutation(api.requestDisposition.setExpiration, {
        humanId,
        expiresAt,
        correlationId,
      })
    },
    async expire(humanId, reason, correlationId) {
      return backend.mutation(api.requestDisposition.expire, {
        humanId,
        reason,
        correlationId,
      })
    },
    async restoreExpired(humanId, expiresAt, correlationId) {
      return backend.mutation(api.requestDisposition.restoreExpired, {
        humanId,
        expiresAt,
        correlationId,
      })
    },
    async archive(humanId, correlationId) {
      await backend.mutation(api.requestDisposition.archive, {
        humanId,
        correlationId,
      })
      return finishArchiveTransition(humanId)
    },
    async restoreArchived(humanId, correlationId) {
      await backend.mutation(api.requestDisposition.restoreArchived, {
        humanId,
        correlationId,
      })
      return finishArchiveTransition(humanId)
    },
    async createFollowUp(input) {
      return backend.mutation(api.requestDisposition.createFollowUp, input)
    },
    async getRelations(humanId) {
      return backend.query(api.requestDisposition.getRelations, { humanId })
    },
    async listAssignablePrincipals() {
      return backend.query(api.contentRequests.listAssignablePrincipals, {})
    },
    async listMyNotifications() {
      return backend.query(api.contentRequests.listMyNotifications, {})
    },
    async listMyNotificationsPage(cursor, limit) {
      const result = await backend.query(
        api.contentRequests.listMyNotificationsPage,
        { paginationOpts: { numItems: limit, cursor } }
      )
      return {
        page: result.page,
        nextCursor: result.isDone ? null : result.continueCursor,
      }
    },
    async markNotificationRead(notificationId, correlationId) {
      await backend.mutation(api.contentRequests.markNotificationRead, {
        notificationId: notificationId as Id<"notifications">,
        correlationId,
      })
    },
    async listAuditEvents(humanId, cursor, limit) {
      const result = await backend.query(
        api.contentRequests.listAuditEventsPage,
        {
          humanId,
          paginationOpts: { numItems: limit, cursor },
        }
      )
      return {
        page: result.page,
        nextCursor: result.isDone ? null : result.continueCursor,
      }
    },
    async listContext(humanId) {
      return backend.query(api.scoutIngestions.listContext, { humanId })
    },
    async upsertContext(input) {
      return backend.mutation(api.scoutIngestions.upsertContext, input)
    },
    async listContextVersions(contextId, cursor, limit) {
      const result = await backend.query(
        api.scoutIngestions.listContextVersions,
        {
          contextId: contextId as Id<"contextItems">,
          paginationOpts: { numItems: limit, cursor },
        }
      )
      return {
        page: result.page,
        nextCursor: result.isDone ? null : result.continueCursor,
      }
    },
    async getContextDeckPreferences(humanId, founderWorkspace) {
      return backend.query(api.scoutIngestions.getContextDeckPreferences, {
        humanId,
        founderWorkspace,
      })
    },
    async saveContextDeckPreferences(
      humanId,
      preferences,
      correlationId,
      founderWorkspace
    ) {
      return backend.mutation(api.scoutIngestions.saveContextDeckPreferences, {
        humanId,
        ...preferences,
        correlationId,
        founderWorkspace,
      })
    },
    async getFounderInput(humanId) {
      return backend.query(api.founderInputs.getMine, { humanId })
    },
    async saveFounderText(humanId, text, correlationId) {
      return backend.mutation(api.founderInputs.saveText, {
        humanId,
        text,
        correlationId,
      })
    },
    async pullFounderAutomergeChanges(humanId, documentId) {
      return backend.query(api.founderInputs.pullAutomergeChanges, {
        humanId,
        documentId,
      })
    },
    async submitFounderAutomergeChanges(input) {
      return backend.mutation(api.founderInputs.submitAutomergeChanges, input)
    },
    async getFounderVersionHistory(humanId) {
      return backend.query(api.founderInputs.getVersionHistory, { humanId })
    },
    async listFounderArchivedVersions(humanId, cursor) {
      return backend.query(api.founderInputs.listArchivedVersions, {
        humanId,
        paginationOpts: { numItems: 20, cursor },
      })
    },
    async restoreFounderArchivedVersion(humanId, versionId, correlationId) {
      return backend.mutation(api.founderInputs.restoreArchivedVersion, {
        humanId,
        versionId: versionId as Id<"founderInputVersions">,
        correlationId,
      })
    },
    async createFounderVoiceUploadUrl(humanId) {
      return backend.mutation(api.voiceCaptures.createUploadUrl, { humanId })
    },
    async finalizeFounderVoiceCapture(input) {
      return backend.mutation(api.voiceCaptures.finalizeUpload, {
        ...input,
        storageId: input.storageId as Id<"_storage">,
      })
    },
    async listFounderVoiceCaptures(humanId) {
      return backend.query(api.voiceCaptures.listMine, { humanId })
    },
    async retryFounderVoiceCapture(humanId, captureId) {
      return backend.mutation(api.voiceCaptures.retry, {
        humanId,
        captureId: captureId as Id<"founderVoiceCaptures">,
      })
    },
    async markFounderVoiceTranscriptMerged(humanId, captureId) {
      return backend.mutation(api.voiceCaptures.markTranscriptMerged, {
        humanId,
        captureId: captureId as Id<"founderVoiceCaptures">,
      })
    },
    async discardFounderVoiceCapture(humanId, captureId) {
      return backend.mutation(api.voiceCaptures.discard, {
        humanId,
        captureId: captureId as Id<"founderVoiceCaptures">,
      })
    },
    async undoFounderInput(humanId, correlationId) {
      return backend.mutation(api.founderInputs.undo, {
        humanId,
        correlationId,
      })
    },
    async redoFounderInput(humanId, correlationId) {
      return backend.mutation(api.founderInputs.redo, {
        humanId,
        correlationId,
      })
    },
    async assertFounderInputSynced(humanId, heads) {
      return backend.query(api.founderInputs.assertDurablySynced, {
        humanId,
        heads,
      })
    },
    async submitFounderInput(humanId, heads, correlationId) {
      return backend.mutation(api.agentJobs.submitFounderInput, {
        humanId,
        heads,
        correlationId,
      })
    },
    async listAgentJobs() {
      return backend.query(api.agentJobs.list, {})
    },
    async listAgentJobsPage(cursor, limit) {
      const result = await backend.query(api.agentJobs.listPage, {
        paginationOpts: { numItems: limit, cursor },
      })
      return {
        page: result.page,
        nextCursor: result.isDone ? null : result.continueCursor,
      }
    },
    async claimAgentJob(leaseToken, leaseMs) {
      return backend.mutation(api.agentJobs.claim, { leaseToken, leaseMs })
    },
    async claimAgentJobForRequest(humanId, leaseToken, leaseMs) {
      return backend.mutation(api.agentJobs.claimForRequest, {
        humanId,
        leaseToken,
        leaseMs,
      })
    },
    async claimExpertSynthesisJob(humanId, leaseToken, leaseMs) {
      return backend.mutation(api.agentJobs.claimExpertSynthesis, {
        humanId,
        leaseToken,
        leaseMs,
      })
    },
    async heartbeatAgentJob(jobId, leaseToken, leaseMs, leaseGeneration) {
      return backend.mutation(api.agentJobs.heartbeat, {
        jobId: jobId as Id<"agentJobs">,
        leaseToken,
        leaseMs,
        leaseGeneration,
      })
    },
    async getAgentJobInput(jobId) {
      return backend.query(api.agentJobs.getInput, {
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
      return backend.mutation(api.agentJobs.complete, {
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
      return backend.mutation(api.agentJobs.fail, {
        jobId: jobId as Id<"agentJobs">,
        leaseToken,
        errorCode,
        transient,
        correlationId,
        leaseGeneration,
      })
    },
    async listDeliverables(humanId) {
      return backend.query(api.deliverables.list, { humanId })
    },
    async createDerivativeDeliverable(input) {
      return backend.mutation(api.deliverables.createDerivative, input)
    },
    async createDeliverableVersion(input) {
      return backend.mutation(api.deliverables.createVersion, {
        ...input,
        deliverableId: input.deliverableId as Id<"deliverables">,
      })
    },
    async promoteDeliverableVersion(input) {
      return backend.mutation(api.deliverables.promote, {
        ...input,
        deliverableId: input.deliverableId as Id<"deliverables">,
        versionId: input.versionId as Id<"deliverableVersions">,
        expectedPromotedVersionId:
          input.expectedPromotedVersionId as Id<"deliverableVersions"> | null,
      })
    },
    async setPrimaryDeliverable(input) {
      return backend.mutation(api.deliverables.setPrimary, {
        ...input,
        deliverableId: input.deliverableId as Id<"deliverables">,
        expectedPrimaryDeliverableId:
          input.expectedPrimaryDeliverableId as Id<"deliverables">,
      })
    },
    async listDeliveryTargets(humanId) {
      return backend.query(api.deliveryTracking.list, { humanId })
    },
    async listArchivedDeliveryTargets(humanId, cursor) {
      const result = await backend.query(api.deliveryTracking.listArchived, {
        humanId,
        paginationOpts: { numItems: 50, cursor },
      })
      return {
        page: result.page,
        nextCursor: result.isDone ? null : result.continueCursor,
      }
    },
    async createDeliveryTarget(input) {
      return backend.mutation(api.deliveryTracking.createTarget, {
        ...input,
        deliverableId: input.deliverableId as Id<"deliverables">,
      })
    },
    async setDeliveryTargetRequired(input) {
      return backend.mutation(api.deliveryTracking.setRequired, {
        ...input,
        targetId: input.targetId as Id<"deliveryTargets">,
      })
    },
    async setDeliveryTargetRetention(input) {
      return backend.mutation(api.deliveryTracking.setRetention, {
        ...input,
        targetId: input.targetId as Id<"deliveryTargets">,
      })
    },
    async listPublicShares(humanId) {
      return backend.mutation(api.publicShares.list, { humanId })
    },
    async createPublicShare(input) {
      return backend.mutation(api.publicShares.create, {
        ...input,
        contextItemIds: input.contextItemIds as Array<Id<"contextItems">>,
        deliverableIds: input.deliverableIds as Array<Id<"deliverables">>,
      })
    },
    async revokePublicShare(shareId, correlationId) {
      return backend.mutation(api.publicShares.revoke, {
        shareId: shareId as Id<"publicShares">,
        correlationId,
      })
    },
    async confirmDeliveryTarget(input) {
      return backend.mutation(api.deliveryTracking.confirm, {
        ...input,
        targetId: input.targetId as Id<"deliveryTargets">,
        versionId: input.versionId as Id<"deliverableVersions">,
        integrationSuccessId: input.integrationSuccessId as
          Id<"integrationDeliverySuccesses"> | undefined,
      })
    },
    async reopenDeliveryTarget(input) {
      return backend.mutation(api.deliveryTracking.reopen, {
        ...input,
        targetId: input.targetId as Id<"deliveryTargets">,
      })
    },
    async proposeAssigneeChange(input) {
      return backend.mutation(api.semanticConflicts.proposeAssigneeChange, {
        ...input,
        expectedAssigneePrincipalId:
          input.expectedAssigneePrincipalId as Id<"principals">,
        proposedAssigneePrincipalId:
          input.proposedAssigneePrincipalId as Id<"principals">,
        watcherPrincipalIds: input.watcherPrincipalIds?.map(
          (principalId) => principalId as Id<"principals">
        ),
      })
    },
    async listOpenSemanticConflicts(humanId) {
      return backend.query(api.semanticConflicts.listOpen, { humanId })
    },
    async resolveSemanticConflict(input) {
      return backend.mutation(api.semanticConflicts.resolve, {
        ...input,
        conflictId: input.conflictId as Id<"semanticConflicts">,
      })
    },
  }
}
