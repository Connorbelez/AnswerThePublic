// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { modules } from "./test.setup"

const operatorIdentity = {
  subject: "user_operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "credential_operator_session",
}

async function operatorBackend() {
  const workspace = convexTest(schema, modules)
  const backend = workspace.withIdentity(operatorIdentity)
  const principal = await backend.mutation(api.principals.syncCurrent)
  return {
    backend,
    principalId: principal.principalId as Id<"principals">,
    workspace,
  }
}

async function createAutomated(
  backend: Awaited<ReturnType<typeof operatorBackend>>["backend"],
  suffix: string,
  expiresAt: number
) {
  const created = await backend.mutation(api.contentRequests.createManual, {
    title: `Automated expiration ${suffix}`,
    origin: "manual",
    correlationId: `create-${suffix}`,
  })
  await backend.run(async (ctx) => {
    const request = await ctx.db.get(created.requestId as Id<"contentRequests">)
    if (!request) throw new Error("missing request")
    await ctx.db.patch(request._id, {
      origin: "automated_scout",
      priority: "normal",
      expiresAt,
      autoExpirationDueAt: expiresAt,
    })
  })
  await backend.mutation(internal.operatorWorkspace.refreshRequest, {
    requestId: created.requestId as Id<"contentRequests">,
  })
  return created
}

async function runDueExpiration(
  backend: Awaited<ReturnType<typeof operatorBackend>>["backend"],
  requestId: Id<"contentRequests">,
  expectedDueAt: number,
  now: number
) {
  const dispatchToken = await backend.run(async (ctx) => {
    const request = await ctx.db.get(requestId)
    if (!request) throw new Error("missing expiration fixture")
    if (
      request.expirationDispatchToken &&
      request.expirationOriginalDueAt === expectedDueAt
    )
      return request.expirationDispatchToken
    const token = `test-dispatch:${requestId}:${expectedDueAt}`
    await ctx.db.patch(requestId, {
      autoExpirationDueAt: now + 5 * 60_000,
      expirationDispatchToken: token,
      expirationOriginalDueAt: expectedDueAt,
    })
    return token
  })
  return backend.mutation(internal.requestDisposition.expireDueRequest, {
    requestId,
    expectedDueAt,
    dispatchToken,
    now,
  })
}

async function finishArchiveTransition(
  backend: Awaited<ReturnType<typeof operatorBackend>>["backend"],
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

async function insertFounderDocumentAndJob(
  backend: Awaited<ReturnType<typeof operatorBackend>>["backend"],
  requestId: Id<"contentRequests">,
  principalId: Id<"principals">,
  input: { meaningful: boolean; jobStatus?: "queued" | "running" }
) {
  return backend.run(async (ctx) => {
    const now = Date.now()
    const documentId = await ctx.db.insert("founderInputDocuments", {
      organizationId: "org_fairlend",
      requestId,
      founderPrincipalId: principalId,
      text: input.meaningful ? "A meaningful founder answer" : "",
      revision: input.meaningful ? 1 : 0,
      hasMeaningfulDraft: input.meaningful,
      createdAt: now,
      updatedAt: now,
    })
    const versionId = await ctx.db.insert("founderInputVersions", {
      organizationId: "org_fairlend",
      requestId,
      documentId,
      text: input.meaningful ? "A meaningful founder answer" : "",
      heads: [],
      revision: input.meaningful ? 1 : 0,
      actorPrincipalId: principalId,
      actorSubject: "user_operator",
      correlationId: `version-${requestId}`,
      occurredAt: now,
    })
    if (!input.jobStatus) return null
    return ctx.db.insert("agentJobs", {
      organizationId: "org_fairlend",
      requestId,
      requestTitle: "Expiration job",
      type: "primary_response",
      status: input.jobStatus,
      founderVersionId: versionId,
      contextSnapshot: [],
      attempts: input.jobStatus === "running" ? 1 : 0,
      maxAttempts: 3,
      leaseGeneration: input.jobStatus === "running" ? 1 : 0,
      startedAt: input.jobStatus === "running" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    })
  })
}

describe("expiration, archival, and linked follow-ups", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("expires unstarted automated work and cancels only unclaimed jobs", async () => {
    const { backend, principalId, workspace } = await operatorBackend()
    const expiresAt = Date.now() + 60_000
    const request = await createAutomated(backend, "unstarted", expiresAt)
    const jobId = await insertFounderDocumentAndJob(
      backend,
      request.requestId as Id<"contentRequests">,
      principalId,
      { meaningful: false, jobStatus: "queued" }
    )

    await expect(
      runDueExpiration(
        backend,
        request.requestId as Id<"contentRequests">,
        expiresAt,
        expiresAt + 1
      )
    ).resolves.toEqual({ outcome: "expired", cancelledJobs: 1 })

    const expired = await backend.query(api.contentRequests.getByHumanId, {
      humanId: request.humanId,
    })
    expect(expired).toMatchObject({
      disposition: "expired",
      expirationReason: "automatic_expiration",
    })
    const job = await backend.run((ctx) => ctx.db.get(jobId as Id<"agentJobs">))
    expect(job).toMatchObject({
      status: "cancelled",
      cancellationReason: "request_expired",
    })
    await expect(
      backend.query(api.operatorWorkspace.list, {
        disposition: "expired",
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).resolves.toMatchObject({
      page: [{ request: { humanId: request.humanId } }],
    })
    const audit = await backend.query(api.contentRequests.listAuditEvents, {
      humanId: request.humanId,
    })
    expect(audit.at(-1)).toMatchObject({
      operation: "content_request.expired",
      credentialId: "system:expiration",
    })
    const systemActor = await backend.run((ctx) =>
      ctx.db.get(audit.at(-1)!.actorPrincipalId as Id<"principals">)
    )
    expect(systemActor).toMatchObject({
      subject: "system:expiration",
      kind: "system",
    })
    await expect(
      backend.query(api.contentRequests.listAssignablePrincipals, {})
    ).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subject: "system:expiration" }),
      ])
    )
    const reservedIdentity = workspace.withIdentity({
      subject: "system:expiration",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "agent-editor",
      jti: "credential_reserved_system_subject",
    })
    await expect(
      reservedIdentity.mutation(api.principals.syncCurrent)
    ).rejects.toMatchObject({ data: { code: "RESERVED_SUBJECT" } })
    const restored = await backend.mutation(
      api.requestDisposition.restoreExpired,
      {
        humanId: request.humanId,
        expiresAt: expiresAt + 24 * 60 * 60 * 1_000,
        correlationId: "restore-auto-expired-queued-job",
      }
    )
    expect(restored.disposition).toBe("active")
    const restoredJob = await backend.run((ctx) =>
      ctx.db.get(jobId as Id<"agentJobs">)
    )
    expect(restoredJob).toMatchObject({
      status: "queued",
      claimableAt: expect.any(Number),
    })
    expect(restoredJob?.cancellationReason).toBeUndefined()
  })

  it("protects manual, meaningful, and started work from automatic expiration", async () => {
    const { backend, principalId } = await operatorBackend()
    const expiresAt = Date.now() + 60_000
    const manual = await backend.mutation(api.contentRequests.createManual, {
      title: "Manual never auto expires",
      origin: "manual",
      correlationId: "create-manual-protected",
    })
    await backend.mutation(api.requestDisposition.setExpiration, {
      humanId: manual.humanId,
      expiresAt,
      correlationId: "set-manual-expiration",
    })
    const meaningful = await createAutomated(backend, "meaningful", expiresAt)
    await insertFounderDocumentAndJob(
      backend,
      meaningful.requestId as Id<"contentRequests">,
      principalId,
      { meaningful: true }
    )
    const started = await createAutomated(backend, "started", expiresAt)
    const runningJobId = await insertFounderDocumentAndJob(
      backend,
      started.requestId as Id<"contentRequests">,
      principalId,
      { meaningful: false, jobStatus: "running" }
    )
    const voiceOnly = await createAutomated(backend, "voice-only", expiresAt)
    await insertFounderDocumentAndJob(
      backend,
      voiceOnly.requestId as Id<"contentRequests">,
      principalId,
      { meaningful: false }
    )
    await backend.run(async (ctx) => {
      const document = await ctx.db
        .query("founderInputDocuments")
        .withIndex("by_request", (index) =>
          index.eq("requestId", voiceOnly.requestId as Id<"contentRequests">)
        )
        .unique()
      if (!document) throw new Error("missing voice document")
      const storageId = await ctx.storage.store(new Blob(["voice capture"]))
      const now = Date.now()
      await ctx.db.insert("founderVoiceCaptures", {
        organizationId: "org_fairlend",
        requestId: voiceOnly.requestId as Id<"contentRequests">,
        documentId: document._id,
        founderPrincipalId: principalId,
        clientCaptureId: "voice-only-capture",
        storageId,
        mimeType: "audio/webm",
        sizeBytes: 13,
        durationMs: 2_000,
        status: "uploaded",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      })
    })

    for (const protectedRequest of [meaningful, started, voiceOnly])
      await expect(
        runDueExpiration(
          backend,
          protectedRequest.requestId as Id<"contentRequests">,
          expiresAt,
          expiresAt + 1
        )
      ).resolves.toEqual({ outcome: "protected", cancelledJobs: 0 })
    const discardedVoiceOnly = await createAutomated(
      backend,
      "discarded-voice-only",
      expiresAt
    )
    await insertFounderDocumentAndJob(
      backend,
      discardedVoiceOnly.requestId as Id<"contentRequests">,
      principalId,
      { meaningful: false }
    )
    await backend.run(async (ctx) => {
      const document = await ctx.db
        .query("founderInputDocuments")
        .withIndex("by_request", (index) =>
          index.eq(
            "requestId",
            discardedVoiceOnly.requestId as Id<"contentRequests">
          )
        )
        .unique()
      if (!document) throw new Error("missing discarded voice document")
      const storageId = await ctx.storage.store(new Blob(["discarded voice"]))
      await ctx.db.insert("founderVoiceCaptures", {
        organizationId: "org_fairlend",
        requestId: discardedVoiceOnly.requestId as Id<"contentRequests">,
        documentId: document._id,
        founderPrincipalId: principalId,
        clientCaptureId: "discarded-voice-only-capture",
        storageId,
        mimeType: "audio/webm",
        sizeBytes: 15,
        durationMs: 1_000,
        status: "transcribed",
        transcript: "Discarded",
        attempts: 1,
        discardedAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })
    await expect(
      runDueExpiration(
        backend,
        discardedVoiceOnly.requestId as Id<"contentRequests">,
        expiresAt,
        expiresAt + 1
      )
    ).resolves.toEqual({ outcome: "expired", cancelledJobs: 0 })
    const overflowVoice = await createAutomated(
      backend,
      "overflow-voice",
      expiresAt
    )
    await insertFounderDocumentAndJob(
      backend,
      overflowVoice.requestId as Id<"contentRequests">,
      principalId,
      { meaningful: false }
    )
    await backend.run(async (ctx) => {
      const document = await ctx.db
        .query("founderInputDocuments")
        .withIndex("by_request", (index) =>
          index.eq(
            "requestId",
            overflowVoice.requestId as Id<"contentRequests">
          )
        )
        .unique()
      if (!document) throw new Error("missing overflow voice document")
      const storageId = await ctx.storage.store(new Blob(["overflow voice"]))
      for (let index = 0; index < 52; index += 1)
        await ctx.db.insert("founderVoiceCaptures", {
          organizationId: "org_fairlend",
          requestId: overflowVoice.requestId as Id<"contentRequests">,
          documentId: document._id,
          founderPrincipalId: principalId,
          clientCaptureId: `overflow-voice-${index}`,
          storageId,
          mimeType: "audio/webm",
          sizeBytes: 14,
          durationMs: 1_000,
          status: "transcribed",
          transcript: `Capture ${index}`,
          attempts: 1,
          discardedAt: index < 51 ? Date.now() : undefined,
          createdAt: index,
          updatedAt: index,
        })
    })
    await expect(
      runDueExpiration(
        backend,
        overflowVoice.requestId as Id<"contentRequests">,
        expiresAt,
        expiresAt + 1
      )
    ).resolves.toEqual({ outcome: "stale", cancelledJobs: 0 })
    for (const humanId of [
      manual.humanId,
      meaningful.humanId,
      started.humanId,
      voiceOnly.humanId,
    ]) {
      await expect(
        backend.query(api.contentRequests.getByHumanId, { humanId })
      ).resolves.toMatchObject({ disposition: "active" })
    }
    await expect(
      backend.run((ctx) => ctx.db.get(runningJobId as Id<"agentJobs">))
    ).resolves.toMatchObject({ status: "running" })
    await expect(
      backend.query(api.operatorWorkspace.list, {
        queue: "attention_required",
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).resolves.toMatchObject({
      page: expect.arrayContaining([
        expect.objectContaining({
          request: expect.objectContaining({ humanId: started.humanId }),
          attentionReasons: [
            "Review protected work after its expiration deadline",
          ],
        }),
      ]),
    })
  })

  it("coordinates due requests without reading a high-cardinality child set", async () => {
    const { backend, principalId } = await operatorBackend()
    const expiresAt = Date.now() + 60_000
    const overflow = await createAutomated(backend, "overflow", expiresAt)
    const healthy = await createAutomated(backend, "healthy", expiresAt)
    const firstJobId = await insertFounderDocumentAndJob(
      backend,
      overflow.requestId as Id<"contentRequests">,
      principalId,
      { meaningful: false, jobStatus: "queued" }
    )
    await backend.run(async (ctx) => {
      const first = await ctx.db.get(firstJobId as Id<"agentJobs">)
      if (!first) throw new Error("missing overflow fixture")
      await ctx.db.insert("agentJobs", {
        organizationId: first.organizationId,
        requestId: first.requestId,
        requestTitle: "Legacy duplicate job",
        type: first.type,
        status: "queued",
        founderVersionId: first.founderVersionId,
        contextSnapshot: first.contextSnapshot,
        attempts: 0,
        maxAttempts: 3,
        leaseGeneration: 0,
        claimableAt: expiresAt,
        createdAt: first.createdAt + 1,
        updatedAt: first.updatedAt + 1,
      })
    })

    await expect(
      backend.mutation(internal.requestDisposition.expireDue, {
        now: expiresAt + 1,
      })
    ).resolves.toEqual({ scheduled: 2 })
    await expect(
      backend.mutation(internal.requestDisposition.expireDue, {
        now: expiresAt + 1,
      })
    ).resolves.toEqual({ scheduled: 0 })
    await expect(
      runDueExpiration(
        backend,
        overflow.requestId as Id<"contentRequests">,
        expiresAt,
        expiresAt + 1
      )
    ).resolves.toEqual({ outcome: "protected", cancelledJobs: 0 })
    await expect(
      runDueExpiration(
        backend,
        healthy.requestId as Id<"contentRequests">,
        expiresAt,
        expiresAt + 1
      )
    ).resolves.toEqual({ outcome: "expired", cancelledJobs: 0 })
  })

  it("leases the first expiration page so later due requests are not starved", async () => {
    const { backend, principalId } = await operatorBackend()
    const dueAt = Date.now() - 1
    await backend.run(async (ctx) => {
      for (let index = 0; index < 101; index += 1) {
        await ctx.db.insert("contentRequests", {
          humanId: `CR-DUE-${String(index).padStart(3, "0")}`,
          organizationId: "org_fairlend",
          title: `Due request ${index}`,
          normalizedTitle: `due request ${index}`,
          searchText: `Due request ${index}`,
          aliases: [],
          origin: "automated_scout",
          priority: "normal",
          lifecycle: "pending",
          disposition: "active",
          retention: "active",
          expiresAt: dueAt,
          autoExpirationDueAt: dueAt,
          aggregateVersion: 1,
          assigneePrincipalId: principalId,
          watcherPrincipalIds: [],
          createdByPrincipalId: principalId,
          createdAt: index + 1,
          updatedAt: index + 1,
        })
      }
    })
    await expect(
      backend.mutation(internal.requestDisposition.expireDue, {
        now: dueAt + 1,
      })
    ).resolves.toEqual({ scheduled: 100 })
    await expect(
      backend.mutation(internal.requestDisposition.expireDue, {
        now: dueAt + 1,
      })
    ).resolves.toEqual({ scheduled: 1 })
  })

  it("archives and restores oversized legacy child collections in resumable pages", async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.UTC(2026, 6, 19, 12))
      const { backend, workspace, principalId } = await operatorBackend()
      const request = await backend.mutation(api.contentRequests.createManual, {
        title: "Oversized legacy archive",
        origin: "manual",
        correlationId: "create-oversized-archive",
      })
      await backend.run(async (ctx) => {
        const primary = await ctx.db
          .query("deliverables")
          .withIndex("by_request", (index) =>
            index.eq("requestId", request.requestId as Id<"contentRequests">)
          )
          .first()
        if (!primary) throw new Error("missing primary deliverable")
        for (let index = 0; index < 55; index += 1) {
          await ctx.db.insert("deliverables", {
            organizationId: "org_fairlend",
            requestId: request.requestId as Id<"contentRequests">,
            kind: "legacy_derivative",
            name: `Legacy derivative ${index}`,
            isPrimary: false,
            retention: "active",
            createdAt: index + 1,
            updatedAt: index + 1,
          })
          await ctx.db.insert("deliveryTargets", {
            organizationId: "org_fairlend",
            requestId: request.requestId as Id<"contentRequests">,
            deliverableId: primary._id,
            channel: `legacy-${index}`,
            destinationLabel: `Legacy destination ${index}`,
            isOriginal: false,
            isRequired: false,
            retention: "active",
            createdByPrincipalId: principalId,
            createdAt: index + 1,
            updatedAt: index + 1,
          })
        }
      })
      await backend.mutation(api.requestDisposition.archive, {
        humanId: request.humanId,
        correlationId: "archive-oversized-legacy",
      })
      await workspace.finishAllScheduledFunctions(vi.runAllTimers)
      const archivedState = await backend.run(async (ctx) => ({
        request: await ctx.db.get(request.requestId as Id<"contentRequests">),
        activeDeliverables: (
          await ctx.db
            .query("deliverables")
            .withIndex("by_request", (index) =>
              index.eq("requestId", request.requestId as Id<"contentRequests">)
            )
            .collect()
        ).filter((item) => (item.retention ?? "active") === "active").length,
      }))
      expect(archivedState).toMatchObject({
        request: { retention: "archived" },
        activeDeliverables: 0,
      })
      expect(archivedState.request?.archiveTransitionToken).toBeUndefined()
      await backend.mutation(api.requestDisposition.restoreArchived, {
        humanId: request.humanId,
        correlationId: "restore-oversized-legacy",
      })
      await expect(
        backend.query(api.contentRequests.getByHumanId, {
          humanId: request.humanId,
        })
      ).resolves.toMatchObject({ retentionTransition: "restoring" })
      await workspace.finishAllScheduledFunctions(vi.runAllTimers)
      await expect(
        backend.query(api.contentRequests.getByHumanId, {
          humanId: request.humanId,
        })
      ).resolves.toMatchObject({ retention: "active" })
      await expect(
        backend.query(api.operatorWorkspace.list, {
          queue: "attention_required",
          paginationOpts: { numItems: 10, cursor: null },
        })
      ).resolves.toMatchObject({
        page: [
          expect.objectContaining({
            request: expect.objectContaining({ humanId: request.humanId }),
            attentionReasons: expect.arrayContaining([
              "Legacy delivery target count requires remediation",
            ]),
          }),
        ],
      })
      const expiresAt = Date.now() + 60_000
      await backend.run((ctx) =>
        ctx.db.patch(request.requestId as Id<"contentRequests">, {
          origin: "automated_scout",
          priority: "normal",
          expiresAt,
          autoExpirationDueAt: expiresAt,
        })
      )
      await expect(
        runDueExpiration(
          backend,
          request.requestId as Id<"contentRequests">,
          expiresAt,
          expiresAt + 1
        )
      ).resolves.toEqual({ outcome: "expired", cancelledJobs: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  it("restores expired work with a replacement expiry and audits editor disposition", async () => {
    const { backend } = await operatorBackend()
    const request = await backend.mutation(api.contentRequests.createManual, {
      title: "Restore this request",
      origin: "manual",
      correlationId: "create-restoration",
    })
    await expect(
      backend.mutation(api.requestDisposition.setExpiration, {
        humanId: request.humanId,
        expiresAt: Number.MAX_SAFE_INTEGER,
        correlationId: "set-out-of-date-range",
      })
    ).rejects.toMatchObject({ data: { code: "VALIDATION_FAILED" } })
    await backend.mutation(api.requestDisposition.expire, {
      humanId: request.humanId,
      reason: "Opportunity was temporarily closed",
      correlationId: "expire-manually",
    })
    await expect(
      backend.mutation(api.requestDisposition.expire, {
        humanId: request.humanId,
        reason: "A second expiration must not replace pause provenance",
        correlationId: "expire-manually-again",
      })
    ).rejects.toMatchObject({ data: { code: "REQUEST_ALREADY_EXPIRED" } })
    await expect(
      backend.mutation(api.requestDisposition.restoreExpired, {
        humanId: request.humanId,
        expiresAt: Number.MAX_SAFE_INTEGER,
        correlationId: "restore-out-of-date-range",
      })
    ).rejects.toMatchObject({ data: { code: "VALIDATION_FAILED" } })
    const replacement = Date.now() + 7 * 24 * 60 * 60 * 1_000
    const restored = await backend.mutation(
      api.requestDisposition.restoreExpired,
      {
        humanId: request.humanId,
        expiresAt: replacement,
        correlationId: "restore-expiration",
      }
    )
    expect(restored).toMatchObject({
      disposition: "active",
      expiresAt: replacement,
      expiredAt: null,
      expirationReason: null,
    })
    const audit = await backend.query(api.contentRequests.listAuditEvents, {
      humanId: request.humanId,
    })
    expect(audit.map((event) => event.operation)).toEqual([
      "content_request.created",
      "content_request.expired",
      "content_request.expiration_restored",
    ])
  })

  it("archives and restores only related records archived by the same operation", async () => {
    const { backend, principalId, workspace } = await operatorBackend()
    const request = await backend.mutation(api.contentRequests.createManual, {
      title: "Archive without data loss",
      origin: "manual",
      correlationId: "create-archive",
    })
    const preArchivedDeliverableId = await backend.run((ctx) =>
      ctx.db.insert("deliverables", {
        organizationId: "org_fairlend",
        requestId: request.requestId as Id<"contentRequests">,
        kind: "optional_social",
        name: "Already archived",
        isPrimary: false,
        retention: "archived",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    )
    const runningJobId = await insertFounderDocumentAndJob(
      backend,
      request.requestId as Id<"contentRequests">,
      principalId,
      { meaningful: false, jobStatus: "running" }
    )
    const agent = workspace.withIdentity({
      subject: "agent_archive_test",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "agent-editor",
      jti: "credential_archive_agent",
    })
    const agentPrincipal = await agent.mutation(api.principals.syncCurrent)
    await backend.run((ctx) =>
      ctx.db.patch(runningJobId as Id<"agentJobs">, {
        claimedByPrincipalId: agentPrincipal.principalId as Id<"principals">,
        leaseToken: "archive-lease",
        leaseExpiresAt: Date.now() + 60_000,
      })
    )
    const archived = await backend.mutation(api.requestDisposition.archive, {
      humanId: request.humanId,
      correlationId: "archive-request",
    })
    expect(archived.retention).toBe("archived")
    await finishArchiveTransition(
      backend,
      request.requestId as Id<"contentRequests">
    )
    await expect(
      backend.run((ctx) => ctx.db.get(runningJobId as Id<"agentJobs">))
    ).resolves.toMatchObject({
      status: "cancelled",
      cancellationReason: "request_archived",
    })
    await expect(
      agent.mutation(api.agentJobs.complete, {
        jobId: runningJobId as Id<"agentJobs">,
        leaseToken: "archive-lease",
        leaseGeneration: 1,
        body: "This draft must not land under an archive.",
        correlationId: "complete-after-archive",
      })
    ).rejects.toMatchObject({ data: { code: "LEASE_LOST" } })
    await expect(
      backend.query(api.operatorWorkspace.list, {
        retention: "archived",
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).resolves.toMatchObject({
      page: [{ request: { humanId: request.humanId } }],
    })
    const fuzzyArchived = await backend.mutation(
      api.contentRequests.createManual,
      {
        title: "Guide to archive without data loss",
        origin: "manual",
        correlationId: "create-archive-fuzzy",
      }
    )
    await backend.mutation(api.requestDisposition.archive, {
      humanId: fuzzyArchived.humanId,
      correlationId: "archive-fuzzy-request",
    })
    await expect(
      backend.query(api.operatorWorkspace.list, {
        retention: "archived",
        search: "Archive without data loss",
        paginationOpts: { numItems: 10, cursor: null },
      })
    ).resolves.toMatchObject({
      page: [{ request: { humanId: request.humanId } }],
      isDone: true,
    })
    await backend.mutation(api.requestDisposition.restoreArchived, {
      humanId: request.humanId,
      correlationId: "restore-archive",
    })
    await expect(
      agent.mutation(api.agentJobs.claim, {
        leaseToken: "claim-during-restore",
        leaseMs: 60_000,
      })
    ).resolves.toBeNull()
    await expect(
      backend.mutation(api.requestDisposition.restoreArchived, {
        humanId: request.humanId,
        correlationId: "overlapping-restore",
      })
    ).rejects.toMatchObject({
      data: { code: "DISPOSITION_TRANSITION_IN_PROGRESS" },
    })
    await finishArchiveTransition(
      backend,
      request.requestId as Id<"contentRequests">
    )
    await expect(
      backend.query(api.contentRequests.getByHumanId, {
        humanId: request.humanId,
      })
    ).resolves.toMatchObject({ retention: "active" })
    const records = await backend.run(async (ctx) => ({
      deliverables: await ctx.db
        .query("deliverables")
        .withIndex("by_request", (index) =>
          index.eq("requestId", request.requestId as Id<"contentRequests">)
        )
        .collect(),
      targets: await ctx.db
        .query("deliveryTargets")
        .withIndex("by_request", (index) =>
          index.eq("requestId", request.requestId as Id<"contentRequests">)
        )
        .collect(),
    }))
    expect(
      records.deliverables.find((item) => item._id === preArchivedDeliverableId)
    ).toMatchObject({ retention: "archived" })
    expect(
      records.deliverables.filter(
        (item) => item._id !== preArchivedDeliverableId
      )
    ).toEqual([expect.objectContaining({ retention: "active" })])
    expect(records.targets).toEqual([
      expect.objectContaining({ retention: "active" }),
    ])
    const restoredJob = await backend.run((ctx) =>
      ctx.db.get(runningJobId as Id<"agentJobs">)
    )
    expect(restoredJob?.status).toBe("queued")
    expect(restoredJob?.attempts).toBe(0)
    expect(restoredJob?.claimableAt).toEqual(expect.any(Number))
    expect(restoredJob?.cancellationReason).toBeUndefined()
    await expect(
      agent.mutation(api.agentJobs.claim, {
        leaseToken: "restored-archive-lease",
        leaseMs: 60_000,
      })
    ).resolves.toMatchObject({
      jobId: runningJobId,
      status: "running",
      attempts: 1,
    })
  })

  it("fences every mutable child surface while a request is inactive", async () => {
    const { backend, workspace } = await operatorBackend()
    const founder = workspace.withIdentity({
      subject: "user_elie_inactive_request",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "founder",
      jti: "credential_inactive_founder",
    })
    const founderPrincipal = await founder.mutation(api.principals.syncCurrent)
    const archived = await backend.mutation(api.contentRequests.createManual, {
      title: "Archived aggregate write fence",
      origin: "manual",
      source: { url: "https://community.example/inactive-archived" },
      correlationId: "create-archived-write-fence",
    })
    await backend.run(async (ctx) => {
      const request = await ctx.db.get(
        archived.requestId as Id<"contentRequests">
      )
      if (!request) throw new Error("missing archived fixture")
      await ctx.db.patch(request._id, {
        origin: "automated_scout",
        priority: "normal",
      })
    })
    await backend.mutation(internal.contentRequests.assign, {
      humanId: archived.humanId,
      assigneePrincipalId: founderPrincipal.principalId,
      correlationId: "assign-archived-write-fence",
    })
    await backend.mutation(api.requestDisposition.archive, {
      humanId: archived.humanId,
      correlationId: "archive-write-fence",
    })

    await expect(
      founder.mutation(api.founderInputs.saveText, {
        humanId: archived.humanId,
        text: "This must not be written under the archive.",
        correlationId: "save-after-archive",
      })
    ).rejects.toMatchObject({ data: { code: "ARCHIVED_REQUEST" } })
    await expect(
      founder.mutation(api.voiceCaptures.createUploadUrl, {
        humanId: archived.humanId,
      })
    ).rejects.toMatchObject({ data: { code: "ARCHIVED_REQUEST" } })
    await expect(
      backend.mutation(api.deliverables.createDerivative, {
        humanId: archived.humanId,
        kind: "linkedin_post",
        name: "Post-archive derivative",
        correlationId: "derivative-after-archive",
      })
    ).rejects.toMatchObject({ data: { code: "ARCHIVED_REQUEST" } })
    await expect(
      backend.mutation(internal.contentRequests.assign, {
        humanId: archived.humanId,
        assigneePrincipalId: founderPrincipal.principalId,
        correlationId: "assign-after-archive",
      })
    ).rejects.toMatchObject({ data: { code: "ARCHIVED_REQUEST" } })
    await expect(
      backend.mutation(api.contentRequests.createManual, {
        title: "Duplicate archived request",
        origin: "manual",
        source: { url: "https://community.example/inactive-archived" },
        correlationId: "dedupe-after-archive",
      })
    ).rejects.toMatchObject({ data: { code: "ARCHIVED_REQUEST" } })

    const expired = await backend.mutation(api.contentRequests.createManual, {
      title: "Expired aggregate write fence",
      origin: "manual",
      source: { url: "https://community.example/inactive-expired" },
      correlationId: "create-expired-write-fence",
    })
    await backend.mutation(api.requestDisposition.expire, {
      humanId: expired.humanId,
      reason: "The response window closed",
      correlationId: "expire-write-fence",
    })
    await expect(
      backend.mutation(api.deliverables.createDerivative, {
        humanId: expired.humanId,
        kind: "linkedin_post",
        name: "Post-expiration derivative",
        correlationId: "derivative-after-expiration",
      })
    ).rejects.toMatchObject({ data: { code: "EXPIRED_REQUEST" } })
    await expect(
      backend.mutation(api.contentRequests.createManual, {
        title: "Duplicate expired request",
        origin: "manual",
        source: { url: "https://community.example/inactive-expired" },
        correlationId: "dedupe-after-expiration",
      })
    ).rejects.toMatchObject({ data: { code: "EXPIRED_REQUEST" } })
  })

  it("creates an idempotent Critical child for a genuine follow-up", async () => {
    const { backend } = await operatorBackend()
    const parent = await backend.mutation(api.contentRequests.createManual, {
      title: "Original delivered response",
      origin: "manual",
      source: { url: "https://journalist.example/follow-up" },
      correlationId: "create-parent",
    })
    const founderId = await backend.run(async (ctx) => {
      const now = Date.now()
      const principalId = await ctx.db.insert("principals", {
        subject: "user_elie_follow_up",
        organizationId: "org_fairlend",
        role: "founder",
        updatedAt: now,
      })
      await ctx.db.patch(parent.requestId as Id<"contentRequests">, {
        assigneePrincipalId: principalId,
      })
      return principalId
    })
    const input = {
      parentHumanId: parent.humanId,
      title: "Clarify the lender consent requirement",
      reason: "The journalist asked a materially new question",
      source: {
        question: "Does the first lender need to consent?",
        url: "https://journalist.example/follow-up",
        channel: "journalist_email",
      },
      correlationId: "create-follow-up",
    }
    const child = await backend.mutation(
      api.requestDisposition.createFollowUp,
      input
    )
    const replay = await backend.mutation(
      api.requestDisposition.createFollowUp,
      input
    )
    expect(replay.requestId).toBe(child.requestId)
    expect(child).toMatchObject({
      origin: "manual",
      priority: "critical",
      lifecycle: "pending",
      parentRequestHumanId: parent.humanId,
    })
    await expect(
      backend.query(api.requestDisposition.getRelations, {
        humanId: parent.humanId,
      })
    ).resolves.toMatchObject({
      parent: null,
      children: [{ humanId: child.humanId }],
    })
    await expect(
      backend.query(api.contentRequests.getByHumanId, {
        humanId: parent.humanId,
      })
    ).resolves.toMatchObject({ lifecycle: parent.lifecycle })
    const canonicalMatches = await backend.run((ctx) =>
      ctx.db
        .query("contentRequests")
        .withIndex("by_organization_normalized_source_url", (index) =>
          index
            .eq("organizationId", "org_fairlend")
            .eq("normalizedSourceUrl", "https://journalist.example/follow-up")
        )
        .collect()
    )
    expect(canonicalMatches).toHaveLength(1)
    const notifications = await backend.run((ctx) =>
      ctx.db
        .query("notifications")
        .withIndex("by_recipient_created_at", (index) =>
          index.eq("recipientPrincipalId", founderId)
        )
        .collect()
    )
    expect(notifications.map((item) => item.type).sort()).toEqual([
      "critical_escalation",
      "request_assigned",
    ])
  })

  it("rejects disposition changes from the founder role", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(operatorIdentity)
    const founder = workspace.withIdentity({
      subject: "user_elie",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "founder",
      jti: "credential_founder_session",
    })
    await operator.mutation(api.principals.syncCurrent)
    await founder.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Editors control disposition",
      origin: "manual",
      correlationId: "create-auth-request",
    })

    await expect(
      founder.mutation(api.requestDisposition.archive, {
        humanId: request.humanId,
        correlationId: "founder-cannot-archive",
      })
    ).rejects.toMatchObject({ data: { code: "ROLE_ACCESS_DENIED" } })
    await expect(
      founder.mutation(api.requestDisposition.createFollowUp, {
        parentHumanId: request.humanId,
        title: "Unauthorized child",
        reason: "Should fail",
        correlationId: "founder-cannot-follow-up",
      })
    ).rejects.toMatchObject({ data: { code: "ROLE_ACCESS_DENIED" } })
  })
})
