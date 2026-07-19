import { ConvexHttpClient } from "convex/browser"

import { api } from "../../convex/_generated/api"
import type { ScoutIngestionRepository } from "@/application/scout-ingestions"

type TokenProvider = () => Promise<string | null>
type AdminIdentityProvider = () => Promise<{
  adminKey: string
  subject: string
  organizationId: string
  credentialId: string
} | null>

export function createConvexScoutIngestionRepository({
  getAccessToken,
  getAdminIdentity,
}: {
  getAccessToken: TokenProvider
  getAdminIdentity?: AdminIdentityProvider
}): ScoutIngestionRepository {
  let cachedClient: Promise<ConvexHttpClient> | null = null
  async function client() {
    const convexUrl = process.env.VITE_CONVEX_URL
    if (!convexUrl)
      throw new Error("VITE_CONVEX_URL is required for scout ingestion.")
    const [token, adminIdentity] = await Promise.all([
      getAccessToken(),
      getAdminIdentity?.() ?? null,
    ])
    if (!token && !adminIdentity)
      throw new Error("An access token is required for scout ingestion.")
    const convex = new ConvexHttpClient(convexUrl)
    if (adminIdentity) {
      ;(
        convex as ConvexHttpClient & {
          setAdminAuth(token: string, identity: Record<string, string>): void
        }
      ).setAdminAuth(adminIdentity.adminKey, {
        subject: adminIdentity.subject,
        issuer: "https://api.workos.com/agents",
        org_id: adminIdentity.organizationId,
        role: "agent-editor",
        jti: adminIdentity.credentialId,
        tokenIdentifier: adminIdentity.credentialId,
      })
      await convex.mutation(api.principals.syncCurrent, {})
    } else {
      convex.setAuth(token!)
    }
    return convex
  }
  function getClient() {
    cachedClient ??= client()
    return cachedClient
  }
  return {
    async authorize() {
      await (await getClient()).query(api.scoutIngestions.authorizeEditor, {})
    },
    async ingest(input) {
      return (await getClient()).mutation(api.scoutIngestions.apply, input)
    },
  }
}
