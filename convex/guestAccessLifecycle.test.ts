// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const operatorIdentity = {
  subject: "guest-lifecycle-operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "guest-lifecycle-operator-session",
  email: "guest-lifecycle-operator@fairlend.ca",
}

const administratorIdentity = {
  subject: "guest-lifecycle-administrator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "administrator",
  jti: "guest-lifecycle-administrator-session",
  email: "guest-lifecycle-administrator@fairlend.ca",
}

const interviewPackage = {
  brief: {
    topic: "Bridge financing when a bank closing is delayed",
    summary: "A practical Ontario guide to recovering a time-sensitive deal.",
    audience: "Ontario mortgage brokers and borrowers",
    framing: "insider_knowledge" as const,
    fairlendPosture: "Useful first; commercial relevance disclosed.",
    founderContribution: "A real recovery sequence and decision criteria.",
  },
  gaps: [
    {
      id: "gap-1",
      kind: "reality_on_the_ground" as const,
      title: "The first hour",
      existingCoverage: "Guides list bridge-loan eligibility.",
      whyItFallsShort: "They do not describe a live closing failure.",
      expertOpportunity: "Explain who gets called first and why.",
      citations: [
        {
          label: "Bridge eligibility guide",
          url: "https://example.test/bridge-eligibility",
          supports: "The published eligibility coverage that omits recovery.",
        },
      ],
    },
  ],
  questions: [
    {
      id: "q-1",
      question: "What do you do in the first hour after the bank slips?",
      motivation: "Capture the recovery sequence missing from indexed guides.",
      gapIds: ["gap-1"],
    },
  ],
  operatorInstructions: "Preserve the respondent's practical sequence.",
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
  return {
    token,
    networkSource,
    networkTimestamp,
    networkProof: Array.from(new Uint8Array(signature), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  }
}

async function withGuestAccessBoundary<T extends { token: string }>(input: T) {
  return {
    ...input,
    ...(await resolveArgs(input.token, "guest-lifecycle-test-source")),
  }
}

async function lifecycleWorkspace() {
  const anonymous = convexTest(schema, modules)
  const operator = anonymous.withIdentity(operatorIdentity)
  const administrator = anonymous.withIdentity(administratorIdentity)
  await operator.mutation(api.principals.syncCurrent)
  await administrator.mutation(api.principals.syncCurrent)
  const request = await operator.mutation(api.contentRequests.createManual, {
    title: "How bridge financing works when the timeline breaks",
    origin: "manual",
    correlationId: "lifecycle-request",
  })
  await operator.mutation(api.expertInterviews.savePackage, {
    humanId: request.humanId,
    ...interviewPackage,
    correlationId: "lifecycle-package",
  })
  const person = await operator.mutation(api.people.create, {
    humanId: request.humanId,
    displayName: "Priya Shah",
    email: "priya@example.ca",
    correlationId: "lifecycle-person",
  })
  const created = await operator.mutation(api.guestAccess.create, {
    humanId: request.humanId,
    personId: person.personId,
    correlationId: "lifecycle-grant",
  })
  if (!created.token) throw new Error("Expected one-time guest token")
  await anonymous.mutation(
    api.guestAccess.resolve,
    await resolveArgs(created.token, "198.51.100.41")
  )
  const leaseId = "lifecycle-editor-lease"
  const lease = await anonymous.mutation(
    api.guestAccess.acquireEditorLease,
    await withGuestAccessBoundary({
      token: created.token,
      leaseId,
      operationId: "lifecycle-lease-acquire",
    })
  )
  if (!lease || lease.status !== "editing")
    throw new Error("Expected active editor lease")
  const saved = await anonymous.mutation(
    api.guestAccess.saveResponseWorkspace,
    await withGuestAccessBoundary({
      token: created.token,
      leaseId,
      leaseGeneration: lease.editorLease.generation,
      operationId: "lifecycle-save-1",
      expectedRevision: 0,
      answerMode: "one_by_one",
      batchText: "",
      questionAnswers: [
        {
          questionId: "q-1",
          text: "Call the closing lawyer, then verify the funding gap.",
        },
      ],
    })
  )
  if (!saved || saved.status !== "saved")
    throw new Error("Expected a saved workspace")
  return {
    anonymous,
    administrator,
    operator,
    request,
    person,
    grant: created.grant,
    token: created.token,
    leaseId,
    leaseGeneration: lease.editorLease.generation,
    workspace: saved.workspace,
  }
}

describe("Guest response evidence lifecycle", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
    process.env.GUEST_ACCESS_TOKEN_SECRET =
      "guest-access-test-secret-with-at-least-32-bytes"
    process.env.GUEST_ACCESS_RESOLVE_SECRET =
      "guest-access-resolve-test-secret-at-least-32-bytes"
  })

  it("requires an explicit material choice when both answer modes have drafts and snapshots only the selected mode", async () => {
    const context = await lifecycleWorkspace()
    const saved = await context.anonymous.mutation(
      api.guestAccess.saveResponseWorkspace,
      await withGuestAccessBoundary({
        token: context.token,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        operationId: "mixed-mode-save",
        expectedRevision: context.workspace.revision,
        answerMode: "batch",
        batchText: "Batch material that must remain independent.",
        questionAnswers: [
          {
            questionId: "q-1",
            text: "Per-question material that must remain independent.",
          },
        ],
      })
    )
    if (!saved || saved.status !== "saved")
      throw new Error("Expected the mixed-mode workspace to save")

    await expect(
      context.anonymous.mutation(
        api.guestAccess.submitResponseWorkspace,
        await withGuestAccessBoundary({
          token: context.token,
          leaseId: context.leaseId,
          leaseGeneration: context.leaseGeneration,
          operationId: "mixed-mode-submit-without-selection",
          expectedRevision: saved.workspace.revision,
          confirmed: true,
        })
      )
    ).rejects.toMatchObject({
      data: { code: "SUBMISSION_MODE_SELECTION_REQUIRED" },
    })

    const submitted = await context.anonymous.mutation(
      api.guestAccess.submitResponseWorkspace,
      await withGuestAccessBoundary({
        token: context.token,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        operationId: "mixed-mode-submit-batch",
        expectedRevision: saved.workspace.revision,
        confirmed: true,
        selectedAnswerMode: "batch",
      })
    )

    expect(submitted?.submission).toMatchObject({
      answerMode: "batch",
      selectedAnswerMode: "batch",
      selectionMethod: "respondent_choice",
      batchText: "Batch material that must remain independent.",
      questionAnswers: [],
    })
    const retained = await context.operator.run(async (ctx) => {
      const workspace = await ctx.db
        .query("responseWorkspaces")
        .withIndex("by_grant", (index) =>
          index.eq("grantId", context.grant.grantId)
        )
        .unique()
      const submission = await ctx.db
        .query("responseSubmissions")
        .withIndex("by_request_submitted_at", (index) =>
          index.eq("requestId", context.request.requestId)
        )
        .unique()
      return { workspace, submission }
    })
    expect(retained.workspace).toMatchObject({
      batchText: "Batch material that must remain independent.",
      questionAnswers: [
        {
          questionId: "q-1",
          text: "Per-question material that must remain independent.",
        },
      ],
    })
    expect(retained.submission).toMatchObject({
      selectedAnswerMode: "batch",
      selectionMethod: "respondent_choice",
      batchText: "Batch material that must remain independent.",
      questionAnswers: [],
    })

    const synthesisSources = await context.operator.mutation(
      api.expertSynthesis.listSubmissions,
      { humanId: context.request.humanId }
    )
    expect(synthesisSources).toEqual([
      expect.objectContaining({
        progress: { completed: 1, total: 1 },
        sourceSummary: expect.stringContaining("1 of 1 answer complete"),
      }),
    ])
  })

  it("deterministically selects the only material answer mode", async () => {
    const context = await lifecycleWorkspace()

    const submitted = await context.anonymous.mutation(
      api.guestAccess.submitResponseWorkspace,
      await withGuestAccessBoundary({
        token: context.token,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        operationId: "single-mode-submit",
        expectedRevision: context.workspace.revision,
        confirmed: true,
      })
    )

    expect(submitted?.submission).toMatchObject({
      answerMode: "one_by_one",
      selectedAnswerMode: "one_by_one",
      selectionMethod: "single_mode",
      batchText: "",
      questionAnswers: [
        {
          questionId: "q-1",
          text: "Call the closing lawyer, then verify the funding gap.",
        },
      ],
    })
  })

  it("submits an immutable attributed snapshot exactly once and rejects later bearer-token edits", async () => {
    const context = await lifecycleWorkspace()
    const workspaceId = await context.operator.run(async (ctx) => {
      const workspace = await ctx.db
        .query("responseWorkspaces")
        .withIndex("by_grant", (index) =>
          index.eq("grantId", context.grant.grantId)
        )
        .unique()
      if (!workspace) throw new Error("Expected response workspace")
      await ctx.db.patch(workspace._id, {
        pendingRequiredOperationIds: ["upload-pending"],
      })
      return workspace._id
    })

    await expect(
      context.anonymous.mutation(
        api.guestAccess.submitResponseWorkspace,
        await withGuestAccessBoundary({
          token: context.token,
          leaseId: context.leaseId,
          leaseGeneration: context.leaseGeneration,
          operationId: "submit-1",
          expectedRevision: context.workspace.revision,
          confirmed: true,
        })
      )
    ).rejects.toMatchObject({
      data: { code: "REQUIRED_OPERATIONS_PENDING" },
    })
    expect(
      (
        await context.operator.run((ctx) =>
          ctx.db.query("notifications").collect()
        )
      ).filter((notification) => notification.type.startsWith("guest_"))
    ).toEqual([])

    const notificationNow = Date.now()
    await context.operator.run(async (ctx) => {
      await ctx.db.patch(workspaceId, { pendingRequiredOperationIds: [] })
      await ctx.db.patch(context.grant.grantId, {
        expiresAt: notificationNow + 60 * 60 * 1_000,
      })
    })
    await context.anonymous.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now: notificationNow, state: "in_progress" }
    )
    const submitted = await context.anonymous.mutation(
      api.guestAccess.submitResponseWorkspace,
      await withGuestAccessBoundary({
        token: context.token,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        operationId: "submit-1",
        expectedRevision: context.workspace.revision,
        confirmed: true,
      })
    )
    const replay = await context.anonymous.mutation(
      api.guestAccess.submitResponseWorkspace,
      await withGuestAccessBoundary({
        token: context.token,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        operationId: "submit-1",
        expectedRevision: context.workspace.revision,
        confirmed: true,
      })
    )

    expect(replay).toEqual(submitted)
    expect(submitted).toMatchObject({
      status: "submitted",
      workspace: {
        locked: true,
        revision: context.workspace.revision,
      },
      submission: {
        requestHumanId: context.request.humanId,
        respondent: {
          personId: context.person.personId,
          displayName: "Priya Shah",
          email: "priya@example.ca",
        },
        workspaceRevision: context.workspace.revision,
        answerMode: "one_by_one",
        questionAnswers: [
          {
            questionId: "q-1",
            text: "Call the closing lawyer, then verify the funding gap.",
          },
        ],
        questions: [
          {
            questionId: "q-1",
            question: "What do you do in the first hour after the bank slips?",
            motivation:
              "Capture the recovery sequence missing from indexed guides.",
            position: 0,
            version: expect.any(Number),
          },
        ],
        submittedAt: expect.any(Number),
      },
    })

    await expect(
      context.anonymous.mutation(
        api.guestAccess.saveResponseWorkspace,
        await withGuestAccessBoundary({
          token: context.token,
          leaseId: context.leaseId,
          leaseGeneration: context.leaseGeneration,
          operationId: "post-submit-write",
          expectedRevision: context.workspace.revision,
          answerMode: "batch",
          batchText: "A bearer token must not rewrite submitted evidence.",
          questionAnswers: [{ questionId: "q-1", text: "rewritten" }],
        })
      )
    ).rejects.toMatchObject({ data: { code: "WORKSPACE_LOCKED" } })

    const persisted = await context.administrator.run(async (ctx) => ({
      submissions: await ctx.db.query("responseSubmissions").collect(),
      events: await ctx.db.query("responseWorkspaceEvents").collect(),
      operations: await ctx.db.query("responseLifecycleOperations").collect(),
      audits: await ctx.db
        .query("auditEvents")
        .withIndex("by_request_operation_correlation", (index) =>
          index
            .eq("requestId", context.request.requestId)
            .eq("operation", "guest_response.submitted")
            .eq("correlationId", "submit-1")
        )
        .collect(),
      notifications: (
        await ctx.db
          .query("notifications")
          .withIndex("by_request_created_at", (index) =>
            index.eq("requestId", context.request.requestId)
          )
          .collect()
      ).filter((notification) => notification.type === "guest_submission"),
      deliveries: (
        await ctx.db.query("notificationEmailOutbox").collect()
      ).filter((delivery) => delivery.template === "guest_submission"),
      expiryNotifications: (
        await ctx.db
          .query("notifications")
          .withIndex("by_request_created_at", (index) =>
            index.eq("requestId", context.request.requestId)
          )
          .collect()
      ).filter(
        (notification) => notification.type === "guest_expiry_approaching"
      ),
    }))
    expect(persisted.submissions).toHaveLength(1)
    expect(persisted.events).toContainEqual(
      expect.objectContaining({ kind: "submitted" })
    )
    expect(persisted.operations).toHaveLength(1)
    expect(persisted.audits).toHaveLength(1)
    expect(persisted.notifications).toHaveLength(1)
    expect(persisted.expiryNotifications).toHaveLength(1)
    expect(persisted.expiryNotifications[0]?.suppressedAt).toEqual(
      expect.any(Number)
    )
    expect(persisted.notifications[0]).toMatchObject({
      type: "guest_submission",
      grantId: context.grant.grantId,
      submissionId: submitted?.submission.submissionId,
      deepLink: `/app/requests/${context.request.humanId}#guest-access-${context.grant.grantId}`,
      emailQueued: true,
    })
    expect(persisted.deliveries).toHaveLength(1)
    expect(persisted.deliveries[0]).toMatchObject({
      notificationId: persisted.notifications[0]?._id,
      template: "guest_submission",
    })
    expect(persisted.audits[0]).toMatchObject({
      requestHumanId: context.request.humanId,
      actorGrantId: context.grant.grantId,
      operation: "guest_response.submitted",
      correlationId: "submit-1",
      beforeVersion: expect.any(Number),
      afterVersion: expect.any(Number),
      inputFingerprint: expect.any(String),
    })
    expect(persisted.audits[0]?.actorPrincipalId).toBeUndefined()
    expect(JSON.stringify(persisted)).not.toContain(context.token)
    expect(JSON.stringify(persisted.notifications)).not.toContain(
      "Call the closing lawyer"
    )
    expect(
      (
        await context.administrator.query(
          api.contentRequests.listMyNotifications,
          {}
        )
      )
        .filter((notification) => notification.type.startsWith("guest_"))
        .map((notification) => notification.type)
    ).toEqual(["guest_submission"])
    expect(
      (
        await context.operator.query(
          api.contentRequests.listMyNotifications,
          {}
        )
      ).filter((notification) => notification.type.startsWith("guest_"))
    ).toEqual([])
  })

  it("keeps attributable operator feedback separate and visible in question context", async () => {
    const context = await lifecycleWorkspace()
    const feedback = await context.operator.mutation(
      api.guestAccess.addResponseFeedback,
      {
        grantId: context.grant.grantId,
        scope: { kind: "question", questionId: "q-1" },
        body: "Please add the decision point that changes the recommendation.",
        correlationId: "feedback-question-1",
      }
    )
    const replay = await context.operator.mutation(
      api.guestAccess.addResponseFeedback,
      {
        grantId: context.grant.grantId,
        scope: { kind: "question", questionId: "q-1" },
        body: "Please add the decision point that changes the recommendation.",
        correlationId: "feedback-question-1",
      }
    )
    expect(replay).toEqual(feedback)
    expect(feedback).toMatchObject({
      scope: { kind: "question", questionId: "q-1" },
      body: "Please add the decision point that changes the recommendation.",
      author: {
        displayName: expect.any(String),
      },
      createdAt: expect.any(Number),
    })

    await expect(
      context.operator.mutation(api.guestAccess.addResponseFeedback, {
        grantId: context.grant.grantId,
        scope: { kind: "question", questionId: "not-in-this-interview" },
        body: "This must not attach across question boundaries.",
        correlationId: "feedback-question-invalid",
      })
    ).rejects.toMatchObject({
      data: { code: "QUESTION_NOT_FOUND" },
    })

    const guestView = await context.anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(context.token, "198.51.100.42")
    )
    const adminView = await context.operator.query(
      api.guestAccess.inspectResponseWorkspace,
      { grantId: context.grant.grantId }
    )
    expect(guestView).toMatchObject({
      status: "available",
      workspace: {
        feedback: [
          {
            scope: { kind: "question", questionId: "q-1" },
            body: "Please add the decision point that changes the recommendation.",
          },
        ],
      },
    })
    expect(adminView).toMatchObject({
      readOnly: true,
      workspace: {
        questionAnswers: [
          {
            questionId: "q-1",
            text: "Call the closing lawyer, then verify the funding gap.",
          },
        ],
      },
    })
    await expect(
      context.operator.mutation(api.guestAccess.addResponseFeedback, {
        grantId: context.grant.grantId,
        scope: { kind: "question", questionId: "q-1" },
        body: "A different instruction must not reuse an idempotency key.",
        correlationId: "feedback-question-1",
      })
    ).rejects.toMatchObject({
      data: { code: "IDEMPOTENCY_KEY_REUSED" },
    })
  })

  it("projects the current unlocked revision and contextual feedback after reopening", async () => {
    const context = await lifecycleWorkspace()
    await context.operator.mutation(api.guestAccess.addResponseFeedback, {
      grantId: context.grant.grantId,
      scope: { kind: "question", questionId: "q-1" },
      body: "Add the decision point before resubmitting.",
      correlationId: "feedback-before-reopen",
    })
    const submitted = await context.anonymous.mutation(
      api.guestAccess.submitResponseWorkspace,
      await withGuestAccessBoundary({
        token: context.token,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        operationId: "submit-before-reopen",
        expectedRevision: context.workspace.revision,
        confirmed: true,
      })
    )
    if (!submitted) throw new Error("Expected submitted workspace")

    const reopened = await context.operator.mutation(
      api.guestAccess.reopenResponseWorkspace,
      {
        grantId: context.grant.grantId,
        correlationId: "reopen-for-guest-revision",
      }
    )
    const resolved = await context.anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(context.token, "198.51.100.43")
    )

    expect(reopened.revision).toBe(submitted.workspace.revision + 1)
    expect(resolved).toMatchObject({
      status: "available",
      workspace: {
        locked: false,
        lockedAt: null,
        revision: reopened.revision,
        feedback: [
          {
            scope: { kind: "question", questionId: "q-1" },
            body: "Add the decision point before resubmitting.",
          },
        ],
      },
    })
    expect(JSON.stringify(resolved)).not.toContain("principalId")
  })

  it("returns stable submission and reopen domain errors without creating partial lifecycle records", async () => {
    const context = await lifecycleWorkspace()
    await expect(
      context.operator.mutation(api.guestAccess.reopenResponseWorkspace, {
        grantId: context.grant.grantId,
        correlationId: "reopen-unlocked",
      })
    ).rejects.toMatchObject({ data: { code: "WORKSPACE_NOT_LOCKED" } })
    await expect(
      context.anonymous.mutation(
        api.guestAccess.submitResponseWorkspace,
        await withGuestAccessBoundary({
          token: context.token,
          leaseId: context.leaseId,
          leaseGeneration: context.leaseGeneration,
          operationId: "submit-unconfirmed",
          expectedRevision: context.workspace.revision,
          confirmed: false,
        })
      )
    ).rejects.toMatchObject({
      data: { code: "SUBMISSION_CONFIRMATION_REQUIRED" },
    })
    await expect(
      context.anonymous.mutation(
        api.guestAccess.submitResponseWorkspace,
        await withGuestAccessBoundary({
          token: context.token,
          leaseId: context.leaseId,
          leaseGeneration: context.leaseGeneration,
          operationId: "submit-stale",
          expectedRevision: context.workspace.revision - 1,
          confirmed: true,
        })
      )
    ).rejects.toMatchObject({
      data: {
        code: "REVISION_CONFLICT",
        currentRevision: context.workspace.revision,
      },
    })
    await expect(
      context.anonymous.mutation(
        api.guestAccess.submitResponseWorkspace,
        await withGuestAccessBoundary({
          token: context.token,
          leaseId: "not-the-active-editor",
          leaseGeneration: context.leaseGeneration,
          operationId: "submit-no-lease",
          expectedRevision: context.workspace.revision,
          confirmed: true,
        })
      )
    ).rejects.toMatchObject({ data: { code: "EDITOR_LEASE_REQUIRED" } })

    await context.anonymous.mutation(
      api.guestAccess.submitResponseWorkspace,
      await withGuestAccessBoundary({
        token: context.token,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        operationId: "submit-domain-errors",
        expectedRevision: context.workspace.revision,
        confirmed: true,
      })
    )
    await expect(
      context.anonymous.mutation(
        api.guestAccess.submitResponseWorkspace,
        await withGuestAccessBoundary({
          token: context.token,
          leaseId: context.leaseId,
          leaseGeneration: context.leaseGeneration,
          operationId: "submit-domain-errors",
          expectedRevision: context.workspace.revision + 1,
          confirmed: true,
        })
      )
    ).rejects.toMatchObject({
      data: { code: "IDEMPOTENCY_KEY_REUSED" },
    })

    await context.operator.run((ctx) =>
      ctx.db.patch(context.grant.grantId, { expiresAt: Date.now() - 1 })
    )
    await expect(
      context.operator.mutation(api.guestAccess.reopenResponseWorkspace, {
        grantId: context.grant.grantId,
        correlationId: "reopen-expired",
      })
    ).rejects.toMatchObject({
      data: { code: "GUEST_ACCESS_UNAVAILABLE" },
    })

    const rejectedOperationIds = new Set([
      "reopen-unlocked",
      "submit-unconfirmed",
      "submit-stale",
      "submit-no-lease",
      "reopen-expired",
    ])
    const rejectedOperations = await context.operator.run(async (ctx) =>
      (await ctx.db.query("responseLifecycleOperations").collect()).filter(
        ({ operationId }) => rejectedOperationIds.has(operationId)
      )
    )
    expect(rejectedOperations).toEqual([])
  })

  it("reopens a valid workspace for later evidence without mutating the prior Submission", async () => {
    const context = await lifecycleWorkspace()
    const first = await context.anonymous.mutation(
      api.guestAccess.submitResponseWorkspace,
      await withGuestAccessBoundary({
        token: context.token,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        operationId: "submit-first",
        expectedRevision: context.workspace.revision,
        confirmed: true,
      })
    )
    if (!first) throw new Error("Expected first submission")
    const reopened = await context.operator.mutation(
      api.guestAccess.reopenResponseWorkspace,
      {
        grantId: context.grant.grantId,
        correlationId: "reopen-1",
      }
    )
    const replay = await context.operator.mutation(
      api.guestAccess.reopenResponseWorkspace,
      {
        grantId: context.grant.grantId,
        correlationId: "reopen-1",
      }
    )
    expect(replay).toEqual(reopened)
    expect(reopened).toMatchObject({
      locked: false,
      revision: context.workspace.revision + 1,
    })

    const updated = await context.anonymous.mutation(
      api.guestAccess.saveResponseWorkspace,
      await withGuestAccessBoundary({
        token: context.token,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        operationId: "save-after-reopen",
        expectedRevision: reopened.revision,
        answerMode: "one_by_one",
        batchText: "",
        questionAnswers: [
          {
            questionId: "q-1",
            text: "Call the lawyer, verify the gap, then compare extension cost.",
          },
        ],
      })
    )
    if (!updated || updated.status !== "saved")
      throw new Error("Expected reopened workspace save")
    await context.anonymous.mutation(
      api.guestAccess.submitResponseWorkspace,
      await withGuestAccessBoundary({
        token: context.token,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        operationId: "submit-second",
        expectedRevision: updated.workspace.revision,
        confirmed: true,
      })
    )

    const admin = await context.operator.query(
      api.guestAccess.inspectResponseWorkspace,
      { grantId: context.grant.grantId }
    )
    expect(admin?.submissions).toHaveLength(2)
    expect(admin?.submissions[0]).toEqual(first.submission)
    expect(admin?.submissions[1]).toMatchObject({
      workspaceRevision: updated.workspace.revision,
      questionAnswers: [
        {
          questionId: "q-1",
          text: "Call the lawyer, verify the gap, then compare extension cost.",
        },
      ],
    })
  })

  it("preserves the complete guest evidence graph when its parent request is archived and restored", async () => {
    const context = await lifecycleWorkspace()
    const begun = await context.anonymous.mutation(
      api.guestEvidence.beginUpload,
      await withGuestAccessBoundary({
        token: context.token,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        clientAssetId: "retention-asset",
        kind: "attachment",
        scope: { kind: "question", questionId: "q-1" },
        fileName: "retention.txt",
        mimeType: "text/plain",
        sizeBytes: 8,
      })
    )
    const storageId = await context.anonymous.run((ctx) =>
      ctx.storage.store(new Blob(["evidence"], { type: "text/plain" }))
    )
    const asset = await context.anonymous.mutation(
      api.guestEvidence.finalizeUpload,
      await withGuestAccessBoundary({
        token: context.token,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        assetId: begun.asset.assetId,
        uploadSessionId: begun.uploadSessionId,
        storageId,
      })
    )
    await context.operator.mutation(api.guestEvidence.addAssetFeedback, {
      grantId: context.grant.grantId,
      assetId: asset.assetId,
      body: "Retain this attributable asset feedback.",
      correlationId: "retention-asset-feedback",
    })
    await context.anonymous.mutation(
      api.guestAccess.submitResponseWorkspace,
      await withGuestAccessBoundary({
        token: context.token,
        leaseId: context.leaseId,
        leaseGeneration: context.leaseGeneration,
        operationId: "retention-submit",
        expectedRevision: context.workspace.revision,
        confirmed: true,
      })
    )

    const evidenceGraph = () =>
      context.operator.run(async (ctx) => {
        const workspace = await ctx.db
          .query("responseWorkspaces")
          .withIndex("by_grant", (index) =>
            index.eq("grantId", context.grant.grantId)
          )
          .unique()
        if (!workspace) throw new Error("Expected retained workspace")
        return {
          workspace,
          assets: await ctx.db
            .query("responseAssets")
            .withIndex("by_workspace_created_at", (index) =>
              index.eq("workspaceId", workspace._id)
            )
            .collect(),
          feedback: await ctx.db
            .query("responseFeedback")
            .withIndex("by_workspace_created_at", (index) =>
              index.eq("workspaceId", workspace._id)
            )
            .collect(),
          events: await ctx.db
            .query("responseWorkspaceEvents")
            .withIndex("by_grant_occurred_at", (index) =>
              index.eq("grantId", context.grant.grantId)
            )
            .collect(),
          submissions: await ctx.db
            .query("responseSubmissions")
            .withIndex("by_workspace_submitted_at", (index) =>
              index.eq("workspaceId", workspace._id)
            )
            .collect(),
        }
      })
    const beforeArchive = await evidenceGraph()

    await context.operator.mutation(api.requestDisposition.archive, {
      humanId: context.request.humanId,
      correlationId: "archive-guest-retention",
    })
    const finishTransition = async () => {
      const transition = await context.operator.run((ctx) =>
        ctx.db.get(context.request.requestId)
      )
      if (
        !transition?.archiveTransitionToken ||
        !transition.archiveTransitionMode ||
        !transition.archiveTransitionMarker
      )
        throw new Error("Expected an active retention transition")
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
        await context.operator.mutation(
          internal.requestDisposition.continueArchiveChildren,
          {
            requestId: context.request.requestId,
            marker: transition.archiveTransitionMarker,
            transitionToken: transition.archiveTransitionToken,
            mode: transition.archiveTransitionMode,
            resource,
          }
        )
      if (transition.archiveTransitionMode === "restore") {
        await context.operator.mutation(
          internal.requestDisposition.activateRestoredJobs,
          {
            requestId: context.request.requestId,
            marker: transition.archiveTransitionMarker,
          }
        )
        await context.operator.mutation(
          internal.requestDisposition.resumeRestoredVoiceCaptures,
          { requestId: context.request.requestId }
        )
      }
    }
    await finishTransition()
    await expect(evidenceGraph()).resolves.toEqual(beforeArchive)
    await expect(
      context.operator.query(api.contentRequests.getByHumanId, {
        humanId: context.request.humanId,
      })
    ).resolves.toMatchObject({ retention: "archived" })

    await context.operator.mutation(api.requestDisposition.restoreArchived, {
      humanId: context.request.humanId,
      correlationId: "restore-guest-retention",
    })
    await finishTransition()
    await expect(evidenceGraph()).resolves.toEqual(beforeArchive)
    await expect(
      context.operator.query(api.contentRequests.getByHumanId, {
        humanId: context.request.humanId,
      })
    ).resolves.toMatchObject({ retention: "active" })
  })
})
