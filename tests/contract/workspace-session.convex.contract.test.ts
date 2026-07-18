// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest"

import { createWorkspaceSessionService } from "@/application/workspace-session"
import { createConvexTestPrincipalRepository } from "@/infrastructure/convex-test-principal-repository.server"

describe("workspace session through the Convex application boundary", () => {
  it("loads the same provisioned session consumed by web and future adapters", async () => {
    const identity = {
      subject: "user_elie",
      organizationId: "org_fairlend",
      email: "elie@fairlend.ca",
      displayName: "Elie",
      workosRole: "founder",
    }
    const principals = await createConvexTestPrincipalRepository(
      identity,
      identity.organizationId
    )
    const service = createWorkspaceSessionService({
      identities: { getIdentity: async () => identity },
      principals,
      expectedOrganizationId: identity.organizationId,
    })

    await expect(service.load()).resolves.toMatchObject({
      subject: "user_elie",
      organizationId: "org_fairlend",
      email: "elie@fairlend.ca",
      displayName: "Elie",
      role: "founder",
    })
  })
})
