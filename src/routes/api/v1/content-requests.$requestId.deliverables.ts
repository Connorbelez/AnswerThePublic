import { createFileRoute } from "@tanstack/react-router"

import { createContentRequestServiceForApiRequest } from "@/application/content-request-api-service.server"
import { createDeliverableCollectionHandler } from "@/application/content-request-http"

export const Route = createFileRoute(
  "/api/v1/content-requests/$requestId/deliverables"
)({
  server: {
    handlers: createDeliverableCollectionHandler((request) =>
      createContentRequestServiceForApiRequest(request)
    ),
  },
})
