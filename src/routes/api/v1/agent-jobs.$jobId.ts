import { createFileRoute } from "@tanstack/react-router"

import { createContentRequestServiceForApiRequest } from "@/application/content-request-api-service.server"
import { createAgentJobItemHandler } from "@/application/content-request-http"

export const Route = createFileRoute("/api/v1/agent-jobs/$jobId")({
  server: {
    handlers: createAgentJobItemHandler((request) =>
      createContentRequestServiceForApiRequest(request)
    ),
  },
})
