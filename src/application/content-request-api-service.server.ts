import { createContentRequestService } from "@/application/content-requests"
import { createContentRequestServiceFromRequest } from "@/application/content-request-service-request.server"
import {
  resolveAgentApiBearer,
  type AgentCredentialValidator,
} from "@/application/agent-api-auth.server"
import { createConvexContentRequestRepository } from "@/infrastructure/convex-content-request-repository"
import { validateWorkosAgentCredential } from "@/infrastructure/workos-agent-credential.server"

export async function createContentRequestServiceForApiRequest(
  request: Request,
  creationOrigin: "http_api" | "cli" = "http_api",
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
