export const founderHandoffStages = [
  "delivered",
  "opened",
  "draft_in_progress",
  "founder_complete",
  "agent_drafting",
  "ready",
  "attention_required",
] as const

export type FounderHandoffStage = (typeof founderHandoffStages)[number]

export const founderHandoffFormats = [
  "original_response",
  "blog_article",
  "linkedin_post",
  "x_thread",
  "youtube_short",
  "instagram_post",
  "infographic",
] as const

export type FounderHandoffFormat = (typeof founderHandoffFormats)[number]

export type FounderHandoffStageInput = {
  lifecycle:
    | "pending"
    | "in_progress"
    | "founder_complete"
    | "ready_to_respond"
    | "responded"
  hasFounderDraft: boolean
  openedAt: number | null
  agentJobStatus:
    | "queued"
    | "running"
    | "retry_wait"
    | "failed"
    | "completed"
    | "cancelled"
    | null
}

export function deriveFounderHandoffStage(
  input: FounderHandoffStageInput
): FounderHandoffStage {
  if (input.agentJobStatus === "failed") return "attention_required"
  if (
    input.lifecycle === "ready_to_respond" ||
    input.lifecycle === "responded" ||
    input.agentJobStatus === "completed"
  )
    return "ready"
  if (
    input.agentJobStatus === "running" ||
    input.agentJobStatus === "retry_wait"
  )
    return "agent_drafting"
  if (
    input.lifecycle === "founder_complete" ||
    input.agentJobStatus === "queued" ||
    input.agentJobStatus === "cancelled"
  )
    return "founder_complete"
  if (input.lifecycle === "in_progress" || input.hasFounderDraft)
    return "draft_in_progress"
  if (input.openedAt) return "opened"
  return "delivered"
}
