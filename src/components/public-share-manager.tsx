import { useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Copy, Link2, ShieldOff } from "lucide-react"

import type {
  ContentContextItem,
  Deliverable,
  PublicShareSummary,
} from "@/application/content-requests"
import {
  createPublicShare,
  revokePublicShare,
} from "@/application/content-request-server-functions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export function PublicShareManager({
  humanId,
  contextItems,
  deliverables,
  shares,
}: {
  humanId: string
  contextItems: Array<ContentContextItem>
  deliverables: Array<Deliverable>
  shares: Array<PublicShareSummary>
}) {
  const router = useRouter()
  const createShare = useServerFn(createPublicShare)
  const revokeShare = useServerFn(revokePublicShare)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Public sharing</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            setPending(true)
            setError(null)
            void createShare({
              data: {
                humanId,
                contextItemIds: data.getAll("contextItemId").map(String),
                deliverableIds: data.getAll("deliverableId").map(String),
                expiresAt: data.get("expiresAt")
                  ? new Date(String(data.get("expiresAt"))).getTime()
                  : undefined,
                correlationId: crypto.randomUUID(),
              },
            })
              .then(async (result) => {
                setCreatedUrl(`${window.location.origin}/share/${result.token}`)
                await router.invalidate()
              })
              .catch(() => setError("The public link could not be created."))
              .finally(() => setPending(false))
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Brief sections</legend>
            {contextItems
              .filter((item) =>
                [
                  "source_summary",
                  "talking_points",
                  "research_requirements",
                  "missing_research",
                  "citations",
                ].includes(item.kind)
              )
              .map((item) => (
                <label
                  key={item.contextId}
                  className="flex min-h-11 items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="contextItemId"
                    value={item.contextId}
                  />
                  {item.title}
                </label>
              ))}
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">
              Promoted deliverables
            </legend>
            {deliverables
              .filter((item) => item.promotedVersionId)
              .map((item) => (
                <label
                  key={item.deliverableId}
                  className="flex min-h-11 items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    name="deliverableId"
                    value={item.deliverableId}
                  />
                  {item.name}
                </label>
              ))}
          </fieldset>
          <label className="grid gap-1 text-sm font-medium">
            Optional expiry
            <Input type="datetime-local" name="expiresAt" />
          </label>
          <Button type="submit" disabled={pending}>
            <Link2 /> Create public link
          </Button>
        </form>
        {createdUrl ? (
          <div className="grid gap-2 rounded-xl border p-3">
            <a
              className="text-sm break-all underline"
              href={createdUrl}
              target="_blank"
              rel="noreferrer"
            >
              {createdUrl}
            </a>
            <Button
              type="button"
              variant="outline"
              onClick={() => void navigator.clipboard.writeText(createdUrl)}
            >
              <Copy /> Copy link
            </Button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {shares.map((share) => (
          <div
            key={share.shareId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm"
          >
            <div>
              <p>
                {share.briefSectionCount} brief sections ·{" "}
                {share.deliverableCount} deliverables
              </p>
              <p className="text-muted-foreground">
                Created {new Date(share.createdAt).toLocaleString()}
              </p>
            </div>
            <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setPending(true)
                  void revokeShare({
                    data: {
                      shareId: share.shareId,
                      correlationId: crypto.randomUUID(),
                    },
                  })
                    .then(() => router.invalidate())
                    .finally(() => setPending(false))
                }}
                disabled={pending}
              >
                <ShieldOff /> Revoke
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
