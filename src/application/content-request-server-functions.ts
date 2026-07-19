import { createServerFn } from "@tanstack/react-start"

import type {
  AssignRequestInput,
  CreateManualRequestInput,
} from "@/application/content-requests"

export const listContentRequests = createServerFn({ method: "POST" }).handler(
  async () => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).list()
  }
)

export const getContentRequest = createServerFn({ method: "POST" })
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

export const openContentRequest = createServerFn({ method: "POST" })
  .validator((data: { humanId: string; correlationId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).open(
      data.humanId,
      data.correlationId
    )
  })

export const listAssignablePrincipals = createServerFn({
  method: "POST",
}).handler(async () => {
  const { createContentRequestServiceFromRequest } =
    await import("@/application/content-request-service-request.server")
  return (
    await createContentRequestServiceFromRequest()
  ).listAssignablePrincipals()
})

export const assignContentRequest = createServerFn({ method: "POST" })
  .validator((data: AssignRequestInput) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (await createContentRequestServiceFromRequest()).assign(data)
  })

export const listMyNotifications = createServerFn({ method: "POST" }).handler(
  async () => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    return (
      await createContentRequestServiceFromRequest()
    ).listMyNotifications()
  }
)

export const markMyNotificationRead = createServerFn({ method: "POST" })
  .validator((data: { notificationId: string }) => data)
  .handler(async ({ data }) => {
    const { createContentRequestServiceFromRequest } =
      await import("@/application/content-request-service-request.server")
    await (
      await createContentRequestServiceFromRequest()
    ).markNotificationRead(data.notificationId)
  })
