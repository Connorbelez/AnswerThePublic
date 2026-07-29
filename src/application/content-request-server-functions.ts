import { createServerFn } from "@tanstack/react-start"

import type {
  AssigneeChangeProposal,
  AssignRequestInput,
  ContextDeckPreferences,
  CreateFollowUpInput,
  CreateManualRequestInput,
  FinalizeFounderVoiceCaptureInput,
  GuestAccessRepository,
  OperatorWorkspaceInput,
} from "@/application/content-requests"
import { toPublicShareResponse } from "@/application/content-requests"
import type { CreateExpertInterviewInput } from "@/application/expert-interviews"
import type { PromoteOpportunityInput } from "@/application/promote-opportunity"

async function createGuestAccessRepositoryForRequest(): Promise<GuestAccessRepository> {
  const [{ getRequestHeader }, { resolveGuestAccessNetworkSource }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/application/guest-access-network.server"),
    ])
  const networkSource = resolveGuestAccessNetworkSource(getRequestHeader)
  if (import.meta.env.MODE === "e2e") {
    const [
      { api },
      { getPublicConvexTestWorkspace },
      { createGuestAccessResolveArguments },
    ] = await Promise.all([
      import("../../convex/_generated/api"),
      import("@/infrastructure/convex-test-workspace.server"),
      import("@/infrastructure/convex-guest-access-repository"),
    ])
    const workspace = getPublicConvexTestWorkspace()
    return {
      async resolve(token, networkSource) {
        return workspace.mutation(
          api.guestAccess.resolve,
          await createGuestAccessResolveArguments(token, networkSource)
        )
      },
      async acquireEditorLease(input) {
        return workspace.mutation(api.guestAccess.acquireEditorLease, {
          ...input,
          ...(await createGuestAccessResolveArguments(
            input.token,
            networkSource
          )),
        })
      },
      async heartbeatEditorLease(input) {
        return workspace.mutation(api.guestAccess.heartbeatEditorLease, {
          ...input,
          ...(await createGuestAccessResolveArguments(
            input.token,
            networkSource
          )),
        })
      },
      async takeoverEditorLease(input) {
        return workspace.mutation(api.guestAccess.takeoverEditorLease, {
          ...input,
          ...(await createGuestAccessResolveArguments(
            input.token,
            networkSource
          )),
        })
      },
      async saveResponseWorkspace(input) {
        return workspace.mutation(api.guestAccess.saveResponseWorkspace, {
          ...input,
          ...(await createGuestAccessResolveArguments(
            input.token,
            networkSource
          )),
        })
      },
      async submitResponseWorkspace(input) {
        return workspace.mutation(api.guestAccess.submitResponseWorkspace, {
          ...input,
          ...(await createGuestAccessResolveArguments(
            input.token,
            networkSource
          )),
        })
      },
      async beginEvidenceUpload(input) {
        return workspace.mutation(api.guestEvidence.beginUpload, {
          ...input,
          ...(await createGuestAccessResolveArguments(
            input.token,
            networkSource
          )),
        })
      },
      registerEvidenceUpload(input) {
        return workspace.mutation(api.guestEvidence.registerUploadObject, {
          ...input,
          assetId: input.assetId as never,
          uploadSessionId: input.uploadSessionId as never,
          storageId: input.storageId as never,
        })
      },
      async finalizeEvidenceUpload(input) {
        return workspace.mutation(api.guestEvidence.finalizeUpload, {
          ...input,
          ...(await createGuestAccessResolveArguments(
            input.token,
            networkSource
          )),
          assetId: input.assetId as never,
          uploadSessionId: input.uploadSessionId as never,
          storageId: input.storageId as never,
        })
      },
      async markEvidenceUploadFailed(input) {
        return workspace.mutation(api.guestEvidence.markUploadFailed, {
          ...input,
          ...(await createGuestAccessResolveArguments(
            input.token,
            networkSource
          )),
          assetId: input.assetId as never,
          uploadSessionId: input.uploadSessionId as never,
        })
      },
      async listEvidence(token) {
        return workspace.mutation(
          api.guestEvidence.listForGuest,
          await createGuestAccessResolveArguments(token, networkSource)
        )
      },
      async retryEvidence(input) {
        return workspace.mutation(api.guestEvidence.retry, {
          ...input,
          ...(await createGuestAccessResolveArguments(
            input.token,
            networkSource
          )),
          assetId: input.assetId as never,
        })
      },
      async discardEvidence(input) {
        return workspace.mutation(api.guestEvidence.discard, {
          ...input,
          ...(await createGuestAccessResolveArguments(
            input.token,
            networkSource
          )),
          assetId: input.assetId as never,
        })
      },
    }
  }
  const { createConvexGuestAccessRepository } =
    await import("@/infrastructure/convex-guest-access-repository")
  return createConvexGuestAccessRepository(networkSource)
}

export const listContentRequests = createServerFn({ method: "POST" }).handler(
  async () => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).list()
  }
)

export const listExpertInterviewSubmissions = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).listExpertInterviewSubmissions(data.humanId)
  })

export const setExpertInterviewSubmissionInclusion = createServerFn({
  method: "POST",
})
  .validator(
    (data: {
      humanId: string
      submissionId: string
      included: boolean
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).setExpertInterviewSubmissionInclusion(data)
  })

export const prepareExpertInterviewProcessingInput = createServerFn({
  method: "POST",
})
  .validator(
    (data: {
      humanId: string
      submissionIds: Array<string>
      synthesisInstructions?: string
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const [
      { createContentRequestServiceFromRequest },
      { prepareExpertInterviewProcessing },
    ] = await Promise.all([
      import("@/application/content-request-service-request.server"),
      import("@/application/expert-interviews"),
    ])
    return prepareExpertInterviewProcessing(
      await createContentRequestServiceFromRequest(),
      data
    )
  })

export const completeExpertInterviewProcessingInput = createServerFn({
  method: "POST",
})
  .validator(
    (data: {
      humanId: string
      submissionIds: Array<string>
      processingToken: string
      payloadDigest: string
      body: string
      jobId?: string
      leaseToken?: string
      leaseGeneration?: number
      jobLeaseToken?: string
      deliverableId?: string
      name?: string
      changeSummary?: string
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const [
      { createContentRequestServiceFromRequest },
      { completeExpertInterviewProcessingWithLease },
    ] = await Promise.all([
      import("@/application/content-request-service-request.server"),
      import("@/application/expert-interviews"),
    ])
    return completeExpertInterviewProcessingWithLease(
      await createContentRequestServiceFromRequest(),
      data
    )
  })

export const listElieWorkspace = createServerFn({ method: "POST" }).handler(
  async () => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).listFounderWorkspace(
      process.env.FAIRLEND_ELIE_EMAIL ?? "elie@fairlend.ca"
    )
  }
)

export const listOperatorWorkspace = createServerFn({ method: "POST" })
  .validator((data: OperatorWorkspaceInput) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).listOperatorWorkspace(data)
  })

export const promoteOpportunity = createServerFn({ method: "POST" })
  .validator((data: PromoteOpportunityInput) => data)
  .handler(async ({ data }) => {
    const [
      { createContentRequestServiceFromRequest },
      { promoteOpportunityToFounder },
    ] = await Promise.all([
      import("@/application/content-request-service-request.server"),
      import("@/application/promote-opportunity"),
    ])
    return promoteOpportunityToFounder(
      await createContentRequestServiceFromRequest(),
      data
    )
  })

export const getContentRequest = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).getByHumanId(
      data.humanId
    )
  })

export const getExpertInterview = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).getExpertInterview(
      data.humanId
    )
  })

export const searchPeople = createServerFn({ method: "POST" })
  .validator((data: { query: string; limit?: number }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).searchPeople(
      data.query,
      data.limit
    )
  })

export const createPerson = createServerFn({ method: "POST" })
  .validator(
    (data: {
      humanId: string
      displayName: string
      email: string
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).createPerson(data)
  })

export const listGuestAccessGrants = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).listGuestAccessGrants(data.humanId)
  })

export const createGuestAccessGrant = createServerFn({ method: "POST" })
  .validator(
    (data: { humanId: string; personId: string; correlationId: string }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).createGuestAccessGrant(data)
  })

export const revokeGuestAccessGrant = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").MutateGuestAccessGrantInput
    ) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).revokeGuestAccessGrant(data)
  })

export const renewGuestAccessGrant = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").MutateGuestAccessGrantInput
    ) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).renewGuestAccessGrant(data)
  })

export const inspectGuestResponseWorkspace = createServerFn({ method: "POST" })
  .validator((data: { grantId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).inspectGuestResponseWorkspace(data.grantId)
  })

export const addGuestResponseFeedback = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").AddGuestResponseFeedbackInput
    ) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).addGuestResponseFeedback(data)
  })

export const addGuestResponseAssetFeedback = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").AddGuestResponseAssetFeedbackInput
    ) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).addGuestResponseAssetFeedback(data)
  })

export const reopenGuestResponseWorkspace = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").ReopenGuestResponseWorkspaceInput
    ) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).reopenGuestResponseWorkspace(data)
  })

export const resolveGuestAccess = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const [
      { getRequestHeader },
      { createGuestAccessService },
      { resolveGuestAccessNetworkSource },
      repository,
    ] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/application/content-requests"),
      import("@/application/guest-access-network.server"),
      createGuestAccessRepositoryForRequest(),
    ])
    const networkSource = resolveGuestAccessNetworkSource(getRequestHeader)
    return createGuestAccessService(repository).resolve(
      data.token,
      networkSource
    )
  })

export const saveGuestResponseWorkspace = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").SaveGuestResponseWorkspaceInput
    ) => data
  )
  .handler(async ({ data }) => {
    const [{ createGuestAccessService }, repository] = await Promise.all([
      import("@/application/content-requests"),
      createGuestAccessRepositoryForRequest(),
    ])
    return createGuestAccessService(repository).saveResponseWorkspace(data)
  })

export const submitGuestResponseWorkspace = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").SubmitGuestResponseWorkspaceInput
    ) => data
  )
  .handler(async ({ data }) => {
    const [{ createGuestAccessService }, repository] = await Promise.all([
      import("@/application/content-requests"),
      createGuestAccessRepositoryForRequest(),
    ])
    return createGuestAccessService(repository).submitResponseWorkspace(data)
  })

export const beginGuestEvidenceUpload = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").BeginGuestEvidenceUploadInput
    ) => data
  )
  .handler(async ({ data }) => {
    const [{ createGuestAccessService }, repository] = await Promise.all([
      import("@/application/content-requests"),
      createGuestAccessRepositoryForRequest(),
    ])
    const result =
      await createGuestAccessService(repository).beginEvidenceUpload(data)
    return import.meta.env.MODE === "e2e"
      ? {
          ...result,
          uploadUrl: `/api/e2e/storage-upload?session=${encodeURIComponent(result.uploadSessionId)}`,
        }
      : result
  })

export const finalizeGuestEvidenceUpload = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").FinalizeGuestEvidenceUploadInput
    ) => data
  )
  .handler(async ({ data }) => {
    const [{ createGuestAccessService }, repository] = await Promise.all([
      import("@/application/content-requests"),
      createGuestAccessRepositoryForRequest(),
    ])
    return createGuestAccessService(repository).finalizeEvidenceUpload(data)
  })

export const registerGuestEvidenceUpload = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").RegisterGuestEvidenceUploadInput
    ) => data
  )
  .handler(async ({ data }) => {
    const [{ createGuestAccessService }, repository] = await Promise.all([
      import("@/application/content-requests"),
      createGuestAccessRepositoryForRequest(),
    ])
    return createGuestAccessService(repository).registerEvidenceUpload(data)
  })

export const markGuestEvidenceUploadFailed = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").MarkGuestEvidenceUploadFailedInput
    ) => data
  )
  .handler(async ({ data }) => {
    const [{ createGuestAccessService }, repository] = await Promise.all([
      import("@/application/content-requests"),
      createGuestAccessRepositoryForRequest(),
    ])
    return createGuestAccessService(repository).markEvidenceUploadFailed(data)
  })

export const listGuestEvidence = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const [{ createGuestAccessService }, repository] = await Promise.all([
      import("@/application/content-requests"),
      createGuestAccessRepositoryForRequest(),
    ])
    return createGuestAccessService(repository).listEvidence(data.token)
  })

export const retryGuestEvidence = createServerFn({ method: "POST" })
  .validator(
    (data: import("@/application/content-requests").RetryGuestEvidenceInput) =>
      data
  )
  .handler(async ({ data }) => {
    const [{ createGuestAccessService }, repository] = await Promise.all([
      import("@/application/content-requests"),
      createGuestAccessRepositoryForRequest(),
    ])
    const result =
      await createGuestAccessService(repository).retryEvidence(data)
    return import.meta.env.MODE === "e2e" && result.uploadSessionId
      ? {
          ...result,
          uploadUrl: `/api/e2e/storage-upload?session=${encodeURIComponent(result.uploadSessionId)}`,
        }
      : result
  })

export const discardGuestEvidence = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").DiscardGuestEvidenceInput
    ) => data
  )
  .handler(async ({ data }) => {
    const [{ createGuestAccessService }, repository] = await Promise.all([
      import("@/application/content-requests"),
      createGuestAccessRepositoryForRequest(),
    ])
    return createGuestAccessService(repository).discardEvidence(data)
  })

export const acquireGuestEditorLease = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").AcquireGuestEditorLeaseInput
    ) => data
  )
  .handler(async ({ data }) => {
    const [{ createGuestAccessService }, repository] = await Promise.all([
      import("@/application/content-requests"),
      createGuestAccessRepositoryForRequest(),
    ])
    return createGuestAccessService(repository).acquireEditorLease(data)
  })

export const heartbeatGuestEditorLease = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").HeartbeatGuestEditorLeaseInput
    ) => data
  )
  .handler(async ({ data }) => {
    const [{ createGuestAccessService }, repository] = await Promise.all([
      import("@/application/content-requests"),
      createGuestAccessRepositoryForRequest(),
    ])
    return createGuestAccessService(repository).heartbeatEditorLease(data)
  })

export const takeoverGuestEditorLease = createServerFn({ method: "POST" })
  .validator(
    (
      data: import("@/application/content-requests").TakeoverGuestEditorLeaseInput
    ) => data
  )
  .handler(async ({ data }) => {
    const [{ createGuestAccessService }, repository] = await Promise.all([
      import("@/application/content-requests"),
      createGuestAccessRepositoryForRequest(),
    ])
    return createGuestAccessService(repository).takeoverEditorLease(data)
  })

export const getContentRequestRelations = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).getRelations(
      data.humanId
    )
  })

export const setContentRequestExpiration = createServerFn({ method: "POST" })
  .validator(
    (data: {
      humanId: string
      expiresAt: number | null
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).setExpiration(
      data.humanId,
      data.expiresAt,
      data.correlationId
    )
  })

export const expireContentRequest = createServerFn({ method: "POST" })
  .validator(
    (data: { humanId: string; reason: string; correlationId: string }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).expire(
      data.humanId,
      data.reason,
      data.correlationId
    )
  })

export const restoreExpiredContentRequest = createServerFn({ method: "POST" })
  .validator(
    (data: {
      humanId: string
      expiresAt: number | null
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).restoreExpired(
      data.humanId,
      data.expiresAt,
      data.correlationId
    )
  })

export const archiveContentRequest = createServerFn({ method: "POST" })
  .validator((data: { humanId: string; correlationId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).archive(
      data.humanId,
      data.correlationId
    )
  })

export const restoreArchivedContentRequest = createServerFn({ method: "POST" })
  .validator((data: { humanId: string; correlationId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).restoreArchived(
      data.humanId,
      data.correlationId
    )
  })

export const createContentRequestFollowUp = createServerFn({ method: "POST" })
  .validator((data: CreateFollowUpInput) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).createFollowUp(data)
  })

export const getContentRequestContext = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).listContext(
      data.humanId
    )
  })

export const getContextDeckPreferences = createServerFn({ method: "POST" })
  .validator((data: { humanId: string; founderWorkspace?: boolean }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).getContextDeckPreferences(data.humanId, data.founderWorkspace)
  })

export const saveContextDeckPreferences = createServerFn({ method: "POST" })
  .validator(
    (data: {
      humanId: string
      preferences: ContextDeckPreferences
      correlationId: string
      founderWorkspace?: boolean
    }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).saveContextDeckPreferences(
      data.humanId,
      data.preferences,
      data.correlationId,
      data.founderWorkspace
    )
  })

export const getFounderInput = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).getFounderInput(
      data.humanId
    )
  })

export const saveFounderText = createServerFn({ method: "POST" })
  .validator(
    (data: { humanId: string; text: string; correlationId: string }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).saveFounderText(
      data.humanId,
      data.text,
      data.correlationId
    )
  })

export const pullFounderAutomergeChanges = createServerFn({ method: "POST" })
  .validator((data: { humanId: string; documentId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).pullFounderAutomergeChanges(data.humanId, data.documentId)
  })

export const submitFounderAutomergeChanges = createServerFn({ method: "POST" })
  .validator(
    (data: {
      humanId: string
      documentId: string
      changes: Array<{ hash: string; data: string }>
      heads: Array<string>
      text: string
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).submitFounderAutomergeChanges(data)
  })

export const getFounderVersionHistory = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).getFounderVersionHistory(data.humanId)
  })

export const listFounderArchivedVersions = createServerFn({ method: "POST" })
  .validator((data: { humanId: string; cursor: string | null }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).listFounderArchivedVersions(data.humanId, data.cursor)
  })

export const restoreFounderArchivedVersion = createServerFn({ method: "POST" })
  .validator(
    (data: { humanId: string; versionId: string; correlationId: string }) =>
      data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).restoreFounderArchivedVersion(
      data.humanId,
      data.versionId,
      data.correlationId
    )
  })

export const createFounderVoiceUploadUrl = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).createFounderVoiceUploadUrl(data.humanId)
  })

export const finalizeFounderVoiceCapture = createServerFn({ method: "POST" })
  .validator((data: FinalizeFounderVoiceCaptureInput) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).finalizeFounderVoiceCapture(data)
  })

export const listFounderVoiceCaptures = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).listFounderVoiceCaptures(data.humanId)
  })

export const retryFounderVoiceCapture = createServerFn({ method: "POST" })
  .validator((data: { humanId: string; captureId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).retryFounderVoiceCapture(data.humanId, data.captureId)
  })

export const markFounderVoiceTranscriptMerged = createServerFn({
  method: "POST",
})
  .validator((data: { humanId: string; captureId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).markFounderVoiceTranscriptMerged(data.humanId, data.captureId)
  })

export const discardFounderVoiceCapture = createServerFn({ method: "POST" })
  .validator((data: { humanId: string; captureId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).discardFounderVoiceCapture(data.humanId, data.captureId)
  })

export const undoFounderInput = createServerFn({ method: "POST" })
  .validator((data: { humanId: string; correlationId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).undoFounderInput(
      data.humanId,
      data.correlationId
    )
  })

export const redoFounderInput = createServerFn({ method: "POST" })
  .validator((data: { humanId: string; correlationId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).redoFounderInput(
      data.humanId,
      data.correlationId
    )
  })

export const assertFounderInputSynced = createServerFn({ method: "POST" })
  .validator((data: { humanId: string; heads: Array<string> }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).assertFounderInputSynced(data.humanId, data.heads)
  })

export const submitFounderInput = createServerFn({ method: "POST" })
  .validator(
    (data: { humanId: string; heads: Array<string>; correlationId: string }) =>
      data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).submitFounderInput(
      data.humanId,
      data.heads,
      data.correlationId
    )
  })

export const proposeAssigneeChange = createServerFn({ method: "POST" })
  .validator((data: AssigneeChangeProposal) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).proposeAssigneeChange(data)
  })

export const listOpenSemanticConflicts = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).listOpenSemanticConflicts(data.humanId)
  })

export const resolveSemanticConflict = createServerFn({ method: "POST" })
  .validator(
    (data: {
      conflictId: string
      selectedValue: string
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).resolveSemanticConflict(data)
  })

export const createManualContentRequest = createServerFn({ method: "POST" })
  .validator((data: CreateManualRequestInput) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).createManual(data)
  })

export const createExpertInterviewContentRequest = createServerFn({
  method: "POST",
})
  .validator((data: CreateExpertInterviewInput) => data)
  .handler(async ({ data }) => {
    const [
      { createContentRequestServiceFromRequest },
      { createExpertInterview },
    ] = await Promise.all([
      import("@/application/content-request-service-request.server"),
      import("@/application/expert-interviews"),
    ])
    return createExpertInterview(
      await createContentRequestServiceFromRequest(),
      data
    )
  })

export const openContentRequest = createServerFn({ method: "POST" })
  .validator((data: { humanId: string; correlationId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).open(
      data.humanId,
      data.correlationId
    )
  })

export const listAssignablePrincipals = createServerFn({
  method: "POST",
}).handler(async () => {
  const { createContentRequestServiceFromRequest } =
    await import("@/application/content-request-service-request.server")
  return (
    await createContentRequestServiceFromRequest()
  ).listAssignablePrincipals()
})

export const assignContentRequest = createServerFn({ method: "POST" })
  .validator((data: AssignRequestInput) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).assign(data)
  })

export const listMyNotifications = createServerFn({ method: "POST" }).handler(
  async () => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).listMyNotifications()
  }
)

export const markMyNotificationRead = createServerFn({ method: "POST" })
  .validator((data: { notificationId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    await (
      await createContentRequestServiceFromRequest()
    ).markNotificationRead(data.notificationId, crypto.randomUUID())
  })

export const listDeliverables = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).listDeliverables(
      data.humanId
    )
  })

export const promoteDeliverableVersion = createServerFn({ method: "POST" })
  .validator(
    (data: {
      deliverableId: string
      versionId: string
      expectedPromotedVersionId: string | null
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).promoteDeliverableVersion(data)
  })

export const setPrimaryDeliverable = createServerFn({ method: "POST" })
  .validator(
    (data: {
      humanId: string
      deliverableId: string
      expectedPrimaryDeliverableId: string
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).setPrimaryDeliverable(data)
  })

export const listDeliveryTargets = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).listDeliveryTargets(
      data.humanId
    )
  })

export const listArchivedDeliveryTargets = createServerFn({ method: "POST" })
  .validator((data: { humanId: string; cursor: string | null }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).listArchivedDeliveryTargets(data.humanId, data.cursor)
  })

export const createDeliveryTarget = createServerFn({ method: "POST" })
  .validator(
    (data: {
      humanId: string
      deliverableId: string
      channel: string
      destinationLabel: string
      destinationUrl?: string
      isRequired?: boolean
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).createDeliveryTarget(data)
  })

export const setDeliveryTargetRequired = createServerFn({ method: "POST" })
  .validator(
    (data: { targetId: string; isRequired: boolean; correlationId: string }) =>
      data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).setDeliveryTargetRequired(data)
  })

export const setDeliveryTargetRetention = createServerFn({ method: "POST" })
  .validator(
    (data: {
      targetId: string
      retention: "active" | "archived"
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).setDeliveryTargetRetention(data)
  })

export const confirmDeliveryTarget = createServerFn({ method: "POST" })
  .validator(
    (data: {
      targetId: string
      versionId: string
      note?: string
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).confirmDeliveryTarget(data)
  })

export const reopenDeliveryTarget = createServerFn({ method: "POST" })
  .validator((data: { targetId: string; correlationId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).reopenDeliveryTarget(data)
  })

export const listPublicShares = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).listPublicShares(
      data.humanId
    )
  })

export const createPublicShare = createServerFn({ method: "POST" })
  .validator(
    (data: {
      humanId: string
      contextItemIds: Array<string>
      deliverableIds: Array<string>
      expiresAt?: number
      correlationId: string
    }) => data
  )
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).createPublicShare(
      data
    )
  })

export const revokePublicShare = createServerFn({ method: "POST" })
  .validator((data: { shareId: string; correlationId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).revokePublicShare(
      data.shareId,
      data.correlationId
    )
  })

export const getPublicShareView = createServerFn({ method: "GET" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    const { api } = await import("../../convex/_generated/api")
    if (import.meta.env.MODE === "e2e") {
      const { getPublicConvexTestWorkspace } =
        await import("@/infrastructure/convex-test-workspace.server")
      const workspace = getPublicConvexTestWorkspace()
      const view = await workspace.mutation(api.publicShares.view, {
        token: data.token,
      })
      return view ? toPublicShareResponse(view) : null
    }
    const { ConvexHttpClient } = await import("convex/browser")
    const url = process.env.VITE_CONVEX_URL
    if (!url) throw new Error("VITE_CONVEX_URL is required.")
    const client = new ConvexHttpClient(url)
    const view = await client.mutation(api.publicShares.view, {
      token: data.token,
    })
    return view ? toPublicShareResponse(view) : null
  })
