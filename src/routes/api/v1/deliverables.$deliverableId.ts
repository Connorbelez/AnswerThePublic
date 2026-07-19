import { createFileRoute } from "@tanstack/react-router"

import { createContentRequestServiceForApiRequest } from "@/application/content-request-api-service.server"
import { createDeliverableItemHandler } from "@/application/content-request-http"

export const Route = createFileRoute("/api/v1/deliverables/$deliverableId")({
  server: {
    handlers: createDeliverableItemHandler((request) =>
      createContentRequestServiceForApiRequest(request)
    ),
  },
})
