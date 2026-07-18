import { api } from "../../convex/_generated/api"
import type {
  ExternalIdentity,
  PrincipalRepository,
} from "@/application/workspace-session"
import { getConvexTestWorkspace } from "@/infrastructure/convex-test-workspace.server"

export async function createConvexTestPrincipalRepository(
  identity: ExternalIdentity,
  configuredOrganizationId = process.env.FAIRLEND_E2E_ORGANIZATION_ID
): Promise<PrincipalRepository> {
  if (!configuredOrganizationId) {
    throw new Error(
      "FAIRLEND_E2E_ORGANIZATION_ID is required for browser tests."
    )
  }
  const testBackend = await getConvexTestWorkspace(
    identity,
    configuredOrganizationId
  )

  return {
    async find(principal) {
      const result = await testBackend.query(api.principals.getCurrent)
      if (
        !result ||
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
