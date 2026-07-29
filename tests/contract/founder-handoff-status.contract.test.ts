import { describe, expect, it } from "vitest"

import {
  deriveFounderHandoffStage,
  type FounderHandoffStageInput,
} from "../../shared/founder-handoff"

const delivered: FounderHandoffStageInput = {
  lifecycle: "pending",
  hasFounderDraft: false,
  openedAt: null,
  agentJobStatus: null,
}

describe("founder handoff status", () => {
  it.each([
    [delivered, "delivered"],
    [{ ...delivered, openedAt: 20 }, "opened"],
    [
      { ...delivered, openedAt: 20, hasFounderDraft: true },
      "draft_in_progress",
    ],
    [
      {
        ...delivered,
        lifecycle: "founder_complete",
        agentJobStatus: "queued",
      },
      "founder_complete",
    ],
    [
      {
        ...delivered,
        lifecycle: "founder_complete",
        agentJobStatus: "running",
      },
      "agent_drafting",
    ],
    [
      {
        ...delivered,
        lifecycle: "founder_complete",
        agentJobStatus: "retry_wait",
      },
      "agent_drafting",
    ],
    [
      {
        ...delivered,
        lifecycle: "founder_complete",
        agentJobStatus: "failed",
      },
      "attention_required",
    ],
    [
      {
        ...delivered,
        lifecycle: "ready_to_respond",
        agentJobStatus: "completed",
      },
      "ready",
    ],
    [
      {
        ...delivered,
        lifecycle: "responded",
        agentJobStatus: "completed",
      },
      "ready",
    ],
  ] satisfies Array<[FounderHandoffStageInput, string]>)(
    "derives %s as %s",
    (input, expected) => {
      expect(deriveFounderHandoffStage(input)).toBe(expected)
    }
  )

  it("shows ready for a pre-drafted response even before the recipient opens it", () => {
    expect(
      deriveFounderHandoffStage({
        ...delivered,
        lifecycle: "ready_to_respond",
      })
    ).toBe("ready")
  })
})
