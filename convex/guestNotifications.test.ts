// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const operatorIdentity = {
  subject: "guest-notification-operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "guest-notification-operator-session",
  email: "guest-notification-operator@fairlend.ca",
}

const administratorIdentity = {
  subject: "guest-notification-administrator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "administrator",
  jti: "guest-notification-administrator-session",
  email: "guest-notification-administrator@fairlend.ca",
}

async function resolveArgs(token: string, networkTimestamp = Date.now()) {
  const networkSource = "guest-notification-test-source"
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
  return { ...input, ...(await resolveArgs(input.token)) }
}

async function notificationWorkspace() {
  const backend = convexTest(schema, modules)
  const operator = backend.withIdentity(operatorIdentity)
  const administrator = backend.withIdentity(administratorIdentity)
  await operator.mutation(api.principals.syncCurrent)
  await administrator.mutation(api.principals.syncCurrent)
  const request = await operator.mutation(api.contentRequests.createManual, {
    title: "Guest expiry notification contract",
    origin: "manual",
    correlationId: "guest-notification-request",
  })
  const grants = []
  for (const label of ["due", "revoked", "submitted", "renewed"]) {
    const person = await operator.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: `${label} expert`,
      email: `${label}@example.ca`,
      correlationId: `guest-notification-person-${label}`,
    })
    grants.push(
      await operator.mutation(api.guestAccess.create, {
        humanId: request.humanId,
        personId: person.personId,
        correlationId: `guest-notification-grant-${label}`,
      })
    )
  }
  return { administrator, backend, operator, request, grants }
}

describe("actionable guest notifications", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
    process.env.GUEST_ACCESS_TOKEN_SECRET =
      "guest-access-test-secret-with-at-least-32-bytes"
    process.env.GUEST_ACCESS_RESOLVE_SECRET =
      "guest-access-resolve-test-secret-with-at-least-32-bytes"
    delete process.env.GUEST_ACCESS_EXPIRY_NOTIFICATION_THRESHOLD_HOURS
  })

  it("emits one privacy-safe final-window expiry signal and suppresses stale states", async () => {
    const context = await notificationWorkspace()
    const now = Date.UTC(2026, 6, 28, 12)
    const [due, revoked, submitted, renewed] = context.grants
    await context.operator.run(async (ctx) => {
      await ctx.db.patch(due!.grant.grantId, {
        state: "in_progress",
        expiresAt: now + 11 * 60 * 60 * 1_000,
      })
      await ctx.db.patch(revoked!.grant.grantId, {
        state: "revoked",
        revokedAt: now - 1,
        expiresAt: now + 2 * 60 * 60 * 1_000,
      })
      await ctx.db.patch(submitted!.grant.grantId, {
        state: "submitted",
        expiresAt: now + 2 * 60 * 60 * 1_000,
      })
      await ctx.db.patch(renewed!.grant.grantId, {
        state: "generated",
        tokenVersion: 2,
        expiresAt: now + 24 * 60 * 60 * 1_000,
      })
    })

    const firstCreated = await context.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now, state: "in_progress" }
    )
    const replayCreated = await context.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now: now + 15 * 60 * 1_000, state: "in_progress" }
    )
    expect(firstCreated).toMatchObject({
      state: "in_progress",
      pageCreatedCount: 1,
      pageDone: true,
      continuation: null,
    })
    expect(replayCreated).toMatchObject({
      state: "in_progress",
      pageCreatedCount: 0,
      pageDone: true,
      continuation: null,
    })

    const stored = await context.administrator.run(async (ctx) => ({
      notifications: (
        await ctx.db
          .query("notifications")
          .withIndex("by_request_created_at", (index) =>
            index.eq("requestId", context.request.requestId)
          )
          .collect()
      ).filter(
        (notification) => notification.type === "guest_expiry_approaching"
      ),
      deliveries: await ctx.db.query("notificationEmailOutbox").collect(),
      audits: await ctx.db
        .query("auditEvents")
        .withIndex("by_request_operation_correlation", (index) =>
          index
            .eq("requestId", context.request.requestId)
            .eq("operation", "notification.guest_expiry_approaching")
            .eq(
              "correlationId",
              `guest-expiry:${due!.grant.grantId}:${due!.grant.tokenVersion}`
            )
        )
        .collect(),
    }))
    expect(stored.notifications).toHaveLength(1)
    expect(stored.notifications[0]).toMatchObject({
      type: "guest_expiry_approaching",
      grantId: due!.grant.grantId,
      deepLink: `/app/requests/${context.request.humanId}#guest-access-${due!.grant.grantId}`,
      emailQueued: true,
    })
    expect(
      stored.deliveries.filter(
        (delivery) => delivery.template === "guest_expiry_approaching"
      )
    ).toHaveLength(1)
    expect(stored.audits).toEqual([
      expect.objectContaining({
        actorPrincipalId: expect.any(String),
        credentialId: "system:guest-expiry-notifications",
        operation: "notification.guest_expiry_approaching",
        correlationId: `guest-expiry:${due!.grant.grantId}:${due!.grant.tokenVersion}`,
        afterVersion: expect.any(Number),
      }),
    ])
    const systemActor = await context.administrator.run((ctx) =>
      ctx.db.get(stored.audits[0]!.actorPrincipalId!)
    )
    expect(systemActor).toMatchObject({
      subject: "system:guest-expiry-notifications",
      kind: "system",
    })
    expect(JSON.stringify(stored)).not.toContain(due!.token)
    expect(JSON.stringify(stored)).not.toContain("expert@example.ca")

    const projected = await context.administrator.query(
      api.contentRequests.listMyNotifications,
      {}
    )
    expect(
      projected.filter(
        (notification) => notification.type === "guest_expiry_approaching"
      )
    ).toEqual([
      expect.objectContaining({
        requestHumanId: context.request.humanId,
        deepLink: `/app/requests/${context.request.humanId}#guest-access-${due!.grant.grantId}`,
      }),
    ])
    expect(
      (
        await context.operator.query(
          api.contentRequests.listMyNotifications,
          {}
        )
      ).filter((notification) => notification.type.startsWith("guest_"))
    ).toEqual([])

    await context.operator.mutation(api.guestAccess.renew, {
      grantId: due!.grant.grantId,
      correlationId: "renew-after-expiry-signal",
    })
    await context.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now: now + 30 * 60 * 1_000, state: "in_progress" }
    )
    expect(
      (
        await context.administrator.query(
          api.contentRequests.listMyNotifications,
          {}
        )
      ).filter(
        (notification) => notification.type === "guest_expiry_approaching"
      )
    ).toEqual([])
    const suppressed = await context.administrator.run(async (ctx) => ({
      notification: await ctx.db.get(stored.notifications[0]!._id),
      delivery: await ctx.db.get(
        stored.deliveries.find(
          (delivery) => delivery.template === "guest_expiry_approaching"
        )!._id
      ),
    }))
    expect(suppressed.notification?.suppressedAt).toEqual(expect.any(Number))
    expect(suppressed.delivery).toMatchObject({
      status: "exhausted",
      lastErrorCode: "STALE_GUEST_GRANT",
    })
  })

  it("honours a configured final-window threshold", async () => {
    process.env.GUEST_ACCESS_EXPIRY_NOTIFICATION_THRESHOLD_HOURS = "6"
    const context = await notificationWorkspace()
    const now = Date.UTC(2026, 6, 28, 12)
    await context.operator.run((ctx) =>
      ctx.db.patch(context.grants[0]!.grant.grantId, {
        expiresAt: now + 7 * 60 * 60 * 1_000,
      })
    )
    await context.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now }
    )
    expect(
      (
        await context.administrator.run((ctx) =>
          ctx.db.query("notifications").collect()
        )
      ).filter(
        (notification) => notification.type === "guest_expiry_approaching"
      )
    ).toHaveLength(0)
  })

  it("reports one sweep page truthfully while chaining mixed unfinished states", async () => {
    const context = await notificationWorkspace()
    const now = Date.UTC(2026, 6, 28, 14)
    await context.operator.run(async (ctx) => {
      await ctx.db.patch(context.grants[0]!.grant.grantId, {
        state: "generated",
        expiresAt: now + 60 * 60 * 1_000,
      })
      await ctx.db.patch(context.grants[1]!.grant.grantId, {
        state: "in_progress",
        expiresAt: now + 2 * 60 * 60 * 1_000,
      })
    })

    const generatedPage = await context.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now }
    )
    expect(generatedPage).toMatchObject({
      state: "generated",
      pageCreatedCount: 1,
      pageDone: true,
      continuation: { state: "opened", cursor: null },
    })
    const openedPage = await context.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now, state: "opened" }
    )
    expect(openedPage).toMatchObject({
      state: "opened",
      pageCreatedCount: 0,
      pageDone: true,
      continuation: { state: "in_progress", cursor: null },
    })
    const inProgressPage = await context.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now, state: "in_progress" }
    )
    expect(inProgressPage).toMatchObject({
      state: "in_progress",
      pageCreatedCount: 1,
      pageDone: true,
      continuation: null,
    })
  })

  it("returns an explicit same-state cursor when a sweep page is truncated", async () => {
    const context = await notificationWorkspace()
    const now = Date.UTC(2026, 6, 28, 15)
    await context.operator.run(async (ctx) => {
      const source = await ctx.db.get(context.grants[0]!.grant.grantId)
      if (!source) throw new Error("Expected source grant")
      const {
        _id: sourceId,
        _creationTime: sourceCreationTime,
        ...template
      } = source
      void sourceId
      void sourceCreationTime
      await ctx.db.patch(source._id, {
        state: "generated",
        expiresAt: now + 60 * 60 * 1_000,
      })
      for (let index = 0; index < 100; index += 1) {
        await ctx.db.insert("guestAccessGrants", {
          ...template,
          currentTokenHash: `pagination-token-${index}`,
          state: "generated",
          expiresAt: now + 60 * 60 * 1_000 + index,
          createdAt: now + index,
          updatedAt: now + index,
          latestActivityAt: now + index,
        })
      }
    })

    const firstPage = await context.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now, state: "generated" }
    )
    expect(firstPage).toMatchObject({
      state: "generated",
      pageCreatedCount: 100,
      pageDone: false,
      continuation: {
        state: "generated",
        cursor: expect.any(String),
      },
    })
    if (!firstPage.continuation?.cursor)
      throw new Error("Expected a continuation cursor")
    const finalPage = await context.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      {
        now,
        state: firstPage.continuation.state,
        cursor: firstPage.continuation.cursor,
      }
    )
    expect(finalPage).toMatchObject({
      state: "generated",
      pageCreatedCount: 1,
      pageDone: true,
      continuation: { state: "opened", cursor: null },
    })
  })

  it("fences suppression before send commitment and records an already committed send truthfully", async () => {
    const beforeCommit = await notificationWorkspace()
    const beforeNow = Date.now()
    const beforeGrant = beforeCommit.grants[0]!
    await beforeCommit.operator.run((ctx) =>
      ctx.db.patch(beforeGrant.grant.grantId, {
        expiresAt: beforeNow + 60 * 60 * 1_000,
      })
    )
    await beforeCommit.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now: beforeNow, state: "generated" }
    )
    const beforeDelivery = await beforeCommit.backend.run((ctx) =>
      ctx.db
        .query("notificationEmailOutbox")
        .withIndex("by_status_next_attempt", (index) =>
          index.eq("status", "queued")
        )
        .first()
    )
    if (!beforeDelivery) throw new Error("Expected queued expiry delivery")
    const beforeClaim = await beforeCommit.backend.mutation(
      internal.notifications.claimEmailDelivery,
      {
        deliveryId: beforeDelivery._id,
        claimToken: "before-commit-claim",
      }
    )
    expect(beforeClaim).not.toBeNull()
    await beforeCommit.operator.mutation(api.guestAccess.renew, {
      grantId: beforeGrant.grant.grantId,
      correlationId: "suppress-before-send-commit",
    })
    await expect(
      beforeCommit.backend.mutation(
        internal.notifications.commitEmailDelivery,
        {
          deliveryId: beforeDelivery._id,
          claimToken: "before-commit-claim",
        }
      )
    ).resolves.toBeNull()
    expect(
      await beforeCommit.backend.run((ctx) => ctx.db.get(beforeDelivery._id))
    ).toMatchObject({
      status: "exhausted",
      lastErrorCode: "STALE_GUEST_GRANT",
    })

    const afterCommit = await notificationWorkspace()
    const afterNow = beforeNow + 1
    const afterGrant = afterCommit.grants[0]!
    await afterCommit.operator.run((ctx) =>
      ctx.db.patch(afterGrant.grant.grantId, {
        expiresAt: afterNow + 60 * 60 * 1_000,
      })
    )
    await afterCommit.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now: afterNow, state: "generated" }
    )
    const afterDelivery = await afterCommit.backend.run((ctx) =>
      ctx.db
        .query("notificationEmailOutbox")
        .withIndex("by_status_next_attempt", (index) =>
          index.eq("status", "queued")
        )
        .first()
    )
    if (!afterDelivery) throw new Error("Expected queued expiry delivery")
    const afterClaim = await afterCommit.backend.mutation(
      internal.notifications.claimEmailDelivery,
      {
        deliveryId: afterDelivery._id,
        claimToken: "after-commit-claim",
      }
    )
    if (!afterClaim) throw new Error("Expected delivery claim")
    const committed = await afterCommit.backend.mutation(
      internal.notifications.commitEmailDelivery,
      {
        deliveryId: afterDelivery._id,
        claimToken: afterClaim.claimToken,
      }
    )
    expect(committed).toMatchObject({
      deliveryId: afterDelivery._id,
      claimToken: afterClaim.claimToken,
    })
    await afterCommit.operator.mutation(api.guestAccess.renew, {
      grantId: afterGrant.grant.grantId,
      correlationId: "suppress-after-send-commit",
    })
    expect(
      await afterCommit.backend.run((ctx) => ctx.db.get(afterDelivery._id))
    ).toMatchObject({
      status: "sending",
      sendCommittedAt: expect.any(Number),
    })
    await afterCommit.backend.run((ctx) =>
      ctx.db.patch(afterDelivery._id, { leaseExpiresAt: Date.now() - 1 })
    )
    const reclaimed = await afterCommit.backend.mutation(
      internal.notifications.claimEmailDelivery,
      {
        deliveryId: afterDelivery._id,
        claimToken: "after-commit-reclaim",
      }
    )
    if (!reclaimed) throw new Error("Expected committed delivery reclaim")
    await expect(
      afterCommit.backend.mutation(internal.notifications.commitEmailDelivery, {
        deliveryId: afterDelivery._id,
        claimToken: reclaimed.claimToken,
      })
    ).resolves.toMatchObject({
      deliveryId: afterDelivery._id,
      claimToken: reclaimed.claimToken,
    })
    await afterCommit.backend.mutation(
      internal.notifications.finishEmailDelivery,
      {
        deliveryId: afterDelivery._id,
        status: "sent",
        claimToken: reclaimed.claimToken,
      }
    )
    expect(
      await afterCommit.backend.run((ctx) => ctx.db.get(afterDelivery._id))
    ).toMatchObject({
      status: "sent",
      sendCommittedAt: expect.any(Number),
    })
  })

  it("removes an existing expiry signal when the grant is revoked", async () => {
    const context = await notificationWorkspace()
    const now = Date.now()
    const grantId = context.grants[0]!.grant.grantId
    await context.operator.run((ctx) =>
      ctx.db.patch(grantId, { expiresAt: now + 60 * 60 * 1_000 })
    )
    await context.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now }
    )
    await context.operator.mutation(api.guestAccess.revoke, {
      grantId,
      correlationId: "revoke-after-expiry-signal",
    })
    expect(
      (
        await context.administrator.query(
          api.contentRequests.listMyNotifications,
          {}
        )
      ).filter(
        (notification) => notification.type === "guest_expiry_approaching"
      )
    ).toEqual([])
  })

  it("reactivates a suppressed expiry signal when an unfinished response is reopened", async () => {
    const context = await notificationWorkspace()
    const now = Date.now()
    const target = context.grants[0]!
    const grantId = target.grant.grantId
    if (!target.token) throw new Error("Expected initial guest token")
    await context.backend.mutation(
      api.guestAccess.resolve,
      await resolveArgs(target.token)
    )
    const leaseId = "reopen-expiry-public-lifecycle"
    const lease = await context.backend.mutation(
      api.guestAccess.acquireEditorLease,
      await withGuestAccessBoundary({
        token: target.token,
        leaseId,
        operationId: "reopen-expiry-acquire",
      })
    )
    if (!lease || lease.status !== "editing")
      throw new Error("Expected active editor lease")
    const saved = await context.backend.mutation(
      api.guestAccess.saveResponseWorkspace,
      await withGuestAccessBoundary({
        token: target.token,
        leaseId,
        leaseGeneration: lease.editorLease.generation,
        operationId: "reopen-expiry-save",
        expectedRevision: 0,
        answerMode: "one_by_one",
        batchText: "",
        questionAnswers: [
          {
            questionId: `standard-prompt:${context.request.requestId}`,
            text: "Keep this unfinished response.",
          },
        ],
      })
    )
    if (!saved || saved.status !== "saved")
      throw new Error("Expected saved response workspace")
    await context.operator.run((ctx) =>
      ctx.db.patch(grantId, {
        expiresAt: now + 60 * 60 * 1_000,
      })
    )
    const scheduled = await context.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now, state: "in_progress" }
    )
    expect(scheduled.pageCreatedCount).toBe(1)
    const fixture = await context.operator.run(async (ctx) => {
      const workspace = await ctx.db
        .query("responseWorkspaces")
        .withIndex("by_grant", (index) => index.eq("grantId", grantId))
        .unique()
      const notification = await ctx.db
        .query("notifications")
        .withIndex("by_grant_type", (index) =>
          index.eq("grantId", grantId).eq("type", "guest_expiry_approaching")
        )
        .unique()
      if (!workspace || !notification)
        throw new Error("Expected reopen notification fixture")
      const delivery = await ctx.db
        .query("notificationEmailOutbox")
        .withIndex("by_notification", (index) =>
          index.eq("notificationId", notification._id)
        )
        .unique()
      if (!delivery) throw new Error("Expected expiry delivery")
      return { deliveryId: delivery._id, notificationId: notification._id }
    })

    await context.backend.mutation(
      api.guestAccess.submitResponseWorkspace,
      await withGuestAccessBoundary({
        token: target.token,
        leaseId,
        leaseGeneration: lease.editorLease.generation,
        operationId: "reopen-expiry-submit",
        expectedRevision: saved.workspace.revision,
        confirmed: true,
      })
    )
    expect(
      await context.operator.run((ctx) => ctx.db.get(fixture.notificationId))
    ).toMatchObject({ suppressedAt: expect.any(Number) })
    expect(
      await context.operator.run((ctx) => ctx.db.get(fixture.deliveryId))
    ).toMatchObject({
      status: "exhausted",
      lastErrorCode: "STALE_GUEST_GRANT",
    })

    await context.operator.mutation(api.guestAccess.reopenResponseWorkspace, {
      grantId,
      correlationId: "reopen-expiry-notification",
    })

    const reactivatedNotification = await context.operator.run((ctx) =>
      ctx.db.get(fixture.notificationId)
    )
    expect(reactivatedNotification?.suppressedAt).toBeUndefined()
    const reactivatedDelivery = await context.operator.run((ctx) =>
      ctx.db.get(fixture.deliveryId)
    )
    expect(reactivatedDelivery).not.toBeNull()
    expect(reactivatedDelivery?.status).not.toBe("exhausted")
    expect(reactivatedDelivery?.lastErrorCode).toBeUndefined()
    expect(reactivatedDelivery?.attempts ?? 0).toBeLessThan(5)
    expect(
      (
        await context.administrator.query(
          api.contentRequests.listMyNotifications,
          {}
        )
      ).filter(
        (notification) => notification.type === "guest_expiry_approaching"
      )
    ).toHaveLength(1)

    await context.operator.mutation(api.guestAccess.renew, {
      grantId,
      correlationId: "renew-reactivated-expiry-notification",
    })
    await context.operator.run(async (ctx) => {
      const workspace = await ctx.db
        .query("responseWorkspaces")
        .withIndex("by_grant", (index) => index.eq("grantId", grantId))
        .unique()
      if (!workspace) throw new Error("Expected renewed response workspace")
      await ctx.db.patch(workspace._id, {
        lockedAt: now + 1,
        updatedAt: now + 1,
      })
      await ctx.db.patch(grantId, {
        state: "submitted",
        latestActivityAt: now + 1,
        updatedAt: now + 1,
      })
    })
    await context.operator.mutation(api.guestAccess.reopenResponseWorkspace, {
      grantId,
      correlationId: "reopen-renewed-expiry-notification",
    })
    expect(
      await context.operator.run((ctx) => ctx.db.get(fixture.notificationId))
    ).toMatchObject({ suppressedAt: expect.any(Number) })
    expect(
      (
        await context.administrator.query(
          api.contentRequests.listMyNotifications,
          {}
        )
      ).filter(
        (notification) => notification.type === "guest_expiry_approaching"
      )
    ).toHaveLength(0)
  })

  it("schedules the first expiry signal after a submitted workspace is reopened", async () => {
    const context = await notificationWorkspace()
    const now = Date.now()
    const target = context.grants[0]!
    const grantId = target.grant.grantId
    if (!target.token) throw new Error("Expected initial guest token")
    await context.backend.mutation(
      api.guestAccess.resolve,
      await resolveArgs(target.token)
    )
    await context.operator.run(async (ctx) => {
      const [grant, workspace] = await Promise.all([
        ctx.db.get(grantId),
        ctx.db
          .query("responseWorkspaces")
          .withIndex("by_grant", (index) => index.eq("grantId", grantId))
          .unique(),
      ])
      if (!grant || !workspace)
        throw new Error("Expected submitted response fixture")
      const submissionId = await ctx.db.insert("responseSubmissions", {
        organizationId: grant.organizationId,
        requestId: context.request.requestId,
        requestHumanId: context.request.humanId,
        grantId,
        workspaceId: workspace._id,
        assignedPersonId: grant.assignedPersonId,
        respondentDisplayName: "Due expert",
        respondentEmail: "due@example.ca",
        workspaceRevision: workspace.revision,
        answerMode: workspace.answerMode,
        batchText: workspace.batchText,
        questionAnswers: workspace.questionAnswers,
        questions: [],
        submittedAt: now,
      })
      await ctx.db.patch(workspace._id, {
        lockedAt: now,
        latestSubmissionId: submissionId,
        updatedAt: now,
      })
      await ctx.db.patch(grantId, {
        state: "submitted",
        expiresAt: now + 60 * 60 * 1_000,
        latestActivityAt: now,
        updatedAt: now,
      })
    })

    await context.operator.mutation(api.guestAccess.reopenResponseWorkspace, {
      grantId,
      correlationId: "reopen-before-first-expiry-notification",
    })
    const scheduled = await context.backend.mutation(
      internal.notifications.scheduleGuestExpiryNotifications,
      { now, state: "in_progress" }
    )
    expect(scheduled.pageCreatedCount).toBe(1)
    expect(
      (
        await context.administrator.query(
          api.contentRequests.listMyNotifications,
          {}
        )
      ).filter(
        (notification) => notification.type === "guest_expiry_approaching"
      )
    ).toHaveLength(1)
  })
})
