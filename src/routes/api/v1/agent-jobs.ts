import { createFileRoute } from "@tanstack/react-router"

import { createContentRequestServiceForApiRequest } from "@/application/content-request-api-service.server"
import { createAgentJobCollectionHandler } from "@/application/content-request-http"

export const Route = createFileRoute("/api/v1/agent-jobs")({
  server: {
    handlers: createAgentJobCollectionHandler((request) =>
      createContentRequestServiceForApiRequest(request)
    ),
  },
})
