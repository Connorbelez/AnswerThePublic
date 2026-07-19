import { createFileRoute } from "@tanstack/react-router"

import { createAgentControlHandler } from "@/application/agent-control-http"
import { createContentRequestServiceForApiRequest } from "@/application/content-request-api-service.server"

export const Route = createFileRoute("/api/v1/control")({
  server: {
    handlers: createAgentControlHandler((request) =>
      createContentRequestServiceForApiRequest(request, "http_api")
    ),
  },
})
