export const WORKSPACE_ROLES = [
  "founder",
  "operator_editor",
  "agent_editor",
  "administrator",
] as const

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number]

export const WORKSPACE_VIEWS = ["operator", "elie"] as const

export type WorkspaceView = (typeof WORKSPACE_VIEWS)[number]

export type ExternalIdentity = {
  subject: string
  organizationId: string
  email: string
  displayName: string
  workosRole: string | null
}

export type PrincipalLookup = Pick<
  ExternalIdentity,
  "subject" | "organizationId"
> & {
  role: WorkspaceRole
}

export type Principal = PrincipalLookup & {
  principalId: string
}

export type WorkspaceSession = Principal &
  Pick<ExternalIdentity, "email" | "displayName">

export type WorkspaceViewSession = WorkspaceSession & {
  workspaceView: WorkspaceView
}

export interface IdentityProvider {
  getIdentity(): Promise<ExternalIdentity | null>
}

export interface PrincipalRepository {
  find(principal: PrincipalLookup): Promise<Principal | null>
}

export interface WorkspaceSessionService {
  load(): Promise<WorkspaceSession>
}

const WORKOS_ROLE_MAP = {
  founder: "founder",
  "operator-editor": "operator_editor",
  "agent-editor": "agent_editor",
  administrator: "administrator",
} as const satisfies Record<string, WorkspaceRole>

export class AuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required to enter the workspace.")
    this.name = "AuthenticationRequiredError"
  }
}

export class UnsupportedWorkspaceRoleError extends Error {
  constructor(role: string | null) {
    super(`The WorkOS role ${role ?? "<missing>"} is not authorized.`)
    this.name = "UnsupportedWorkspaceRoleError"
  }
}

export class OrganizationAccessDeniedError extends Error {
  constructor() {
    super("The active WorkOS organization cannot access this workspace.")
    this.name = "OrganizationAccessDeniedError"
  }
}

export class PrincipalNotProvisionedError extends Error {
  constructor() {
    super("The authenticated principal has not been provisioned.")
    this.name = "PrincipalNotProvisionedError"
  }
}

export class WorkspaceViewAccessDeniedError extends Error {
  constructor() {
    super("Only administrators can switch workspace views.")
    this.name = "WorkspaceViewAccessDeniedError"
  }
}

export function resolveWorkspaceView(
  role: WorkspaceRole,
  requestedView: string | null | undefined
): WorkspaceView {
  if (role === "founder") return "elie"
  if (role === "administrator" && requestedView === "elie") return "elie"
  return "operator"
}

export function authorizeWorkspaceViewSwitch(
  role: WorkspaceRole,
  requestedView: WorkspaceView
) {
  if (role !== "administrator") throw new WorkspaceViewAccessDeniedError()
  return requestedView
}

function mapWorkosRole(role: string | null): WorkspaceRole {
  if (role === null || !(role in WORKOS_ROLE_MAP)) {
    throw new UnsupportedWorkspaceRoleError(role)
  }

  return WORKOS_ROLE_MAP[role as keyof typeof WORKOS_ROLE_MAP]
}

export function authorizeExternalIdentity(
  identity: ExternalIdentity,
  expectedOrganizationId: string
): PrincipalLookup {
  if (identity.organizationId !== expectedOrganizationId) {
    throw new OrganizationAccessDeniedError()
  }

  return {
    subject: identity.subject,
    organizationId: identity.organizationId,
    role: mapWorkosRole(identity.workosRole),
  }
}

export function createWorkspaceSessionService({
  identities,
  principals,
  expectedOrganizationId,
}: {
  identities: IdentityProvider
  principals: PrincipalRepository
  expectedOrganizationId: string
}): WorkspaceSessionService {
  return {
    async load() {
      const identity = await identities.getIdentity()
      if (!identity) {
        throw new AuthenticationRequiredError()
      }

      const authorizedIdentity = authorizeExternalIdentity(
        identity,
        expectedOrganizationId
      )
      const principal = await principals.find(authorizedIdentity)
      if (!principal || principal.role !== authorizedIdentity.role) {
        throw new PrincipalNotProvisionedError()
      }

      return {
        ...principal,
        email: identity.email,
        displayName: identity.displayName,
      }
    },
  }
}
