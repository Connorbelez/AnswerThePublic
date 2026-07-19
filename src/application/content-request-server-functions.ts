import { createServerFn } from "@tanstack/react-start"

import type {
  AssigneeChangeProposal,
  AssignRequestInput,
  ContextDeckPreferences,
  CreateManualRequestInput,
  FinalizeFounderVoiceCaptureInput,
} from "@/application/content-requests"

export const listContentRequests = createServerFn({ method: "POST" }).handler(
  async () => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).list()
  }
)

export const getContentRequest = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).getByHumanId(
      data.humanId
    )
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
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).getContextDeckPreferences(data.humanId)
  })

export const saveContextDeckPreferences = createServerFn({ method: "POST" })
  .validator(
    (data: {
      humanId: string
      preferences: ContextDeckPreferences
      correlationId: string
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
      data.correlationId
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
    ).markNotificationRead(data.notificationId)
  })
