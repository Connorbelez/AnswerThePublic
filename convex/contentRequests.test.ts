// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { api, internal } from "./_generated/api"
import { requestQueueSortKey } from "./lib/requestOrdering"
import schema from "./schema"
import { modules } from "./test.setup"

const operatorIdentity = {
  subject: "user_operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "credential_operator_session",
  email: "operator@fairlend.ca",
}

async function operatorBackend() {
  const backend = convexTest(schema, modules).withIdentity(operatorIdentity)
  await backend.mutation(api.principals.syncCurrent)
  return backend
}

describe("Content Request workflow contract", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
    process.env.FAIRLEND_TRANSACTIONAL_EMAIL_ENDPOINT =
      "https://email.example/send"
    process.env.FAIRLEND_TRANSACTIONAL_EMAIL_API_KEY = "email-test-key"
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("creates a minimal manual request as Critical and retrieves it by stable ID", async () => {
    const backend = await operatorBackend()

    const created = await backend.mutation(api.contentRequests.createManual, {
      title: "Explain a portable mortgage",
      origin: "manual",
      correlationId: "corr-create-001",
    })

    expect(created).toMatchObject({
      title: "Explain a portable mortgage",
      requestType: "standard",
      origin: "manual",
      priority: "critical",
      lifecycle: "pending",
      source: null,
    })
    expect(created.humanId).toMatch(/^CR-[A-Z0-9]+$/)
    await expect(
      backend.query(api.contentRequests.getByHumanId, {
        humanId: created.humanId,
      })
    ).resolves.toEqual(created)
  })

  it("replays createManual audit records written before requestType joined the fingerprint", async () => {
    const backend = await operatorBackend()
    const input = {
      title: "Legacy idempotent request",
      origin: "manual" as const,
      correlationId: "legacy-create-fingerprint",
    }
    const created = await backend.mutation(
      api.contentRequests.createManual,
      input
    )
    await backend.run(async (ctx) => {
      const audit = await ctx.db
        .query("auditEvents")
        .withIndex("by_organization_actor_operation_correlation", (index) =>
          index
            .eq("organizationId", "org_fairlend")
            .eq("actorPrincipalId", created.assignee.principalId)
            .eq("operation", "content_request.created")
            .eq("correlationId", input.correlationId)
        )
        .unique()
      if (!audit) throw new Error("Missing creation audit")
      await ctx.db.patch(audit._id, {
        inputFingerprint: JSON.stringify({
          title: input.title,
          origin: input.origin,
          aliases: [],
          source: null,
        }),
      })
    })

    await expect(
      backend.mutation(api.contentRequests.createManual, input)
    ).resolves.toEqual(created)
  })

  it("updates only allowlisted metadata and preserves immutable source text", async () => {
    const backend = await operatorBackend()
    const created = await backend.mutation(api.contentRequests.createManual, {
      title: "Original title",
      origin: "manual",
      source: { question: "Immutable question", body: "Immutable body" },
      correlationId: "create-before-metadata-update",
    })
    const input = {
      humanId: created.humanId,
      title: "Editorial title",
      aliases: ["renewal explainer"],
      priority: "high" as const,
      timingLabel: "Answer this week",
      correlationId: "metadata-update-1",
    }
    const updated = await backend.mutation(api.contentRequests.update, input)
    const replay = await backend.mutation(api.contentRequests.update, input)

    expect(updated).toMatchObject({
      title: "Editorial title",
      aliases: ["renewal explainer"],
      priority: "high",
      timingLabel: "Answer this week",
      source: { question: "Immutable question", body: "Immutable body" },
      aggregateVersion: 2,
    })
    expect(replay).toEqual(updated)
    await expect(
      backend.mutation(api.contentRequests.update, {
        ...input,
        title: "Conflicting replay",
      })
    ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })
  })

  it("paginates beyond the legacy 100-request cap with datastore cursors", async () => {
    const backend = await operatorBackend()
    await backend.run(async (ctx) => {
      const principal = await ctx.db.query("principals").first()
      if (!principal) throw new Error("Missing principal")
      for (let index = 0; index < 105; index += 1) {
        const sortable = String(index).padStart(3, "0")
        await ctx.db.insert("contentRequests", {
          humanId: `CR-PAGE-${sortable}`,
          organizationId: "org_fairlend",
          title: `Paged request ${sortable}`,
          normalizedTitle: `paged request ${sortable}`,
          searchText: `paged request ${sortable}`,
          queueSortKey: sortable,
          aliases: [],
          origin: "manual",
          priority: "critical",
          lifecycle: "pending",
          disposition: "active",
          retention: "active",
          aggregateVersion: 1,
          createdByPrincipalId: principal._id,
          createdAt: index,
          updatedAt: index,
        })
      }
    })
    const first = await backend.query(api.contentRequests.listPage, {
      paginationOpts: { numItems: 100, cursor: null },
    })
    const second = await backend.query(api.contentRequests.listPage, {
      paginationOpts: { numItems: 100, cursor: first.continueCursor },
    })

    expect(first.page).toHaveLength(100)
    expect(first.isDone).toBe(false)
    expect(second.page).toHaveLength(5)
    expect(second.isDone).toBe(true)
  })

  it("preserves supplied original source material and audits creation", async () => {
    const backend = await operatorBackend()
    const created = await backend.mutation(api.contentRequests.createManual, {
      title: "Answer a first-time buyer question",
      origin: "manual",
      source: {
        question: "  Can I qualify while self-employed?\n",
        body: "\nThe original community post, preserved verbatim.  ",
        url: "https://community.example/questions/42",
        name: "Community forum",
        channel: "forum",
      },
      correlationId: "corr-create-002",
    })

    expect(created.source).toEqual({
      question: "  Can I qualify while self-employed?\n",
      body: "\nThe original community post, preserved verbatim.  ",
      url: "https://community.example/questions/42",
      name: "Community forum",
      channel: "forum",
    })
    await expect(
      backend.query(api.contentRequests.listAuditEvents, {
        humanId: created.humanId,
      })
    ).resolves.toMatchObject([
      {
        operation: "content_request.created",
        correlationId: "corr-create-002",
        requestHumanId: created.humanId,
        credentialId: "credential_operator_session",
        beforeVersion: null,
        afterVersion: 1,
      },
    ])
  })

  it("ranks exact ID above title and returns ambiguous fuzzy candidates", async () => {
    const backend = await operatorBackend()
    const calculator = await backend.mutation(
      api.contentRequests.createManual,
      {
        title: "Mortgage renewal calculator",
        origin: "manual",
        source: { channel: "calculator" },
        correlationId: "corr-create-003",
      }
    )
    const options = await backend.mutation(api.contentRequests.createManual, {
      title: "Mortgage renewal options",
      origin: "manual",
      source: { name: "Reddit", channel: "community" },
      aliases: ["renewal choices"],
      correlationId: "corr-create-004",
    })

    await expect(
      backend.query(api.contentRequests.resolve, {
        query: calculator.humanId.toLowerCase(),
      })
    ).resolves.toMatchObject({
      kind: "resolved",
      matchedBy: "exact_id",
      request: { humanId: calculator.humanId },
    })
    await expect(
      backend.query(api.contentRequests.resolve, {
        query: "  MORTGAGE renewal OPTIONS ",
      })
    ).resolves.toMatchObject({
      kind: "resolved",
      matchedBy: "exact_title",
      request: { humanId: options.humanId },
    })

    const ambiguous = await backend.query(api.contentRequests.resolve, {
      query: "mortgage renewal",
    })
    expect(ambiguous.kind).toBe("candidates")
    if (ambiguous.kind !== "candidates") throw new Error("Expected candidates")
    expect(ambiguous.candidates.map((candidate) => candidate.humanId)).toEqual([
      calculator.humanId,
      options.humanId,
    ])
    await expect(
      backend.query(api.contentRequests.resolve, { query: "Reddit community" })
    ).resolves.toMatchObject({
      kind: "candidates",
      candidates: [{ humanId: options.humanId }],
    })
  })

  it("rejects manual creation by the founder role", async () => {
    const backend = convexTest(schema, modules).withIdentity({
      subject: "user_elie",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "founder",
    })
    await backend.mutation(api.principals.syncCurrent)

    await expect(
      backend.mutation(api.contentRequests.createManual, {
        title: "Founder cannot self-assign operator work",
        origin: "manual",
        correlationId: "corr-denied-001",
      })
    ).rejects.toMatchObject({ data: { code: "ROLE_ACCESS_DENIED" } })
    await expect(backend.query(api.contentRequests.list, {})).resolves.toEqual(
      []
    )
  })

  it("assigns exactly one owner, preserves history, and emits assignment notifications", async () => {
    vi.useFakeTimers()
    let releaseFirstDelivery: ((response: Response) => void) | undefined
    let announceFirstDelivery: (() => void) | undefined
    const firstDeliveryStarted = new Promise<void>((resolve) => {
      announceFirstDelivery = resolve
    })
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            releaseFirstDelivery = resolve
            announceFirstDelivery?.()
          })
      )
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(operatorIdentity)
    const founder = workspace.withIdentity({
      subject: "user_elie",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "founder",
      jti: "credential_elie_session",
      email: "elie@fairlend.ca",
    })
    const watcher = workspace.withIdentity({
      subject: "user_marketer",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "operator-editor",
      jti: "credential_marketer_session",
      email: "marketer@fairlend.ca",
    })
    await operator.mutation(api.principals.syncCurrent)
    const founderPrincipal = await founder.mutation(api.principals.syncCurrent)
    const watcherPrincipal = await watcher.mutation(api.principals.syncCurrent)
    const created = await operator.mutation(api.contentRequests.createManual, {
      title: "Founder assignment contract",
      origin: "manual",
      correlationId: "corr-assignment-create",
    })

    const assigned = await operator.mutation(internal.contentRequests.assign, {
      humanId: created.humanId,
      assigneePrincipalId: founderPrincipal.principalId,
      watcherPrincipalIds: [watcherPrincipal.principalId],
      reason: "Elie owns the expert response",
      correlationId: "corr-assignment-1",
    })

    expect(assigned.assignee).toMatchObject({
      principalId: founderPrincipal.principalId,
      subject: "user_elie",
      role: "founder",
    })
    expect(assigned.watchers).toEqual([
      expect.objectContaining({
        principalId: watcherPrincipal.principalId,
        subject: "user_marketer",
      }),
    ])
    await expect(
      operator.query(api.contentRequests.listAssignmentEvents, {
        humanId: created.humanId,
      })
    ).resolves.toMatchObject([
      {
        previousAssigneePrincipalId: created.assignee.principalId,
        newAssigneePrincipalId: founderPrincipal.principalId,
        watcherPrincipalIds: [watcherPrincipal.principalId],
        reason: "Elie owns the expert response",
        correlationId: "corr-assignment-1",
      },
    ])
    const notifications = await founder.query(
      api.contentRequests.listMyNotifications,
      {}
    )
    expect(
      notifications.map((notification) => notification.type).sort()
    ).toEqual(["critical_escalation", "request_assigned"])
    expect(
      notifications.every((notification) => notification.emailQueued)
    ).toBe(true)
    expect(
      notifications.every((notification) =>
        notification.deepLink.endsWith(`/app/requests/${created.humanId}`)
      )
    ).toBe(true)
    const emailOutbox = await operator.run((ctx) =>
      ctx.db.query("notificationEmailOutbox").collect()
    )
    expect(emailOutbox).toHaveLength(2)
    expect(emailOutbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recipientEmail: "elie@fairlend.ca",
          status: "queued",
          deepLink: expect.stringContaining(`/app/requests/${created.humanId}`),
        }),
      ])
    )

    const firstDispatch = operator.action(
      internal.notifications.dispatchEmail,
      { deliveryId: emailOutbox[0]._id }
    )
    await firstDeliveryStarted
    await operator.action(internal.notifications.dispatchEmail, {
      deliveryId: emailOutbox[0]._id,
    })
    releaseFirstDelivery?.(new Response(null, { status: 202 }))
    await firstDispatch
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [endpoint, request] = fetchMock.mock.calls[0]
    expect(endpoint).toBe("https://email.example/send")
    expect(request).toMatchObject({ method: "POST" })
    expect(new Headers(request?.headers).get("idempotency-key")).toBe(
      `notification-email:${emailOutbox[0]._id}`
    )
    expect(JSON.parse(String(request?.body))).toEqual({
      to: "elie@fairlend.ca",
      template: emailOutbox[0].template,
      deepLink: emailOutbox[0].deepLink,
      idempotencyKey: `notification-email:${emailOutbox[0]._id}`,
    })
    await workspace.finishAllScheduledFunctions(vi.runAllTimers)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const deliveryStates = await operator.run((ctx) =>
      Promise.all(emailOutbox.map((delivery) => ctx.db.get(delivery._id)))
    )
    expect(deliveryStates.map((delivery) => delivery?.status).sort()).toEqual([
      "failed",
      "sent",
    ])
    const notificationStates = await operator.run((ctx) =>
      Promise.all(
        emailOutbox.map((delivery) => ctx.db.get(delivery.notificationId))
      )
    )
    expect(
      notificationStates.map((notification) => notification?.emailStatus).sort()
    ).toEqual(["failed", "sent"])

    await founder.mutation(api.contentRequests.markNotificationRead, {
      notificationId: notifications[0].notificationId,
      correlationId: "notification-read-founder",
    })
    const readNotifications = await founder.query(
      api.contentRequests.listMyNotifications,
      {}
    )
    expect(
      readNotifications.find(
        (notification) =>
          notification.notificationId === notifications[0].notificationId
      )?.readAt
    ).toBeTypeOf("number")
    await expect(
      founder.mutation(api.contentRequests.markNotificationRead, {
        notificationId: notifications[1].notificationId,
        correlationId: "notification-read-founder",
      })
    ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })
    await expect(
      operator.mutation(api.contentRequests.markNotificationRead, {
        notificationId: notifications[1].notificationId,
        correlationId: "notification-read-operator",
      })
    ).rejects.toMatchObject({ data: { code: "RESOURCE_ACCESS_DENIED" } })
  })

  it("projects the same suppression-safe notifications through list and paginated queries", async () => {
    const backend = await operatorBackend()
    const request = await backend.mutation(api.contentRequests.createManual, {
      title: "Notification projection contract",
      origin: "manual",
      correlationId: "notification-projection-request",
    })
    const ids = await backend.run(async (ctx) => {
      const activeWithDeepLink = await ctx.db.insert("notifications", {
        organizationId: "org_fairlend",
        requestId: request.requestId,
        recipientPrincipalId: request.assignee.principalId,
        type: "guest_submission",
        deepLink: `/app/requests/${request.humanId}#guest-access-test`,
        emailQueued: true,
        emailStatus: "queued",
        createdAt: 3,
      })
      const activeLegacy = await ctx.db.insert("notifications", {
        organizationId: "org_fairlend",
        requestId: request.requestId,
        recipientPrincipalId: request.assignee.principalId,
        type: "request_assigned",
        emailQueued: false,
        emailStatus: "failed",
        createdAt: 2,
      })
      const suppressed = await ctx.db.insert("notifications", {
        organizationId: "org_fairlend",
        requestId: request.requestId,
        recipientPrincipalId: request.assignee.principalId,
        type: "guest_upload_failed",
        emailQueued: true,
        emailStatus: "queued",
        createdAt: 1,
        suppressedAt: 4,
      })
      return { activeWithDeepLink, activeLegacy, suppressed }
    })

    const listed = await backend.query(
      api.contentRequests.listMyNotifications,
      {}
    )
    const paginated = await backend.query(
      api.contentRequests.listMyNotificationsPage,
      { paginationOpts: { numItems: 50, cursor: null } }
    )

    expect(paginated.page).toEqual(listed)
    expect(listed.map(({ notificationId }) => notificationId)).toEqual([
      ids.activeWithDeepLink,
      ids.activeLegacy,
    ])
    expect(
      listed.find(
        ({ notificationId }) => notificationId === ids.activeWithDeepLink
      )?.deepLink
    ).toBe(`/app/requests/${request.humanId}#guest-access-test`)
    expect(
      listed.find(({ notificationId }) => notificationId === ids.activeLegacy)
        ?.deepLink
    ).toBe(`/app/requests/${request.humanId}`)
    expect(
      listed.some(({ notificationId }) => notificationId === ids.suppressed)
    ).toBe(false)
  })

  it("sorts explicit founder work ahead of newer automated work before limiting", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(operatorIdentity)
    const founder = workspace.withIdentity({
      subject: "user_elie",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "founder",
    })
    await operator.mutation(api.principals.syncCurrent)
    const founderPrincipal = await founder.mutation(api.principals.syncCurrent)
    const manual = await operator.mutation(api.contentRequests.createManual, {
      title: "Older explicit request",
      origin: "manual",
      correlationId: "corr-order-manual",
    })
    const automated = await operator.mutation(
      api.contentRequests.createManual,
      {
        title: "Newer automated request",
        origin: "manual",
        correlationId: "corr-order-automated",
      }
    )
    await operator.run(async (ctx) => {
      const request = await ctx.db.get(automated.requestId)
      if (!request) throw new Error("Automated fixture was not created")
      const createdAt = manual.createdAt + 1_000
      await ctx.db.patch(request._id, {
        origin: "automated_scout",
        createdAt,
        queueSortKey: requestQueueSortKey(
          "automated_scout",
          "critical",
          createdAt
        ),
      })
    })
    for (const request of [manual, automated]) {
      await operator.mutation(internal.contentRequests.assign, {
        humanId: request.humanId,
        assigneePrincipalId: founderPrincipal.principalId,
        correlationId: `corr-order-${request.humanId}`,
      })
    }

    const founderLibrary = await founder.query(api.contentRequests.list, {
      limit: 1,
    })
    expect(founderLibrary.map((request) => request.title)).toEqual([
      "Older explicit request",
    ])
  })

  it("accepts verified callback email only with the server provisioning key", async () => {
    process.env.FAIRLEND_PRINCIPAL_PROVISIONING_KEY = "provisioning-test-key"
    const workspace = convexTest(schema, modules)
    const identityWithoutEmail = workspace.withIdentity({
      subject: "user_callback",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "founder",
    })

    await expect(
      identityWithoutEmail.mutation(api.principals.syncCurrentProfile, {
        verifiedEmail: "verified@fairlend.ca",
        provisioningKey: "wrong-key",
      })
    ).rejects.toMatchObject({
      data: { code: "PRINCIPAL_PROVISIONING_DENIED" },
    })
    const principal = await identityWithoutEmail.mutation(
      api.principals.syncCurrentProfile,
      {
        verifiedEmail: "verified@fairlend.ca",
        provisioningKey: "provisioning-test-key",
      }
    )
    const stored = await identityWithoutEmail.run((ctx) =>
      ctx.db.get(principal.principalId)
    )
    expect(stored?.email).toBe("verified@fairlend.ca")
  })

  it("shows founders only assigned work and tracks first/latest open separately", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(operatorIdentity)
    const founder = workspace.withIdentity({
      subject: "user_elie",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "founder",
      email: "elie@fairlend.ca",
    })
    const administrator = workspace.withIdentity({
      subject: "user_admin",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "administrator",
      email: "admin@fairlend.ca",
    })
    await operator.mutation(api.principals.syncCurrent)
    const founderPrincipal = await founder.mutation(api.principals.syncCurrent)
    await administrator.mutation(api.principals.syncCurrent)
    const assigned = await operator.mutation(api.contentRequests.createManual, {
      title: "Assigned to Elie",
      origin: "manual",
      correlationId: "corr-open-create-1",
    })
    await operator.mutation(internal.contentRequests.assign, {
      humanId: assigned.humanId,
      assigneePrincipalId: founderPrincipal.principalId,
      correlationId: "corr-open-assign",
    })
    await operator.mutation(api.contentRequests.createManual, {
      title: "Not assigned to Elie",
      origin: "manual",
      correlationId: "corr-open-create-2",
    })

    const founderLibrary = await founder.query(api.contentRequests.list, {})
    expect(founderLibrary.map((request) => request.title)).toEqual([
      "Assigned to Elie",
    ])
    await expect(
      administrator.query(api.contentRequests.listFounderWorkspace, {
        founderEmail: "ELIE@FAIRLEND.CA",
      })
    ).resolves.toEqual(founderLibrary)
    await expect(
      operator.query(api.contentRequests.listFounderWorkspace, {
        founderEmail: "elie@fairlend.ca",
      })
    ).rejects.toMatchObject({ data: { code: "ROLE_ACCESS_DENIED" } })
    const opened = await founder.mutation(api.contentRequests.open, {
      humanId: assigned.humanId,
      correlationId: "corr-open-1",
    })
    expect(opened.firstOpenedAt).toBeTypeOf("number")
    expect(opened.latestOpenedAt).toBe(opened.firstOpenedAt)
    const reopened = await founder.mutation(api.contentRequests.open, {
      humanId: assigned.humanId,
      correlationId: "corr-open-2",
    })
    expect(reopened.firstOpenedAt).toBe(opened.firstOpenedAt)
    expect(reopened.latestOpenedAt).toBeGreaterThanOrEqual(
      opened.latestOpenedAt ?? 0
    )
    const duplicateRetry = await founder.mutation(api.contentRequests.open, {
      humanId: assigned.humanId,
      correlationId: "corr-open-2",
    })
    expect(duplicateRetry.aggregateVersion).toBe(reopened.aggregateVersion)
    expect(duplicateRetry.latestOpenedAt).toBe(reopened.latestOpenedAt)
    const auditEvents = await operator.query(
      api.contentRequests.listAuditEvents,
      { humanId: assigned.humanId }
    )
    expect(
      auditEvents.filter(
        (event) =>
          event.operation === "content_request.opened" &&
          event.correlationId === "corr-open-2"
      )
    ).toHaveLength(1)

    await expect(
      founder.mutation(internal.contentRequests.assign, {
        humanId: assigned.humanId,
        assigneePrincipalId: founderPrincipal.principalId,
        correlationId: "corr-founder-denied",
      })
    ).rejects.toMatchObject({ data: { code: "ROLE_ACCESS_DENIED" } })
  })

  it("autosaves only the assigned founder's text and exposes draft metadata without private content", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(operatorIdentity)
    const founder = workspace.withIdentity({
      subject: "user_elie",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "founder",
      jti: "credential_elie_autosave",
    })
    const agent = workspace.withIdentity({
      subject: "agent_writer",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "agent-editor",
      jti: "credential_agent_writer",
    })
    const otherFounder = workspace.withIdentity({
      subject: "user_other_founder",
      issuer: "https://api.workos.com/",
      org_id: "org_fairlend",
      role: "founder",
      jti: "credential_other_founder",
    })
    await operator.mutation(api.principals.syncCurrent)
    const founderPrincipal = await founder.mutation(api.principals.syncCurrent)
    await agent.mutation(api.principals.syncCurrent)
    const otherFounderPrincipal = await otherFounder.mutation(
      api.principals.syncCurrent
    )
    const created = await operator.mutation(api.contentRequests.createManual, {
      title: "Autosaved founder input contract",
      origin: "manual",
      correlationId: "corr-founder-draft-create",
    })
    await operator.mutation(internal.contentRequests.assign, {
      humanId: created.humanId,
      assigneePrincipalId: founderPrincipal.principalId,
      correlationId: "corr-founder-draft-assign",
    })

    const opened = await founder.mutation(api.contentRequests.open, {
      humanId: created.humanId,
      correlationId: "corr-founder-draft-open",
    })
    expect(opened.lifecycle).toBe("pending")
    await expect(
      founder.query(api.founderInputs.getMine, { humanId: created.humanId })
    ).resolves.toBeNull()

    const whitespace = await founder.mutation(api.founderInputs.saveText, {
      humanId: created.humanId,
      text: "   \n",
      correlationId: "corr-founder-draft-whitespace",
    })
    expect(whitespace).toMatchObject({
      text: "   \n",
      revision: 1,
      hasMeaningfulDraft: false,
    })
    const meaningful = await founder.mutation(api.founderInputs.saveText, {
      humanId: created.humanId,
      text: "My lender should confirm consent before any second-position financing.",
      correlationId: "corr-founder-draft-meaningful",
    })
    expect(meaningful).toMatchObject({
      revision: 2,
      hasMeaningfulDraft: true,
    })
    await expect(
      founder.query(api.contentRequests.getByHumanId, {
        humanId: created.humanId,
      })
    ).resolves.toMatchObject({
      lifecycle: "in_progress",
      hasFounderDraft: true,
    })
    await expect(
      operator.query(api.founderInputs.getMetadata, {
        humanId: created.humanId,
      })
    ).resolves.toMatchObject({ hasFounderDraft: true, revision: 2 })
    await expect(
      operator.query(api.founderInputs.getMine, { humanId: created.humanId })
    ).rejects.toMatchObject({ data: { code: "ROLE_ACCESS_DENIED" } })
    await expect(
      agent.mutation(api.founderInputs.saveText, {
        humanId: created.humanId,
        text: "An agent must not rewrite Elie's raw input.",
        correlationId: "corr-agent-founder-draft-denied",
      })
    ).rejects.toMatchObject({ data: { code: "ROLE_ACCESS_DENIED" } })
    await expect(
      operator.mutation(internal.contentRequests.assign, {
        humanId: created.humanId,
        assigneePrincipalId: otherFounderPrincipal.principalId,
        correlationId: "corr-founder-draft-reassignment",
      })
    ).rejects.toMatchObject({
      data: { code: "FOUNDER_INPUT_HANDOFF_REQUIRED" },
    })
    await expect(
      founder.query(api.founderInputs.getMine, { humanId: created.humanId })
    ).resolves.toMatchObject({
      text: "My lender should confirm consent before any second-position financing.",
      revision: 2,
    })
    const founderSaveAudit = await operator.run(async (ctx) =>
      ctx.db
        .query("auditEvents")
        .withIndex("by_request_operation_correlation", (index) =>
          index
            .eq("requestId", created.requestId)
            .eq("operation", "founder_input.text_saved")
            .eq("correlationId", "corr-founder-draft-meaningful")
        )
        .unique()
    )
    expect(founderSaveAudit?.inputFingerprint).toBeUndefined()
  })

  it("fences stale email workers and exposes due deliveries to the reaper", async () => {
    const backend = await operatorBackend()
    const request = await backend.mutation(api.contentRequests.createManual, {
      title: "Email fencing contract",
      origin: "manual",
      correlationId: "corr-email-fencing",
    })
    const deliveryId = await backend.run(async (ctx) => {
      const notificationId = await ctx.db.insert("notifications", {
        organizationId: "org_fairlend",
        requestId: request.requestId,
        recipientPrincipalId: request.assignee.principalId,
        type: "request_assigned",
        emailQueued: true,
        emailStatus: "queued",
        createdAt: Date.now(),
      })
      return ctx.db.insert("notificationEmailOutbox", {
        organizationId: "org_fairlend",
        requestId: request.requestId,
        notificationId,
        recipientPrincipalId: request.assignee.principalId,
        recipientEmail: "operator@fairlend.ca",
        template: "request_assigned",
        deepLink: `/app/requests/${request.humanId}`,
        status: "queued",
        attempts: 0,
        nextAttemptAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })

    const firstClaim = await backend.mutation(
      internal.notifications.claimEmailDelivery,
      { deliveryId, claimToken: "claim-first" }
    )
    expect(firstClaim).not.toBeNull()
    await backend.run((ctx) =>
      ctx.db.patch(deliveryId, { leaseExpiresAt: Date.now() - 1 })
    )
    const retryable = await backend.query(
      internal.notifications.listRetryableEmailDeliveries,
      {}
    )
    expect(retryable).toContain(deliveryId)
    const secondClaim = await backend.mutation(
      internal.notifications.claimEmailDelivery,
      { deliveryId, claimToken: "claim-second" }
    )
    if (!firstClaim || !secondClaim) throw new Error("Expected email claims")
    expect(secondClaim.claimToken).not.toBe(firstClaim.claimToken)
    await backend.mutation(internal.notifications.finishEmailDelivery, {
      deliveryId,
      status: "sent",
      claimToken: secondClaim.claimToken,
    })
    await backend.mutation(internal.notifications.finishEmailDelivery, {
      deliveryId,
      status: "failed",
      claimToken: firstClaim.claimToken,
      errorCode: "STALE_WORKER",
    })
    const finalDelivery = await backend.run((ctx) => ctx.db.get(deliveryId))
    expect(finalDelivery).toMatchObject({ status: "sent" })
    expect(finalDelivery?.lastErrorCode).not.toBe("STALE_WORKER")
    if (!finalDelivery) throw new Error("Expected final delivery")
    const dueAfterExhausted = await backend.run(async (ctx) => {
      for (let index = 0; index < 30; index += 1) {
        await ctx.db.insert("notificationEmailOutbox", {
          organizationId: finalDelivery.organizationId,
          requestId: finalDelivery.requestId,
          notificationId: finalDelivery.notificationId,
          recipientPrincipalId: finalDelivery.recipientPrincipalId,
          recipientEmail: finalDelivery.recipientEmail,
          template: finalDelivery.template,
          deepLink: finalDelivery.deepLink,
          status: "exhausted",
          attempts: 5,
          createdAt: index + 1,
          updatedAt: index + 1,
        })
      }
      return ctx.db.insert("notificationEmailOutbox", {
        organizationId: finalDelivery.organizationId,
        requestId: finalDelivery.requestId,
        notificationId: finalDelivery.notificationId,
        recipientPrincipalId: finalDelivery.recipientPrincipalId,
        recipientEmail: finalDelivery.recipientEmail,
        template: finalDelivery.template,
        deepLink: finalDelivery.deepLink,
        status: "failed",
        attempts: 1,
        nextAttemptAt: Date.now() - 1,
        createdAt: 100,
        updatedAt: 100,
      })
    })
    await expect(
      backend.query(internal.notifications.listRetryableEmailDeliveries, {})
    ).resolves.toContain(dueAfterExhausted)

    const { fifthAttempt, failedDue, leaseExpiredDue } = await backend.run(
      async (ctx) => {
        const common = {
          organizationId: finalDelivery.organizationId,
          requestId: finalDelivery.requestId,
          notificationId: finalDelivery.notificationId,
          recipientPrincipalId: finalDelivery.recipientPrincipalId,
          recipientEmail: finalDelivery.recipientEmail,
          template: finalDelivery.template,
          deepLink: finalDelivery.deepLink,
        }
        for (let index = 0; index < 25; index += 1) {
          await ctx.db.insert("notificationEmailOutbox", {
            ...common,
            status: "queued",
            attempts: 0,
            nextAttemptAt: Date.now() - 1,
            createdAt: 200 + index,
            updatedAt: 200 + index,
          })
        }
        const failedDue = await ctx.db.insert("notificationEmailOutbox", {
          ...common,
          status: "failed",
          attempts: 2,
          nextAttemptAt: Date.now() - 1,
          createdAt: 300,
          updatedAt: 300,
        })
        const leaseExpiredDue = await ctx.db.insert("notificationEmailOutbox", {
          ...common,
          status: "sending",
          attempts: 2,
          claimToken: "expired-balanced-claim",
          leaseExpiresAt: Date.now() - 1,
          createdAt: 301,
          updatedAt: 301,
        })
        const fifthAttempt = await ctx.db.insert("notificationEmailOutbox", {
          ...common,
          status: "sending",
          attempts: 5,
          claimToken: "fifth-attempt-crash",
          leaseExpiresAt: Date.now() - 1,
          createdAt: 302,
          updatedAt: 302,
        })
        return { fifthAttempt, failedDue, leaseExpiredDue }
      }
    )
    const balancedRetryable = await backend.query(
      internal.notifications.listRetryableEmailDeliveries,
      {}
    )
    expect(balancedRetryable).toEqual(
      expect.arrayContaining([failedDue, leaseExpiredDue, fifthAttempt])
    )
    await expect(
      backend.mutation(internal.notifications.claimEmailDelivery, {
        deliveryId: fifthAttempt,
        claimToken: "fifth-attempt-reclaim",
      })
    ).resolves.toBeNull()
    const fifthTerminal = await backend.run((ctx) => ctx.db.get(fifthAttempt))
    expect(fifthTerminal).toMatchObject({
      status: "exhausted",
      lastErrorCode: "EMAIL_ATTEMPTS_EXHAUSTED",
    })
    expect(fifthTerminal?.claimToken).toBeUndefined()
    expect(fifthTerminal?.leaseExpiresAt).toBeUndefined()
  })

  it("backfills assignment fields on records created before Ticket 03", async () => {
    const backend = await operatorBackend()
    const current = await backend.query(api.principals.getCurrent, {})
    if (!current) throw new Error("Expected operator principal")
    const legacyRequestId = await backend.run((ctx) =>
      ctx.db.insert("contentRequests", {
        humanId: "CR-LEGACY",
        organizationId: "org_fairlend",
        title: "Legacy request",
        normalizedTitle: "legacy request",
        searchText: "Legacy request",
        aliases: [],
        origin: "manual",
        priority: "critical",
        lifecycle: "pending",
        disposition: "active",
        retention: "active",
        aggregateVersion: 1,
        createdByPrincipalId: current.principalId,
        createdAt: 1,
        updatedAt: 1,
      })
    )

    await expect(
      backend.mutation(internal.migrations.backfillAssignmentFields, {})
    ).resolves.toEqual({ migrated: 1, done: true })
    const migrated = await backend.run((ctx) => ctx.db.get(legacyRequestId))
    expect(migrated).toMatchObject({
      assigneePrincipalId: current.principalId,
      watcherPrincipalIds: [],
      queueSortKey: expect.any(String),
    })
  })
})
