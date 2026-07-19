import { ConvexHttpClient } from "convex/browser"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type {
  AssignRequestInput,
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
    async assign(input: AssignRequestInput) {
      return (await client()).mutation(api.contentRequests.assign, {
        ...input,
        assigneePrincipalId: input.assigneePrincipalId as Id<"principals">,
        watcherPrincipalIds: input.watcherPrincipalIds?.map(
          (principalId) => principalId as Id<"principals">
        ),
      })
    },
    async open(humanId, correlationId) {
      return (await client()).mutation(api.contentRequests.open, {
        humanId,
        correlationId,
      })
    },
    async listAssignablePrincipals() {
      return (await client()).query(
        api.contentRequests.listAssignablePrincipals,
        {}
      )
    },
    async listMyNotifications() {
      return (await client()).query(api.contentRequests.listMyNotifications, {})
    },
    async markNotificationRead(notificationId) {
      await (
        await client()
      ).mutation(api.contentRequests.markNotificationRead, {
        notificationId: notificationId as Id<"notifications">,
      })
    },
  }
}
