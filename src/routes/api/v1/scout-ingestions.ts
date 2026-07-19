import { createFileRoute } from "@tanstack/react-router"

import { createScoutIngestionHandler } from "@/application/scout-ingestion-http"
import { createScoutIngestionServiceForRequest } from "@/application/scout-ingestion-service-request.server"

export const Route = createFileRoute("/api/v1/scout-ingestions")({
  server: {
    handlers: createScoutIngestionHandler(
      createScoutIngestionServiceForRequest
    ),
  },
})
