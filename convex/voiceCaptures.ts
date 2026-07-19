import { ConvexError, v } from "convex/values"

import type { Doc } from "./_generated/dataModel"
import { internal } from "./_generated/api"
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import { requireActiveRequest, requirePrincipal } from "./lib/authorization"
import {
  assertWithinRequestLimit,
  MAX_VOICE_CAPTURES_PER_REQUEST,
  VOICE_CAPTURE_OVERFLOW_SENTINEL,
} from "./lib/requestLimits"

const captureValidator = v.object({
  captureId: v.id("founderVoiceCaptures"),
  clientCaptureId: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
  durationMs: v.number(),
  recordedAt: v.number(),
  status: v.union(
    v.literal("uploaded"),
    v.literal("transcribing"),
    v.literal("transcribed"),
    v.literal("failed")
  ),
  transcript: v.union(v.string(), v.null()),
  failureCode: v.union(v.string(), v.null()),
  transcriptMergedAt: v.union(v.number(), v.null()),
  discardedAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
})

function publicCapture(capture: Doc<"founderVoiceCaptures">) {
  return {
    captureId: capture._id,
    clientCaptureId: capture.clientCaptureId,
    mimeType: capture.mimeType,
    sizeBytes: capture.sizeBytes,
    durationMs: capture.durationMs,
    recordedAt: capture.recordedAt ?? capture.createdAt,
    status: capture.status,
    transcript: capture.transcript ?? null,
    failureCode: capture.failureCode ?? null,
    transcriptMergedAt: capture.transcriptMergedAt ?? null,
    discardedAt: capture.discardedAt ?? null,
    createdAt: capture.createdAt,
    updatedAt: capture.updatedAt,
  }
}

async function assignedFounderRequest(
  ctx: Parameters<typeof requirePrincipal>[0],
  humanId: string,
  requireMutable = false
) {
  const principal = await requirePrincipal(ctx)
  if (principal.role !== "founder") {
    throw new ConvexError({ code: "ROLE_ACCESS_DENIED" })
  }
  const request = await ctx.db
    .query("contentRequests")
    .withIndex("by_organization_human_id", (index) =>
      index
        .eq("organizationId", principal.organizationId)
        .eq("humanId", humanId.trim().toUpperCase())
    )
    .unique()
  if (!request) throw new ConvexError({ code: "NOT_FOUND" })
  if (
    (request.assigneePrincipalId ?? request.createdByPrincipalId) !==
    principal._id
  ) {
    throw new ConvexError({ code: "RESOURCE_ACCESS_DENIED" })
  }
  if (requireMutable) {
    requireActiveRequest(request)
    if (!["pending", "in_progress"].includes(request.lifecycle))
      throw new ConvexError({ code: "FOUNDER_INPUT_SUBMITTED" })
  }
  const document = await ctx.db
    .query("founderInputDocuments")
    .withIndex("by_request", (index) => index.eq("requestId", request._id))
    .unique()
  if (!document) throw new ConvexError({ code: "FOUNDER_INPUT_REQUIRED" })
  if (document.founderPrincipalId !== principal._id) {
    throw new ConvexError({ code: "FOUNDER_INPUT_HANDOFF_REQUIRED" })
  }
  return { principal, request, document }
}

export const createUploadUrl = mutation({
  args: { humanId: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    await assignedFounderRequest(ctx, args.humanId, true)
    return ctx.storage.generateUploadUrl()
  },
})

export const finalizeUpload = mutation({
  args: {
    humanId: v.string(),
    clientCaptureId: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    sizeBytes: v.number(),
    durationMs: v.number(),
    recordedAt: v.number(),
    correlationId: v.string(),
  },
  returns: captureValidator,
  handler: async (ctx, args) => {
    const { principal, request, document } = await assignedFounderRequest(
      ctx,
      args.humanId,
      true
    )
    const clientCaptureId = args.clientCaptureId.trim()
    const correlationId = args.correlationId.trim()
    if (
      !clientCaptureId ||
      clientCaptureId.length > 100 ||
      !correlationId ||
      !args.mimeType.startsWith("audio/") ||
      args.sizeBytes < 1 ||
      args.sizeBytes > 100_000_000 ||
      args.durationMs < 1 ||
      args.durationMs > 60 * 60 * 1_000 ||
      !Number.isFinite(args.recordedAt) ||
      args.recordedAt < 0
    ) {
      throw new ConvexError({ code: "VALIDATION_FAILED" })
    }
    const existing = await ctx.db
      .query("founderVoiceCaptures")
      .withIndex("by_organization_founder_client", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("founderPrincipalId", principal._id)
          .eq("clientCaptureId", clientCaptureId)
      )
      .unique()
    if (existing) {
      if (
        existing.requestId !== request._id ||
        existing.documentId !== document._id ||
        existing.storageId !== args.storageId ||
        existing.mimeType !== args.mimeType ||
        existing.sizeBytes !== args.sizeBytes ||
        existing.durationMs !== args.durationMs ||
        (existing.recordedAt ?? existing.createdAt) !== args.recordedAt
      ) {
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      }
      return publicCapture(existing)
    }
    const requestCaptures = await ctx.db
      .query("founderVoiceCaptures")
      .withIndex("by_request_created_at", (index) =>
        index.eq("requestId", request._id)
      )
      .take(MAX_VOICE_CAPTURES_PER_REQUEST + 1)
    assertWithinRequestLimit(
      requestCaptures.length,
      MAX_VOICE_CAPTURES_PER_REQUEST,
      "voice_captures"
    )
    const now = Date.now()
    const captureId = await ctx.db.insert("founderVoiceCaptures", {
      organizationId: principal.organizationId,
      requestId: request._id,
      documentId: document._id,
      founderPrincipalId: principal._id,
      clientCaptureId,
      storageId: args.storageId,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      durationMs: args.durationMs,
      recordedAt: args.recordedAt,
      status: "uploaded",
      attempts: 0,
      retryAttemptCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    const reconstructedActiveCaptureCount = requestCaptures.filter(
      (capture) => !capture.discardedAt
    ).length
    const currentActiveCaptureCount =
      request.activeVoiceCaptureCount ?? reconstructedActiveCaptureCount
    await ctx.db.patch(request._id, {
      activeVoiceCaptureCount:
        currentActiveCaptureCount > MAX_VOICE_CAPTURES_PER_REQUEST
          ? VOICE_CAPTURE_OVERFLOW_SENTINEL
          : currentActiveCaptureCount + 1,
      voiceCaptureCountGeneration:
        (request.voiceCaptureCountGeneration ?? 0) + 1,
      updatedAt: now,
    })
    if (currentActiveCaptureCount > MAX_VOICE_CAPTURES_PER_REQUEST)
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.recountActiveVoiceCaptures,
        {
          requestId: request._id,
          generation: (request.voiceCaptureCountGeneration ?? 0) + 1,
          count: 0,
        }
      )
    await ctx.db.insert("auditEvents", {
      organizationId: principal.organizationId,
      requestId: request._id,
      requestHumanId: request.humanId,
      actorPrincipalId: principal._id,
      credentialId: principal.credentialId,
      operation: "founder_input.voice_uploaded",
      correlationId,
      occurredAt: now,
      afterVersion: request.aggregateVersion,
    })
    await ctx.scheduler.runAfter(0, internal.voiceCaptures.transcribe, {
      captureId,
    })
    const capture = await ctx.db.get(captureId)
    if (!capture) throw new ConvexError({ code: "WRITE_FAILED" })
    return publicCapture(capture)
  },
})

export const listMine = query({
  args: { humanId: v.string() },
  returns: v.array(captureValidator),
  handler: async (ctx, args) => {
    const { document } = await assignedFounderRequest(ctx, args.humanId)
    const captures = await ctx.db
      .query("founderVoiceCaptures")
      .withIndex("by_document_created_at", (index) =>
        index.eq("documentId", document._id)
      )
      .order("desc")
      .take(MAX_VOICE_CAPTURES_PER_REQUEST)
    return captures.map(publicCapture)
  },
})

export const retry = mutation({
  args: { humanId: v.string(), captureId: v.id("founderVoiceCaptures") },
  returns: captureValidator,
  handler: async (ctx, args) => {
    const { document } = await assignedFounderRequest(ctx, args.humanId, true)
    const capture = await ctx.db.get(args.captureId)
    if (!capture || capture.documentId !== document._id) {
      throw new ConvexError({ code: "NOT_FOUND" })
    }
    if (capture.status !== "failed") return publicCapture(capture)
    const now = Date.now()
    await ctx.db.patch(capture._id, {
      status: "uploaded",
      failureCode: undefined,
      retryAttemptCount: 0,
      transcriptionLeaseExpiresAt: undefined,
      updatedAt: now,
    })
    await ctx.scheduler.runAfter(0, internal.voiceCaptures.transcribe, {
      captureId: capture._id,
    })
    const saved = await ctx.db.get(capture._id)
    if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
    return publicCapture(saved)
  },
})

export const discard = mutation({
  args: { humanId: v.string(), captureId: v.id("founderVoiceCaptures") },
  returns: captureValidator,
  handler: async (ctx, args) => {
    const { document } = await assignedFounderRequest(ctx, args.humanId, true)
    const capture = await ctx.db.get(args.captureId)
    if (!capture || capture.documentId !== document._id)
      throw new ConvexError({ code: "NOT_FOUND" })
    if (["uploaded", "transcribing"].includes(capture.status))
      throw new ConvexError({ code: "VOICE_CAPTURE_IN_FLIGHT" })
    if (!capture.discardedAt) {
      const request = await ctx.db.get(capture.requestId)
      const requestCaptures =
        request?.activeVoiceCaptureCount === undefined
          ? await ctx.db
              .query("founderVoiceCaptures")
              .withIndex("by_request_created_at", (index) =>
                index.eq("requestId", capture.requestId)
              )
              .take(VOICE_CAPTURE_OVERFLOW_SENTINEL)
          : []
      const reconstructedActiveCaptureCount = requestCaptures.filter(
        (candidate) => !candidate.discardedAt
      ).length
      const currentActiveCaptureCount =
        request?.activeVoiceCaptureCount ?? reconstructedActiveCaptureCount
      await ctx.db.patch(capture._id, {
        discardedAt: Date.now(),
        updatedAt: Date.now(),
      })
      if (request)
        await ctx.db.patch(request._id, {
          activeVoiceCaptureCount:
            requestCaptures.length >= VOICE_CAPTURE_OVERFLOW_SENTINEL ||
            currentActiveCaptureCount > MAX_VOICE_CAPTURES_PER_REQUEST
              ? VOICE_CAPTURE_OVERFLOW_SENTINEL
              : Math.max(0, currentActiveCaptureCount - 1),
          voiceCaptureCountGeneration:
            (request.voiceCaptureCountGeneration ?? 0) + 1,
          updatedAt: Date.now(),
        })
      if (
        request &&
        (requestCaptures.length >= VOICE_CAPTURE_OVERFLOW_SENTINEL ||
          currentActiveCaptureCount > MAX_VOICE_CAPTURES_PER_REQUEST)
      )
        await ctx.scheduler.runAfter(
          0,
          internal.migrations.recountActiveVoiceCaptures,
          {
            requestId: request._id,
            generation: (request.voiceCaptureCountGeneration ?? 0) + 1,
            count: 0,
          }
        )
    }
    const saved = await ctx.db.get(capture._id)
    if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
    return publicCapture(saved)
  },
})

export const markTranscriptMerged = mutation({
  args: { humanId: v.string(), captureId: v.id("founderVoiceCaptures") },
  returns: captureValidator,
  handler: async (ctx, args) => {
    const { document } = await assignedFounderRequest(ctx, args.humanId, true)
    const capture = await ctx.db.get(args.captureId)
    if (!capture || capture.documentId !== document._id) {
      throw new ConvexError({ code: "NOT_FOUND" })
    }
    if (capture.status !== "transcribed" || !capture.transcript) {
      throw new ConvexError({ code: "TRANSCRIPT_NOT_READY" })
    }
    if (!capture.transcriptMergedAt) {
      await ctx.db.patch(capture._id, {
        transcriptMergedAt: Date.now(),
        updatedAt: Date.now(),
      })
    }
    const saved = await ctx.db.get(capture._id)
    if (!saved) throw new ConvexError({ code: "WRITE_FAILED" })
    return publicCapture(saved)
  },
})

export const claimTranscription = internalMutation({
  args: { captureId: v.id("founderVoiceCaptures") },
  returns: v.union(
    v.object({
      storageId: v.id("_storage"),
      mimeType: v.string(),
      attempt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const capture = await ctx.db.get(args.captureId)
    const now = Date.now()
    const staleClaim =
      capture?.status === "transcribing" &&
      (capture.transcriptionLeaseExpiresAt ?? 0) <= now
    if (!capture || (capture.status !== "uploaded" && !staleClaim)) {
      return null
    }
    const request = await ctx.db.get(capture.requestId)
    if (
      !request ||
      request.retention !== "active" ||
      request.disposition !== "active"
    )
      return null
    const retryAttemptCount = capture.retryAttemptCount ?? capture.attempts
    if (retryAttemptCount >= 3) {
      await ctx.db.patch(capture._id, {
        status: "failed",
        failureCode: "TRANSCRIPTION_LEASE_EXHAUSTED",
        transcriptionLeaseExpiresAt: undefined,
        updatedAt: now,
      })
      return null
    }
    await ctx.db.patch(capture._id, {
      status: "transcribing",
      attempts: capture.attempts + 1,
      retryAttemptCount: retryAttemptCount + 1,
      transcriptionLeaseExpiresAt: now + 2 * 60_000,
      updatedAt: now,
    })
    return {
      storageId: capture.storageId,
      mimeType: capture.mimeType,
      attempt: capture.attempts + 1,
    }
  },
})

export const completeTranscription = internalMutation({
  args: {
    captureId: v.id("founderVoiceCaptures"),
    attempt: v.number(),
    transcript: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const capture = await ctx.db.get(args.captureId)
    const transcript = args.transcript.trim()
    if (
      !capture ||
      capture.status !== "transcribing" ||
      capture.attempts !== args.attempt ||
      !transcript
    )
      return null
    const request = await ctx.db.get(capture.requestId)
    if (
      !request ||
      request.retention !== "active" ||
      request.disposition !== "active"
    )
      return null
    await ctx.db.patch(capture._id, {
      status: "transcribed",
      transcript,
      failureCode: undefined,
      transcriptionLeaseExpiresAt: undefined,
      updatedAt: Date.now(),
    })
    return null
  },
})

export const failTranscription = internalMutation({
  args: {
    captureId: v.id("founderVoiceCaptures"),
    attempt: v.number(),
    failureCode: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const capture = await ctx.db.get(args.captureId)
    if (
      !capture ||
      capture.status !== "transcribing" ||
      capture.attempts !== args.attempt
    )
      return null
    const request = await ctx.db.get(capture.requestId)
    if (
      !request ||
      request.retention !== "active" ||
      request.disposition !== "active"
    )
      return null
    await ctx.db.patch(capture._id, {
      status: "failed",
      failureCode: args.failureCode.slice(0, 100),
      transcriptionLeaseExpiresAt: undefined,
      updatedAt: Date.now(),
    })
    return null
  },
})

export const getForTranscription = internalQuery({
  args: { captureId: v.id("founderVoiceCaptures") },
  returns: v.union(
    v.object({ storageId: v.id("_storage"), mimeType: v.string() }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const capture = await ctx.db.get(args.captureId)
    if (!capture) return null
    const request = await ctx.db.get(capture.requestId)
    if (
      !request ||
      request.retention !== "active" ||
      request.disposition !== "active"
    )
      return null
    return { storageId: capture.storageId, mimeType: capture.mimeType }
  },
})

export const transcribe = internalAction({
  args: { captureId: v.id("founderVoiceCaptures") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await ctx.runMutation(
      internal.voiceCaptures.claimTranscription,
      args
    )
    if (!claim) return null
    await ctx.scheduler.runAfter(
      2 * 60_000,
      internal.voiceCaptures.transcribe,
      {
        captureId: args.captureId,
      }
    )
    const endpoint = process.env.FAIRLEND_TRANSCRIPTION_API_URL
    const apiKey = process.env.FAIRLEND_TRANSCRIPTION_API_KEY
    if (!endpoint || !apiKey) {
      await ctx.runMutation(internal.voiceCaptures.failTranscription, {
        captureId: args.captureId,
        attempt: claim.attempt,
        failureCode: "TRANSCRIPTION_NOT_CONFIGURED",
      })
      return null
    }
    try {
      const audioUrl = await ctx.storage.getUrl(claim.storageId)
      if (!audioUrl) throw new Error("AUDIO_NOT_FOUND")
      const audio = await fetch(audioUrl).then((response) => {
        if (!response.ok) throw new Error("AUDIO_FETCH_FAILED")
        return response.blob()
      })
      const form = new FormData()
      form.set(
        "file",
        audio,
        `founder-input.${claim.mimeType.split(";")[0]?.split("/")[1] ?? "webm"}`
      )
      form.set("model", process.env.FAIRLEND_TRANSCRIPTION_MODEL ?? "whisper-1")
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      })
      if (!response.ok) throw new Error(`PROVIDER_${response.status}`)
      const result = (await response.json()) as { text?: unknown }
      if (typeof result.text !== "string" || !result.text.trim()) {
        throw new Error("EMPTY_TRANSCRIPT")
      }
      await ctx.runMutation(internal.voiceCaptures.completeTranscription, {
        captureId: args.captureId,
        attempt: claim.attempt,
        transcript: result.text,
      })
    } catch (error) {
      await ctx.runMutation(internal.voiceCaptures.failTranscription, {
        captureId: args.captureId,
        attempt: claim.attempt,
        failureCode:
          error instanceof Error
            ? error.message.slice(0, 100)
            : "TRANSCRIPTION_FAILED",
      })
    }
    return null
  },
})
