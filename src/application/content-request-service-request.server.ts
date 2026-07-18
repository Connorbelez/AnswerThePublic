import {
  createContentRequestService,
  type ContentRequestService,
} from "@/application/content-requests"
import {
  AuthenticationRequiredError,
  authorizeExternalIdentity,
} from "@/application/workspace-session"
import { createConvexContentRequestRepository } from "@/infrastructure/convex-content-request-repository"
import { createRequestIdentityProvider } from "@/infrastructure/request-identity"

export async function createContentRequestServiceFromRequest(
  creationOrigin: "manual" | "http_api" | "cli" | "chatgpt_app" = "manual"
): Promise<ContentRequestService> {
  const identities = createRequestIdentityProvider()
  const identity = await identities.getIdentity()
  if (!identity) throw new AuthenticationRequiredError()
  const expectedOrganizationId = identities.isFixture
    ? process.env.FAIRLEND_E2E_ORGANIZATION_ID
    : process.env.WORKOS_ORGANIZATION_ID
  if (!expectedOrganizationId) {
    throw new Error("The FairLend WorkOS organization is not configured.")
  }
  authorizeExternalIdentity(identity, expectedOrganizationId)

  if (import.meta.env.MODE === "e2e" && identities.isFixture) {
    const { createConvexTestContentRequestRepository } =
      await import("@/infrastructure/convex-test-content-request-repository.server")
    return createContentRequestService(
      await createConvexTestContentRequestRepository(identity),
      creationOrigin
    )
  }
  if (identities.isFixture) {
    throw new Error("Browser-test identity injection is disabled.")
  }

  return createContentRequestService(
    createConvexContentRequestRepository({
      getAccessToken: () => identities.getAccessToken(),
    }),
    creationOrigin
  )
}
