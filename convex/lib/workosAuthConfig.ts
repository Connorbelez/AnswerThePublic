export function createWorkosAuthConfig(clientId: string) {
  const normalizedClientId = clientId.trim()
  if (!normalizedClientId) {
    throw new Error(
      "WORKOS_CLIENT_ID must be configured in the Convex deployment."
    )
  }

  const jwks = `https://api.workos.com/sso/jwks/${normalizedClientId}`
  return {
    providers: [
      {
        type: "customJwt" as const,
        issuer: "https://api.workos.com/",
        algorithm: "RS256" as const,
        jwks,
        applicationID: normalizedClientId,
      },
      {
        type: "customJwt" as const,
        issuer: `https://api.workos.com/user_management/${normalizedClientId}`,
        algorithm: "RS256" as const,
        jwks,
      },
    ],
  }
}
