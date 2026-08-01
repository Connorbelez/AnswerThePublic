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
const personId = nonEmpty.describe(
  "Stable organization-scoped Person ID selected for this grant"
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
const expertInterviewFraming = z.enum([
  "educational",
  "how_to",
  "insider_knowledge",
  "fairlend_sales",
])
const expertInterviewGapKind = z.enum([
  "confusing_coverage",
  "local_specific",
  "reality_on_the_ground",
  "practitioner_best_practice",
  "fragmented_how_to",
  "missing_evidence",
  "other",
])

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
  "expert_interview.research_prompt": z.strictObject({
    topic: nonEmpty.describe(
      "Question or topic whose indexed knowledge gaps should be researched"
    ),
    audience: z.string().optional(),
    geography: z.string().optional(),
    framing: expertInterviewFraming.optional(),
    operatorInstructions: z
      .string()
      .optional()
      .describe(
        "Operator-supplied requirements; these take priority over agent inferences"
      ),
  }),
  "expert_interview.create": z.strictObject({
    title: nonEmpty,
    aliases: z.array(nonEmpty).max(100).optional(),
    brief: z.strictObject({
      topic: nonEmpty,
      summary: nonEmpty,
      audience: nonEmpty,
      framing: expertInterviewFraming,
      fairlendPosture: nonEmpty,
      founderContribution: nonEmpty,
    }),
    gaps: z
      .array(
        z.strictObject({
          id: nonEmpty,
          kind: expertInterviewGapKind,
          title: nonEmpty,
          existingCoverage: nonEmpty,
          whyItFallsShort: nonEmpty,
          expertOpportunity: nonEmpty,
          citations: z.array(citation).max(100),
        })
      )
      .min(1)
      .max(50),
    questions: z
      .array(
        z.strictObject({
          id: nonEmpty,
          question: nonEmpty,
          motivation: nonEmpty,
          gapIds: z.array(nonEmpty).min(1).max(50),
        })
      )
      .min(1)
      .max(100),
    operatorInstructions: z
      .string()
      .optional()
      .describe(
        "Operator-supplied requirements persisted as highest-priority agent context"
      ),
    source,
  }),
  "expert_interview.processing_input": z.strictObject({
    humanId,
    submissionIds: z
      .array(nonEmpty)
      .min(1)
      .max(100)
      .describe("Explicit ordered immutable Submission IDs to synthesize"),
    synthesisInstructions: z
      .string()
      .optional()
      .describe(
        "Operator-supplied synthesis requirements; these take priority over defaults"
      ),
  }),
  "expert_interview.submissions": z.strictObject({ humanId }),
  "expert_interview.submission_selection": z.strictObject({
    humanId,
    submissionId: nonEmpty,
    included: z.boolean(),
  }),
  "expert_interview.complete_processing": z
    .strictObject({
      humanId,
      processingToken: nonEmpty.describe(
        "The signed processing snapshot token returned by expert_interview.processing_input"
      ),
      payloadDigest: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .describe(
          "The canonical processing payload SHA-256 returned by expert_interview.processing_input"
        ),
      submissionIds: z
        .array(nonEmpty)
        .min(1)
        .max(100)
        .describe("The exact Submission IDs used to create this draft"),
      body: nonEmpty.describe("Publication-ready Markdown article draft"),
      jobId: jobId
        .optional()
        .describe(
          "Required when the request has an active founder drafting job"
        ),
      leaseToken: nonEmpty
        .optional()
        .describe("Active lease token returned by job.claim"),
      leaseGeneration: z.number().int().min(1).optional(),
      deliverableId: deliverableId
        .optional()
        .describe(
          "Optional exact article Deliverable to version; omit to create a new Deliverable"
        ),
      name: z.string().optional(),
      changeSummary: z.string().optional(),
    })
    .superRefine((value, context) => {
      const leaseTuple = [value.jobId, value.leaseToken, value.leaseGeneration]
      if (
        leaseTuple.some((item) => item !== undefined) &&
        !leaseTuple.every((item) => item !== undefined)
      )
        context.addIssue({
          code: "custom",
          message:
            "jobId, leaseToken, and leaseGeneration must be supplied together",
          path: ["jobId"],
        })
    }),
  "person.search": z.strictObject({
    query: z.string(),
    limit,
  }),
  "person.create": z.strictObject({
    humanId,
    displayName: nonEmpty,
    email: z.string().email(),
  }),
  "guest_access.list": z.strictObject({
    humanId,
    ...offsetPagination,
  }),
  "guest_access.create": z.strictObject({
    humanId,
    personId,
  }),
  "guest_access.revoke": z.strictObject({ grantId: nonEmpty }),
  "guest_access.renew": z.strictObject({ grantId: nonEmpty }),
  "principal.list": z.strictObject(offsetPagination),
  "notification.list": z.strictObject(pagination),
  "notification.read": z.strictObject({
    notificationId: nonEmpty.describe(
      "Stable notification ID returned by notification.list"
    ),
  }),
  "metrics.get": z.strictObject({
    from: z.number().int().min(0).optional(),
    to: z.number().int().min(0).optional(),
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
    humanId: humanId
      .optional()
      .describe(
        "Bind the claim to the exact Expert Interview request instead of claiming the oldest organization job"
      ),
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
