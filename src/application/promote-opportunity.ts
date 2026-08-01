import type {
  ContentRequestService,
  Deliverable,
  DeliveryTarget,
  FounderHandoffStatus,
  SemanticConflict,
} from "@/application/content-requests"
import { extractOpportunityBrief } from "@/lib/opportunity-brief"

export const contentFormatDefinitions = [
  {
    id: "original_response",
    label: "Reddit response",
    shortLabel: "Response",
  },
  { id: "blog_article", label: "Blog article", shortLabel: "Blog" },
  { id: "linkedin_post", label: "LinkedIn post", shortLabel: "LinkedIn" },
  { id: "x_thread", label: "X thread", shortLabel: "X" },
  {
    id: "youtube_short",
    label: "YouTube Short",
    shortLabel: "YouTube",
  },
  { id: "instagram_post", label: "Instagram", shortLabel: "Instagram" },
  { id: "infographic", label: "Infographic", shortLabel: "Infographic" },
] as const

export type ContentFormat = (typeof contentFormatDefinitions)[number]["id"]

export type PromoteOpportunityInput = {
  humanId: string
  recipientPrincipalId: string
  formats: Array<ContentFormat>
  note?: string
  correlationId: string
}

export type OpportunityPromotionPort = Pick<
  ContentRequestService,
  | "getByHumanId"
  | "getCurrentFounderHandoff"
  | "finalizeFounderHandoff"
  | "listDeliverables"
  | "listDeliveryTargets"
  | "proposeAssigneeChange"
  | "createDeliverableVersion"
  | "promoteDeliverableVersion"
  | "createDerivativeDeliverable"
  | "createDeliveryTarget"
  | "setDeliveryTargetRequired"
>

export type PromoteOpportunityResult =
  | {
      outcome: "applied"
      selectedFormats: Array<ContentFormat>
      promotedDeliverable: Deliverable
      derivativeDeliverables: Array<Deliverable>
      originalTarget: DeliveryTarget
      handoff: FounderHandoffStatus
    }
  | {
      outcome: "already_applied"
      handoff: FounderHandoffStatus
    }
  | {
      outcome: "blocked"
      reason:
        | "request_not_found"
        | "request_inactive"
        | "primary_deliverable_missing"
        | "candidate_version_missing"
    }
  | {
      outcome: "attention_required"
      conflict: SemanticConflict
    }

const formatDefinitionById = new Map(
  contentFormatDefinitions.map((format) => [format.id, format])
)

function normalizedFormats(formats: Array<ContentFormat>) {
  const selected = new Set<ContentFormat>(["original_response", ...formats])
  return contentFormatDefinitions
    .map((format) => format.id)
    .filter((format) => selected.has(format))
}

function operationKey(root: string, operation: string) {
  return `${root}:${operation}`
}

export async function promoteOpportunityToFounder(
  port: OpportunityPromotionPort,
  input: PromoteOpportunityInput
): Promise<PromoteOpportunityResult> {
  const currentHandoff = await port.getCurrentFounderHandoff(input.humanId)
  if (currentHandoff)
    return { outcome: "already_applied", handoff: currentHandoff }

  const request = await port.getByHumanId(input.humanId)
  if (!request) return { outcome: "blocked", reason: "request_not_found" }
  if (request.retention !== "active" || request.disposition !== "active") {
    return { outcome: "blocked", reason: "request_inactive" }
  }

  const formats = normalizedFormats(input.formats)
  const deliverables = await port.listDeliverables(request.humanId)
  let primary = deliverables.find((deliverable) => deliverable.isPrimary)
  if (!primary) {
    return { outcome: "blocked", reason: "primary_deliverable_missing" }
  }
  if (!primary.currentCandidateVersionId) {
    const preparedDraft = extractOpportunityBrief(
      request.source?.body
    ).draftResponse?.trim()
    if (preparedDraft) {
      primary = await port.createDeliverableVersion({
        deliverableId: primary.deliverableId,
        body: preparedDraft,
        changeSummary: "Prepared from the scout response",
        correlationId: operationKey(
          input.correlationId,
          `seed-draft:${primary.deliverableId}`
        ),
      })
      if (!primary.currentCandidateVersionId) {
        return { outcome: "blocked", reason: "candidate_version_missing" }
      }
    }
  }
  if (request.assignee.principalId !== input.recipientPrincipalId) {
    const assignment = await port.proposeAssigneeChange({
      humanId: request.humanId,
      expectedAssigneePrincipalId: request.assignee.principalId,
      proposedAssigneePrincipalId: input.recipientPrincipalId,
      reason:
        input.note?.trim() || "Promoted from the opportunity triage inbox.",
      correlationId: operationKey(input.correlationId, "assign"),
    })
    if (assignment.outcome === "attention_required") {
      return {
        outcome: "attention_required",
        conflict: assignment.conflict,
      }
    }
  }

  let promotedDeliverable = primary
  if (
    primary.currentCandidateVersionId &&
    primary.promotedVersionId !== primary.currentCandidateVersionId
  ) {
    const promotion = await port.promoteDeliverableVersion({
      deliverableId: primary.deliverableId,
      versionId: primary.currentCandidateVersionId,
      expectedPromotedVersionId: primary.promotedVersionId,
      correlationId: operationKey(
        input.correlationId,
        `promote:${primary.deliverableId}`
      ),
    })
    promotedDeliverable = promotion.deliverable
    if (promotion.outcome === "attention_required") {
      return {
        outcome: "attention_required",
        conflict: promotion.conflict,
      }
    }
  }

  const derivativeDeliverables: Array<Deliverable> = []
  for (const format of formats) {
    if (format === "original_response") continue
    const existing = deliverables.find(
      (deliverable) => deliverable.kind === format
    )
    if (existing) {
      derivativeDeliverables.push(existing)
      continue
    }
    const definition = formatDefinitionById.get(format)
    if (!definition) continue
    derivativeDeliverables.push(
      await port.createDerivativeDeliverable({
        humanId: request.humanId,
        kind: format,
        name: definition.label,
        correlationId: operationKey(input.correlationId, `format:${format}`),
      })
    )
  }

  const deliveryTargets = await port.listDeliveryTargets(request.humanId)
  let originalTarget = deliveryTargets.find(
    (target) =>
      target.deliverableId === primary.deliverableId &&
      target.retention === "active" &&
      (target.isOriginal || target.channel === request.source?.channel)
  )
  if (!originalTarget) {
    originalTarget = await port.createDeliveryTarget({
      humanId: request.humanId,
      deliverableId: primary.deliverableId,
      channel: request.source?.channel?.trim() || "source",
      destinationLabel:
        request.source?.name?.trim() || "Original response destination",
      destinationUrl: request.source?.url,
      isRequired: true,
      correlationId: operationKey(input.correlationId, "target:original"),
    })
  } else if (!originalTarget.isRequired) {
    originalTarget = await port.setDeliveryTargetRequired({
      targetId: originalTarget.targetId,
      isRequired: true,
      correlationId: operationKey(input.correlationId, "target:required"),
    })
  }

  const finalized = await port.finalizeFounderHandoff({
    humanId: request.humanId,
    recipientPrincipalId: input.recipientPrincipalId,
    selectedFormats: formats,
    note: input.note,
    correlationId: operationKey(input.correlationId, "handoff"),
  })
  if (finalized.outcome === "already_applied") return finalized

  return {
    outcome: "applied",
    selectedFormats: formats,
    promotedDeliverable,
    derivativeDeliverables,
    originalTarget,
    handoff: finalized.handoff,
  }
}
