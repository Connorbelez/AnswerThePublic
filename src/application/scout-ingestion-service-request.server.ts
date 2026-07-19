import { createScoutIngestionService } from "@/application/scout-ingestions"
import {
  AuthenticationRequiredError,
  authorizeExternalIdentity,
} from "@/application/workspace-session"
import { createConvexScoutIngestionRepository } from "@/infrastructure/convex-scout-ingestion-repository"
import { createRequestIdentityProvider } from "@/infrastructure/request-identity"

export async function createScoutIngestionServiceForRequest(request: Request) {
  const authorization = request.headers.get("authorization")
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim()
    if (!token) throw new AuthenticationRequiredError()
    return createScoutIngestionService(
      createConvexScoutIngestionRepository({
        getAccessToken: async () => token,
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
