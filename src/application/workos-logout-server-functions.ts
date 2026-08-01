import { createServerFn } from "@tanstack/react-start"

/**
 * Resolve the absolute post-logout URL without exposing server-only request and
 * environment access to the client route graph.
 */
export const getWorkosLogoutReturnTo = createServerFn({
  method: "GET",
}).handler(async () => {
  const { resolveWorkosLogoutReturnTo } =
    await import("@/infrastructure/workos-logout-return-to.server")

  return resolveWorkosLogoutReturnTo("/")
})
