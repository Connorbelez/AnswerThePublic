import { createFileRoute } from "@tanstack/react-router"

const MAX_E2E_UPLOAD_BYTES = 15 * 1024 * 1024

export const Route = createFileRoute("/api/e2e/storage-upload")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        if (import.meta.env.MODE !== "e2e")
          return new Response(null, { status: 404 })
        const session = new URL(request.url).searchParams.get("session")
        if (!session || session.length > 200)
          return Response.json(
            { error: { code: "INVALID_UPLOAD_SESSION" } },
            { status: 400 }
          )
        const bytes = await request.arrayBuffer()
        if (!bytes.byteLength || bytes.byteLength > MAX_E2E_UPLOAD_BYTES)
          return Response.json(
            { error: { code: "INVALID_UPLOAD_SIZE" } },
            { status: 400 }
          )
        const { getPublicConvexTestWorkspace } =
          await import("@/infrastructure/convex-test-workspace.server")
        const storageId = await getPublicConvexTestWorkspace().run((ctx) =>
          ctx.storage.store(
            new Blob([bytes], {
              type:
                request.headers.get("content-type") ??
                "application/octet-stream",
            })
          )
        )
        return Response.json({ storageId })
      },
    },
  },
})
