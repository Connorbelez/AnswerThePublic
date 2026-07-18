import { createServerFn } from "@tanstack/react-start"

import type { CreateManualRequestInput } from "@/application/content-requests"

export const listContentRequests = createServerFn({ method: "GET" }).handler(
  async () => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).list()
  }
)

export const getContentRequest = createServerFn({ method: "GET" })
  .validator((data: { humanId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).getByHumanId(
      data.humanId
    )
  })

export const createManualContentRequest = createServerFn({ method: "POST" })
  .validator((data: CreateManualRequestInput) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).createManual(data)
  })
