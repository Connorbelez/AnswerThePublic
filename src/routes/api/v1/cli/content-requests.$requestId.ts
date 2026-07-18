import { createFileRoute } from "@tanstack/react-router"

import { createContentRequestItemHandler } from "@/application/content-request-http"
import { createContentRequestServiceForApiRequest } from "@/application/content-request-api-service.server"

export const Route = createFileRoute("/api/v1/cli/content-requests/$requestId")(
  {
    server: {
      handlers: createContentRequestItemHandler((request) =>
        createContentRequestServiceForApiRequest(request, "cli")
      ),
    },
  }
)
