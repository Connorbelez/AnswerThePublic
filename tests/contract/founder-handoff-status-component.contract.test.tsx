// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FounderHandoffStatusCard } from "@/components/founder-handoff-status"
import type { FounderHandoffStatus } from "@/application/content-requests"

const handoff: FounderHandoffStatus = {
  handoffId: "handoff-1",
  recipient: {
    principalId: "elie",
    subject: "Elie",
    role: "founder",
  },
  selectedFormats: ["original_response", "blog_article", "linkedin_post"],
  note: null,
  stage: "ready",
  deliveredAt: Date.UTC(2026, 6, 28, 15, 0),
  openedAt: Date.UTC(2026, 6, 28, 15, 5),
  emailStatus: "sent",
}

describe("Founder handoff status presentation", () => {
  it("renders the durable handoff evidence in the detail variant", () => {
    render(<FounderHandoffStatusCard handoff={handoff} variant="detail" />)

    expect(screen.getByText("To Elie")).toBeTruthy()
    expect(screen.getByText("Ready")).toBeTruthy()
    expect(screen.getByText("3 outputs")).toBeTruthy()
    expect(screen.getByText(/Delivered/)).toBeTruthy()
    expect(screen.getByText(/Opened/)).toBeTruthy()
    expect(screen.getByText("Email sent")).toBeTruthy()
  })

  it("uses the same status copy in the compact variant", () => {
    render(<FounderHandoffStatusCard handoff={handoff} variant="compact" />)

    expect(screen.getByText("To Elie: Ready")).toBeTruthy()
  })
})
