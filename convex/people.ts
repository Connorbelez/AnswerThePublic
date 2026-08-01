import { ConvexError, v } from "convex/values"

import type { Doc } from "./_generated/dataModel"
import { mutation, query } from "./_generated/server"
import { requireEditor, requirePrincipal } from "./lib/authorization"

const MAX_PEOPLE_RESULTS = 50

export const personSummaryValidator = v.object({
  personId: v.id("people"),
  displayName: v.string(),
  email: v.string(),
  principalId: v.union(v.id("principals"), v.null()),
  isFounder: v.boolean(),
})

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("en-CA")
}

function searchTerms(value: string) {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function directorySearchText(displayName: string, email: string) {
  return `${normalize(displayName)} ${email} ${searchTerms(email)}`
}

function required(value: string, field: string, maxLength: number) {
  const cleaned = value.trim()
  if (!cleaned || cleaned.length > maxLength)
    throw new ConvexError({ code: "VALIDATION_FAILED", field })
  return cleaned
}

function cleanEmail(value: string) {
  const email = normalize(required(value, "email", 320))
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new ConvexError({ code: "VALIDATION_FAILED", field: "email" })
  return email
}

function summary(person: Doc<"people">) {
  return {
    personId: person._id,
    displayName: person.displayName,
    email: person.email,
    principalId: person.principalId ?? null,
    isFounder: person.isFounder,
  }
}

export const search = query({
  args: { query: v.string(), limit: v.optional(v.number()) },
  returns: v.object({
    people: v.array(personSummaryValidator),
    defaultPersonId: v.union(v.id("people"), v.null()),
  }),
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const limit = args.limit ?? 20
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PEOPLE_RESULTS)
      throw new ConvexError({ code: "VALIDATION_FAILED", field: "limit" })
    const query = searchTerms(args.query)
    const configuredFounderEmail = normalize(
      process.env.FAIRLEND_ELIE_EMAIL ?? "elie@fairlend.ca"
    )
    const [configuredFounderCandidate, firstFounder] = await Promise.all([
      ctx.db
        .query("people")
        .withIndex("by_organization_email", (index) =>
          index
            .eq("organizationId", principal.organizationId)
            .eq("normalizedEmail", configuredFounderEmail)
        )
        .unique(),
      ctx.db
        .query("people")
        .withIndex("by_organization_founder_created_at", (index) =>
          index
            .eq("organizationId", principal.organizationId)
            .eq("isFounder", true)
        )
        .first(),
    ])
    const defaultPerson =
      configuredFounderCandidate?.isFounder === true
        ? configuredFounderCandidate
        : firstFounder
    const directory = query
      ? await ctx.db
          .query("people")
          .withSearchIndex("search_directory", (index) =>
            index
              .search("searchText", query)
              .eq("organizationId", principal.organizationId)
          )
          .take(limit)
      : await ctx.db
          .query("people")
          .withIndex("by_organization_created_at", (index) =>
            index.eq("organizationId", principal.organizationId)
          )
          .take(limit)
    const matches = [
      ...new Map(
        [...(query || !defaultPerson ? [] : [defaultPerson]), ...directory].map(
          (person) => [person._id, person]
        )
      ).values(),
    ]
      .sort(
        (left, right) =>
          Number(right.isFounder) - Number(left.isFounder) ||
          left.displayName.localeCompare(right.displayName)
      )
      .slice(0, limit)
    return {
      people: matches.map(summary),
      defaultPersonId: defaultPerson?._id ?? null,
    }
  },
})

export const create = mutation({
  args: {
    humanId: v.string(),
    displayName: v.string(),
    email: v.string(),
    correlationId: v.string(),
  },
  returns: personSummaryValidator,
  handler: async (ctx, args) => {
    const principal = await requirePrincipal(ctx)
    requireEditor(principal)
    const humanId = required(args.humanId, "humanId", 64).toUpperCase()
    const displayName = required(args.displayName, "displayName", 120)
    const email = cleanEmail(args.email)
    const correlationId = required(args.correlationId, "correlationId", 200)
    const inputFingerprint = JSON.stringify({ humanId, displayName, email })
    const request = await ctx.db
      .query("contentRequests")
      .withIndex("by_organization_human_id", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("humanId", humanId)
      )
      .unique()
    if (!request) throw new ConvexError({ code: "NOT_FOUND" })
    const prior = await ctx.db
      .query("personOperations")
      .withIndex("by_organization_actor_correlation", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("actorPrincipalId", principal._id)
          .eq("correlationId", correlationId)
      )
      .unique()
    if (prior) {
      if (prior.inputFingerprint !== inputFingerprint)
        throw new ConvexError({ code: "IDEMPOTENCY_KEY_REUSED" })
      const person = await ctx.db.get(prior.personId)
      if (!person || person.organizationId !== principal.organizationId)
        throw new ConvexError({ code: "NOT_FOUND" })
      return summary(person)
    }
    const existing = await ctx.db
      .query("people")
      .withIndex("by_organization_email", (index) =>
        index
          .eq("organizationId", principal.organizationId)
          .eq("normalizedEmail", email)
      )
      .unique()
    const now = Date.now()
    const personId = existing?._id
    const createdPersonId =
      personId ??
      (await ctx.db.insert("people", {
        organizationId: principal.organizationId,
        displayName,
        normalizedDisplayName: normalize(displayName),
        email,
        normalizedEmail: email,
        searchText: directorySearchText(displayName, email),
        isFounder: false,
        createdByPrincipalId: principal._id,
        createdAt: now,
        updatedAt: now,
      }))
    await ctx.db.insert("personOperations", {
      organizationId: principal.organizationId,
      actorPrincipalId: principal._id,
      correlationId,
      inputFingerprint,
      personId: createdPersonId,
      createdAt: now,
    })
    if (!existing) {
      const afterVersion = request.aggregateVersion + 1
      await ctx.db.patch(request._id, {
        aggregateVersion: afterVersion,
        updatedAt: now,
      })
      await ctx.db.insert("auditEvents", {
        organizationId: principal.organizationId,
        requestId: request._id,
        requestHumanId: request.humanId,
        actorPrincipalId: principal._id,
        credentialId: principal.credentialId,
        operation: "person.created",
        correlationId,
        occurredAt: now,
        beforeVersion: request.aggregateVersion,
        afterVersion,
        inputFingerprint,
      })
    }
    const person = await ctx.db.get(createdPersonId)
    if (!person) throw new ConvexError({ code: "WRITE_FAILED" })
    return summary(person)
  },
})
