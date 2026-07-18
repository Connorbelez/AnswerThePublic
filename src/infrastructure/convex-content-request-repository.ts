import { ConvexHttpClient } from "convex/browser"

import { api } from "../../convex/_generated/api"
import type {
  ContentRequestRepository,
  PersistManualRequestInput,
} from "@/application/content-requests"

type TokenProvider = () => Promise<string | null>

export function createConvexContentRequestRepository({
  getAccessToken,
}: {
  getAccessToken: TokenProvider
}): ContentRequestRepository {
  async function client() {
    const convexUrl = process.env.VITE_CONVEX_URL
    if (!convexUrl) {
      throw new Error("VITE_CONVEX_URL is required for Content Request access.")
    }
    const accessToken = await getAccessToken()
    if (!accessToken) {
      throw new Error("An access token is required for Content Request access.")
    }
    const convex = new ConvexHttpClient(convexUrl)
    convex.setAuth(accessToken)
    return convex
  }

  return {
    async createManual(input: PersistManualRequestInput) {
      return (await client()).mutation(api.contentRequests.createManual, input)
    },
    async getByHumanId(humanId) {
      return (await client()).query(api.contentRequests.getByHumanId, {
        humanId,
      })
    },
    async list(limit) {
      return (await client()).query(api.contentRequests.list, { limit })
    },
    async resolve(query) {
      return (await client()).query(api.contentRequests.resolve, { query })
    },
  }
}
