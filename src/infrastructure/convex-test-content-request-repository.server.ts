import { api } from "../../convex/_generated/api"
import type {
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
  }
}
