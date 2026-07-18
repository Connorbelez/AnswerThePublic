import {
  AuthenticationRequiredError,
  OrganizationAccessDeniedError,
  PrincipalNotProvisionedError,
  UnsupportedWorkspaceRoleError,
  createWorkspaceSessionService,
  type PrincipalRepository,
} from "@/application/workspace-session"
import type { WorkspaceSessionResult } from "@/application/load-workspace-session"
import { createConvexPrincipalRepository } from "@/infrastructure/convex-principal-repository"
import { createRequestIdentityProvider } from "@/infrastructure/request-identity"

export async function loadWorkspaceSessionFromRequest(): Promise<WorkspaceSessionResult> {
  try {
    const identities = createRequestIdentityProvider()
    let principals: PrincipalRepository
    if (import.meta.env.MODE === "e2e" && identities.isFixture) {
      if (!identities.fixtureIdentity) {
        throw new Error("Browser-test identity injection is disabled.")
      }
      const { createConvexTestPrincipalRepository } = await import(
        "@/infrastructure/convex-test-principal-repository.server"
      )
      principals = await createConvexTestPrincipalRepository(
        identities.fixtureIdentity
      )
    } else if (identities.isFixture) {
      throw new Error("Browser-test identity injection is disabled.")
    } else {
      principals = createConvexPrincipalRepository({
        getAccessToken: () => identities.getAccessToken(),
      })
    }
    const expectedOrganizationId = identities.isFixture
      ? process.env.FAIRLEND_E2E_ORGANIZATION_ID
      : process.env.WORKOS_ORGANIZATION_ID ??
        (import.meta.env.MODE === "e2e"
          ? process.env.FAIRLEND_E2E_ORGANIZATION_ID
          : undefined)
    if (!expectedOrganizationId) {
      throw new Error("The FairLend WorkOS organization is not configured.")
    }

    const session = await createWorkspaceSessionService({
      identities,
      principals,
      expectedOrganizationId,
    }).load()
    return { status: "authenticated", session }
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return { status: "unauthenticated" }
    }
    if (
      error instanceof UnsupportedWorkspaceRoleError ||
      error instanceof OrganizationAccessDeniedError ||
      error instanceof PrincipalNotProvisionedError
    ) {
      return { status: "forbidden" }
    }
    throw error
  }
}
