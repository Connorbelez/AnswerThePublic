import { ConvexError, v } from "convex/values"

import type { MutationCtx } from "../_generated/server"

const MAX_GUEST_ACCESS_ATTEMPTS_PER_HOUR = 10
const GUEST_ACCESS_PROOF_MAX_AGE_MS = 5 * 60 * 1_000
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PROOF_PATTERN = /^[a-f0-9]{64}$/

export const guestAccessBoundaryArgs = {
  networkSource: v.string(),
  networkTimestamp: v.number(),
  networkProof: v.string(),
}

function tokenSecret() {
  const secret = process.env.GUEST_ACCESS_TOKEN_SECRET
  if (!secret || new TextEncoder().encode(secret).byteLength < 32)
    throw new ConvexError({ code: "GUEST_ACCESS_SECRET_NOT_CONFIGURED" })
  return secret
}

function resolveSecret() {
  const secret = process.env.GUEST_ACCESS_RESOLVE_SECRET
  if (!secret || new TextEncoder().encode(secret).byteLength < 32)
    throw new ConvexError({
      code: "GUEST_ACCESS_RESOLVE_SECRET_NOT_CONFIGURED",
    })
  return secret
}

async function sign(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  )
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
}

function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

export async function authenticatedGuestAccessNetworkSource(
  input: {
    token: string
    networkSource: string
    networkTimestamp: number
    networkProof: string
  },
  now: number
) {
  if (
    !TOKEN_PATTERN.test(input.token) ||
    !Number.isSafeInteger(input.networkTimestamp) ||
    Math.abs(now - input.networkTimestamp) > GUEST_ACCESS_PROOF_MAX_AGE_MS ||
    input.networkSource.length === 0 ||
    input.networkSource.length > 256 ||
    input.networkSource.trim() !== input.networkSource ||
    !PROOF_PATTERN.test(input.networkProof)
  )
    return null
  const expected = await sign(
    resolveSecret(),
    `guest-access-resolve:v1\n${input.networkTimestamp}\n${input.networkSource}\n${input.token}`
  )
  return secureEqual(expected, input.networkProof) ? input.networkSource : null
}

export async function recordFailedGuestTokenAttempt(
  ctx: MutationCtx,
  token: string,
  networkSource: string,
  now: number
) {
  const [tokenFingerprint, networkSourceHash] = await Promise.all([
    sign(tokenSecret(), `token-fingerprint:${token}`),
    sign(tokenSecret(), `network-source:${networkSource}`),
  ])
  const hourBucket = Math.floor(now / 3_600_000)
  const [tokenAttempts, sourceAttempts] = await Promise.all([
    ctx.db
      .query("guestAccessAttempts")
      .withIndex("by_fingerprint_hour", (index) =>
        index
          .eq("tokenFingerprint", tokenFingerprint)
          .eq("hourBucket", hourBucket)
      )
      .collect(),
    ctx.db
      .query("guestAccessAttempts")
      .withIndex("by_source_hour", (index) =>
        index
          .eq("networkSourceHash", networkSourceHash)
          .eq("hourBucket", hourBucket)
      )
      .collect(),
  ])
  if (
    tokenAttempts.reduce((total, attempt) => total + attempt.count, 0) >=
      MAX_GUEST_ACCESS_ATTEMPTS_PER_HOUR ||
    sourceAttempts.reduce((total, attempt) => total + attempt.count, 0) >=
      MAX_GUEST_ACCESS_ATTEMPTS_PER_HOUR
  )
    return false
  const existing = await ctx.db
    .query("guestAccessAttempts")
    .withIndex("by_fingerprint_source_hour", (index) =>
      index
        .eq("tokenFingerprint", tokenFingerprint)
        .eq("networkSourceHash", networkSourceHash)
        .eq("hourBucket", hourBucket)
    )
    .unique()
  if (existing?.count && existing.count >= MAX_GUEST_ACCESS_ATTEMPTS_PER_HOUR)
    return false
  if (existing)
    await ctx.db.patch(existing._id, {
      count: existing.count + 1,
      lastAttemptedAt: now,
    })
  else
    await ctx.db.insert("guestAccessAttempts", {
      tokenFingerprint,
      networkSourceHash,
      hourBucket,
      count: 1,
      firstAttemptedAt: now,
      lastAttemptedAt: now,
    })
  return true
}
