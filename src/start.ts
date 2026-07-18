import {
  createCsrfMiddleware,
  createStart,
} from "@tanstack/react-start"
import { authkitMiddleware } from "@workos/authkit-tanstack-react-start"

import { getOptionalWorkosServerConfig } from "@/config/workos-runtime-config"

const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === "serverFn",
})

export const startInstance = createStart(() => ({
  requestMiddleware: [
    csrfMiddleware,
    ...(getOptionalWorkosServerConfig() ? [authkitMiddleware()] : []),
  ],
}))
