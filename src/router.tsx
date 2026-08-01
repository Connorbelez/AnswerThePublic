import { createRouter as createTanStackRouter } from "@tanstack/react-router"

import { routeTree } from "./routeTree.gen"
import { RoutePendingFallback } from "./components/route-fallback"

export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadDelay: 40,
    defaultPreloadStaleTime: 10_000,
    defaultPendingMs: 80,
    defaultPendingMinMs: 140,
    defaultPendingComponent: RoutePendingFallback,
    defaultViewTransition: {
      types: ({ fromLocation, toLocation, pathChanged }) => {
        const fromApp = fromLocation?.pathname.startsWith("/app") ?? false
        const toApp = toLocation.pathname.startsWith("/app")
        return pathChanged && fromApp && toApp
          ? ["workspace-navigation"]
          : false
      },
    },
  })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
