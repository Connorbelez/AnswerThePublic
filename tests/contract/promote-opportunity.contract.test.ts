import { describe, expect, it, vi } from "vitest"

import {
  promoteOpportunityToFounder,
  type OpportunityPromotionPort,
} from "@/application/promote-opportunity"
import type {
  ContentRequest,
  Deliverable,
  DeliveryTarget,
} from "@/application/content-requests"

const request: ContentRequest = {
  requestId: "request-1",
  humanId: "CR-TRIAGE",
  title: "Ontario mortgage discharge",
  aliases: [],
  requestType: "standard",
  origin: "automated_scout",
  priority: "normal",
  lifecycle: "pending",
  disposition: "active",
  retention: "active",
  retentionTransition: null,
  timingLabel: "while active",
  expiresAt: null,
  expiredAt: null,
  expirationReason: null,
  expirationReviewRequiredAt: null,
  archivedAt: null,
  parentRequestHumanId: null,
  aggregateVersion: 3,
  assignee: {
    principalId: "scout-agent",
    subject: "Scout agent",
    role: "agent_editor",
  },
  watchers: [],
  firstOpenedAt: null,
  latestOpenedAt: null,
  hasFounderDraft: false,
  founderDraftUpdatedAt: null,
  source: {
    channel: "reddit",
    name: "r/CanadaPersonalFinance",
    url: "https://www.reddit.com/r/CanadaPersonalFinance/comments/example",
  },
  createdAt: 1,
  updatedAt: 3,
}

const primary: Deliverable = {
  deliverableId: "deliverable-primary",
  requestHumanId: request.humanId,
  kind: "primary_response",
  name: "Primary response",
  isPrimary: true,
  currentCandidateVersionId: "version-candidate",
  promotedVersionId: null,
  versions: [
    {
      versionId: "version-candidate",
      body: "A zero balance is not the same as a registered discharge.",
      ordinal: 1,
      createdByPrincipalId: "scout-agent",
      sourceJobId: null,
      changeSummary: null,
      createdAt: 2,
    },
  ],
  createdAt: 2,
  updatedAt: 2,
}

function derivative(kind: string, name: string): Deliverable {
  return {
    ...primary,
    deliverableId: `deliverable-${kind}`,
    kind,
    name,
    isPrimary: false,
    currentCandidateVersionId: null,
    promotedVersionId: null,
    versions: [],
  }
}

const deliveredHandoff = {
  handoffId: "handoff-applied",
  recipient: {
    principalId: "elie",
    subject: "Elie",
    role: "founder" as const,
  },
  selectedFormats: ["original_response"] as const,
  note: null,
  stage: "delivered" as const,
  deliveredAt: 5,
  openedAt: null,
  emailStatus: "queued" as const,
}

describe("promote opportunity to founder", () => {
  it("returns the immutable active handoff without applying a second promotion", async () => {
    const handoff = {
      handoffId: "handoff-1",
      recipient: {
        principalId: "elie",
        subject: "Elie",
        role: "founder" as const,
      },
      selectedFormats: ["original_response", "blog_article"] as const,
      note: null,
      stage: "opened" as const,
      deliveredAt: 10,
      openedAt: 20,
      emailStatus: "sent" as const,
    }
    const port = {
      getCurrentFounderHandoff: vi.fn().mockResolvedValue(handoff),
      getByHumanId: vi.fn(),
      listDeliverables: vi.fn(),
      listDeliveryTargets: vi.fn(),
      proposeAssigneeChange: vi.fn(),
      createDeliverableVersion: vi.fn(),
      promoteDeliverableVersion: vi.fn(),
      createDerivativeDeliverable: vi.fn(),
      createDeliveryTarget: vi.fn(),
      setDeliveryTargetRequired: vi.fn(),
      finalizeFounderHandoff: vi.fn(),
    } as unknown as OpportunityPromotionPort

    const result = await promoteOpportunityToFounder(port, {
      humanId: request.humanId,
      recipientPrincipalId: "elie",
      formats: ["original_response", "youtube_short"],
      correlationId: "triage-repeat",
    })

    expect(result).toEqual({ outcome: "already_applied", handoff })
    expect(port.getByHumanId).not.toHaveBeenCalled()
    expect(port.finalizeFounderHandoff).not.toHaveBeenCalled()
  })

  it("routes, promotes, creates selected formats, and requires the source target", async () => {
    const createdTargets: DeliveryTarget[] = []
    const port: OpportunityPromotionPort = {
      getCurrentFounderHandoff: vi.fn().mockResolvedValue(null),
      finalizeFounderHandoff: vi.fn().mockResolvedValue({
        outcome: "applied",
        handoff: deliveredHandoff,
      }),
      getByHumanId: vi.fn().mockResolvedValue(request),
      listDeliverables: vi.fn().mockResolvedValue([primary]),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      proposeAssigneeChange: vi
        .fn()
        .mockResolvedValue({ outcome: "applied", conflict: null }),
      createDeliverableVersion: vi.fn(),
      promoteDeliverableVersion: vi.fn().mockResolvedValue({
        outcome: "applied",
        conflict: null,
        deliverable: { ...primary, promotedVersionId: "version-candidate" },
      }),
      createDerivativeDeliverable: vi
        .fn()
        .mockImplementation(({ kind, name }) => derivative(kind, name)),
      createDeliveryTarget: vi.fn().mockImplementation((input) => {
        const target: DeliveryTarget = {
          targetId: "target-original",
          requestHumanId: request.humanId,
          deliverableId: input.deliverableId,
          channel: input.channel,
          destinationLabel: input.destinationLabel,
          destinationUrl: input.destinationUrl ?? null,
          isOriginal: true,
          isRequired: Boolean(input.isRequired),
          retention: "active",
          currentReceiptId: null,
          currentReceipt: null,
          receiptHistory: [],
          createdAt: 4,
          updatedAt: 4,
        }
        createdTargets.push(target)
        return target
      }),
      setDeliveryTargetRequired: vi.fn(),
    }

    const result = await promoteOpportunityToFounder(port, {
      humanId: request.humanId,
      recipientPrincipalId: "elie",
      formats: ["original_response", "blog_article", "linkedin_post"],
      correlationId: "triage-decision-1",
    })

    expect(result).toMatchObject({
      outcome: "applied",
      selectedFormats: ["original_response", "blog_article", "linkedin_post"],
    })
    expect(port.proposeAssigneeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        humanId: request.humanId,
        expectedAssigneePrincipalId: "scout-agent",
        proposedAssigneePrincipalId: "elie",
        correlationId: "triage-decision-1:assign",
      })
    )
    expect(port.promoteDeliverableVersion).toHaveBeenCalledWith({
      deliverableId: primary.deliverableId,
      versionId: "version-candidate",
      expectedPromotedVersionId: null,
      correlationId: "triage-decision-1:promote:deliverable-primary",
    })
    expect(port.createDerivativeDeliverable).toHaveBeenCalledTimes(2)
    expect(port.createDerivativeDeliverable).toHaveBeenCalledWith({
      humanId: request.humanId,
      kind: "blog_article",
      name: "Blog article",
      correlationId: "triage-decision-1:format:blog_article",
    })
    expect(createdTargets).toHaveLength(1)
    expect(createdTargets[0]).toMatchObject({
      deliverableId: primary.deliverableId,
      channel: "reddit",
      destinationLabel: "r/CanadaPersonalFinance",
      isRequired: true,
    })
  })

  it("promotes the prepared scout response when the primary deliverable has no candidate yet", async () => {
    const scoutRequest: ContentRequest = {
      ...request,
      source: {
        ...request.source,
        body: `## Draft response

The lender reporting a zero balance does not remove the registered charge.

## Evidence used

- Ontario land registry guidance`,
      },
    }
    const emptyPrimary: Deliverable = {
      ...primary,
      currentCandidateVersionId: null,
      versions: [],
    }
    const preparedPrimary: Deliverable = {
      ...emptyPrimary,
      currentCandidateVersionId: "version-from-scout",
      versions: [
        {
          versionId: "version-from-scout",
          body: "The lender reporting a zero balance does not remove the registered charge.",
          ordinal: 1,
          createdByPrincipalId: "scout-agent",
          sourceJobId: null,
          changeSummary: "Prepared from the scout response",
          createdAt: 4,
        },
      ],
    }
    const createDeliverableVersion = vi.fn().mockResolvedValue(preparedPrimary)
    const port = {
      getCurrentFounderHandoff: vi.fn().mockResolvedValue(null),
      finalizeFounderHandoff: vi.fn().mockResolvedValue({
        outcome: "applied",
        handoff: deliveredHandoff,
      }),
      getByHumanId: vi.fn().mockResolvedValue(scoutRequest),
      listDeliverables: vi.fn().mockResolvedValue([emptyPrimary]),
      listDeliveryTargets: vi.fn().mockResolvedValue([]),
      proposeAssigneeChange: vi
        .fn()
        .mockResolvedValue({ outcome: "applied", conflict: null }),
      createDeliverableVersion,
      promoteDeliverableVersion: vi.fn().mockResolvedValue({
        outcome: "applied",
        conflict: null,
        deliverable: {
          ...preparedPrimary,
          promotedVersionId: "version-from-scout",
        },
      }),
      createDerivativeDeliverable: vi.fn(),
      createDeliveryTarget: vi.fn().mockResolvedValue({
        targetId: "target-original",
        requestHumanId: request.humanId,
        deliverableId: primary.deliverableId,
        channel: "reddit",
        destinationLabel: "r/CanadaPersonalFinance",
        destinationUrl: request.source?.url ?? null,
        isOriginal: true,
        isRequired: true,
        retention: "active",
        currentReceiptId: null,
        currentReceipt: null,
        receiptHistory: [],
        createdAt: 4,
        updatedAt: 4,
      }),
      setDeliveryTargetRequired: vi.fn(),
    } as OpportunityPromotionPort & {
      createDeliverableVersion: typeof createDeliverableVersion
    }

    const result = await promoteOpportunityToFounder(port, {
      humanId: scoutRequest.humanId,
      recipientPrincipalId: "elie",
      formats: ["original_response"],
      correlationId: "triage-seed-1",
    })

    expect(result.outcome).toBe("applied")
    expect(createDeliverableVersion).toHaveBeenCalledWith({
      deliverableId: emptyPrimary.deliverableId,
      body: "The lender reporting a zero balance does not remove the registered charge.",
      changeSummary: "Prepared from the scout response",
      correlationId: "triage-seed-1:seed-draft:deliverable-primary",
    })
    expect(port.promoteDeliverableVersion).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: "version-from-scout" })
    )
  })

  it("routes an opportunity to the founder when no response draft exists yet", async () => {
    const emptyPrimary: Deliverable = {
      ...primary,
      currentCandidateVersionId: null,
      versions: [],
    }
    const existingTarget: DeliveryTarget = {
      targetId: "target-original",
      requestHumanId: request.humanId,
      deliverableId: emptyPrimary.deliverableId,
      channel: "reddit",
      destinationLabel: "r/CanadaPersonalFinance",
      destinationUrl: request.source?.url ?? null,
      isOriginal: true,
      isRequired: true,
      retention: "active",
      currentReceiptId: null,
      currentReceipt: null,
      receiptHistory: [],
      createdAt: 4,
      updatedAt: 4,
    }
    const port: OpportunityPromotionPort = {
      getCurrentFounderHandoff: vi.fn().mockResolvedValue(null),
      finalizeFounderHandoff: vi.fn().mockResolvedValue({
        outcome: "applied",
        handoff: deliveredHandoff,
      }),
      getByHumanId: vi.fn().mockResolvedValue(request),
      listDeliverables: vi.fn().mockResolvedValue([emptyPrimary]),
      listDeliveryTargets: vi.fn().mockResolvedValue([existingTarget]),
      proposeAssigneeChange: vi
        .fn()
        .mockResolvedValue({ outcome: "applied", conflict: null }),
      createDeliverableVersion: vi.fn(),
      promoteDeliverableVersion: vi.fn(),
      createDerivativeDeliverable: vi
        .fn()
        .mockImplementation(({ kind, name }) => derivative(kind, name)),
      createDeliveryTarget: vi.fn(),
      setDeliveryTargetRequired: vi.fn(),
    }

    const result = await promoteOpportunityToFounder(port, {
      humanId: request.humanId,
      recipientPrincipalId: "elie",
      formats: ["original_response", "blog_article", "linkedin_post"],
      correlationId: "triage-no-draft-1",
    })

    expect(result).toMatchObject({
      outcome: "applied",
      selectedFormats: ["original_response", "blog_article", "linkedin_post"],
    })
    expect(port.proposeAssigneeChange).toHaveBeenCalledWith(
      expect.objectContaining({
        humanId: request.humanId,
        proposedAssigneePrincipalId: "elie",
      })
    )
    expect(port.createDeliverableVersion).not.toHaveBeenCalled()
    expect(port.promoteDeliverableVersion).not.toHaveBeenCalled()
    expect(port.createDerivativeDeliverable).toHaveBeenCalledTimes(2)
  })
})
