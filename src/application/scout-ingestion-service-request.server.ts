import { createScoutIngestionService } from "@/application/scout-ingestions"
import {
  resolveAgentApiBearer,
  type AgentCredentialValidator,
} from "@/application/agent-api-auth.server"
import {
  AuthenticationRequiredError,
  authorizeExternalIdentity,
} from "@/application/workspace-session"
import { createConvexScoutIngestionRepository } from "@/infrastructure/convex-scout-ingestion-repository"
import { createRequestIdentityProvider } from "@/infrastructure/request-identity"
import { validateWorkosAgentCredential } from "@/infrastructure/workos-agent-credential.server"

export async function createScoutIngestionServiceForRequest(
  request: Request,
  validateAgentCredential: AgentCredentialValidator = validateWorkosAgentCredential
) {
  const authorization = request.headers.get("authorization")
  if (authorization?.startsWith("Bearer ")) {
    const { accessToken, adminIdentity } = await resolveAgentApiBearer(
      request,
      validateAgentCredential
    )
    return createScoutIngestionService(
      createConvexScoutIngestionRepository({
        getAccessToken: async () => accessToken,
        getAdminIdentity: async () => adminIdentity,
      })
    )
  }

  const identities = createRequestIdentityProvider()
  const identity = await identities.getIdentity()
  if (!identity) throw new AuthenticationRequiredError()
  const expectedOrganizationId = process.env.WORKOS_ORGANIZATION_ID
  if (!expectedOrganizationId)
    throw new Error("The FairLend WorkOS organization is not configured.")
  authorizeExternalIdentity(identity, expectedOrganizationId)
  if (identities.isFixture)
    throw new Error("Scout ingestion fixtures are disabled.")
  return createScoutIngestionService(
    createConvexScoutIngestionRepository({
      getAccessToken: () => identities.getAccessToken(),
    })
  )
}
