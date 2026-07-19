import { useState } from "react"
import { useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"

import type { Deliverable } from "@/application/content-requests"
import {
  promoteDeliverableVersion,
  setPrimaryDeliverable,
} from "@/application/content-request-server-functions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function DeliverablePanel({
  humanId,
  deliverables,
}: {
  humanId: string
  deliverables: Array<Deliverable>
}) {
  const promote = useServerFn(promoteDeliverableVersion)
  const setPrimary = useServerFn(setPrimaryDeliverable)
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Deliverables</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p aria-live="polite" className="sr-only" role="status">
          {error ?? (pending ? "Updating deliverables" : "")}
        </p>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {deliverables.map((deliverable) => (
          <article
            key={deliverable.deliverableId}
            className="rounded-xl border p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-medium">{deliverable.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {deliverable.kind}
                </p>
              </div>
              {deliverable.isPrimary ? <Badge>Primary</Badge> : null}
            </div>
            <ol
              className="mt-3 grid gap-3"
              aria-label={`${deliverable.name} versions`}
            >
              {deliverable.versions.map((version) => {
                const promoted =
                  version.versionId === deliverable.promotedVersionId
                const candidate =
                  version.versionId === deliverable.currentCandidateVersionId
                return (
                  <li
                    key={version.versionId}
                    className="rounded-lg bg-muted/40 p-3"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                      <span>Version {version.ordinal}</span>
                      {promoted ? (
                        <Badge variant="secondary">Promoted</Badge>
                      ) : null}
                      {candidate && !promoted ? (
                        <Badge variant="outline">Candidate</Badge>
                      ) : null}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">
                      {version.body}
                    </p>
                    {!promoted ? (
                      <Button
                        className="mt-3"
                        size="sm"
                        variant="outline"
                        disabled={pending !== null}
                        aria-label={`Promote ${deliverable.name} version ${version.ordinal}`}
                        onClick={async () => {
                          setError(null)
                          setPending(version.versionId)
                          try {
                            const result = await promote({
                              data: {
                                deliverableId: deliverable.deliverableId,
                                versionId: version.versionId,
                                expectedPromotedVersionId:
                                  deliverable.promotedVersionId,
                                correlationId: crypto.randomUUID(),
                              },
                            })
                            if (result.outcome === "attention_required") {
                              setError(
                                `${deliverable.name} changed elsewhere. Resolve the queued conflict before promoting.`
                              )
                              return
                            }
                            await router.invalidate()
                          } catch {
                            setError(
                              `Could not promote ${deliverable.name} version ${version.ordinal}. Refresh and try again.`
                            )
                          } finally {
                            setPending(null)
                          }
                        }}
                      >
                        Promote version
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ol>
            {!deliverable.isPrimary ? (
              <Button
                className="mt-3"
                size="sm"
                variant="ghost"
                disabled={pending !== null}
                aria-label={`Make ${deliverable.name} primary`}
                onClick={async () => {
                  setError(null)
                  setPending(deliverable.deliverableId)
                  try {
                    const primary = deliverables.find(
                      (candidate) => candidate.isPrimary
                    )
                    if (!primary) throw new Error("Primary deliverable missing")
                    const result = await setPrimary({
                      data: {
                        humanId,
                        deliverableId: deliverable.deliverableId,
                        expectedPrimaryDeliverableId: primary.deliverableId,
                        correlationId: crypto.randomUUID(),
                      },
                    })
                    if (result.outcome === "attention_required") {
                      setError(
                        "The primary deliverable changed elsewhere. Resolve the queued conflict before retrying."
                      )
                      return
                    }
                    await router.invalidate()
                  } catch {
                    setError(
                      `Could not make ${deliverable.name} primary. Refresh and try again.`
                    )
                  } finally {
                    setPending(null)
                  }
                }}
              >
                Make primary
              </Button>
            ) : null}
          </article>
        ))}
      </CardContent>
    </Card>
  )
}
