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
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"

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
        <CardTitle as="h2">Public sharing</CardTitle>
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
          <FieldSet className="gap-2">
            <FieldLegend variant="label">Brief sections</FieldLegend>
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
                <Field key={item.contextId} orientation="horizontal">
                  <Checkbox
                    id={`context-item-${item.contextId}`}
                    name="contextItemId"
                    value={item.contextId}
                  />
                  <FieldLabel htmlFor={`context-item-${item.contextId}`}>
                    {item.title}
                  </FieldLabel>
                </Field>
              ))}
          </FieldSet>
          <FieldSet className="gap-2">
            <FieldLegend variant="label">Promoted deliverables</FieldLegend>
            {deliverables
              .filter((item) => item.promotedVersionId)
              .map((item) => (
                <Field key={item.deliverableId} orientation="horizontal">
                  <Checkbox
                    id={`deliverable-${item.deliverableId}`}
                    name="deliverableId"
                    value={item.deliverableId}
                  />
                  <FieldLabel htmlFor={`deliverable-${item.deliverableId}`}>
                    {item.name}
                  </FieldLabel>
                </Field>
              ))}
          </FieldSet>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="public-share-expiry">
                Optional expiry
              </FieldLabel>
              <Input
                id="public-share-expiry"
                type="datetime-local"
                name="expiresAt"
              />
            </Field>
          </FieldGroup>
          <Button type="submit" disabled={pending}>
            <Link2 /> Create public link
          </Button>
        </form>
        {createdUrl ? (
          <Item variant="outline">
            <ItemContent className="min-w-0">
              <ItemTitle>New public link</ItemTitle>
              <ItemDescription className="line-clamp-none break-all">
                <a href={createdUrl} target="_blank" rel="noreferrer">
                  {createdUrl}
                </a>
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => void navigator.clipboard.writeText(createdUrl)}
              >
                <Copy /> Copy link
              </Button>
            </ItemActions>
          </Item>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {shares.map((share) => (
          <Item key={share.shareId} variant="outline">
            <ItemContent>
              <ItemTitle>
                {share.briefSectionCount} brief sections ·{" "}
                {share.deliverableCount} deliverables
              </ItemTitle>
              <ItemDescription>
                Created {new Date(share.createdAt).toLocaleString()}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                type="button"
                size="sm-touch"
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
            </ItemActions>
          </Item>
        ))}
      </CardContent>
    </Card>
  )
}
