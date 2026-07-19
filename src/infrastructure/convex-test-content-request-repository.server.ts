import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type {
  AssignRequestInput,
  ContentRequestRepository,
  PersistManualRequestInput,
} from "@/application/content-requests"
import type { ExternalIdentity } from "@/application/workspace-session"
import { getConvexTestWorkspace } from "@/infrastructure/convex-test-workspace.server"

export async function createConvexTestContentRequestRepository(
  identity: ExternalIdentity
): Promise<ContentRequestRepository> {
  const backend = await getConvexTestWorkspace(identity)
  return {
    async createManual(input: PersistManualRequestInput) {
      return backend.mutation(api.contentRequests.createManual, input)
    },
    async getByHumanId(humanId) {
      return backend.query(api.contentRequests.getByHumanId, { humanId })
    },
    async list(limit) {
      return backend.query(api.contentRequests.list, { limit })
    },
    async resolve(query) {
      return backend.query(api.contentRequests.resolve, { query })
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
    async listAssignablePrincipals() {
      return backend.query(api.contentRequests.listAssignablePrincipals, {})
    },
    async listMyNotifications() {
      return backend.query(api.contentRequests.listMyNotifications, {})
    },
    async markNotificationRead(notificationId) {
      await backend.mutation(api.contentRequests.markNotificationRead, {
        notificationId: notificationId as Id<"notifications">,
      })
    },
    async listContext(humanId) {
      return backend.query(api.scoutIngestions.listContext, { humanId })
    },
    async getContextDeckPreferences(humanId) {
      return backend.query(api.scoutIngestions.getContextDeckPreferences, {
        humanId,
      })
    },
    async saveContextDeckPreferences(humanId, preferences, correlationId) {
      return backend.mutation(api.scoutIngestions.saveContextDeckPreferences, {
        humanId,
        ...preferences,
        correlationId,
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
