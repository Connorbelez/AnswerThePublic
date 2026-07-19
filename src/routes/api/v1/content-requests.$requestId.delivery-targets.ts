import { createFileRoute } from "@tanstack/react-router"

import { createContentRequestServiceForApiRequest } from "@/application/content-request-api-service.server"
import { createDeliveryTargetCollectionHandler } from "@/application/content-request-http"

export const Route = createFileRoute(
  "/api/v1/content-requests/$requestId/delivery-targets"
)({
  server: {
    handlers: createDeliveryTargetCollectionHandler((request) =>
      createContentRequestServiceForApiRequest(request)
    ),
  },
})
