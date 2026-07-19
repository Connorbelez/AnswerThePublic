import { ConvexError, v } from "convex/values"
import type { Auth } from "convex/server"

import { mutation, query, type MutationCtx } from "./_generated/server"
import { workspaceRoleValidator } from "./schema"

const principalValidator = v.object({
  principalId: v.string(),
  subject: v.string(),
  organizationId: v.string(),
  role: workspaceRoleValidator,
})

const workosRoleMap = {
  founder: "founder",
  "operator-editor": "operator_editor",
  "agent-editor": "agent_editor",
  // WorkOS default Admin role slug plus the FairLend custom slug.
  admin: "administrator",
  administrator: "administrator",
} as const

async function syncIdentityPrincipal(
  ctx: MutationCtx,
  identity: Awaited<ReturnType<typeof requireIdentity>>,
  verifiedEmail?: string
) {
  if (identity.subject.startsWith("system:")) {
    throw new ConvexError({ code: "RESERVED_SUBJECT" })
  }
  const existing = await ctx.db
    .query("principals")
    .withIndex("by_organization_subject", (index) =>
      index
        .eq("organizationId", identity.organizationId)
        .eq("subject", identity.subject)
    )
    .unique()
  if (existing?.kind === "system") {
    throw new ConvexError({ code: "RESERVED_SUBJECT" })
  }
  const email = verifiedEmail?.trim() || identity.email || existing?.email
  const fields = {
    subject: identity.subject,
    organizationId: identity.organizationId,
    role: identity.role,
    kind:
      identity.role === "agent_editor"
        ? ("agent" as const)
        : ("human" as const),
    email,
    updatedAt: Date.now(),
  }
  const principalId = existing
    ? (await ctx.db.patch(existing._id, fields), existing._id)
    : await ctx.db.insert("principals", fields)

  return {
    principalId,
    subject: fields.subject,
    organizationId: fields.organizationId,
    role: fields.role,
  }
}

export async function requireIdentity(auth: Auth) {
  const identity = await auth.getUserIdentity()
  if (!identity) {
    throw new ConvexError({ code: "UNAUTHENTICATED" })
  }
  const tokenClientId =
    typeof identity.client_id === "string" ? identity.client_id : null
  const expectedClientId = process.env.WORKOS_CLIENT_ID
  if (tokenClientId && tokenClientId !== expectedClientId) {
    throw new ConvexError({ code: "APPLICATION_ACCESS_DENIED" })
  }
  const expectedOrganizationId = process.env.FAIRLEND_WORKOS_ORGANIZATION_ID
  if (!expectedOrganizationId) {
    throw new ConvexError({ code: "AUTHORIZATION_NOT_CONFIGURED" })
  }

  const organizationId =
    typeof identity.org_id === "string" ? identity.org_id : null
  if (organizationId !== expectedOrganizationId) {
    throw new ConvexError({ code: "ORGANIZATION_ACCESS_DENIED" })
  }

  const role =
    typeof identity.role === "string" && identity.role in workosRoleMap
      ? workosRoleMap[identity.role as keyof typeof workosRoleMap]
      : null
  if (!role) {
    throw new ConvexError({ code: "ROLE_ACCESS_DENIED" })
  }

  const credentialId =
    typeof identity.jti === "string" ? identity.jti : identity.tokenIdentifier
  const email = typeof identity.email === "string" ? identity.email : undefined
  return {
    subject: identity.subject,
    organizationId,
    role,
    credentialId,
    email,
  }
}

export const getCurrent = query({
  args: {},
  returns: v.union(principalValidator, v.null()),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx.auth)
    const principal = await ctx.db
      .query("principals")
      .withIndex("by_organization_subject", (index) =>
        index
          .eq("organizationId", identity.organizationId)
          .eq("subject", identity.subject)
      )
      .unique()

    if (!principal || principal.kind === "system") {
      return null
    }

    return {
      principalId: principal._id,
      subject: principal.subject,
      organizationId: principal.organizationId,
      role: principal.role,
    }
  },
})

export const syncCurrent = mutation({
  args: {},
  returns: principalValidator,
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx.auth)
    return syncIdentityPrincipal(ctx, identity)
  },
})

export const syncCurrentProfile = mutation({
  args: { verifiedEmail: v.string(), provisioningKey: v.string() },
  returns: principalValidator,
  handler: async (ctx, args) => {
    const expectedKey = process.env.FAIRLEND_PRINCIPAL_PROVISIONING_KEY
    if (!expectedKey || args.provisioningKey !== expectedKey) {
      throw new ConvexError({ code: "PRINCIPAL_PROVISIONING_DENIED" })
    }
    const verifiedEmail = args.verifiedEmail.trim()
    if (!verifiedEmail) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "verifiedEmail",
      })
    }
    const identity = await requireIdentity(ctx.auth)
    return syncIdentityPrincipal(ctx, identity, verifiedEmail)
  },
})

export const seedFounder = mutation({
  args: {
    provisioningKey: v.string(),
    email: v.string(),
    subject: v.optional(v.string()),
  },
  returns: v.object({
    principalId: v.id("principals"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const expectedKey = process.env.FAIRLEND_PRINCIPAL_PROVISIONING_KEY
    if (!expectedKey || args.provisioningKey !== expectedKey) {
      throw new ConvexError({ code: "PRINCIPAL_PROVISIONING_DENIED" })
    }
    const organizationId = process.env.FAIRLEND_WORKOS_ORGANIZATION_ID
    if (!organizationId) {
      throw new ConvexError({ code: "AUTHORIZATION_NOT_CONFIGURED" })
    }
    const email = args.email.trim().toLowerCase()
    if (!email) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "email",
      })
    }
    const subject = (args.subject ?? "user_elie").trim()
    if (!subject || subject.startsWith("system:")) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        field: "subject",
      })
    }

    const founders = await ctx.db
      .query("principals")
      .withIndex("by_organization_role", (index) =>
        index.eq("organizationId", organizationId).eq("role", "founder")
      )
      .collect()
    const existingByEmail = founders.find(
      (candidate) =>
        candidate.kind !== "system" &&
        candidate.email?.trim().toLowerCase() === email
    )
    const existingBySubject = await ctx.db
      .query("principals")
      .withIndex("by_organization_subject", (index) =>
        index.eq("organizationId", organizationId).eq("subject", subject)
      )
      .unique()
    const existing = existingByEmail ?? existingBySubject
    const now = Date.now()
    if (existing) {
      if (existing.kind === "system") {
        throw new ConvexError({ code: "RESERVED_SUBJECT" })
      }
      await ctx.db.patch(existing._id, {
        subject: existingByEmail ? existing.subject : subject,
        role: "founder",
        kind: "human",
        email,
        updatedAt: now,
      })
      return { principalId: existing._id, created: false }
    }

    const principalId = await ctx.db.insert("principals", {
      subject,
      organizationId,
      role: "founder",
      kind: "human",
      email,
      updatedAt: now,
    })
    return { principalId, created: true }
  },
})
