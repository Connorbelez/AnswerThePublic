import { ConvexHttpClient } from "convex/browser"

import { api } from "../../convex/_generated/api"
import type { ScoutIngestionRepository } from "@/application/scout-ingestions"

type TokenProvider = () => Promise<string | null>

export function createConvexScoutIngestionRepository({
  getAccessToken,
}: {
  getAccessToken: TokenProvider
}): ScoutIngestionRepository {
  async function client() {
    const convexUrl = process.env.VITE_CONVEX_URL
    if (!convexUrl)
      throw new Error("VITE_CONVEX_URL is required for scout ingestion.")
    const token = await getAccessToken()
    if (!token)
      throw new Error("An access token is required for scout ingestion.")
    const convex = new ConvexHttpClient(convexUrl)
    convex.setAuth(token)
    return convex
  }
  return {
    async authorize() {
      await (await client()).query(api.scoutIngestions.authorizeEditor, {})
    },
    async ingest(input) {
      return (await client()).mutation(api.scoutIngestions.apply, input)
    },
  }
}
