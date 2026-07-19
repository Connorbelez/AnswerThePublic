import { ConvexError } from "convex/values"

import type { Doc } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { requireIdentity } from "../principals"

export type AuthorizedPrincipal = Doc<"principals"> & {
  credentialId: string
}

export async function requirePrincipal(
  ctx: QueryCtx | MutationCtx
): Promise<AuthorizedPrincipal> {
  const identity = await requireIdentity(ctx.auth)
  const principal = await ctx.db
    .query("principals")
    .withIndex("by_organization_subject", (index) =>
      index
        .eq("organizationId", identity.organizationId)
        .eq("subject", identity.subject)
    )
    .unique()
  if (
    !principal ||
    principal.role !== identity.role ||
    principal.kind === "system"
  ) {
    throw new ConvexError({ code: "PRINCIPAL_NOT_PROVISIONED" })
  }
  return {
    ...principal,
    credentialId: identity.credentialId,
  }
}

export function requireEditor(principal: Doc<"principals">) {
  if (
    principal.role !== "operator_editor" &&
    principal.role !== "agent_editor" &&
    principal.role !== "administrator"
  ) {
    throw new ConvexError({ code: "ROLE_ACCESS_DENIED" })
  }
}

export async function requireFounderWorkspacePrincipal(
  ctx: QueryCtx | MutationCtx,
  principal: Doc<"principals">,
  request: Pick<
    Doc<"contentRequests">,
    "assigneePrincipalId" | "createdByPrincipalId"
  >
) {
  const assigneePrincipalId =
    request.assigneePrincipalId ?? request.createdByPrincipalId
  if (principal.role === "founder") {
    if (assigneePrincipalId !== principal._id) {
      throw new ConvexError({ code: "RESOURCE_ACCESS_DENIED" })
    }
    return principal
  }
  if (principal.role !== "administrator") {
    throw new ConvexError({ code: "ROLE_ACCESS_DENIED" })
  }
  const founder = await ctx.db.get(assigneePrincipalId)
  if (
    !founder ||
    founder.organizationId !== principal.organizationId ||
    founder.kind === "system" ||
    founder.role !== "founder"
  ) {
    throw new ConvexError({ code: "RESOURCE_ACCESS_DENIED" })
  }
  return founder
}

export function requireActiveRequest(
  request: Pick<Doc<"contentRequests">, "retention" | "disposition">
) {
  if (request.retention !== "active") {
    throw new ConvexError({ code: "ARCHIVED_REQUEST" })
  }
  if (request.disposition !== "active") {
    throw new ConvexError({ code: "EXPIRED_REQUEST" })
  }
}
