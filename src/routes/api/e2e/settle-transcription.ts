import { createFileRoute } from "@tanstack/react-router"

import { createRequestIdentityProvider } from "@/infrastructure/request-identity"

export const Route = createFileRoute("/api/e2e/settle-transcription")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        if (import.meta.env.MODE !== "e2e")
          return new Response(null, { status: 404 })
        const identities = createRequestIdentityProvider()
        const identity = await identities.getIdentity()
        if (!identities.isFixture || !identity)
          return Response.json(
            { error: { code: "UNAUTHENTICATED" } },
            { status: 401 }
          )
        const input = (await request.json()) as Record<string, unknown>
        if (
          typeof input.fileName !== "string" ||
          !input.fileName.trim() ||
          input.fileName.length > 200
        )
          return Response.json(
            { error: { code: "VALIDATION_FAILED" } },
            { status: 400 }
          )
        const { getPublicConvexTestWorkspace } =
          await import("@/infrastructure/convex-test-workspace.server")
        const assetId = await getPublicConvexTestWorkspace().run(
          async (ctx) => {
            const assets = await ctx.db.query("responseAssets").collect()
            const asset = assets
              .filter(
                (candidate) =>
                  candidate.organizationId === identity.organizationId &&
                  candidate.fileName === input.fileName &&
                  candidate.kind === "audio" &&
                  !candidate.discardedAt
              )
              .sort((left, right) => right.createdAt - left.createdAt)[0]
            if (!asset) throw new Error("Audio E2E fixture not found.")
            const workspace = await ctx.db.get(asset.workspaceId)
            if (!workspace) throw new Error("Audio workspace not found.")
            const now = Date.now()
            await ctx.db.patch(asset._id, {
              transcriptionState: "transcribed",
              transcript:
                "E2E transcript: call the closing lawyer and verify the payout statement.",
              transcriptVersion: asset.transcriptVersion + 1,
              failureCode: undefined,
              transcriptionLeaseExpiresAt: undefined,
              version: asset.version + 1,
              updatedAt: now,
            })
            await ctx.db.patch(workspace._id, {
              pendingRequiredOperationIds: (
                workspace.pendingRequiredOperationIds ?? []
              ).filter((value) => value !== `asset:${asset._id}`),
              updatedAt: now,
            })
            return asset._id
          }
        )
        return Response.json({ data: { assetId } })
      },
    },
  },
})
