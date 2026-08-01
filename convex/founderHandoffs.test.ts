// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const operatorIdentity = {
  subject: "handoff-operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "handoff-operator-session",
}

const founderIdentity = {
  ...operatorIdentity,
  subject: "handoff-founder",
  role: "founder",
  jti: "handoff-founder-session",
  email: "elie@fairlend.ca",
}

describe("founder handoffs", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
    process.env.FAIRLEND_TRANSACTIONAL_EMAIL_ENDPOINT = ""
    process.env.FAIRLEND_TRANSACTIONAL_EMAIL_API_KEY = ""
  })

  it("persists one immutable handoff and only records the recipient opening it", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(operatorIdentity)
    const founder = workspace.withIdentity(founderIdentity)
    const operatorPrincipal = await operator.mutation(
      api.principals.syncCurrent
    )
    const founderPrincipal = await founder.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Durable founder handoff",
      origin: "manual",
      correlationId: "handoff-request",
    })
    await operator.mutation(internal.contentRequests.assign, {
      humanId: request.humanId,
      assigneePrincipalId: founderPrincipal.principalId,
      correlationId: "handoff-assign",
    })

    const applied = await operator.mutation(api.founderHandoffs.finalize, {
      humanId: request.humanId,
      recipientPrincipalId: founderPrincipal.principalId,
      selectedFormats: ["original_response"],
      note: "Please review the prepared response.",
      correlationId: "handoff-finalize",
    })
    expect(applied).toMatchObject({
      outcome: "applied",
      handoff: {
        recipient: {
          principalId: founderPrincipal.principalId,
          subject: founderIdentity.subject,
        },
        selectedFormats: ["original_response"],
        note: "Please review the prepared response.",
        stage: "delivered",
        openedAt: null,
      },
    })
    const [handoffDelivery] = await operator.run((ctx) =>
      ctx.db.query("notificationEmailOutbox").collect()
    )
    if (!handoffDelivery)
      throw new Error("Founder handoff email was not queued")
    await operator.action(internal.notifications.dispatchEmail, {
      deliveryId: handoffDelivery._id,
    })
    const deliveredProjection = await operator.query(
      api.operatorWorkspace.list,
      {
        search: request.humanId,
        paginationOpts: { numItems: 1, cursor: null },
      }
    )
    expect(deliveredProjection.page[0]?.founderHandoff).toMatchObject({
      handoffId: applied.handoff.handoffId,
      stage: "delivered",
      emailStatus: "failed",
    })

    await operator.mutation(api.contentRequests.open, {
      humanId: request.humanId,
      correlationId: "handoff-operator-open",
    })
    await expect(
      operator.query(api.founderHandoffs.getCurrent, {
        humanId: request.humanId,
      })
    ).resolves.toMatchObject({ stage: "delivered", openedAt: null })

    await founder.mutation(api.contentRequests.open, {
      humanId: request.humanId,
      correlationId: "handoff-founder-open",
    })
    await expect(
      operator.query(api.founderHandoffs.getCurrent, {
        humanId: request.humanId,
      })
    ).resolves.toMatchObject({ stage: "opened", openedAt: expect.any(Number) })
    const openedProjection = await operator.query(api.operatorWorkspace.list, {
      search: request.humanId,
      paginationOpts: { numItems: 1, cursor: null },
    })
    expect(openedProjection.page[0]?.founderHandoff).toMatchObject({
      handoffId: applied.handoff.handoffId,
      stage: "opened",
      emailStatus: "failed",
    })

    const replay = await operator.mutation(api.founderHandoffs.finalize, {
      humanId: request.humanId,
      recipientPrincipalId: founderPrincipal.principalId,
      selectedFormats: ["original_response", "blog_article"],
      correlationId: "handoff-finalize-replay",
    })
    expect(replay).toMatchObject({
      outcome: "already_applied",
      handoff: {
        handoffId: applied.handoff.handoffId,
        selectedFormats: ["original_response"],
      },
    })

    const notifications = await founder.query(
      api.contentRequests.listMyNotifications,
      {}
    )
    const handoffNotifications = notifications.filter(
      (notification) => notification.type === "founder_handoff"
    )
    expect(handoffNotifications).toHaveLength(1)
    expect(handoffNotifications[0]?.readAt).toBeTypeOf("number")

    await operator.mutation(internal.contentRequests.assign, {
      humanId: request.humanId,
      assigneePrincipalId: operatorPrincipal.principalId,
      correlationId: "handoff-reassign-away",
    })
    await expect(
      operator.query(api.founderHandoffs.getCurrent, {
        humanId: request.humanId,
      })
    ).resolves.toBeNull()

    await operator.mutation(internal.contentRequests.assign, {
      humanId: request.humanId,
      assigneePrincipalId: founderPrincipal.principalId,
      correlationId: "handoff-reassign-back",
    })
    const reapplied = await operator.mutation(api.founderHandoffs.finalize, {
      humanId: request.humanId,
      recipientPrincipalId: founderPrincipal.principalId,
      selectedFormats: ["original_response"],
      correlationId: "handoff-finalize-new-cycle",
    })
    expect(reapplied).toMatchObject({
      outcome: "applied",
      handoff: { stage: "delivered" },
    })
    expect(reapplied.handoff.handoffId).not.toBe(applied.handoff.handoffId)
    const nextNotifications = await founder.query(
      api.contentRequests.listMyNotifications,
      {}
    )
    expect(
      nextNotifications.filter(
        (notification) => notification.type === "founder_handoff"
      )
    ).toHaveLength(2)
  })
})
