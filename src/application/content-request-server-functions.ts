import { createServerFn } from "@tanstack/react-start"

import type {
  AssigneeChangeProposal,
  AssignRequestInput,
  ContextDeckPreferences,
  CreateFollowUpInput,
  CreateManualRequestInput,
  FinalizeFounderVoiceCaptureInput,
  OperatorWorkspaceInput,
} from "@/application/content-requests"
import { toPublicShareResponse } from "@/application/content-requests"

export const listContentRequests = createServerFn({ method: "POST" }).handler(
  async () => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).list()
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

export const getContentRequest = createServerFn({ method: "POST" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).getByHumanId(
      data.humanId
    )
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
