// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { OpportunityQueueRail } from "@/components/triage-inbox"

describe("Opportunity queue rail", () => {
  it("collapses without losing queue position or navigation context", () => {
    render(
      <OpportunityQueueRail
        activeHumanId="CR-ONE"
        items={[
          {
            request: {
              requestId: "request-1",
              humanId: "CR-ONE",
              title: "Ontario mortgage discharge",
              aliases: [],
              requestType: "standard",
              origin: "automated_scout",
              priority: "normal",
              lifecycle: "pending",
              disposition: "active",
              retention: "active",
              retentionTransition: null,
              timingLabel: null,
              expiresAt: null,
              expiredAt: null,
              expirationReason: null,
              expirationReviewRequiredAt: null,
              archivedAt: null,
              parentRequestHumanId: null,
              aggregateVersion: 1,
              assignee: {
                principalId: "scout",
                subject: "Scout",
                role: "agent_editor",
              },
              watchers: [],
              firstOpenedAt: null,
              latestOpenedAt: null,
              hasFounderDraft: false,
              founderDraftUpdatedAt: null,
              source: { channel: "reddit", body: "Score: 78/100" },
              createdAt: 1,
              updatedAt: 1,
            },
            queue: "needs_operator",
            founderHandoff: null,
            agentJobStatus: null,
            requiredDeliveryConfirmed: 0,
            requiredDeliveryTotal: 1,
            openConflictCount: 0,
            attentionReasonCount: 0,
            attentionReasons: [],
            deliveryChannels: ["reddit"],
            nextActionChangedAt: 1,
          },
        ]}
      />
    )

    expect(screen.getByText("Opportunity queue")).toBeTruthy()
    expect(screen.getByText("Ontario mortgage discharge")).toBeTruthy()
    const collapse = screen.getByRole("button", {
      name: "Collapse opportunity queue",
    })
    fireEvent.click(collapse)
    expect(
      screen
        .getByRole("button", { name: "Expand opportunity queue" })
        .getAttribute("aria-expanded")
    ).toBe("false")
    expect(screen.getByText("1 of 1")).toBeTruthy()
  })
})
