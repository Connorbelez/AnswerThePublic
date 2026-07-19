import { createFileRoute } from "@tanstack/react-router"

import { createContentRequestServiceForApiRequest } from "@/application/content-request-api-service.server"
import { createSemanticConflictItemHandler } from "@/application/content-request-http"

export const Route = createFileRoute("/api/v1/semantic-conflicts/$conflictId")({
  server: {
    handlers: createSemanticConflictItemHandler((request) =>
      createContentRequestServiceForApiRequest(request)
    ),
  },
})
