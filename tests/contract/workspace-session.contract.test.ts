import { describe, expect, it } from "vitest"

import {
  AuthenticationRequiredError,
  OrganizationAccessDeniedError,
  UnsupportedWorkspaceRoleError,
  createWorkspaceSessionService,
  type IdentityProvider,
  type PrincipalRepository,
} from "@/application/workspace-session"

function identityProvider(
  identity: Awaited<ReturnType<IdentityProvider["getIdentity"]>>
): IdentityProvider {
  return {
    getIdentity: async () => identity,
  }
}

function principalRepository(): PrincipalRepository & { reads: number } {
  const repository = {
    reads: 0,
    find: async (principal: Parameters<PrincipalRepository["find"]>[0]) => {
      repository.reads += 1
      return {
        ...principal,
        principalId: "principal_01",
      }
    },
  }

  return repository
}

describe("workspace session application contract", () => {
  it.each([
    ["founder", "founder"],
    ["operator-editor", "operator_editor"],
    ["agent-editor", "agent_editor"],
    ["administrator", "administrator"],
  ] as const)("maps the WorkOS %s role to %s", async (workosRole, role) => {
    const principals = principalRepository()
    const service = createWorkspaceSessionService({
      identities: identityProvider({
        subject: "user_01",
        organizationId: "org_fairlend",
        email: "elie@fairlend.ca",
        displayName: "Elie",
        workosRole,
      }),
      principals,
      expectedOrganizationId: "org_fairlend",
    })

    await expect(service.load()).resolves.toEqual({
      principalId: "principal_01",
      subject: "user_01",
      organizationId: "org_fairlend",
      email: "elie@fairlend.ca",
      displayName: "Elie",
      role,
    })
    expect(principals.reads).toBe(1)
  })

  it("rejects an unauthenticated request before touching persistence", async () => {
    const principals = principalRepository()
    const service = createWorkspaceSessionService({
      identities: identityProvider(null),
      principals,
      expectedOrganizationId: "org_fairlend",
    })

    await expect(service.load()).rejects.toBeInstanceOf(
      AuthenticationRequiredError
    )
    expect(principals.reads).toBe(0)
  })

  it("rejects a signed-in identity without an application role", async () => {
    const service = createWorkspaceSessionService({
      identities: identityProvider({
        subject: "user_02",
        organizationId: "org_fairlend",
        email: "unknown@fairlend.ca",
        displayName: "Unknown",
        workosRole: "member",
      }),
      principals: principalRepository(),
      expectedOrganizationId: "org_fairlend",
    })

    await expect(service.load()).rejects.toBeInstanceOf(
      UnsupportedWorkspaceRoleError
    )
  })

  it("rejects an allowed role from a different WorkOS organization", async () => {
    const principals = principalRepository()
    const service = createWorkspaceSessionService({
      identities: identityProvider({
        subject: "user_external",
        organizationId: "org_external",
        email: "external@example.com",
        displayName: "External user",
        workosRole: "founder",
      }),
      principals,
      expectedOrganizationId: "org_fairlend",
    })

    await expect(service.load()).rejects.toBeInstanceOf(
      OrganizationAccessDeniedError
    )
    expect(principals.reads).toBe(0)
  })
})
