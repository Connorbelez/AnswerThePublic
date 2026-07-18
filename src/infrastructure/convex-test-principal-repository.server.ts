import { convexTest } from "convex-test"

import { api } from "../../convex/_generated/api"
import schema from "../../convex/schema"
import type {
  ExternalIdentity,
  PrincipalRepository,
} from "@/application/workspace-session"
import { authorizeExternalIdentity } from "@/application/workspace-session"

const modules = import.meta.glob([
  "../../convex/**/*.ts",
  "!../../convex/**/*.test.ts",
  "!../../convex/**/*.config.ts",
  "!../../convex/**/*.setup.ts",
])

export async function createConvexTestPrincipalRepository(
  identity: ExternalIdentity,
  configuredOrganizationId = process.env.FAIRLEND_E2E_ORGANIZATION_ID
): Promise<PrincipalRepository> {
  const expectedOrganizationId = configuredOrganizationId
  if (!expectedOrganizationId) {
    throw new Error(
      "FAIRLEND_E2E_ORGANIZATION_ID is required for browser tests."
    )
  }
  authorizeExternalIdentity(identity, expectedOrganizationId)

  process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = expectedOrganizationId
  const testBackend = convexTest(schema, modules).withIdentity({
    issuer: "https://api.workos.com/",
    subject: identity.subject,
    org_id: identity.organizationId,
    role: identity.workosRole ?? undefined,
  })
  await testBackend.mutation(api.principals.syncCurrent)

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
