import { createContentRequestService } from "@/application/content-requests"
import { createContentRequestServiceFromRequest } from "@/application/content-request-service-request.server"
import { AuthenticationRequiredError } from "@/application/workspace-session"
import { createConvexContentRequestRepository } from "@/infrastructure/convex-content-request-repository"

export async function createContentRequestServiceForApiRequest(
  request: Request,
  creationOrigin: "http_api" | "cli" = "http_api"
) {
  const authorization = request.headers.get("authorization")
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim()
    if (!token) throw new AuthenticationRequiredError()
    return createContentRequestService(
      createConvexContentRequestRepository({
        getAccessToken: async () => token,
      }),
      creationOrigin
    )
  }
  return createContentRequestServiceFromRequest(creationOrigin)
}
