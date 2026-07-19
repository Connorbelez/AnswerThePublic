// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ContentRequestCard } from "@/components/content-request-card"

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}))

describe("Operator workspace card contract", () => {
  it("communicates ownership, job, draft, and delivery progress", () => {
    render(
      <ContentRequestCard
        request={{
          requestId: "request-1",
          humanId: "CR-OPERATOR",
          title: "Answer the renewal question",
          aliases: [],
          origin: "manual",
          priority: "critical",
          lifecycle: "founder_complete",
          disposition: "active",
          retention: "active",
          expiresAt: null,
          expiredAt: null,
          expirationReason: null,
          expirationReviewRequiredAt: null,
          archivedAt: null,
          parentRequestHumanId: null,
          aggregateVersion: 3,
          assignee: {
            principalId: "elie",
            subject: "Elie",
            role: "founder",
          },
          watchers: [],
          firstOpenedAt: 1,
          latestOpenedAt: 2,
          hasFounderDraft: true,
          founderDraftUpdatedAt: 2,
          source: null,
          createdAt: 1,
          updatedAt: 3,
        }}
        operational={{
          queue: "needs_operator",
          agentJobStatus: "completed",
          requiredDeliveryConfirmed: 1,
          requiredDeliveryTotal: 2,
          openConflictCount: 0,
          attentionReasonCount: 0,
          attentionReasons: [],
          deliveryChannels: ["reddit"],
          nextActionChangedAt: 3,
        }}
      />
    )

    expect(screen.getByText(/Assigned to Elie/)).toBeTruthy()
    expect(screen.getByText("Founder draft saved")).toBeTruthy()
    expect(screen.getByText("Needs operator")).toBeTruthy()
    expect(screen.getByText("Founder complete")).toBeTruthy()
    expect(screen.getByText("Job: completed")).toBeTruthy()
    expect(screen.getByText("Delivery 1/2")).toBeTruthy()
  })
})
