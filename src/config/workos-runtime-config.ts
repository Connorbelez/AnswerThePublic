export type WorkosServerConfig = {
  clientId: string
  apiKey: string
  redirectUri: string
  cookiePassword: string
  organizationId: string
}

const environmentKeys = [
  "WORKOS_CLIENT_ID",
  "WORKOS_API_KEY",
  "WORKOS_REDIRECT_URI",
  "WORKOS_COOKIE_PASSWORD",
  "WORKOS_ORGANIZATION_ID",
] as const

export function getOptionalWorkosServerConfig(): WorkosServerConfig | null {
  const values = environmentKeys.map((key) => process.env[key])
  if (values.every((value) => !value)) {
    return null
  }

  const missing = environmentKeys.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(
      `Incomplete WorkOS configuration. Missing: ${missing.join(", ")}.`
    )
  }

  return {
    clientId: process.env.WORKOS_CLIENT_ID!,
    apiKey: process.env.WORKOS_API_KEY!,
    redirectUri: process.env.WORKOS_REDIRECT_URI!,
    cookiePassword: process.env.WORKOS_COOKIE_PASSWORD!,
    organizationId: process.env.WORKOS_ORGANIZATION_ID!,
  }
}

export function getWorkosServerConfig(): WorkosServerConfig {
  const config = getOptionalWorkosServerConfig()
  if (!config) {
    throw new Error("WorkOS is not configured for this runtime.")
  }
  return config
}
