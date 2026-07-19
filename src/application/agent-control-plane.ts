import type { ContentRequestService } from "@/application/content-requests"

export type AgentControlCommand = {
  operation: string
  arguments?: Record<string, unknown>
  fields?: Array<string>
  idempotencyKey?: string
}

const operations = [
  "request.list",
  "request.workspace",
  "request.resolve",
  "request.get",
  "request.create",
  "request.update",
  "request.assign",
  "request.open",
  "request.set_expiration",
  "request.expire",
  "request.restore_expired",
  "request.archive",
  "request.restore_archived",
  "request.follow_up",
  "request.relations",
  "principal.list",
  "notification.list",
  "notification.read",
  "metrics.get",
  "context.list",
  "context.upsert",
  "context.versions",
  "context.preferences.get",
  "context.preferences.save",
  "job.list",
  "job.claim",
  "job.input",
  "job.heartbeat",
  "job.complete",
  "job.fail",
  "deliverable.list",
  "deliverable.create",
  "deliverable.version",
  "deliverable.promote",
  "deliverable.set_primary",
  "target.list",
  "target.list_archived",
  "target.create",
  "target.set_required",
  "target.set_retention",
  "target.confirm",
  "target.reopen",
  "conflict.list",
  "conflict.resolve",
  "share.list",
  "share.create",
  "share.revoke",
  "audit.list",
] as const

export type AgentControlOperation = (typeof operations)[number]
export const agentControlOperations = [...operations]

const mutations = new Set<AgentControlOperation>([
  "request.create",
  "request.update",
  "request.assign",
  "request.open",
  "request.set_expiration",
  "request.expire",
  "request.restore_expired",
  "request.archive",
  "request.restore_archived",
  "request.follow_up",
  "notification.read",
  "context.upsert",
  "context.preferences.save",
  "job.claim",
  "job.heartbeat",
  "job.complete",
  "job.fail",
  "deliverable.create",
  "deliverable.version",
  "deliverable.promote",
  "deliverable.set_primary",
  "target.create",
  "target.set_required",
  "target.set_retention",
  "target.confirm",
  "target.reopen",
  "conflict.resolve",
  "share.create",
  "share.revoke",
])

const paginatedOperations = new Set<AgentControlOperation>([
  "principal.list",
  "context.list",
  "deliverable.list",
  "target.list",
  "conflict.list",
  "share.list",
])
const datastorePaginatedOperations = new Set<AgentControlOperation>([
  "request.list",
  "notification.list",
  "job.list",
  "context.versions",
])

const contextKinds = new Set([
  "source_metadata",
  "source_summary",
  "talking_points",
  "research_requirements",
  "missing_research",
  "citations",
  "guardrails",
  "operator_cue",
  "delivery_hint",
])
const workspaceEnums: Record<string, Set<string>> = {
  queue: new Set([
    "needs_elie",
    "agent_drafting",
    "needs_operator",
    "delivered",
    "attention_required",
  ]),
  priority: new Set(["critical", "high", "normal", "low"]),
  origin: new Set([
    "manual",
    "automated_scout",
    "chatgpt_app",
    "cli",
    "http_api",
  ]),
  lifecycle: new Set([
    "pending",
    "in_progress",
    "founder_complete",
    "ready_to_respond",
    "responded",
  ]),
  disposition: new Set(["active", "expired"]),
  retention: new Set(["active", "archived"]),
}

export class AgentControlValidationError extends Error {
  constructor(readonly field: string) {
    super(`INVALID_ARGUMENT:${field}`)
  }
}

export function isAgentControlMutation(operation: string) {
  return mutations.has(operation as AgentControlOperation)
}

function fail(field: string): never {
  throw new AgentControlValidationError(field)
}

function text(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (typeof value !== "string" || !value.trim()) fail(key)
  return value
}

function finiteNumber(
  args: Record<string, unknown>,
  key: string,
  options: { integer?: boolean; minimum?: number } = {}
) {
  const value = args[key]
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (options.integer && !Number.isInteger(value)) ||
    (options.minimum !== undefined && value < options.minimum)
  )
    fail(key)
  return value
}

function boolean(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (typeof value !== "boolean") fail(key)
  return value
}

function optionalText(args: Record<string, unknown>, key: string) {
  if (args[key] !== undefined && typeof args[key] !== "string") fail(key)
}

function validateSource(args: Record<string, unknown>) {
  if (args.source === undefined) return
  const source = requiredRecord(args, "source")
  for (const field of ["question", "body", "url", "name", "channel"])
    optionalText(source, field)
}

function stringArray(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string" && item.trim())
  )
    fail(key)
  return value as Array<string>
}

function optionalPagination(args: Record<string, unknown>) {
  if (args.limit !== undefined)
    finiteNumber(args, "limit", { integer: true, minimum: 1 })
  if (typeof args.limit === "number" && args.limit > 100) fail("limit")
  if (
    args.cursor !== undefined &&
    (typeof args.cursor !== "string" || !/^offset:\d+$/.test(args.cursor))
  )
    fail("cursor")
}

function requiredRecord(args: Record<string, unknown>, key: string) {
  const value = args[key]
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(key)
  return value as Record<string, unknown>
}

export function validateAgentControlCommand(command: AgentControlCommand) {
  if (!operations.includes(command.operation as AgentControlOperation))
    fail("operation")
  const operation = command.operation as AgentControlOperation
  const a = command.arguments ?? {}
  if (paginatedOperations.has(operation)) optionalPagination(a)
  if (datastorePaginatedOperations.has(operation)) {
    if (a.limit !== undefined)
      finiteNumber(a, "limit", { integer: true, minimum: 1 })
    if (typeof a.limit === "number" && a.limit > 100) fail("limit")
    if (
      a.cursor !== undefined &&
      a.cursor !== null &&
      typeof a.cursor !== "string"
    )
      fail("cursor")
  }
  switch (operation) {
    case "metrics.get":
      for (const field of ["from", "to"])
        if (a[field] !== undefined)
          finiteNumber(a, field, { integer: true, minimum: 0 })
      if (
        typeof a.from === "number" &&
        typeof a.to === "number" &&
        a.to <= a.from
      )
        fail("to")
      break
    case "request.workspace":
      if (a.limit !== undefined)
        finiteNumber(a, "limit", { integer: true, minimum: 1 })
      if (typeof a.limit === "number" && a.limit > 100) fail("limit")
      if (a.cursor !== undefined && typeof a.cursor !== "string") fail("cursor")
      for (const [field, allowed] of Object.entries(workspaceEnums))
        if (a[field] !== undefined && !allowed.has(String(a[field])))
          fail(field)
      for (const field of ["search", "assigneePrincipalId", "deliveryChannel"])
        optionalText(a, field)
      break
    case "request.resolve":
      text(a, "query")
      break
    case "request.get":
    case "request.open":
    case "request.archive":
    case "request.restore_archived":
    case "request.relations":
    case "context.list":
    case "context.preferences.get":
    case "deliverable.list":
    case "target.list":
    case "share.list":
    case "conflict.list":
      text(a, "humanId")
      break
    case "request.create":
      text(a, "title")
      if (a.aliases !== undefined) stringArray(a, "aliases")
      validateSource(a)
      break
    case "request.update":
      text(a, "humanId")
      if (a.title !== undefined) text(a, "title")
      if (a.aliases !== undefined) stringArray(a, "aliases")
      if (
        a.priority !== undefined &&
        !workspaceEnums.priority.has(String(a.priority))
      )
        fail("priority")
      if (
        a.timingLabel !== undefined &&
        a.timingLabel !== null &&
        typeof a.timingLabel !== "string"
      )
        fail("timingLabel")
      if (
        a.title === undefined &&
        a.aliases === undefined &&
        a.priority === undefined &&
        a.timingLabel === undefined
      )
        fail("update")
      break
    case "request.assign":
      text(a, "humanId")
      text(a, "assigneePrincipalId")
      if (a.watcherPrincipalIds !== undefined)
        stringArray(a, "watcherPrincipalIds")
      optionalText(a, "reason")
      break
    case "request.set_expiration":
    case "request.restore_expired":
      text(a, "humanId")
      if (a.expiresAt !== null) finiteNumber(a, "expiresAt", { minimum: 0 })
      break
    case "request.expire":
      text(a, "humanId")
      text(a, "reason")
      break
    case "request.follow_up":
      text(a, "parentHumanId")
      text(a, "title")
      text(a, "reason")
      validateSource(a)
      break
    case "notification.read":
      text(a, "notificationId")
      break
    case "context.upsert": {
      text(a, "humanId")
      text(a, "kind")
      if (!contextKinds.has(String(a.kind))) fail("kind")
      text(a, "title")
      stringArray(a, "bulletPoints")
      const citations = a.citations
      if (
        !Array.isArray(citations) ||
        !citations.every((citation) => {
          if (
            typeof citation !== "object" ||
            citation === null ||
            Array.isArray(citation)
          )
            return false
          const value = citation as Record<string, unknown>
          return ["label", "url", "supports"].every(
            (key) => typeof value[key] === "string" && value[key]
          )
        })
      )
        fail("citations")
      break
    }
    case "context.versions":
      text(a, "contextId")
      break
    case "context.preferences.save": {
      text(a, "humanId")
      const preferences = requiredRecord(a, "preferences")
      stringArray(preferences, "visibleContextIds")
      stringArray(preferences, "pinnedContextIds")
      stringArray(preferences, "knownContextIds")
      break
    }
    case "job.claim":
      text(a, "leaseToken")
      finiteNumber(a, "leaseMs", { integer: true, minimum: 1 })
      break
    case "job.input":
      text(a, "jobId")
      break
    case "job.heartbeat":
      text(a, "jobId")
      text(a, "leaseToken")
      finiteNumber(a, "leaseMs", { integer: true, minimum: 1 })
      finiteNumber(a, "leaseGeneration", { integer: true, minimum: 1 })
      break
    case "job.complete":
      text(a, "jobId")
      text(a, "leaseToken")
      text(a, "body")
      finiteNumber(a, "leaseGeneration", { integer: true, minimum: 1 })
      break
    case "job.fail":
      text(a, "jobId")
      text(a, "leaseToken")
      text(a, "errorCode")
      finiteNumber(a, "leaseGeneration", { integer: true, minimum: 1 })
      if (a.transient !== undefined) boolean(a, "transient")
      break
    case "deliverable.create":
      text(a, "humanId")
      text(a, "kind")
      text(a, "name")
      optionalText(a, "body")
      break
    case "deliverable.version":
      text(a, "deliverableId")
      text(a, "body")
      optionalText(a, "changeSummary")
      break
    case "deliverable.promote":
      text(a, "deliverableId")
      text(a, "versionId")
      if (
        a.expectedPromotedVersionId !== null &&
        typeof a.expectedPromotedVersionId !== "string"
      )
        fail("expectedPromotedVersionId")
      break
    case "deliverable.set_primary":
      text(a, "humanId")
      text(a, "deliverableId")
      text(a, "expectedPrimaryDeliverableId")
      break
    case "target.list_archived":
      text(a, "humanId")
      if (
        a.cursor !== undefined &&
        a.cursor !== null &&
        typeof a.cursor !== "string"
      )
        fail("cursor")
      break
    case "audit.list":
      text(a, "humanId")
      if (
        a.cursor !== undefined &&
        a.cursor !== null &&
        typeof a.cursor !== "string"
      )
        fail("cursor")
      if (a.limit !== undefined)
        finiteNumber(a, "limit", { integer: true, minimum: 1 })
      if (typeof a.limit === "number" && a.limit > 100) fail("limit")
      break
    case "target.create":
      text(a, "humanId")
      text(a, "deliverableId")
      text(a, "channel")
      text(a, "destinationLabel")
      optionalText(a, "destinationUrl")
      if (a.isRequired !== undefined) boolean(a, "isRequired")
      break
    case "target.set_required":
      text(a, "targetId")
      boolean(a, "isRequired")
      break
    case "target.set_retention":
      text(a, "targetId")
      if (a.retention !== "active" && a.retention !== "archived")
        fail("retention")
      break
    case "target.confirm":
      text(a, "targetId")
      text(a, "versionId")
      optionalText(a, "note")
      optionalText(a, "integrationSuccessId")
      break
    case "target.reopen":
      text(a, "targetId")
      break
    case "conflict.resolve":
      text(a, "conflictId")
      text(a, "selectedValue")
      break
    case "share.create":
      text(a, "humanId")
      stringArray(a, "contextItemIds")
      stringArray(a, "deliverableIds")
      if (a.expiresAt !== undefined)
        finiteNumber(a, "expiresAt", { minimum: 0 })
      break
    case "share.revoke":
      text(a, "shareId")
      break
    default:
      break
  }
  if (isAgentControlMutation(operation)) text(a, "correlationId")
  return command as AgentControlCommand & { operation: AgentControlOperation }
}

function project(value: unknown, fields?: Array<string>): unknown {
  if (!fields?.length || typeof value !== "object" || value === null)
    return value
  if (Array.isArray(value))
    return value.map((item): unknown => project(item, fields))
  const input = value as Record<string, unknown>
  if (Array.isArray(input.page)) {
    const envelopeFields = new Set([
      "page",
      "nextCursor",
      "continueCursor",
      "isDone",
      "pageStatus",
    ])
    const itemFields = fields.flatMap((field) => {
      if (field.startsWith("page.")) return [field.slice("page.".length)]
      return envelopeFields.has(field) || field in input ? [] : [field]
    })
    const includePage =
      fields.includes("page") ||
      fields.some((field) => field.startsWith("page.")) ||
      itemFields.length > 0
    const output = Object.fromEntries(
      Object.entries(input).filter(([key]) => key !== "page")
    )
    if (includePage)
      output.page =
        itemFields.length > 0
          ? input.page.map((item): unknown => project(item, itemFields))
          : input.page
    return output
  }
  const required =
    input.kind === "candidates" ? ["kind", "candidates"] : ["kind"]
  const selected = [...new Set([...fields, ...required])]
  const output: Record<string, unknown> = {}
  for (const field of selected) {
    const path = field.split(".").filter(Boolean)
    let source: unknown = input
    for (const segment of path) {
      if (
        typeof source !== "object" ||
        source === null ||
        !(segment in source)
      ) {
        source = undefined
        break
      }
      source = (source as Record<string, unknown>)[segment]
    }
    if (source === undefined) continue
    let target = output
    for (const segment of path.slice(0, -1)) {
      const child = target[segment]
      if (typeof child !== "object" || child === null || Array.isArray(child))
        target[segment] = {}
      target = target[segment] as Record<string, unknown>
    }
    if (path.length) target[path.at(-1)!] = source
  }
  return output
}

function pageArray(items: Array<unknown>, args: Record<string, unknown>) {
  const offset =
    typeof args.cursor === "string"
      ? Number(args.cursor.slice("offset:".length))
      : 0
  const limit = typeof args.limit === "number" ? args.limit : 50
  const page = items.slice(offset, offset + limit)
  return {
    page,
    nextCursor:
      offset + page.length < items.length
        ? `offset:${offset + page.length}`
        : null,
  }
}

export async function executeAgentControlCommand(
  service: ContentRequestService,
  rawCommand: AgentControlCommand
) {
  const command = validateAgentControlCommand(rawCommand)
  const a = command.arguments ?? {}
  let result: unknown
  switch (command.operation) {
    case "metrics.get":
      result = await service.getProductMetrics({
        from: typeof a.from === "number" ? a.from : undefined,
        to: typeof a.to === "number" ? a.to : undefined,
      })
      break
    case "request.list":
      result = await service.listPage(
        typeof a.cursor === "string" ? a.cursor : null,
        typeof a.limit === "number" ? a.limit : 50
      )
      break
    case "request.workspace":
      result = await service.listOperatorWorkspace(a as never)
      break
    case "request.resolve":
      result = await service.resolve(text(a, "query"))
      break
    case "request.get":
      result = await service.getByHumanId(text(a, "humanId"))
      break
    case "request.create":
      result = await service.createManual(a as never)
      break
    case "request.update":
      result = await service.update(a as never)
      break
    case "request.assign":
      result = await service.assign(a as never)
      break
    case "request.open":
      result = await service.open(text(a, "humanId"), text(a, "correlationId"))
      break
    case "request.set_expiration":
      result = await service.setExpiration(
        text(a, "humanId"),
        a.expiresAt as number | null,
        text(a, "correlationId")
      )
      break
    case "request.expire": {
      const args = [
        text(a, "humanId"),
        text(a, "reason"),
        text(a, "correlationId"),
      ] as const
      result =
        typeof a.expectedAggregateVersion === "number"
          ? await service.expire(...args, a.expectedAggregateVersion)
          : await service.expire(...args)
      break
    }
    case "request.restore_expired":
      result = await service.restoreExpired(
        text(a, "humanId"),
        a.expiresAt as number | null,
        text(a, "correlationId")
      )
      break
    case "request.archive": {
      const args = [text(a, "humanId"), text(a, "correlationId")] as const
      result =
        typeof a.expectedAggregateVersion === "number"
          ? await service.archive(...args, a.expectedAggregateVersion)
          : await service.archive(...args)
      break
    }
    case "request.restore_archived":
      result = await service.restoreArchived(
        text(a, "humanId"),
        text(a, "correlationId")
      )
      break
    case "request.follow_up":
      result = await service.createFollowUp(a as never)
      break
    case "request.relations":
      result = await service.getRelations(text(a, "humanId"))
      break
    case "principal.list":
      result = await service.listAssignablePrincipals()
      break
    case "notification.list":
      result = await service.listMyNotificationsPage(
        typeof a.cursor === "string" ? a.cursor : null,
        typeof a.limit === "number" ? a.limit : 50
      )
      break
    case "notification.read":
      result = await service.markNotificationRead(
        text(a, "notificationId"),
        text(a, "correlationId")
      )
      break
    case "context.list":
      result = await service.listContext(text(a, "humanId"))
      break
    case "context.upsert":
      result = await service.upsertContext(a as never)
      break
    case "context.versions":
      result = await service.listContextVersions(
        text(a, "contextId"),
        typeof a.cursor === "string" ? a.cursor : null,
        typeof a.limit === "number" ? a.limit : 50
      )
      break
    case "context.preferences.get":
      result = await service.getContextDeckPreferences(text(a, "humanId"))
      break
    case "context.preferences.save":
      result = await service.saveContextDeckPreferences(
        text(a, "humanId"),
        a.preferences as never,
        text(a, "correlationId")
      )
      break
    case "job.list":
      result = await service.listAgentJobsPage(
        typeof a.cursor === "string" ? a.cursor : null,
        typeof a.limit === "number" ? a.limit : 50
      )
      break
    case "job.claim":
      result = await service.claimAgentJob(
        text(a, "leaseToken"),
        finiteNumber(a, "leaseMs")
      )
      break
    case "job.input":
      result = await service.getAgentJobInput(text(a, "jobId"))
      break
    case "job.heartbeat":
      result = await service.heartbeatAgentJob(
        text(a, "jobId"),
        text(a, "leaseToken"),
        finiteNumber(a, "leaseMs"),
        finiteNumber(a, "leaseGeneration")
      )
      break
    case "job.complete":
      result = await service.completeAgentJob(
        text(a, "jobId"),
        text(a, "leaseToken"),
        text(a, "body"),
        text(a, "correlationId"),
        finiteNumber(a, "leaseGeneration")
      )
      break
    case "job.fail": {
      const args = [
        text(a, "jobId"),
        text(a, "leaseToken"),
        text(a, "errorCode"),
        a.transient === undefined ? true : boolean(a, "transient"),
        text(a, "correlationId"),
        finiteNumber(a, "leaseGeneration"),
      ] as const
      result =
        typeof a.expectedAggregateVersion === "number"
          ? await service.failAgentJob(...args, a.expectedAggregateVersion)
          : await service.failAgentJob(...args)
      break
    }
    case "deliverable.list":
      result = await service.listDeliverables(text(a, "humanId"))
      break
    case "deliverable.create":
      result = await service.createDerivativeDeliverable(a as never)
      break
    case "deliverable.version":
      result = await service.createDeliverableVersion(a as never)
      break
    case "deliverable.promote":
      result = await service.promoteDeliverableVersion(a as never)
      break
    case "deliverable.set_primary":
      result = await service.setPrimaryDeliverable(a as never)
      break
    case "target.list":
      result = await service.listDeliveryTargets(text(a, "humanId"))
      break
    case "target.list_archived":
      result = await service.listArchivedDeliveryTargets(
        text(a, "humanId"),
        typeof a.cursor === "string" ? a.cursor : null
      )
      break
    case "target.create":
      result = await service.createDeliveryTarget(a as never)
      break
    case "target.set_required":
      result = await service.setDeliveryTargetRequired(a as never)
      break
    case "target.set_retention":
      result = await service.setDeliveryTargetRetention(a as never)
      break
    case "target.confirm":
      result = await service.confirmDeliveryTarget(a as never)
      break
    case "target.reopen":
      result = await service.reopenDeliveryTarget(a as never)
      break
    case "conflict.list":
      result = await service.listOpenSemanticConflicts(text(a, "humanId"))
      break
    case "conflict.resolve":
      result = await service.resolveSemanticConflict(a as never)
      break
    case "share.list":
      result = await service.listPublicShares(text(a, "humanId"))
      break
    case "share.create":
      result = await service.createPublicShare(a as never)
      break
    case "share.revoke": {
      const args = [text(a, "shareId"), text(a, "correlationId")] as const
      result =
        typeof a.expectedAggregateVersion === "number"
          ? await service.revokePublicShare(...args, a.expectedAggregateVersion)
          : await service.revokePublicShare(...args)
      break
    }
    case "audit.list":
      result = await service.listAuditEvents(
        text(a, "humanId"),
        typeof a.cursor === "string" ? a.cursor : null,
        typeof a.limit === "number" ? a.limit : 50
      )
      break
  }
  if (paginatedOperations.has(command.operation) && Array.isArray(result))
    result = pageArray(result, a)
  return project(result, command.fields)
}
