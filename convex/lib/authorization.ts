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
  if (!principal || principal.role !== identity.role) {
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
