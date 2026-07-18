import { createFileRoute } from "@tanstack/react-router"

import { createContentRequestItemHandler } from "@/application/content-request-http"
import { createContentRequestServiceForApiRequest } from "@/application/content-request-api-service.server"

export const Route = createFileRoute("/api/v1/content-requests/$requestId")({
  server: {
    handlers: createContentRequestItemHandler((request) =>
      createContentRequestServiceForApiRequest(request, "http_api")
    ),
  },
})
