// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const operatorIdentity = {
  subject: "guest-evidence-operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "guest-evidence-operator-session",
  email: "guest-evidence-operator@fairlend.ca",
}

const administratorIdentity = {
  subject: "guest-evidence-administrator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "administrator",
  jti: "guest-evidence-administrator-session",
  email: "guest-evidence-administrator@fairlend.ca",
}

const interviewPackage = {
  brief: {
    topic: "Bridge financing when a bank closing is delayed",
    summary: "A practical Ontario guide to recovering a time-sensitive deal.",
    audience: "Ontario mortgage brokers and borrowers",
    framing: "insider_knowledge" as const,
    fairlendPosture:
      "Explain options without presenting practitioner evidence as law.",
    founderContribution: "Capture the real recovery sequence.",
  },
  gaps: [
    {
      id: "gap-1",
      kind: "reality_on_the_ground" as const,
      title: "The first hour",
      existingCoverage: "Published guides list bridge-loan eligibility.",
      whyItFallsShort: "They omit the live recovery sequence.",
      expertOpportunity: "Explain who is called first and why.",
      citations: [],
    },
  ],
  questions: [
    {
      id: "q-1",
      question: "What do you do in the first hour?",
      motivation: "Capture the sequence missing from indexed guides.",
      gapIds: ["gap-1"],
    },
  ],
  operatorInstructions: "Preserve attribution.",
}

async function resolveArgs(token: string, networkSource: string) {
  const networkTimestamp = Date.now()
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(process.env.GUEST_ACCESS_RESOLVE_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `guest-access-resolve:v1\n${networkTimestamp}\n${networkSource}\n${token}`
    )
  )
  const networkProof = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return { token, networkSource, networkTimestamp, networkProof }
}

async function withGuestAccessBoundary<T extends { token: string }>(input: T) {
  return {
    ...input,
    ...(await resolveArgs(input.token, "guest-evidence-test-source")),
  }
}

async function evidenceWorkspace() {
  const anonymous = convexTest(schema, modules)
  const operator = anonymous.withIdentity(operatorIdentity)
  const administrator = anonymous.withIdentity(administratorIdentity)
  await operator.mutation(api.principals.syncCurrent)
  await administrator.mutation(api.principals.syncCurrent)
  const request = await operator.mutation(api.contentRequests.createManual, {
    title: "How bridge financing works when a timeline breaks",
    origin: "manual",
    correlationId: "guest-evidence-request",
  })
  await operator.mutation(api.expertInterviews.savePackage, {
    humanId: request.humanId,
    ...interviewPackage,
    correlationId: "guest-evidence-package",
  })
  const firstPerson = await operator.mutation(api.people.create, {
    humanId: request.humanId,
    displayName: "Priya Shah",
    email: "priya@example.ca",
    correlationId: "guest-evidence-person-1",
  })
  const secondPerson = await operator.mutation(api.people.create, {
    humanId: request.humanId,
    displayName: "Alex Chen",
    email: "alex@example.ca",
    correlationId: "guest-evidence-person-2",
  })
  const first = await operator.mutation(api.guestAccess.create, {
    humanId: request.humanId,
    personId: firstPerson.personId,
    correlationId: "guest-evidence-grant-1",
  })
  const second = await operator.mutation(api.guestAccess.create, {
    humanId: request.humanId,
    personId: secondPerson.personId,
    correlationId: "guest-evidence-grant-2",
  })
  if (!first.token || !second.token) throw new Error("Expected guest tokens")
  await anonymous.mutation(
    api.guestAccess.resolve,
    await resolveArgs(first.token, "198.51.100.71")
  )
  await anonymous.mutation(
    api.guestAccess.resolve,
    await resolveArgs(second.token, "198.51.100.72")
  )
  const leaseId = "guest-evidence-editor"
  const lease = await anonymous.mutation(
    api.guestAccess.acquireEditorLease,
    await withGuestAccessBoundary({
      token: first.token,
      leaseId,
      operationId: "guest-evidence-lease-acquire",
    })
  )
  if (!lease || lease.status !== "editing")
    throw new Error("Expected guest editor lease")
  const secondLeaseId = "guest-evidence-editor-second"
  const secondLease = await anonymous.mutation(
    api.guestAccess.acquireEditorLease,
    await withGuestAccessBoundary({
      token: second.token,
      leaseId: secondLeaseId,
      operationId: "guest-evidence-lease-acquire-second",
    })
  )
  if (!secondLease || secondLease.status !== "editing")
    throw new Error("Expected second guest editor lease")
  return {
    anonymous,
    administrator,
    operator,
    request,
    first,
    second,
    leaseId,
    leaseGeneration: lease.editorLease.generation,
    secondLeaseId,
    secondLeaseGeneration: secondLease.editorLease.generation,
  }
}

async function standardEvidenceWorkspace() {
  const anonymous = convexTest(schema, modules)
  const operator = anonymous.withIdentity(operatorIdentity)
  await operator.mutation(api.principals.syncCurrent)
  const request = await operator.mutation(api.contentRequests.createManual, {
    title: "Explain a portable mortgage",
    origin: "manual",
    source: {
      question: "Can I take my mortgage with me when I move?",
      body: "The borrower wants a plain-language portability explanation.",
    },
    correlationId: "standard-guest-evidence-request",
  })
  const person = await operator.mutation(api.people.create, {
    humanId: request.humanId,
    displayName: "Alex Borrower",
    email: "alex@example.ca",
    correlationId: "standard-guest-evidence-person",
  })
  const grant = await operator.mutation(api.guestAccess.create, {
    humanId: request.humanId,
    personId: person.personId,
    correlationId: "standard-guest-evidence-grant",
  })
  if (!grant.token) throw new Error("Expected Standard guest token")
  const opened = await anonymous.mutation(
    api.guestAccess.resolve,
    await resolveArgs(grant.token, "198.51.100.73")
  )
  const leaseId = "standard-guest-evidence-editor"
  const lease = await anonymous.mutation(
    api.guestAccess.acquireEditorLease,
    await withGuestAccessBoundary({
      token: grant.token,
      leaseId,
      operationId: "standard-guest-evidence-lease",
    })
  )
  if (!lease || lease.status !== "editing")
    throw new Error("Expected Standard guest editor lease")
  return {
    anonymous,
    operator,
    request,
    grant,
    opened,
    leaseId,
    leaseGeneration: lease.editorLease.generation,
  }
}

function editorArgs(context: Awaited<ReturnType<typeof evidenceWorkspace>>) {
  return {
    leaseId: context.leaseId,
    leaseGeneration: context.leaseGeneration,
  }
}

describe("grant-scoped response evidence", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
    process.env.GUEST_ACCESS_TOKEN_SECRET =
      "guest-access-test-secret-with-at-least-32-bytes"
    process.env.GUEST_ACCESS_RESOLVE_SECRET =
      "guest-access-resolve-test-secret-at-least-32-bytes"
  })

  it("authorizes the canonical Standard prompt scope through upload, transcription, and guest/admin projections", async () => {
    const context = await standardEvidenceWorkspace()
    if (!context.opened || context.opened.status !== "available")
      throw new Error("Expected available Standard guest view")
    const expectedQuestionId = `standard-prompt:${context.request.requestId}`
    expect(context.opened).toMatchObject({
      questions: [
        {
          id: expectedQuestionId,
          question: "Can I take my mortgage with me when I move?",
          motivation:
            "The borrower wants a plain-language portability explanation.",
        },
      ],
      workspace: {
        questionAnswers: [{ questionId: expectedQuestionId, text: "" }],
      },
    })

    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.grant.token!,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        clientAssetId: "standard-prompt-recording",
        kind: "audio",
        scope: { kind: "question", questionId: expectedQuestionId },
        fileName: "portable-mortgage.webm",
        mimeType: "audio/webm",
        sizeBytes: 11,
      })
    )
    expect(begun.asset.scope).toEqual({
      kind: "question",
      questionId: expectedQuestionId,
    })
    const storageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["voice-audio"], { type: "audio/webm" }))
    )
    const uploaded = await context.anonymous.mutation(
      api.guestEvidence.finalizeUpload,
      await withGuestAccessBoundary({
        token: context.grant.token!,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        assetId: begun.asset.assetId,
        uploadSessionId: begun.uploadSessionId,
        storageId,
      })
    )
    expect(uploaded).toMatchObject({
      scope: { kind: "question", questionId: expectedQuestionId },
      uploadState: "uploaded",
      transcriptionState: "queued",
    })

    const claim = await context.anonymous.mutation(
      internal.guestEvidence.claimTranscription,
      { assetId: begun.asset.assetId }
    )
    if (!claim) throw new Error("Expected Standard transcription claim")
    await context.anonymous.mutation(
      internal.guestEvidence.completeTranscription,
      {
        assetId: begun.asset.assetId,
        attempt: claim.attempt,
        transcript:
          "Confirm the lender's portability terms before listing the home.",
      }
    )
    const listed = await context.anonymous.mutation(
      api.guestEvidence.listForGuest,
      await withGuestAccessBoundary({ token: context.grant.token! })
    )
    expect(listed).toMatchObject([
      {
        assetId: begun.asset.assetId,
        scope: { kind: "question", questionId: expectedQuestionId },
        transcriptionState: "transcribed",
        transcript:
          "Confirm the lender's portability terms before listing the home.",
      },
    ])
    const admin = await context.operator.query(
      api.guestEvidence.inspectForAdmin,
      { grantId: context.grant.grant.grantId }
    )
    expect(admin?.assets[0]?.asset).toMatchObject({
      assetId: begun.asset.assetId,
      scope: { kind: "question", questionId: expectedQuestionId },
      transcript:
        "Confirm the lender's portability terms before listing the home.",
    })
  })

  it("blocks evidence reads, uploads, retries, and transcription after the parent request is archived without deleting retained evidence", async () => {
    const context = await evidenceWorkspace()
    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        clientAssetId: "archived-parent-evidence",
        kind: "audio",
        scope: { kind: "batch" },
        fileName: "retained.webm",
        mimeType: "audio/webm",
        sizeBytes: 8,
      })
    )
    await context.operator.mutation(api.requestDisposition.archive, {
      humanId: context.request.humanId,
      correlationId: "archive-parent-with-evidence",
    })

    await expect(
      context.anonymous.mutation(
        api.guestEvidence.listForGuest,
        await withGuestAccessBoundary({
          token: context.first.token!,
        })
      )
    ).rejects.toMatchObject({ data: { code: "ARCHIVED_REQUEST" } })
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.beginUpload,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          clientAssetId: "blocked-archived-parent-evidence",
          kind: "attachment",
          scope: { kind: "batch" },
          fileName: "blocked.txt",
          mimeType: "text/plain",
          sizeBytes: 8,
        })
      )
    ).rejects.toMatchObject({ data: { code: "ARCHIVED_REQUEST" } })
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.retry,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          assetId: begun.asset.assetId,
          operationId: "blocked-archived-parent-retry",
        })
      )
    ).rejects.toMatchObject({ data: { code: "ARCHIVED_REQUEST" } })
    await expect(
      context.anonymous.mutation(internal.guestEvidence.claimTranscription, {
        assetId: begun.asset.assetId,
      })
    ).resolves.toBeNull()
    const lateStorageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["retained"], { type: "audio/webm" }))
    )
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.finalizeUpload,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          assetId: begun.asset.assetId,
          uploadSessionId: begun.uploadSessionId,
          storageId: lateStorageId,
        })
      )
    ).rejects.toMatchObject({ data: { code: "ARCHIVED_REQUEST" } })
    await expect(
      context.anonymous.mutation(api.guestEvidence.registerUploadObject, {
        assetId: begun.asset.assetId,
        uploadSessionId: begun.uploadSessionId,
        storageId: lateStorageId,
        uploadRegistrationToken: begun.uploadRegistrationToken,
      })
    ).resolves.toBeNull()
    await expect(
      context.anonymous.run((ctx) => ctx.db.system.get(lateStorageId))
    ).resolves.toBeNull()

    const retained = await context.operator.run(async (ctx) => ({
      grant: await ctx.db.get(context.first.grant.grantId),
      asset: await ctx.db.get(begun.asset.assetId),
      workspace: await ctx.db
        .query("responseWorkspaces")
        .withIndex("by_grant", (index) =>
          index.eq("grantId", context.first.grant.grantId)
        )
        .unique(),
    }))
    expect(retained.grant).not.toBeNull()
    expect(retained.workspace).not.toBeNull()
    expect(retained.asset).toMatchObject({
      uploadState: "failed",
      transcriptionState: "queued",
      failureCode: "UPLOAD_REGISTRATION_REJECTED",
    })
  })

  it("blocks evidence operations when the parent request expires", async () => {
    const context = await evidenceWorkspace()
    await context.operator.run(async (ctx) => {
      await ctx.db.patch(context.request.requestId, {
        disposition: "expired",
        updatedAt: Date.now(),
      })
    })

    await expect(
      context.anonymous.mutation(
        api.guestEvidence.listForGuest,
        await withGuestAccessBoundary({
          token: context.first.token!,
        })
      )
    ).rejects.toMatchObject({ data: { code: "EXPIRED_REQUEST" } })
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.beginUpload,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          clientAssetId: "expired-parent-upload",
          kind: "attachment",
          scope: { kind: "batch" },
          fileName: "blocked.txt",
          mimeType: "text/plain",
          sizeBytes: 8,
        })
      )
    ).rejects.toMatchObject({ data: { code: "EXPIRED_REQUEST" } })
  })

  it("uploads an idempotent permitted attachment in question scope and isolates it from another grant", async () => {
    const context = await evidenceWorkspace()
    const beginInput = {
      token: context.first.token!,
      ...editorArgs(context),
      clientAssetId: "device-file-1",
      kind: "attachment" as const,
      scope: { kind: "question" as const, questionId: "q-1" },
      fileName: "closing-checklist.pdf",
      mimeType: "application/pdf",
      sizeBytes: 9,
    }
    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary(beginInput)
    )
    const replay = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary(beginInput)
    )
    expect(replay.asset.assetId).toBe(begun.asset.assetId)
    expect(replay.uploadUrl).toEqual(expect.any(String))

    const storageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["checklist"], { type: "application/pdf" }))
    )
    const finalized = await context.anonymous.mutation(
      api.guestEvidence.finalizeUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        uploadSessionId: begun.uploadSessionId,
        storageId,
      })
    )
    const finalizedReplay = await context.anonymous.mutation(
      api.guestEvidence.finalizeUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        uploadSessionId: begun.uploadSessionId,
        storageId,
      })
    )
    expect(finalizedReplay).toEqual(finalized)
    expect(finalized).toMatchObject({
      kind: "attachment",
      scope: { kind: "question", questionId: "q-1" },
      uploadState: "uploaded",
      transcriptionState: "not_applicable",
      version: 2,
      downloadUrl: null,
    })

    const ownAssets = await context.anonymous.mutation(
      api.guestEvidence.listForGuest,
      await withGuestAccessBoundary({ token: context.first.token! })
    )
    const otherAssets = await context.anonymous.mutation(
      api.guestEvidence.listForGuest,
      await withGuestAccessBoundary({ token: context.second.token! })
    )
    expect(ownAssets).toHaveLength(1)
    expect(ownAssets[0]?.downloadUrl).toBeNull()
    expect(otherAssets).toEqual([])
    const adminAssets = await context.operator.query(
      api.guestEvidence.inspectForAdmin,
      { grantId: context.first.grant.grantId }
    )
    expect(adminAssets?.assets[0]?.asset.downloadUrl).toEqual(
      expect.any(String)
    )
    expect(
      (
        await context.operator.run((ctx) =>
          ctx.db.query("notifications").collect()
        )
      ).filter((notification) => notification.type.startsWith("guest_"))
    ).toEqual([])
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.discard,
        await withGuestAccessBoundary({
          token: context.second.token!,
          leaseId: context.secondLeaseId,
          leaseGeneration: context.secondLeaseGeneration,
          operationId: "cross-grant-discard",
          assetId: begun.asset.assetId,
        })
      )
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } })
  })

  it("enforces MIME, size, and question authorization before issuing an upload URL", async () => {
    const context = await evidenceWorkspace()
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.beginUpload,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          clientAssetId: "device-executable",
          kind: "attachment",
          scope: { kind: "batch" },
          fileName: "payload.exe",
          mimeType: "application/x-msdownload",
          sizeBytes: 128,
        })
      )
    ).rejects.toMatchObject({ data: { code: "MIME_NOT_ALLOWED" } })
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.beginUpload,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          clientAssetId: "device-too-large",
          kind: "audio",
          scope: { kind: "batch" },
          fileName: "interview.webm",
          mimeType: "audio/webm",
          sizeBytes: 25_000_001,
        })
      )
    ).rejects.toMatchObject({ data: { code: "FILE_TOO_LARGE" } })
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.beginUpload,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          clientAssetId: "device-wrong-question",
          kind: "attachment",
          scope: { kind: "question", questionId: "q-other" },
          fileName: "notes.txt",
          mimeType: "text/plain",
          sizeBytes: 12,
        })
      )
    ).rejects.toMatchObject({ data: { code: "QUESTION_NOT_FOUND" } })
  })

  it("deletes metadata-mismatched uploads and emits one deduplicated administrator failure signal", async () => {
    const context = await evidenceWorkspace()
    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        clientAssetId: "metadata-mismatch-file",
        kind: "attachment",
        scope: { kind: "batch" },
        fileName: "priya-private-response.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
      })
    )
    const storageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["different-size"], { type: "text/plain" }))
    )
    const finalizeInput = {
      token: context.first.token!,
      ...editorArgs(context),
      assetId: begun.asset.assetId,
      uploadSessionId: begun.uploadSessionId,
      storageId,
    }
    const failed = await context.anonymous.mutation(
      api.guestEvidence.finalizeUpload,
      await withGuestAccessBoundary(finalizeInput)
    )
    expect(failed).toMatchObject({
      uploadState: "failed",
      failureCode: "UPLOAD_METADATA_MISMATCH",
    })
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.finalizeUpload,
        await withGuestAccessBoundary(finalizeInput)
      )
    ).rejects.toMatchObject({ data: { code: "UPLOAD_SESSION_SETTLED" } })
    const failureCallbackInput = {
      token: context.first.token!,
      ...editorArgs(context),
      assetId: begun.asset.assetId,
      uploadSessionId: begun.uploadSessionId,
      failureCode: "UPLOAD_METADATA_MISMATCH",
    }
    const callbackReplay = await context.anonymous.mutation(
      api.guestEvidence.markUploadFailed,
      await withGuestAccessBoundary(failureCallbackInput)
    )
    const retryReplay = await context.anonymous.mutation(
      api.guestEvidence.markUploadFailed,
      await withGuestAccessBoundary(failureCallbackInput)
    )
    expect(callbackReplay.version).toBe(failed.version)
    expect(retryReplay.version).toBe(failed.version)
    const storageObject = await context.anonymous.run((ctx) =>
      ctx.db.system.get(storageId)
    )
    expect(storageObject).toBeNull()
    const claim = await context.anonymous.run((ctx) =>
      ctx.db
        .query("storageObjectClaims")
        .withIndex("by_storage", (index) => index.eq("storageId", storageId))
        .unique()
    )
    expect(claim).toMatchObject({
      ownerKind: "guest_evidence",
      ownerId: begun.asset.assetId,
      deletedAt: expect.any(Number),
    })
    const failureSignals = await context.administrator.run(async (ctx) => ({
      notifications: (
        await ctx.db
          .query("notifications")
          .withIndex("by_request_created_at", (index) =>
            index.eq("requestId", context.request.requestId)
          )
          .collect()
      ).filter((notification) => notification.type === "guest_upload_failed"),
      deliveries: (
        await ctx.db.query("notificationEmailOutbox").collect()
      ).filter((delivery) => delivery.template === "guest_upload_failed"),
      audits: await ctx.db
        .query("auditEvents")
        .withIndex("by_request_operation_correlation", (index) =>
          index
            .eq("requestId", context.request.requestId)
            .eq("operation", "guest_evidence.upload_failed")
            .eq("correlationId", `guest-upload-failed:${begun.uploadSessionId}`)
        )
        .collect(),
    }))
    expect(failureSignals.notifications).toEqual([
      expect.objectContaining({
        type: "guest_upload_failed",
        grantId: context.first.grant.grantId,
        assetId: begun.asset.assetId,
        deepLink: `/app/requests/${context.request.humanId}#guest-access-${context.first.grant.grantId}-asset-${begun.asset.assetId}`,
      }),
    ])
    expect(failureSignals.deliveries).toEqual([
      expect.objectContaining({
        notificationId: failureSignals.notifications[0]._id,
        template: "guest_upload_failed",
        deepLink: `https://content-requests.fairlend.ca/app/requests/${context.request.humanId}#guest-access-${context.first.grant.grantId}-asset-${begun.asset.assetId}`,
      }),
    ])
    expect(failureSignals.audits).toEqual([
      expect.objectContaining({
        actorGrantId: context.first.grant.grantId,
        credentialId: `guest-access-grant:${context.first.grant.grantId}`,
      }),
    ])
    const persistedSignals = JSON.stringify(failureSignals)
    expect(persistedSignals).not.toContain(context.first.token)
    expect(persistedSignals).not.toContain("Priya Shah")
    expect(persistedSignals).not.toContain("priya@example.ca")
    expect(persistedSignals).not.toContain("priya-private-response.txt")
  })

  it("recovers an abandoned issued upload session into a retryable failure", async () => {
    const context = await evidenceWorkspace()
    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        clientAssetId: "abandoned-upload",
        kind: "attachment",
        scope: { kind: "batch" },
        fileName: "abandoned.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
      })
    )
    const otherGrantUpload = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.second.token!,
        leaseId: context.secondLeaseId,
        leaseGeneration: context.secondLeaseGeneration,
        clientAssetId: "other-grant-registration-capability",
        kind: "attachment",
        scope: { kind: "batch" },
        fileName: "other-grant.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
      })
    )
    const abandonedStorageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["late"], { type: "text/plain" }))
    )
    await expect(
      context.anonymous.mutation(api.guestEvidence.registerUploadObject, {
        assetId: begun.asset.assetId,
        uploadSessionId: begun.uploadSessionId,
        storageId: abandonedStorageId,
        uploadRegistrationToken: otherGrantUpload.uploadRegistrationToken,
      })
    ).rejects.toMatchObject({ data: { code: "UPLOAD_SESSION_INVALID" } })
    await context.anonymous.mutation(api.guestEvidence.registerUploadObject, {
      assetId: begun.asset.assetId,
      uploadSessionId: begun.uploadSessionId,
      storageId: abandonedStorageId,
      uploadRegistrationToken: begun.uploadRegistrationToken,
    })
    const issuedAt = await context.anonymous.run(async (ctx) => {
      const session = await ctx.db.get(begun.uploadSessionId)
      if (!session) throw new Error("Expected upload session")
      await ctx.db.patch(session._id, {
        updatedAt: Date.now() - 2 * 60_000 - 1,
      })
      return session.createdAt
    })
    await context.anonymous.mutation(
      internal.guestEvidence.recoverUploadSession,
      {
        uploadSessionId: begun.uploadSessionId,
        issuedAt,
      }
    )
    const assets = await context.anonymous.mutation(
      api.guestEvidence.listForGuest,
      await withGuestAccessBoundary({ token: context.first.token! })
    )
    expect(assets[0]).toMatchObject({
      uploadState: "failed",
      failureCode: "UPLOAD_SESSION_TIMEOUT",
      retryHistory: expect.arrayContaining([
        expect.objectContaining({
          stage: "upload",
          outcome: "failed",
          code: "UPLOAD_SESSION_TIMEOUT",
        }),
      ]),
    })
    expect(
      await context.anonymous.run((ctx) =>
        ctx.db.system.get(abandonedStorageId)
      )
    ).toBeNull()
    const timeoutAudits = await context.anonymous.run((ctx) =>
      ctx.db
        .query("auditEvents")
        .withIndex("by_request_operation_correlation", (index) =>
          index
            .eq("requestId", context.request.requestId)
            .eq("operation", "guest_evidence.upload_failed")
            .eq("correlationId", `guest-upload-failed:${begun.uploadSessionId}`)
        )
        .collect()
    )
    expect(timeoutAudits).toEqual([
      expect.objectContaining({
        actorGrantId: context.first.grant.grantId,
        credentialId: `guest-access-grant:${context.first.grant.grantId}`,
        inputFingerprint: expect.any(String),
      }),
    ])
    expect(timeoutAudits[0]).not.toHaveProperty("actorPrincipalId")
    const retried = await context.anonymous.mutation(
      api.guestEvidence.retry,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        operationId: "retry-abandoned-upload",
      })
    )
    expect(retried).toMatchObject({
      asset: { uploadState: "uploading" },
      uploadSessionId: expect.any(String),
      uploadUrl: expect.any(String),
    })
  })

  it("keeps audio transcripts attributable, tracks recovery, and settles only after transcription", async () => {
    const context = await evidenceWorkspace()
    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        clientAssetId: "device-audio-1",
        kind: "audio",
        scope: { kind: "batch" },
        fileName: "recovery-sequence.webm",
        mimeType: "audio/webm",
        sizeBytes: 11,
      })
    )
    const storageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["voice-audio"], { type: "audio/webm" }))
    )
    const uploaded = await context.anonymous.mutation(
      api.guestEvidence.finalizeUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        uploadSessionId: begun.uploadSessionId,
        storageId,
      })
    )
    expect(uploaded).toMatchObject({
      uploadState: "uploaded",
      transcriptionState: "queued",
    })

    const firstClaim = await context.anonymous.mutation(
      internal.guestEvidence.claimTranscription,
      { assetId: begun.asset.assetId }
    )
    if (!firstClaim) throw new Error("Expected transcription claim")
    await context.anonymous.mutation(internal.guestEvidence.failTranscription, {
      assetId: begun.asset.assetId,
      attempt: firstClaim.attempt,
      failureCode: "PROVIDER_503",
    })
    const failed = await context.anonymous.mutation(
      api.guestEvidence.listForGuest,
      await withGuestAccessBoundary({ token: context.first.token! })
    )
    expect(failed[0]).toMatchObject({
      transcriptionState: "failed",
      failureCode: "PROVIDER_503",
      retryHistory: expect.arrayContaining([
        expect.objectContaining({
          stage: "transcription",
          outcome: "failed",
          code: "PROVIDER_503",
        }),
      ]),
    })

    const retried = await context.anonymous.mutation(
      api.guestEvidence.retry,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        operationId: "retry-audio-transcription",
      })
    )
    expect(retried.asset.transcriptionState).toBe("queued")
    const replayedRetry = await context.anonymous.mutation(
      api.guestEvidence.retry,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        operationId: "retry-audio-transcription",
      })
    )
    expect(replayedRetry.asset.version).toBe(retried.asset.version)
    expect(
      replayedRetry.asset.retryHistory.filter(
        (entry) =>
          entry.stage === "transcription" && entry.outcome === "started"
      )
    ).toHaveLength(1)
    const secondClaim = await context.anonymous.mutation(
      internal.guestEvidence.claimTranscription,
      { assetId: begun.asset.assetId }
    )
    if (!secondClaim) throw new Error("Expected retried claim")
    const afterSecondClaim = await context.anonymous.mutation(
      api.guestEvidence.listForGuest,
      await withGuestAccessBoundary({ token: context.first.token! })
    )
    expect(
      afterSecondClaim[0]?.retryHistory.filter(
        (entry) =>
          entry.stage === "transcription" && entry.outcome === "started"
      )
    ).toHaveLength(2)
    await context.anonymous.mutation(
      internal.guestEvidence.completeTranscription,
      {
        assetId: begun.asset.assetId,
        attempt: secondClaim.attempt,
        transcript: "Call the lawyer first, then verify the funding gap.",
      }
    )
    const complete = await context.anonymous.mutation(
      api.guestEvidence.listForGuest,
      await withGuestAccessBoundary({ token: context.first.token! })
    )
    expect(complete[0]).toMatchObject({
      transcript: "Call the lawyer first, then verify the funding gap.",
      transcriptVersion: 1,
      transcriptionState: "transcribed",
    })
    expect(
      (
        await context.operator.run((ctx) =>
          ctx.db.query("notifications").collect()
        )
      ).filter((notification) => notification.type.startsWith("guest_"))
    ).toEqual([])
  })

  it("snapshots settled asset versions, exposes operator feedback read-only, and freezes submitted evidence", async () => {
    const context = await evidenceWorkspace()
    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        clientAssetId: "device-file-submit",
        kind: "attachment",
        scope: { kind: "batch" },
        fileName: "case-notes.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
      })
    )

    await expect(
      context.anonymous.mutation(
        api.guestAccess.submitResponseWorkspace,
        await withGuestAccessBoundary({
          token: context.first.token!,
          leaseId: context.leaseId,
          leaseGeneration: context.leaseGeneration,
          operationId: "submit-with-upload-pending",
          expectedRevision: 0,
          confirmed: true,
        })
      )
    ).rejects.toMatchObject({
      data: { code: "REQUIRED_OPERATIONS_PENDING" },
    })

    const storageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["case-notes"], { type: "text/plain" }))
    )
    const asset = await context.anonymous.mutation(
      api.guestEvidence.finalizeUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        uploadSessionId: begun.uploadSessionId,
        storageId,
      })
    )
    const feedback = await context.operator.mutation(
      api.guestEvidence.addAssetFeedback,
      {
        grantId: context.first.grant.grantId,
        assetId: asset.assetId,
        body: "Please add the date this sequence was used.",
        correlationId: "asset-feedback-1",
      }
    )
    const feedbackReplay = await context.operator.mutation(
      api.guestEvidence.addAssetFeedback,
      {
        grantId: context.first.grant.grantId,
        assetId: asset.assetId,
        body: "Please add the date this sequence was used.",
        correlationId: "asset-feedback-1",
      }
    )
    expect(feedbackReplay).toEqual(feedback)
    expect(feedback).toMatchObject({
      assetId: asset.assetId,
      body: "Please add the date this sequence was used.",
    })
    const guestAssetsWithFeedback = await context.anonymous.mutation(
      api.guestEvidence.listForGuest,
      await withGuestAccessBoundary({ token: context.first.token! })
    )
    expect(guestAssetsWithFeedback[0]?.feedback).toMatchObject([
      {
        body: "Please add the date this sequence was used.",
        author: { displayName: expect.any(String) },
      },
    ])
    expect(JSON.stringify(guestAssetsWithFeedback)).not.toContain("principalId")
    const feedbackLifecycle = await context.operator.run(async (ctx) => ({
      audits: await ctx.db
        .query("auditEvents")
        .withIndex("by_request_operation_correlation", (index) =>
          index
            .eq("requestId", context.request.requestId)
            .eq("operation", "guest_response.feedback_added")
            .eq("correlationId", "asset-feedback-1")
        )
        .collect(),
      events: (
        await ctx.db
          .query("responseWorkspaceEvents")
          .withIndex("by_grant_occurred_at", (index) =>
            index.eq("grantId", context.first.grant.grantId)
          )
          .collect()
      ).filter((event) => event.operationId === "asset-feedback-1"),
      operations: (
        await ctx.db.query("responseLifecycleOperations").collect()
      ).filter((operation) => operation.operationId === "asset-feedback-1"),
    }))
    expect(feedbackLifecycle.audits).toHaveLength(1)
    expect(feedbackLifecycle.audits[0]).toMatchObject({
      operation: "guest_response.feedback_added",
      correlationId: "asset-feedback-1",
      beforeVersion: expect.any(Number),
      afterVersion: expect.any(Number),
      inputFingerprint: expect.any(String),
    })
    expect(feedbackLifecycle.events).toEqual([
      expect.objectContaining({
        kind: "feedback_added",
        feedbackId: feedback.feedbackId,
        actorPrincipalId: expect.any(String),
      }),
    ])
    expect(feedbackLifecycle.operations).toHaveLength(1)
    expect(JSON.stringify(feedbackLifecycle)).not.toContain(
      "Please add the date this sequence was used."
    )
    const responseWorkspace = await context.operator.query(
      api.guestAccess.inspectResponseWorkspace,
      { grantId: context.first.grant.grantId }
    )
    expect(responseWorkspace?.workspace.feedback).toEqual([])

    const submitted = await context.anonymous.mutation(
      api.guestAccess.submitResponseWorkspace,
      await withGuestAccessBoundary({
        token: context.first.token!,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        operationId: "submit-with-settled-file",
        expectedRevision: 0,
        confirmed: true,
      })
    )
    expect(submitted?.submission).toMatchObject({
      assetSnapshots: [
        {
          assetId: asset.assetId,
          version: asset.version,
          transcriptVersion: 0,
          kind: "attachment",
          scope: { kind: "batch" },
        },
      ],
    })
    const firstSubmittedAsset = (
      await context.anonymous.mutation(
        api.guestEvidence.listForGuest,
        await withGuestAccessBoundary({
          token: context.first.token!,
        })
      )
    )[0]
    expect(firstSubmittedAsset?.submittedAt).toEqual(expect.any(Number))
    const reopened = await context.operator.mutation(
      api.guestAccess.reopenResponseWorkspace,
      {
        grantId: context.first.grant.grantId,
        correlationId: "reopen-settled-evidence",
      }
    )
    await context.anonymous.mutation(
      api.guestAccess.submitResponseWorkspace,
      await withGuestAccessBoundary({
        token: context.first.token!,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        operationId: "resubmit-with-settled-file",
        expectedRevision: reopened.revision,
        confirmed: true,
      })
    )
    const resubmittedAsset = (
      await context.anonymous.mutation(
        api.guestEvidence.listForGuest,
        await withGuestAccessBoundary({
          token: context.first.token!,
        })
      )
    )[0]
    expect(resubmittedAsset?.submittedAt).toBe(firstSubmittedAsset?.submittedAt)
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.discard,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          operationId: "discard-submitted-asset",
          assetId: asset.assetId,
        })
      )
    ).rejects.toMatchObject({ data: { code: "ASSET_SUBMITTED" } })

    const admin = await context.operator.query(
      api.guestEvidence.inspectForAdmin,
      { grantId: context.first.grant.grantId }
    )
    expect(admin).toMatchObject({
      readOnly: true,
      assets: [
        {
          asset: {
            assetId: asset.assetId,
            fileName: "case-notes.txt",
          },
          feedback: [
            {
              body: "Please add the date this sequence was used.",
            },
          ],
        },
      ],
    })
  })

  it("rejects stale-editor evidence mutations after an explicit takeover", async () => {
    const context = await evidenceWorkspace()
    const takeover = await context.anonymous.mutation(
      api.guestAccess.takeoverEditorLease,
      await withGuestAccessBoundary({
        token: context.first.token!,
        leaseId: "replacement-evidence-editor",
        expectedGeneration: context.leaseGeneration,
        operationId: "take-over-evidence-editor",
      })
    )
    expect(takeover?.status).toBe("editing")

    await expect(
      context.anonymous.mutation(
        api.guestEvidence.beginUpload,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          clientAssetId: "stale-editor-file",
          kind: "attachment",
          scope: { kind: "batch" },
          fileName: "stale.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
        })
      )
    ).rejects.toMatchObject({
      data: { code: "EDITOR_LEASE_REQUIRED" },
    })
  })

  it("never aliases or deletes a storage object already bound to another asset", async () => {
    const context = await evidenceWorkspace()
    const first = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        clientAssetId: "bound-storage-first",
        kind: "attachment",
        scope: { kind: "batch" },
        fileName: "first.txt",
        mimeType: "text/plain",
        sizeBytes: 5,
      })
    )
    const storageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["first"], { type: "text/plain" }))
    )
    await context.anonymous.mutation(
      api.guestEvidence.finalizeUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: first.asset.assetId,
        uploadSessionId: first.uploadSessionId,
        storageId,
      })
    )
    const second = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        clientAssetId: "bound-storage-second",
        kind: "attachment",
        scope: { kind: "batch" },
        fileName: "second.txt",
        mimeType: "text/plain",
        sizeBytes: 5,
      })
    )
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.finalizeUpload,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          assetId: second.asset.assetId,
          uploadSessionId: second.uploadSessionId,
          storageId,
        })
      )
    ).rejects.toMatchObject({
      data: { code: "STORAGE_OBJECT_ALREADY_BOUND" },
    })
    expect(
      await context.anonymous.run((ctx) => ctx.db.system.get(storageId))
    ).not.toBeNull()

    const founderStorageId = await context.anonymous.run(async (ctx) => {
      const request = await ctx.db.get(context.request.requestId)
      const principal = await ctx.db
        .query("principals")
        .withIndex("by_organization_subject", (index) =>
          index
            .eq("organizationId", "org_fairlend")
            .eq("subject", operatorIdentity.subject)
        )
        .unique()
      if (!request || !principal) throw new Error("Expected request principal")
      const documentId = await ctx.db.insert("founderInputDocuments", {
        organizationId: request.organizationId,
        requestId: request._id,
        founderPrincipalId: principal._id,
        text: "",
        revision: 0,
        hasMeaningfulDraft: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      const stored = await ctx.storage.store(
        new Blob(["voice"], { type: "audio/webm" })
      )
      await ctx.db.insert("founderVoiceCaptures", {
        organizationId: request.organizationId,
        requestId: request._id,
        documentId,
        founderPrincipalId: principal._id,
        clientCaptureId: "historical-founder-capture",
        storageId: stored,
        mimeType: "audio/webm",
        sizeBytes: 5,
        durationMs: 1_000,
        status: "uploaded",
        attempts: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      return stored
    })
    const third = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        clientAssetId: "bound-storage-third",
        kind: "audio",
        scope: { kind: "batch" },
        fileName: "third.webm",
        mimeType: "audio/webm",
        sizeBytes: 5,
      })
    )
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.finalizeUpload,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          assetId: third.asset.assetId,
          uploadSessionId: third.uploadSessionId,
          storageId: founderStorageId,
        })
      )
    ).rejects.toMatchObject({
      data: { code: "STORAGE_OBJECT_ALREADY_BOUND" },
    })
    expect(
      await context.anonymous.run((ctx) => ctx.db.system.get(founderStorageId))
    ).not.toBeNull()
  })

  it("replays upload failure and retry operations without duplicate history", async () => {
    const context = await evidenceWorkspace()
    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        clientAssetId: "idempotent-upload-failure",
        kind: "attachment",
        scope: { kind: "batch" },
        fileName: "retry.txt",
        mimeType: "text/plain",
        sizeBytes: 5,
      })
    )
    const failureInput = {
      token: context.first.token!,
      ...editorArgs(context),
      assetId: begun.asset.assetId,
      uploadSessionId: begun.uploadSessionId,
      failureCode: "NETWORK_FAILED",
    }
    const failed = await context.anonymous.mutation(
      api.guestEvidence.markUploadFailed,
      await withGuestAccessBoundary(failureInput)
    )
    const failedReplay = await context.anonymous.mutation(
      api.guestEvidence.markUploadFailed,
      await withGuestAccessBoundary(failureInput)
    )
    expect(failedReplay.version).toBe(failed.version)
    const failureSignals = await context.administrator.run(async (ctx) => ({
      notifications: (
        await ctx.db
          .query("notifications")
          .withIndex("by_request_created_at", (index) =>
            index.eq("requestId", context.request.requestId)
          )
          .collect()
      ).filter((notification) => notification.type === "guest_upload_failed"),
      deliveries: await ctx.db.query("notificationEmailOutbox").collect(),
      audits: await ctx.db
        .query("auditEvents")
        .withIndex("by_request_operation_correlation", (index) =>
          index
            .eq("requestId", context.request.requestId)
            .eq("operation", "guest_evidence.upload_failed")
            .eq("correlationId", `guest-upload-failed:${begun.uploadSessionId}`)
        )
        .collect(),
    }))
    expect(failureSignals.notifications).toHaveLength(1)
    expect(failureSignals.notifications[0]).toMatchObject({
      type: "guest_upload_failed",
      grantId: context.first.grant.grantId,
      assetId: begun.asset.assetId,
      deepLink: `/app/requests/${context.request.humanId}#guest-access-${context.first.grant.grantId}-asset-${begun.asset.assetId}`,
    })
    expect(
      failureSignals.deliveries.filter(
        (delivery) => delivery.template === "guest_upload_failed"
      )
    ).toHaveLength(1)
    expect(failureSignals.audits).toEqual([
      expect.objectContaining({
        actorGrantId: context.first.grant.grantId,
        credentialId: `guest-access-grant:${context.first.grant.grantId}`,
        inputFingerprint: expect.any(String),
      }),
    ])
    expect(failureSignals.audits[0]).not.toHaveProperty("actorPrincipalId")
    expect(JSON.stringify(failureSignals)).not.toContain(context.first.token)
    expect(JSON.stringify(failureSignals)).not.toContain("NETWORK_FAILED")
    expect(
      (
        await context.operator.query(
          api.contentRequests.listMyNotifications,
          {}
        )
      ).filter((notification) => notification.type.startsWith("guest_"))
    ).toEqual([])

    const retryInput = {
      token: context.first.token!,
      ...editorArgs(context),
      assetId: begun.asset.assetId,
      operationId: "retry-idempotent-upload",
    }
    const retried = await context.anonymous.mutation(
      api.guestEvidence.retry,
      await withGuestAccessBoundary(retryInput)
    )
    const replay = await context.anonymous.mutation(
      api.guestEvidence.retry,
      await withGuestAccessBoundary(retryInput)
    )
    expect(replay.uploadSessionId).toBe(retried.uploadSessionId)
    expect(replay.uploadUrl).toBe(retried.uploadUrl)
    expect(replay.asset.version).toBe(retried.asset.version)
    expect(
      replay.asset.retryHistory.filter(
        (entry) => entry.stage === "upload" && entry.outcome === "started"
      )
    ).toHaveLength(2)
    if (!retried.uploadSessionId)
      throw new Error("Expected a retried upload session")
    await context.anonymous.mutation(
      api.guestEvidence.markUploadFailed,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        uploadSessionId: retried.uploadSessionId,
        failureCode: "NETWORK_FAILED_AGAIN",
      })
    )
    expect(
      (
        await context.administrator.run((ctx) =>
          ctx.db
            .query("notifications")
            .withIndex("by_asset_type", (index) =>
              index
                .eq("assetId", begun.asset.assetId)
                .eq("type", "guest_upload_failed")
            )
            .collect()
        )
      ).filter((notification) => !notification.suppressedAt)
    ).toHaveLength(1)
    const recovery = await context.anonymous.mutation(
      api.guestEvidence.retry,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        operationId: "retry-idempotent-upload-after-second-failure",
      })
    )
    if (!recovery.uploadSessionId)
      throw new Error("Expected a recovery upload session")
    const recoveredStorageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["fixed"], { type: "text/plain" }))
    )
    await context.anonymous.mutation(
      api.guestEvidence.finalizeUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        uploadSessionId: recovery.uploadSessionId,
        storageId: recoveredStorageId,
      })
    )
    const recoveredSignals = await context.administrator.run(async (ctx) => ({
      notifications: await ctx.db
        .query("notifications")
        .withIndex("by_asset_type", (index) =>
          index
            .eq("assetId", begun.asset.assetId)
            .eq("type", "guest_upload_failed")
        )
        .collect(),
      deliveries: await ctx.db.query("notificationEmailOutbox").collect(),
    }))
    expect(
      recoveredSignals.notifications.filter(
        (notification) => !notification.suppressedAt
      )
    ).toHaveLength(0)
    expect(
      recoveredSignals.deliveries.filter(
        (delivery) => delivery.template === "guest_upload_failed"
      )
    ).toEqual([
      expect.objectContaining({
        status: "exhausted",
        lastErrorCode: "RESOLVED_GUEST_UPLOAD",
      }),
    ])
  })

  it("suppresses a failed-upload notification when the respondent discards the asset", async () => {
    const context = await evidenceWorkspace()
    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        clientAssetId: "discard-failed-upload",
        kind: "attachment",
        scope: { kind: "batch" },
        fileName: "discard-failed-upload.txt",
        mimeType: "text/plain",
        sizeBytes: 5,
      })
    )
    await context.anonymous.mutation(
      api.guestEvidence.markUploadFailed,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        uploadSessionId: begun.uploadSessionId,
        failureCode: "NETWORK_FAILED",
      })
    )

    await context.anonymous.mutation(
      api.guestEvidence.discard,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        operationId: "discard-failed-upload",
      })
    )

    expect(
      (
        await context.administrator.query(
          api.contentRequests.listMyNotifications,
          {}
        )
      ).filter((notification) => notification.type === "guest_upload_failed")
    ).toEqual([])
    const stored = await context.administrator.run(async (ctx) => ({
      notifications: await ctx.db
        .query("notifications")
        .withIndex("by_asset_type", (index) =>
          index
            .eq("assetId", begun.asset.assetId)
            .eq("type", "guest_upload_failed")
        )
        .collect(),
      deliveries: await ctx.db.query("notificationEmailOutbox").collect(),
    }))
    expect(stored.notifications).toEqual([
      expect.objectContaining({ suppressedAt: expect.any(Number) }),
    ])
    expect(
      stored.deliveries.filter(
        (delivery) => delivery.template === "guest_upload_failed"
      )
    ).toEqual([
      expect.objectContaining({
        status: "exhausted",
        lastErrorCode: "RESOLVED_GUEST_UPLOAD",
      }),
    ])
    await expect(
      context.operator.query(api.guestEvidence.inspectForAdmin, {
        grantId: context.first.grant.grantId,
      })
    ).resolves.toMatchObject({ assets: [] })
  })

  it("keeps discarded uploads terminal across delayed callbacks and exact begin retries", async () => {
    const context = await evidenceWorkspace()
    const beginInput = {
      token: context.first.token!,
      ...editorArgs(context),
      clientAssetId: "discarded-upload-race",
      kind: "attachment" as const,
      scope: { kind: "batch" as const },
      fileName: "discarded.txt",
      mimeType: "text/plain",
      sizeBytes: 9,
    }
    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary(beginInput)
    )
    await context.anonymous.mutation(
      api.guestEvidence.discard,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        operationId: "discard-before-upload-callback",
      })
    )

    await expect(
      context.anonymous.mutation(
        api.guestEvidence.beginUpload,
        await withGuestAccessBoundary(beginInput)
      )
    ).rejects.toMatchObject({ data: { code: "ASSET_DISCARDED" } })
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.markUploadFailed,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          assetId: begun.asset.assetId,
          uploadSessionId: begun.uploadSessionId,
          failureCode: "LATE_NETWORK_FAILURE",
        })
      )
    ).rejects.toMatchObject({ data: { code: "ASSET_DISCARDED" } })

    const storageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["discarded"], { type: "text/plain" }))
    )
    await context.anonymous.mutation(api.guestEvidence.registerUploadObject, {
      assetId: begun.asset.assetId,
      uploadSessionId: begun.uploadSessionId,
      storageId,
      uploadRegistrationToken: begun.uploadRegistrationToken,
    })
    expect(
      await context.anonymous.run((ctx) => ctx.db.system.get(storageId))
    ).toBeNull()
    await expect(
      context.anonymous.mutation(
        api.guestEvidence.finalizeUpload,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          assetId: begun.asset.assetId,
          uploadSessionId: begun.uploadSessionId,
          storageId,
        })
      )
    ).rejects.toMatchObject({ data: { code: "ASSET_DISCARDED" } })
    expect(
      await context.anonymous.mutation(
        api.guestEvidence.listForGuest,
        await withGuestAccessBoundary({
          token: context.first.token!,
        })
      )
    ).toEqual([])
  })

  it.each(["takeover", "lease_expiry", "revocation"] as const)(
    "deletes late upload bytes after terminal editor transition: %s",
    async (transition) => {
      const context = await evidenceWorkspace()
      const begun = await context.anonymous.mutation(
        api.guestEvidence.beginUpload,
        await withGuestAccessBoundary({
          token: context.first.token!,
          ...editorArgs(context),
          clientAssetId: `late-upload-${transition}`,
          kind: "attachment",
          scope: { kind: "batch" },
          fileName: `${transition}.txt`,
          mimeType: "text/plain",
          sizeBytes: 4,
        })
      )
      const storageId = await context.anonymous.run((ctx) =>
        ctx.storage.store(new Blob(["late"], { type: "text/plain" }))
      )

      if (transition === "takeover") {
        await context.anonymous.mutation(
          api.guestAccess.takeoverEditorLease,
          await withGuestAccessBoundary({
            token: context.first.token!,
            leaseId: "late-upload-replacement-editor",
            expectedGeneration: context.leaseGeneration,
            operationId: "late-upload-takeover",
          })
        )
      } else if (transition === "lease_expiry") {
        await context.anonymous.run(async (ctx) => {
          const workspace = await ctx.db
            .query("responseWorkspaces")
            .withIndex("by_grant", (index) =>
              index.eq("grantId", context.first.grant.grantId)
            )
            .unique()
          if (!workspace) throw new Error("Expected response workspace")
          await ctx.db.patch(workspace._id, {
            leaseExpiresAt: Date.now() - 1,
          })
        })
      } else {
        await context.operator.mutation(api.guestAccess.revoke, {
          grantId: context.first.grant.grantId,
          correlationId: "late-upload-revocation",
        })
      }

      const registration = {
        assetId: begun.asset.assetId,
        uploadSessionId: begun.uploadSessionId,
        storageId,
        uploadRegistrationToken: begun.uploadRegistrationToken,
      }
      await expect(
        context.anonymous.mutation(
          api.guestEvidence.registerUploadObject,
          registration
        )
      ).resolves.toBeNull()
      await expect(
        context.anonymous.mutation(
          api.guestEvidence.registerUploadObject,
          registration
        )
      ).resolves.toBeNull()
      expect(
        await context.anonymous.run((ctx) => ctx.db.system.get(storageId))
      ).toBeNull()
      expect(
        await context.anonymous.run((ctx) => ctx.db.get(begun.uploadSessionId))
      ).toMatchObject({ state: "failed", storageId })
      const terminalState = await context.anonymous.run(async (ctx) => ({
        asset: await ctx.db.get(begun.asset.assetId),
        audits: await ctx.db
          .query("auditEvents")
          .withIndex("by_request_operation_correlation", (index) =>
            index
              .eq("requestId", context.request.requestId)
              .eq("operation", "guest_evidence.upload_failed")
              .eq(
                "correlationId",
                `guest-upload-failed:${begun.uploadSessionId}`
              )
          )
          .collect(),
      }))
      expect(terminalState.asset).toMatchObject({
        uploadState: "failed",
        failureCode: "UPLOAD_REGISTRATION_REJECTED",
      })
      expect(terminalState.audits).toEqual([
        expect.objectContaining({
          actorGrantId: context.first.grant.grantId,
          credentialId: `guest-access-grant:${context.first.grant.grantId}`,
          inputFingerprint: expect.any(String),
        }),
      ])
      expect(terminalState.audits[0]).not.toHaveProperty("actorPrincipalId")
      expect(JSON.stringify(terminalState)).not.toContain(context.first.token)
    }
  )

  it("deletes registered upload bytes when the respondent discards before finalization", async () => {
    const context = await evidenceWorkspace()
    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        clientAssetId: "discard-after-registration",
        kind: "attachment",
        scope: { kind: "batch" },
        fileName: "discard-after-registration.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
      })
    )
    const storageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["late"], { type: "text/plain" }))
    )
    await context.anonymous.mutation(api.guestEvidence.registerUploadObject, {
      assetId: begun.asset.assetId,
      uploadSessionId: begun.uploadSessionId,
      storageId,
      uploadRegistrationToken: begun.uploadRegistrationToken,
    })
    expect(
      await context.anonymous.run((ctx) => ctx.db.system.get(storageId))
    ).not.toBeNull()

    const discarded = await context.anonymous.mutation(
      api.guestEvidence.discard,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        operationId: "discard-registered-upload",
      })
    )

    expect(discarded.uploadState).toBe("discarded")
    expect(
      await context.anonymous.run((ctx) => ctx.db.system.get(storageId))
    ).toBeNull()
    expect(
      await context.anonymous.run((ctx) => ctx.db.get(begun.uploadSessionId))
    ).toMatchObject({ state: "failed", storageId })
  })

  it("lets a respondent recover an expired transcription lease idempotently", async () => {
    const context = await evidenceWorkspace()
    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        clientAssetId: "stale-transcription-retry",
        kind: "audio",
        scope: { kind: "batch" },
        fileName: "stale.webm",
        mimeType: "audio/webm",
        sizeBytes: 5,
      })
    )
    const storageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["audio"], { type: "audio/webm" }))
    )
    await context.anonymous.mutation(
      api.guestEvidence.finalizeUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        uploadSessionId: begun.uploadSessionId,
        storageId,
      })
    )
    await context.anonymous.mutation(
      internal.guestEvidence.claimTranscription,
      { assetId: begun.asset.assetId }
    )
    await context.anonymous.run((ctx) =>
      ctx.db.patch(begun.asset.assetId, {
        transcriptionLeaseExpiresAt: Date.now() - 1,
      })
    )

    const retryInput = {
      token: context.first.token!,
      ...editorArgs(context),
      assetId: begun.asset.assetId,
      operationId: "retry-stale-transcription",
    }
    const retried = await context.anonymous.mutation(
      api.guestEvidence.retry,
      await withGuestAccessBoundary(retryInput)
    )
    const replay = await context.anonymous.mutation(
      api.guestEvidence.retry,
      await withGuestAccessBoundary(retryInput)
    )
    expect(retried.asset).toMatchObject({
      transcriptionState: "queued",
      transcriptionLeaseExpiresAt: null,
    })
    expect(replay.asset.version).toBe(retried.asset.version)
  })

  it("fails an abandoned transcription after the bounded watchdog attempts", async () => {
    const context = await evidenceWorkspace()
    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        clientAssetId: "watchdog-audio",
        kind: "audio",
        scope: { kind: "batch" },
        fileName: "watchdog.webm",
        mimeType: "audio/webm",
        sizeBytes: 5,
      })
    )
    const storageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["audio"], { type: "audio/webm" }))
    )
    await context.anonymous.mutation(
      api.guestEvidence.finalizeUpload,
      await withGuestAccessBoundary({
        token: context.first.token!,
        ...editorArgs(context),
        assetId: begun.asset.assetId,
        uploadSessionId: begun.uploadSessionId,
        storageId,
      })
    )
    await context.anonymous.mutation(
      internal.guestEvidence.claimTranscription,
      { assetId: begun.asset.assetId }
    )
    await context.anonymous.run(async (ctx) => {
      await ctx.db.patch(begun.asset.assetId, {
        transcriptionAttempt: 3,
        transcriptionLeaseExpiresAt: Date.now() - 1,
      })
    })
    await context.anonymous.mutation(
      internal.guestEvidence.recoverTranscription,
      { assetId: begun.asset.assetId, attempt: 3 }
    )
    const [asset] = await context.anonymous.mutation(
      api.guestEvidence.listForGuest,
      await withGuestAccessBoundary({ token: context.first.token! })
    )
    expect(asset).toMatchObject({
      transcriptionState: "failed",
      failureCode: "TRANSCRIPTION_TIMEOUT",
      transcriptionLeaseExpiresAt: null,
    })
  })
})
