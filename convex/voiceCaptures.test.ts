// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
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
  return { workspace, operator, founder, request }
}

describe("founder voice capture aggregate", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
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
