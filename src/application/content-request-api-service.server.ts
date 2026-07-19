import { createContentRequestService } from "@/application/content-requests"
import { createContentRequestServiceFromRequest } from "@/application/content-request-service-request.server"
import {
  resolveAgentApiBearer,
  type AgentCredentialValidator,
} from "@/application/agent-api-auth.server"
import { createConvexContentRequestRepository } from "@/infrastructure/convex-content-request-repository"
import { validateWorkosAgentCredential } from "@/infrastructure/workos-agent-credential.server"
import { AuthenticationRequiredError } from "@/application/workspace-session"

export async function createContentRequestServiceForApiRequest(
  request: Request,
  creationOrigin: "http_api" | "cli" | "chatgpt_app" = "http_api",
  validateAgentCredential: AgentCredentialValidator = validateWorkosAgentCredential
) {
  const authorization = request.headers.get("authorization")
  if (authorization?.startsWith("Bearer ")) {
    const { accessToken, adminIdentity } = await resolveAgentApiBearer(
      request,
      validateAgentCredential
    )
    return createContentRequestService(
      createConvexContentRequestRepository({
        getAccessToken: async () => accessToken,
        getAdminIdentity: async () => adminIdentity,
      }),
      creationOrigin
    )
  }
  return createContentRequestServiceFromRequest(creationOrigin)
}

/** Agent-only bearer factory for private machine connectors such as ChatGPT. */
export async function createContentRequestServiceForAgentApiRequest(
  request: Request,
  creationOrigin: "chatgpt_app" | "cli" | "http_api",
  validateAgentCredential: AgentCredentialValidator = validateWorkosAgentCredential
) {
  const { adminIdentity } = await resolveAgentApiBearer(
    request,
    validateAgentCredential
  )
  if (!adminIdentity) throw new AuthenticationRequiredError()
  return createContentRequestService(
    createConvexContentRequestRepository({
      getAccessToken: async () => null,
      getAdminIdentity: async () => adminIdentity,
    }),
    creationOrigin
  )
}
