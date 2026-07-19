import { createFileRoute } from "@tanstack/react-router"

import { createChatGptAppHandler } from "@/application/chatgpt-app"
import { createContentRequestServiceForAgentApiRequest } from "@/application/content-request-api-service.server"

export const Route = createFileRoute("/api/chatgpt/mcp")({
  server: {
    handlers: createChatGptAppHandler((request) =>
      createContentRequestServiceForAgentApiRequest(request, "chatgpt_app")
    ),
  },
})
