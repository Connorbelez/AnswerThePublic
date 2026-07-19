import { AuthenticationRequiredError } from "@/application/workspace-session"
import {
  validateWorkosAgentCredential,
  type ValidatedAgentInstallation,
} from "@/infrastructure/workos-agent-credential.server"

export type AgentCredentialValidator = (
  credential: string
) => Promise<ValidatedAgentInstallation | null>

function looksLikeWorkosAgentJwt(token: string) {
  const payload = token.split(".")[1]
  if (!payload) return false
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/")
    const value = JSON.parse(
      atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))
    ) as Record<string, unknown>
    return typeof value.sub === "string" && value.sub.startsWith("agent_reg_")
  } catch {
    return false
  }
}

/**
 * Resolves a bearer token once for every server adapter. Opaque credentials
 * and WorkOS Agent JWTs always fail closed through WorkOS; only non-agent JWTs
 * may continue through the regular Convex/WorkOS human session path.
 */
export async function resolveAgentApiBearer(
  request: Request,
  validateAgentCredential: AgentCredentialValidator = validateWorkosAgentCredential
) {
  const authorization = request.headers.get("authorization")
  if (!authorization?.startsWith("Bearer "))
    throw new AuthenticationRequiredError()
  const token = authorization.slice("Bearer ".length).trim()
  if (!token) throw new AuthenticationRequiredError()
  const isOpaqueAgentKey = token.split(".").length !== 3
  const installation = await validateAgentCredential(token)
  if ((isOpaqueAgentKey || looksLikeWorkosAgentJwt(token)) && !installation)
    throw new AuthenticationRequiredError()
  const adminKey = installation
    ? process.env.FAIRLEND_CONVEX_AGENT_ADMIN_KEY
    : null
  if (installation && !adminKey)
    throw new Error("FAIRLEND_CONVEX_AGENT_ADMIN_KEY is required.")
  return {
    accessToken: installation ? null : token,
    adminIdentity:
      installation && adminKey ? { ...installation, adminKey } : null,
  }
}
