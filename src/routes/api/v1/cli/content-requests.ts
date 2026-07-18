import { createFileRoute } from "@tanstack/react-router"

import { createContentRequestCollectionHandler } from "@/application/content-request-http"
import { createContentRequestServiceForApiRequest } from "@/application/content-request-api-service.server"

export const Route = createFileRoute("/api/v1/cli/content-requests")({
  server: {
    handlers: createContentRequestCollectionHandler((request) =>
      createContentRequestServiceForApiRequest(request, "cli")
    ),
  },
})
