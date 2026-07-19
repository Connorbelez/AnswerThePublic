// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { VOICE_CAPTURE_OVERFLOW_SENTINEL } from "./lib/requestLimits"
import schema from "./schema"
import { modules } from "./test.setup"

const identity = (subject: string, role: string) => ({
  subject,
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role,
  jti: `${subject}-session`,
})

async function founderVoiceWorkspace() {
  const workspace = convexTest(schema, modules)
  const operator = workspace.withIdentity(
    identity("operator", "operator-editor")
  )
  const founder = workspace.withIdentity(identity("founder", "founder"))
  await operator.mutation(api.principals.syncCurrent)
  const founderPrincipal = await founder.mutation(api.principals.syncCurrent)
  const request = await operator.mutation(api.contentRequests.createManual, {
    title: "Founder voice response",
    origin: "manual",
    correlationId: "create-voice-request",
  })
  await operator.mutation(internal.contentRequests.assign, {
    humanId: request.humanId,
    assigneePrincipalId: founderPrincipal.principalId,
    correlationId: "assign-voice-founder",
  })
  await founder.mutation(api.founderInputs.saveText, {
    humanId: request.humanId,
    text: "Typed context remains intact.",
    correlationId: "create-founder-document",
  })
  return { workspace, operator, founder, founderPrincipal, request }
}

async function finishArchiveTransition(
  backend: Awaited<ReturnType<typeof founderVoiceWorkspace>>["operator"],
  requestId: Id<"contentRequests">
) {
  const transition = await backend.run((ctx) => ctx.db.get(requestId))
  if (
    !transition?.archiveTransitionToken ||
    !transition.archiveTransitionMode ||
    !transition.archiveTransitionMarker
  )
    return
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
        requestId,
        marker: transition.archiveTransitionMarker,
        transitionToken: transition.archiveTransitionToken,
        mode: transition.archiveTransitionMode,
        resource,
      }
    )
  if (transition.archiveTransitionMode === "restore") {
    await backend.mutation(internal.requestDisposition.activateRestoredJobs, {
      requestId,
      marker: transition.archiveTransitionMarker,
    })
    await backend.mutation(
      internal.requestDisposition.resumeRestoredVoiceCaptures,
      { requestId }
    )
  }
}

describe("founder voice capture aggregate", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("allows an administrator to QA Elie's founder voice controls", async () => {
    const { workspace, request } = await founderVoiceWorkspace()
    const administrator = workspace.withIdentity(
      identity("administrator", "administrator")
    )
    await administrator.mutation(api.principals.syncCurrent)

    await expect(
      administrator.mutation(api.voiceCaptures.createUploadUrl, {
        humanId: request.humanId,
      })
    ).resolves.toEqual(expect.any(String))
  })

  it("attaches one idempotent audio reference and transcript to the founder document", async () => {
    const { workspace, founder, request } = await founderVoiceWorkspace()
    const audio = new Blob(["voice-audio"], { type: "audio/webm" })
    const storageId = await workspace.run((ctx) => ctx.storage.store(audio))
    const input = {
      humanId: request.humanId,
      clientCaptureId: "capture-device-1",
      storageId,
      mimeType: "audio/webm",
      sizeBytes: audio.size,
      durationMs: 2_500,
      recordedAt: 1_000,
      correlationId: "finalize-voice-1",
    }
    const first = await founder.mutation(
      api.voiceCaptures.finalizeUpload,
      input
    )
    const replay = await founder.mutation(
      api.voiceCaptures.finalizeUpload,
      input
    )
    expect(replay).toEqual(first)

    const firstClaim = await workspace.mutation(
      internal.voiceCaptures.claimTranscription,
      {
        captureId: first.captureId,
      }
    )
    if (!firstClaim) throw new Error("Expected transcription claim")
    await workspace.mutation(internal.voiceCaptures.completeTranscription, {
      captureId: first.captureId,
      attempt: firstClaim.attempt,
      transcript: "The founder's spoken perspective.",
    })
    await expect(
      founder.query(api.voiceCaptures.listMine, {
        humanId: request.humanId,
      })
    ).resolves.toEqual([
      expect.objectContaining({
        captureId: first.captureId,
        status: "transcribed",
        transcript: "The founder's spoken perspective.",
        transcriptMergedAt: null,
      }),
    ])
    await expect(
      founder.mutation(api.voiceCaptures.markTranscriptMerged, {
        humanId: request.humanId,
        captureId: first.captureId,
      })
    ).resolves.toMatchObject({ transcriptMergedAt: expect.any(Number) })
  })

  it("keeps typed input intact when transcription fails and permits retry", async () => {
    const { workspace, founder, request } = await founderVoiceWorkspace()
    const audio = new Blob(["retry-audio"], { type: "audio/webm" })
    const storageId = await workspace.run((ctx) => ctx.storage.store(audio))
    const capture = await founder.mutation(api.voiceCaptures.finalizeUpload, {
      humanId: request.humanId,
      clientCaptureId: "capture-retry",
      storageId,
      mimeType: "audio/webm",
      sizeBytes: audio.size,
      durationMs: 1_000,
      recordedAt: 2_000,
      correlationId: "finalize-retry",
    })
    const abandonedClaim = await workspace.mutation(
      internal.voiceCaptures.claimTranscription,
      { captureId: capture.captureId }
    )
    if (!abandonedClaim) throw new Error("Expected abandoned claim")
    await workspace.run((ctx) =>
      ctx.db.patch(capture.captureId, {
        transcriptionLeaseExpiresAt: Date.now() - 1,
      })
    )
    const recoveredClaim = await workspace.mutation(
      internal.voiceCaptures.claimTranscription,
      {
        captureId: capture.captureId,
      }
    )
    expect(recoveredClaim).toMatchObject({ storageId })
    if (!recoveredClaim) throw new Error("Expected recovered claim")
    await workspace.mutation(internal.voiceCaptures.failTranscription, {
      captureId: capture.captureId,
      attempt: abandonedClaim.attempt,
      failureCode: "STALE_WORKER",
    })
    await expect(
      founder.query(api.voiceCaptures.listMine, { humanId: request.humanId })
    ).resolves.toEqual([
      expect.objectContaining({ status: "transcribing", failureCode: null }),
    ])
    await workspace.mutation(internal.voiceCaptures.failTranscription, {
      captureId: capture.captureId,
      attempt: recoveredClaim.attempt,
      failureCode: "PROVIDER_503",
    })
    await expect(
      founder.mutation(api.voiceCaptures.retry, {
        humanId: request.humanId,
        captureId: capture.captureId,
      })
    ).resolves.toMatchObject({ status: "uploaded", failureCode: null })
    const postRetryClaim = await workspace.mutation(
      internal.voiceCaptures.claimTranscription,
      { captureId: capture.captureId }
    )
    if (!postRetryClaim) throw new Error("Expected post-retry claim")
    expect(postRetryClaim.attempt).toBeGreaterThan(recoveredClaim.attempt)
    await workspace.mutation(internal.voiceCaptures.completeTranscription, {
      captureId: capture.captureId,
      attempt: abandonedClaim.attempt,
      transcript: "Stale result",
    })
    await expect(
      founder.query(api.voiceCaptures.listMine, { humanId: request.humanId })
    ).resolves.toEqual([
      expect.objectContaining({ status: "transcribing", transcript: null }),
    ])
    await workspace.mutation(internal.voiceCaptures.failTranscription, {
      captureId: capture.captureId,
      attempt: postRetryClaim.attempt,
      failureCode: "CURRENT_FAILURE",
    })
    await founder.mutation(api.voiceCaptures.retry, {
      humanId: request.humanId,
      captureId: capture.captureId,
    })
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const claim = await workspace.mutation(
        internal.voiceCaptures.claimTranscription,
        {
          captureId: capture.captureId,
        }
      )
      expect(claim).toMatchObject({ storageId })
      if (!claim) throw new Error("Expected retry claim")
      await workspace.mutation(internal.voiceCaptures.failTranscription, {
        captureId: capture.captureId,
        attempt: claim.attempt,
        failureCode: `TRANSIENT_${attempt}`,
      })
      await founder.mutation(api.voiceCaptures.retry, {
        humanId: request.humanId,
        captureId: capture.captureId,
      })
    }
    await expect(
      founder.query(api.founderInputs.getMine, { humanId: request.humanId })
    ).resolves.toMatchObject({ text: "Typed context remains intact." })
  })

  it("pauses transcription writes across archive and expiration races", async () => {
    const { workspace, operator, founder, request } =
      await founderVoiceWorkspace()
    const audio = new Blob(["race-audio"], { type: "audio/webm" })
    const storageId = await workspace.run((ctx) => ctx.storage.store(audio))
    const capture = await founder.mutation(api.voiceCaptures.finalizeUpload, {
      humanId: request.humanId,
      clientCaptureId: "capture-disposition-race",
      storageId,
      mimeType: "audio/webm",
      sizeBytes: audio.size,
      durationMs: 1_000,
      recordedAt: 3_000,
      correlationId: "finalize-disposition-race",
    })
    const firstClaim = await workspace.mutation(
      internal.voiceCaptures.claimTranscription,
      { captureId: capture.captureId }
    )
    if (!firstClaim) throw new Error("Expected first transcription claim")

    await operator.mutation(api.requestDisposition.archive, {
      humanId: request.humanId,
      correlationId: "archive-during-transcription",
    })
    await finishArchiveTransition(
      operator,
      request.requestId as Id<"contentRequests">
    )
    await expect(
      workspace.mutation(internal.voiceCaptures.completeTranscription, {
        captureId: capture.captureId,
        attempt: firstClaim.attempt,
        transcript: "This transcript must remain paused.",
      })
    ).resolves.toBeNull()
    await expect(
      workspace.query(internal.voiceCaptures.getForTranscription, {
        captureId: capture.captureId,
      })
    ).resolves.toBeNull()
    const pausedCapture = await workspace.run((ctx) =>
      ctx.db.get(capture.captureId)
    )
    expect(pausedCapture?.status).toBe("transcribing")
    expect(pausedCapture?.transcript).toBeUndefined()

    await operator.mutation(api.requestDisposition.restoreArchived, {
      humanId: request.humanId,
      correlationId: "restore-after-transcription-race",
    })
    await finishArchiveTransition(
      operator,
      request.requestId as Id<"contentRequests">
    )
    await workspace.run((ctx) =>
      ctx.db.patch(capture.captureId, {
        transcriptionLeaseExpiresAt: Date.now() - 1,
      })
    )
    const secondClaim = await workspace.mutation(
      internal.voiceCaptures.claimTranscription,
      { captureId: capture.captureId }
    )
    if (!secondClaim) throw new Error("Expected resumed transcription claim")
    await operator.mutation(api.requestDisposition.expire, {
      humanId: request.humanId,
      reason: "Opportunity closed during transcription",
      correlationId: "expire-during-transcription",
    })
    await expect(
      workspace.mutation(internal.voiceCaptures.failTranscription, {
        captureId: capture.captureId,
        attempt: secondClaim.attempt,
        failureCode: "SHOULD_REMAIN_PAUSED",
      })
    ).resolves.toBeNull()
    await expect(
      workspace.run((ctx) => ctx.db.get(capture.captureId))
    ).resolves.toMatchObject({ status: "transcribing" })
  })

  it("reschedules an uploaded capture restored after archive", async () => {
    const { workspace, operator, founder, request } =
      await founderVoiceWorkspace()
    const audio = new Blob(["pre-claim-race"], { type: "audio/webm" })
    const storageId = await workspace.run((ctx) => ctx.storage.store(audio))
    const capture = await founder.mutation(api.voiceCaptures.finalizeUpload, {
      humanId: request.humanId,
      clientCaptureId: "capture-pre-claim-archive",
      storageId,
      mimeType: "audio/webm",
      sizeBytes: audio.size,
      durationMs: 1_000,
      recordedAt: 4_000,
      correlationId: "finalize-pre-claim-archive",
    })
    await operator.mutation(api.requestDisposition.archive, {
      humanId: request.humanId,
      correlationId: "archive-before-transcription-claim",
    })
    await finishArchiveTransition(
      operator,
      request.requestId as Id<"contentRequests">
    )
    await expect(
      workspace.mutation(internal.voiceCaptures.claimTranscription, {
        captureId: capture.captureId,
      })
    ).resolves.toBeNull()
    await operator.mutation(api.requestDisposition.restoreArchived, {
      humanId: request.humanId,
      correlationId: "restore-before-transcription-claim",
    })
    await finishArchiveTransition(
      operator,
      request.requestId as Id<"contentRequests">
    )
    await expect(
      workspace.mutation(internal.voiceCaptures.claimTranscription, {
        captureId: capture.captureId,
      })
    ).resolves.toMatchObject({ attempt: 1 })
  })

  it("reconstructs the active capture summary during a rolling migration", async () => {
    const { workspace, founder, request } = await founderVoiceWorkspace()
    const audio = new Blob(["migration-race"], { type: "audio/webm" })
    const storageId = await workspace.run((ctx) => ctx.storage.store(audio))
    const first = await founder.mutation(api.voiceCaptures.finalizeUpload, {
      humanId: request.humanId,
      clientCaptureId: "capture-before-count-backfill",
      storageId,
      mimeType: "audio/webm",
      sizeBytes: audio.size,
      durationMs: 1_000,
      recordedAt: 5_000,
      correlationId: "finalize-before-count-backfill",
    })
    await workspace.run(async (ctx) => {
      const storedRequest = await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_human_id", (index) =>
          index
            .eq("organizationId", "org_fairlend")
            .eq("humanId", request.humanId)
        )
        .unique()
      if (!storedRequest) throw new Error("Expected request")
      await ctx.db.patch(storedRequest._id, {
        activeVoiceCaptureCount: undefined,
      })
      await ctx.db.patch(first.captureId, {
        status: "transcribed",
        transcript: "First legacy transcript",
      })
    })
    const second = await founder.mutation(api.voiceCaptures.finalizeUpload, {
      humanId: request.humanId,
      clientCaptureId: "capture-during-count-backfill",
      storageId,
      mimeType: "audio/webm",
      sizeBytes: audio.size,
      durationMs: 1_000,
      recordedAt: 6_000,
      correlationId: "finalize-during-count-backfill",
    })
    await workspace.run((ctx) =>
      ctx.db.patch(second.captureId, {
        status: "transcribed",
        transcript: "Second transcript",
      })
    )
    await founder.mutation(api.voiceCaptures.discard, {
      humanId: request.humanId,
      captureId: second.captureId,
    })
    const activeVoiceCaptureCount = await workspace.run(async (ctx) => {
      const storedRequest = await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_human_id", (index) =>
          index
            .eq("organizationId", "org_fairlend")
            .eq("humanId", request.humanId)
        )
        .unique()
      return storedRequest?.activeVoiceCaptureCount
    })
    expect(activeVoiceCaptureCount).toBe(1)
  })

  it("keeps oversized legacy capture sets protected after migration and discard", async () => {
    const { workspace, founder, request } = await founderVoiceWorkspace()
    const audio = new Blob(["legacy-overflow"], { type: "audio/webm" })
    const storageId = await workspace.run((ctx) => ctx.storage.store(audio))
    const firstCaptureId = await workspace.run(async (ctx) => {
      const storedRequest = await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_human_id", (index) =>
          index
            .eq("organizationId", "org_fairlend")
            .eq("humanId", request.humanId)
        )
        .unique()
      if (!storedRequest) throw new Error("Expected request")
      await ctx.db.patch(storedRequest._id, {
        activeVoiceCaptureCount: undefined,
        voiceCaptureCountGeneration: undefined,
      })
      const document = await ctx.db
        .query("founderInputDocuments")
        .withIndex("by_request", (index) =>
          index.eq("requestId", storedRequest._id)
        )
        .unique()
      if (!document) throw new Error("Expected founder document")
      let firstCaptureId = null
      for (let index = 0; index < VOICE_CAPTURE_OVERFLOW_SENTINEL; index += 1) {
        const captureId = await ctx.db.insert("founderVoiceCaptures", {
          organizationId: storedRequest.organizationId,
          requestId: storedRequest._id,
          documentId: document._id,
          founderPrincipalId: document.founderPrincipalId,
          clientCaptureId: `legacy-overflow-${index}`,
          storageId,
          mimeType: "audio/webm",
          sizeBytes: audio.size,
          durationMs: 1_000,
          recordedAt: index,
          status: "transcribed",
          transcript: `Legacy transcript ${index}`,
          attempts: 1,
          retryAttemptCount: 1,
          createdAt: index,
          updatedAt: index,
        })
        firstCaptureId ??= captureId
      }
      return firstCaptureId
    })
    if (!firstCaptureId) throw new Error("Expected legacy capture")
    await workspace.mutation(
      internal.migrations.backfillActiveVoiceCaptureCounts,
      {}
    )
    await founder.mutation(api.voiceCaptures.discard, {
      humanId: request.humanId,
      captureId: firstCaptureId,
    })
    const activeVoiceCaptureCount = await workspace.run(async (ctx) => {
      const storedRequest = await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_human_id", (index) =>
          index
            .eq("organizationId", "org_fairlend")
            .eq("humanId", request.humanId)
        )
        .unique()
      return storedRequest?.activeVoiceCaptureCount
    })
    expect(activeVoiceCaptureCount).toBe(VOICE_CAPTURE_OVERFLOW_SENTINEL)
  })

  it("does not expose a founder's capture to another founder", async () => {
    const { workspace, founder, request } = await founderVoiceWorkspace()
    const otherFounder = workspace.withIdentity(
      identity("other-founder", "founder")
    )
    await otherFounder.mutation(api.principals.syncCurrent)
    await expect(
      otherFounder.query(api.voiceCaptures.listMine, {
        humanId: request.humanId,
      })
    ).rejects.toMatchObject({ data: { code: "RESOURCE_ACCESS_DENIED" } })
    await expect(
      founder.mutation(api.voiceCaptures.createUploadUrl, {
        humanId: request.humanId,
      })
    ).resolves.toMatch(/^https?:\/\//)
  })
})
