import { getAuth } from "@workos/authkit-tanstack-react-start"
import { getRequestHeader } from "@tanstack/react-start/server"

import type {
  ExternalIdentity,
  IdentityProvider,
} from "@/application/workspace-session"
import { getOptionalWorkosServerConfig } from "@/config/workos-runtime-config"

function parseE2eIdentity(): ExternalIdentity | null {
  if (import.meta.env.MODE !== "e2e") {
    return null
  }

  const expectedKey = process.env.FAIRLEND_E2E_AUTH_KEY
  const providedKey = getRequestHeader("x-fairlend-e2e-key")
  const serializedIdentity = getRequestHeader("x-fairlend-e2e-user")

  if (!expectedKey || providedKey !== expectedKey || !serializedIdentity) {
    return null
  }

  let value: unknown
  try {
    value = JSON.parse(serializedIdentity)
  } catch {
    return null
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("subject" in value) ||
    !("organizationId" in value) ||
    !("email" in value) ||
    !("displayName" in value) ||
    !("workosRole" in value) ||
    typeof value.subject !== "string" ||
    typeof value.organizationId !== "string" ||
    typeof value.email !== "string" ||
    typeof value.displayName !== "string" ||
    (typeof value.workosRole !== "string" && value.workosRole !== null)
  ) {
    return null
  }

  return {
    subject: value.subject,
    organizationId: value.organizationId,
    email: value.email,
    displayName: value.displayName,
    workosRole: value.workosRole,
  }
}

export function createRequestIdentityProvider(): IdentityProvider & {
  getAccessToken(): Promise<string | null>
  readonly isFixture: boolean
  readonly fixtureIdentity: ExternalIdentity | null
} {
  let accessToken: string | null = null
  const fixture = parseE2eIdentity()

  return {
    isFixture: fixture !== null,
    fixtureIdentity: fixture,
    async getIdentity() {
      if (fixture) {
        return fixture
      }

      if (!getOptionalWorkosServerConfig()) {
        return null
      }

      const auth = await getAuth()
      if (!auth.user) {
        return null
      }

      accessToken = auth.accessToken
      return {
        subject: auth.user.id,
        organizationId: auth.organizationId ?? "",
        email: auth.user.email,
        displayName:
          [auth.user.firstName, auth.user.lastName].filter(Boolean).join(" ") ||
          auth.user.email,
        workosRole: auth.role ?? null,
      }
    },
    async getAccessToken() {
      return accessToken
    },
  }
}
