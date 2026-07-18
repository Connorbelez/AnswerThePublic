import { ConvexHttpClient } from "convex/browser"

import { api } from "../../convex/_generated/api"
import type {
  PrincipalRepository,
} from "@/application/workspace-session"

type TokenProvider = () => Promise<string | null>

export function createConvexPrincipalRepository({
  getAccessToken,
}: {
  getAccessToken: TokenProvider
}): PrincipalRepository {
  return {
    async find(principal) {
      const convexUrl = process.env.VITE_CONVEX_URL
      if (!convexUrl) {
        throw new Error(
          "VITE_CONVEX_URL is required for authenticated workspace access."
        )
      }

      const accessToken = await getAccessToken()
      if (!accessToken) {
        throw new Error("A WorkOS access token is required for Convex access.")
      }

      const client = new ConvexHttpClient(convexUrl)
      client.setAuth(accessToken)
      const result = await client.query(api.principals.getCurrent)
      if (!result) {
        return null
      }
      if (
        result.subject !== principal.subject ||
        result.organizationId !== principal.organizationId ||
        result.role !== principal.role
      ) {
        return null
      }

      return result
    },
  }
}
