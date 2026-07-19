import { createFileRoute } from "@tanstack/react-router"

import { createContentRequestServiceForApiRequest } from "@/application/content-request-api-service.server"
import { createDeliveryTargetItemHandler } from "@/application/content-request-http"

export const Route = createFileRoute("/api/v1/delivery-targets/$targetId")({
  server: {
    handlers: createDeliveryTargetItemHandler((request) =>
      createContentRequestServiceForApiRequest(request)
    ),
  },
})
