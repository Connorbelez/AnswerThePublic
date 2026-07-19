import { createFileRoute } from "@tanstack/react-router"

import { createContentRequestServiceForApiRequest } from "@/application/content-request-api-service.server"
import { createSemanticConflictCollectionHandler } from "@/application/content-request-http"

export const Route = createFileRoute(
  "/api/v1/content-requests/$requestId/semantic-conflicts"
)({
  server: {
    handlers: createSemanticConflictCollectionHandler((request) =>
      createContentRequestServiceForApiRequest(request)
    ),
  },
})
