import { convexTest } from "convex-test"

import { api } from "../../convex/_generated/api"
import schema from "../../convex/schema"
import type { ExternalIdentity } from "@/application/workspace-session"
import { authorizeExternalIdentity } from "@/application/workspace-session"

const modules = import.meta.glob([
  "../../convex/**/*.ts",
  "!../../convex/**/*.test.ts",
  "!../../convex/**/*.config.ts",
  "!../../convex/**/*.setup.ts",
])

const workspace = convexTest(schema, modules)

export async function getConvexTestWorkspace(
  identity: ExternalIdentity,
  configuredOrganizationId = process.env.FAIRLEND_E2E_ORGANIZATION_ID
) {
  const expectedOrganizationId = configuredOrganizationId
  if (!expectedOrganizationId) {
    throw new Error(
      "FAIRLEND_E2E_ORGANIZATION_ID is required for browser tests."
    )
  }
  authorizeExternalIdentity(identity, expectedOrganizationId)
  process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = expectedOrganizationId
  const authenticated = workspace.withIdentity({
    issuer: "https://api.workos.com/",
    subject: identity.subject,
    org_id: identity.organizationId,
    role: identity.workosRole ?? undefined,
  })
  await authenticated.mutation(api.principals.syncCurrent)
  return authenticated
}
