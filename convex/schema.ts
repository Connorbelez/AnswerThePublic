import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export const workspaceRoleValidator = v.union(
  v.literal("founder"),
  v.literal("operator_editor"),
  v.literal("agent_editor"),
  v.literal("administrator")
)

export default defineSchema({
  principals: defineTable({
    subject: v.string(),
    organizationId: v.string(),
    role: workspaceRoleValidator,
    updatedAt: v.number(),
  }).index("by_organization_subject", ["organizationId", "subject"]),
})
