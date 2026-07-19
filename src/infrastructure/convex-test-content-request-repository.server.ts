import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type {
  AssignRequestInput,
  ContentRequestRepository,
  PersistManualRequestInput,
} from "@/application/content-requests"
import type { ExternalIdentity } from "@/application/workspace-session"
import { getConvexTestWorkspace } from "@/infrastructure/convex-test-workspace.server"

export async function createConvexTestContentRequestRepository(
  identity: ExternalIdentity
): Promise<ContentRequestRepository> {
  const backend = await getConvexTestWorkspace(identity)
  return {
    async createManual(input: PersistManualRequestInput) {
      return backend.mutation(api.contentRequests.createManual, input)
    },
    async getByHumanId(humanId) {
      return backend.query(api.contentRequests.getByHumanId, { humanId })
    },
    async list(limit) {
      return backend.query(api.contentRequests.list, { limit })
    },
    async resolve(query) {
      return backend.query(api.contentRequests.resolve, { query })
    },
    async assign(input: AssignRequestInput) {
      return backend.mutation(api.contentRequests.assign, {
        ...input,
        assigneePrincipalId: input.assigneePrincipalId as Id<"principals">,
        watcherPrincipalIds: input.watcherPrincipalIds?.map(
          (principalId) => principalId as Id<"principals">
        ),
      })
    },
    async open(humanId, correlationId) {
      return backend.mutation(api.contentRequests.open, {
        humanId,
        correlationId,
      })
    },
    async listAssignablePrincipals() {
      return backend.query(api.contentRequests.listAssignablePrincipals, {})
    },
    async listMyNotifications() {
      return backend.query(api.contentRequests.listMyNotifications, {})
    },
    async markNotificationRead(notificationId) {
      await backend.mutation(api.contentRequests.markNotificationRead, {
        notificationId: notificationId as Id<"notifications">,
      })
    },
    async listContext(humanId) {
      return backend.query(api.scoutIngestions.listContext, { humanId })
    },
    async getContextDeckPreferences(humanId) {
      return backend.query(api.scoutIngestions.getContextDeckPreferences, {
        humanId,
      })
    },
    async saveContextDeckPreferences(humanId, preferences, correlationId) {
      return backend.mutation(api.scoutIngestions.saveContextDeckPreferences, {
        humanId,
        ...preferences,
        correlationId,
      })
    },
  }
}
