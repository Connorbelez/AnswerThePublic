import { WorkOS } from "@workos-inc/node"

import { getWorkosServerConfig } from "@/config/workos-runtime-config"

export type ValidatedAgentInstallation = {
  subject: string
  organizationId: string
  credentialId: string
}

export async function validateWorkosAgentCredential(
  credential: string
): Promise<ValidatedAgentInstallation | null> {
  const config = getWorkosServerConfig()
  const workos = new WorkOS(config.apiKey, { clientId: config.clientId })
  const isAccessToken = credential.split(".").length === 3
  const validation = await workos.agents.validateCredential(
    isAccessToken
      ? { type: "access_token", credential, checkForRevoked: true }
      : { type: "api_key", credential }
  )
  if (!validation.valid) return null
  const registration = await workos.agents.getRegistration(
    validation.registrationId
  )
  if (
    registration.status !== "verified" ||
    registration.organizationId !== config.organizationId
  )
    return null
  return {
    subject: `workos-agent:${registration.agentIdentity.id}`,
    organizationId: registration.organizationId,
    credentialId:
      validation.claims?.jti ?? `workos-registration:${registration.id}`,
  }
}
