import type { Doc } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

/** Project lifecycle from durable workflow evidence after primary changes. */
export async function lifecycleForPrimary(
  ctx: QueryCtx | MutationCtx,
  request: Doc<"contentRequests">,
  primary: Doc<"deliverables">
): Promise<Doc<"contentRequests">["lifecycle"]> {
  if (request.lifecycle === "responded") return "responded"
  if (primary.promotedVersionId) return "ready_to_respond"
  const submittedJob = await ctx.db
    .query("agentJobs")
    .withIndex("by_request", (index) => index.eq("requestId", request._id))
    .first()
  if (submittedJob) return "founder_complete"
  const founderInput = await ctx.db
    .query("founderInputDocuments")
    .withIndex("by_request", (index) => index.eq("requestId", request._id))
    .unique()
  if (founderInput?.hasMeaningfulDraft || request.lifecycle === "in_progress")
    return "in_progress"
  return "pending"
}
