import { z } from "zod"

import type { AgentControlOperation } from "@/application/agent-control-plane"

const nonEmpty = z.string().trim().min(1)
const humanId = nonEmpty.describe(
  "Stable Content Request ID, for example CR-ABC123"
)
const principalId = nonEmpty.describe(
  "Stable principal ID returned by principal.list"
)
const contextId = nonEmpty.describe(
  "Stable context item ID returned by context.list"
)
const jobId = nonEmpty.describe("Stable agent job ID returned by job.list")
const deliverableId = nonEmpty.describe(
  "Stable deliverable ID returned by deliverable.list"
)
const versionId = nonEmpty.describe(
  "Stable immutable version ID returned by deliverable.list"
)
const targetId = nonEmpty.describe(
  "Stable delivery target ID returned by target.list"
)
const conflictId = nonEmpty.describe(
  "Stable semantic conflict ID returned by conflict.list"
)
const shareId = nonEmpty.describe(
  "Stable public share ID returned by share.list"
)
const cursor = z
  .string()
  .nullable()
  .optional()
  .describe("Opaque cursor from the prior page")
const limit = z.number().int().min(1).max(100).optional()
const pagination = { cursor, limit }
const offsetCursor = z
  .string()
  .regex(/^offset:\d+$/)
  .optional()
  .describe("Offset cursor returned by the prior page")
const offsetPagination = { cursor: offsetCursor, limit }
const source = z
  .strictObject({
    question: z.string().optional(),
    body: z.string().optional(),
    url: z.string().optional(),
    name: z.string().optional(),
    channel: z.string().optional(),
  })
  .optional()
const citation = z.strictObject({
  label: nonEmpty,
  url: nonEmpty,
  supports: nonEmpty,
})
const priority = z.enum(["critical", "high", "normal", "low"])

const noArguments = z.strictObject({})

export const chatGptOperationArgumentSchemas: Record<
  AgentControlOperation,
  z.ZodType<Record<string, unknown>>
> = {
  "request.list": z.strictObject(pagination),
  "request.workspace": z.strictObject({
    queue: z
      .enum([
        "needs_elie",
        "agent_drafting",
        "needs_operator",
        "delivered",
        "attention_required",
      ])
      .optional(),
    search: z.string().optional(),
    priority: priority.optional(),
    origin: z
      .enum(["manual", "automated_scout", "chatgpt_app", "cli", "http_api"])
      .optional(),
    lifecycle: z
      .enum([
        "pending",
        "in_progress",
        "founder_complete",
        "ready_to_respond",
        "responded",
      ])
      .optional(),
    disposition: z.enum(["active", "expired"]).optional(),
    retention: z.enum(["active", "archived"]).optional(),
    assigneePrincipalId: principalId.optional(),
    deliveryChannel: z.string().optional(),
    ...pagination,
  }),
  "request.resolve": z.strictObject({
    query: nonEmpty.describe("Stable ID, exact title, or fuzzy request name"),
  }),
  "request.get": z.strictObject({ humanId }),
  "request.create": z.strictObject({
    title: nonEmpty,
    aliases: z.array(nonEmpty).max(100).optional(),
    source,
  }),
  "request.update": z
    .strictObject({
      humanId,
      title: nonEmpty.optional(),
      aliases: z.array(nonEmpty).max(100).optional(),
      priority: priority.optional(),
      timingLabel: z.string().nullable().optional(),
    })
    .refine(
      ({ title, aliases, priority, timingLabel }) =>
        title !== undefined ||
        aliases !== undefined ||
        priority !== undefined ||
        timingLabel !== undefined,
      { message: "Provide at least one mutable metadata field." }
    ),
  "request.assign": z.strictObject({
    humanId,
    assigneePrincipalId: principalId,
    watcherPrincipalIds: z.array(principalId).optional(),
    reason: z.string().optional(),
  }),
  "request.open": z.strictObject({ humanId }),
  "request.set_expiration": z.strictObject({
    humanId,
    expiresAt: z.number().min(0).nullable(),
  }),
  "request.expire": z.strictObject({ humanId, reason: nonEmpty }),
  "request.restore_expired": z.strictObject({
    humanId,
    expiresAt: z.number().min(0).nullable(),
  }),
  "request.archive": z.strictObject({ humanId }),
  "request.restore_archived": z.strictObject({ humanId }),
  "request.follow_up": z.strictObject({
    parentHumanId: humanId.describe("Stable parent Content Request ID"),
    title: nonEmpty,
    reason: nonEmpty,
    source,
  }),
  "request.relations": z.strictObject({ humanId }),
  "principal.list": z.strictObject(offsetPagination),
  "notification.list": z.strictObject(pagination),
  "notification.read": z.strictObject({
    notificationId: nonEmpty.describe(
      "Stable notification ID returned by notification.list"
    ),
  }),
  "context.list": z.strictObject({ humanId, ...offsetPagination }),
  "context.upsert": z.strictObject({
    humanId,
    kind: z.enum([
      "source_metadata",
      "source_summary",
      "talking_points",
      "research_requirements",
      "missing_research",
      "citations",
      "guardrails",
      "operator_cue",
      "delivery_hint",
    ]),
    title: nonEmpty,
    bulletPoints: z.array(nonEmpty).max(100),
    citations: z.array(citation).max(100),
  }),
  "context.versions": z.strictObject({ contextId, ...pagination }),
  "context.preferences.get": z.strictObject({ humanId }),
  "context.preferences.save": z.strictObject({
    humanId,
    preferences: z.strictObject({
      visibleContextIds: z.array(contextId),
      pinnedContextIds: z.array(contextId),
      knownContextIds: z.array(contextId),
    }),
  }),
  "job.list": z.strictObject(pagination),
  "job.claim": z.strictObject({
    leaseMs: z.number().int().min(1).max(3_600_000),
  }),
  "job.input": z.strictObject({ jobId }),
  "job.heartbeat": z.strictObject({
    jobId,
    leaseToken: nonEmpty,
    leaseMs: z.number().int().min(1).max(3_600_000),
    leaseGeneration: z.number().int().min(1),
  }),
  "job.complete": z.strictObject({
    jobId,
    leaseToken: nonEmpty,
    body: nonEmpty,
    leaseGeneration: z.number().int().min(1),
  }),
  "job.fail": z.strictObject({
    jobId,
    leaseToken: nonEmpty,
    errorCode: nonEmpty,
    transient: z.boolean().optional(),
    leaseGeneration: z.number().int().min(1),
  }),
  "deliverable.list": z.strictObject({ humanId, ...offsetPagination }),
  "deliverable.create": z.strictObject({
    humanId,
    kind: nonEmpty,
    name: nonEmpty,
    body: z.string().optional(),
  }),
  "deliverable.version": z.strictObject({
    deliverableId,
    body: nonEmpty,
    changeSummary: z.string().optional(),
  }),
  "deliverable.promote": z.strictObject({
    deliverableId,
    versionId,
    expectedPromotedVersionId: versionId.nullable(),
  }),
  "deliverable.set_primary": z.strictObject({
    humanId,
    deliverableId,
    expectedPrimaryDeliverableId: deliverableId,
  }),
  "target.list": z.strictObject({ humanId, ...offsetPagination }),
  "target.list_archived": z.strictObject({ humanId, cursor }),
  "target.create": z.strictObject({
    humanId,
    deliverableId,
    channel: nonEmpty,
    destinationLabel: nonEmpty,
    destinationUrl: z.string().optional(),
    isRequired: z.boolean().optional(),
  }),
  "target.set_required": z.strictObject({ targetId, isRequired: z.boolean() }),
  "target.set_retention": z.strictObject({
    targetId,
    retention: z.enum(["active", "archived"]),
  }),
  "target.confirm": z.strictObject({
    targetId,
    versionId,
    note: z.string().optional(),
    integrationSuccessId: z.string().optional(),
  }),
  "target.reopen": z.strictObject({ targetId }),
  "conflict.list": z.strictObject({ humanId, ...offsetPagination }),
  "conflict.resolve": z.strictObject({ conflictId, selectedValue: nonEmpty }),
  "share.list": z.strictObject({ humanId, ...offsetPagination }),
  "share.create": z.strictObject({
    humanId,
    contextItemIds: z.array(contextId),
    deliverableIds: z.array(deliverableId),
    expiresAt: z.number().min(0).optional(),
  }),
  "share.revoke": z.strictObject({ shareId }),
  "audit.list": z.strictObject({ humanId, ...pagination }),
}

export function operationEnvelopeSchema(
  operations: ReadonlyArray<AgentControlOperation>,
  options: {
    mutation: boolean
    confirmationToken?: boolean
    confirmationScope?: boolean
  }
): z.ZodType<Record<string, unknown>> {
  const branches: Array<z.ZodType<Record<string, unknown>>> = operations.map(
    (operation) =>
      z.strictObject({
        operation: z.literal(operation),
        arguments: chatGptOperationArgumentSchemas[operation],
        fields: z.array(nonEmpty).max(50).optional(),
        ...(options.mutation
          ? {
              idempotencyKey: nonEmpty
                .max(200)
                .describe("Stable retry key for this exact intended mutation"),
            }
          : {}),
        ...(options.confirmationToken
          ? {
              confirmationToken: nonEmpty.describe(
                "Short-lived challenge returned by content_requests_preview"
              ),
            }
          : {}),
        ...(options.confirmationScope
          ? {
              scopeHumanId: humanId.describe(
                "Content Request whose current authorized state must be shown and bound to this consequential action"
              ),
            }
          : {}),
      }) as z.ZodType<Record<string, unknown>>
  )
  const command =
    branches.length < 2
      ? branches[0]!
      : z.union([branches[0]!, branches[1]!, ...branches.slice(2)])
  return z.strictObject({
    command: command.describe(
      "Discriminated operation command with exact stable-ID arguments"
    ),
  })
}

export { noArguments }
