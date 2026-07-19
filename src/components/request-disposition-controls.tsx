import { useEffect, useState } from "react"
import { Link, useRouter } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"

import {
  archiveContentRequest,
  createContentRequestFollowUp,
  expireContentRequest,
  restoreArchivedContentRequest,
  restoreExpiredContentRequest,
  setContentRequestExpiration,
} from "@/application/content-request-server-functions"
import type {
  ContentRequest,
  ContentRequestRelations,
} from "@/application/content-requests"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

function dateInputValue(value: number | null) {
  if (!value) return ""
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function endOfLocalDate(value: FormDataEntryValue | null) {
  const date = String(value ?? "").trim()
  if (!date) return null
  const timestamp = new Date(`${date}T23:59:59.999`).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

export function RequestDispositionControls({
  request,
  relations,
}: {
  request: ContentRequest
  relations: ContentRequestRelations
}) {
  const router = useRouter()
  const setExpiration = useServerFn(setContentRequestExpiration)
  const expire = useServerFn(expireContentRequest)
  const restoreExpired = useServerFn(restoreExpiredContentRequest)
  const archive = useServerFn(archiveContentRequest)
  const restoreArchived = useServerFn(restoreArchivedContentRequest)
  const createFollowUp = useServerFn(createContentRequestFollowUp)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!request.retentionTransition) return
    const poll = window.setInterval(() => void router.invalidate(), 500)
    return () => window.clearInterval(poll)
  }, [request.retentionTransition, router])

  async function run(name: string, operation: () => Promise<unknown>) {
    setBusy(name)
    setError(null)
    try {
      await operation()
      await router.invalidate()
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The request was not updated."
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifecycle and related work</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-2 text-sm">
          <p>
            <strong>Retention:</strong> {request.retention}
            {request.archivedAt
              ? ` · archived ${new Date(request.archivedAt).toLocaleString()}`
              : ""}
          </p>
          <p>
            <strong>Disposition:</strong> {request.disposition}
            {request.expiredAt
              ? ` · expired ${new Date(request.expiredAt).toLocaleString()}`
              : ""}
          </p>
          {request.expirationReason ? (
            <p>
              <strong>Expiration reason:</strong> {request.expirationReason}
            </p>
          ) : null}
          {request.expirationReviewRequiredAt ? (
            <p className="text-destructive">
              Started work was protected from automatic expiration. Review it
              before changing disposition.
            </p>
          ) : null}
        </div>

        {request.retention === "archived" ? (
          <Button
            type="button"
            disabled={busy !== null || request.retentionTransition !== null}
            onClick={() =>
              void run("restore-archive", () =>
                restoreArchived({
                  data: {
                    humanId: request.humanId,
                    correlationId: crypto.randomUUID(),
                  },
                })
              )
            }
          >
            {busy === "restore-archive" ||
            request.retentionTransition === "restoring"
              ? "Restoring…"
              : request.retentionTransition === "archiving"
                ? "Archiving…"
                : "Restore request"}
          </Button>
        ) : (
          <>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                const form = new FormData(event.currentTarget)
                const expiresAt = endOfLocalDate(form.get("expiresAt"))
                void run("expiration", () =>
                  request.disposition === "expired"
                    ? restoreExpired({
                        data: {
                          humanId: request.humanId,
                          expiresAt,
                          correlationId: crypto.randomUUID(),
                        },
                      })
                    : setExpiration({
                        data: {
                          humanId: request.humanId,
                          expiresAt,
                          correlationId: crypto.randomUUID(),
                        },
                      })
                )
              }}
            >
              <Field>
                <FieldLabel htmlFor="request-expires-at">
                  {request.disposition === "expired"
                    ? "Replacement expiration (optional)"
                    : "Expiration date (optional)"}
                </FieldLabel>
                <Input
                  id="request-expires-at"
                  name="expiresAt"
                  type="date"
                  defaultValue={dateInputValue(request.expiresAt)}
                />
              </Field>
              <Button type="submit" disabled={busy !== null}>
                {busy === "expiration"
                  ? "Saving…"
                  : request.disposition === "expired"
                    ? "Restore from Expired"
                    : "Save expiration"}
              </Button>
            </form>

            {request.disposition === "active" ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy !== null}
                onClick={() =>
                  void run("expire", () =>
                    expire({
                      data: {
                        humanId: request.humanId,
                        reason: "Manually expired by editor",
                        correlationId: crypto.randomUUID(),
                      },
                    })
                  )
                }
              >
                {busy === "expire" ? "Expiring…" : "Move to Expired"}
              </Button>
            ) : null}

            <Button
              type="button"
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void run("archive", () =>
                  archive({
                    data: {
                      humanId: request.humanId,
                      correlationId: crypto.randomUUID(),
                    },
                  })
                )
              }
            >
              {busy === "archive" ? "Archiving…" : "Archive request"}
            </Button>
          </>
        )}

        <div className="grid gap-2">
          <h3 className="font-medium">Related requests</h3>
          {relations.parent ? (
            <p className="text-sm">
              Follow-up to{" "}
              <Link
                className="underline underline-offset-4"
                to="/app/requests/$requestId"
                params={{ requestId: relations.parent.humanId }}
              >
                {relations.parent.humanId} · {relations.parent.title}
              </Link>
            </p>
          ) : null}
          {relations.children.map((child) => (
            <Link
              key={child.requestId}
              className="text-sm underline underline-offset-4"
              to="/app/requests/$requestId"
              params={{ requestId: child.humanId }}
            >
              {child.humanId} · {child.title}
            </Link>
          ))}
          {relations.childrenTruncated ? (
            <p className="text-sm text-muted-foreground">
              Showing the first 100 linked follow-ups. Use request search to
              find older related work.
            </p>
          ) : null}
          {!relations.parent && relations.children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No linked follow-ups yet.
            </p>
          ) : null}
        </div>

        {request.retention === "active" ? (
          <form
            className="grid gap-3 border-t pt-5"
            onSubmit={(event) => {
              event.preventDefault()
              const formElement = event.currentTarget
              const form = new FormData(formElement)
              void run("follow-up", async () => {
                const child = await createFollowUp({
                  data: {
                    parentHumanId: request.humanId,
                    title: String(form.get("title") ?? ""),
                    reason: String(form.get("reason") ?? ""),
                    source: {
                      question: String(form.get("question") ?? "") || undefined,
                      url: String(form.get("url") ?? "") || undefined,
                    },
                    correlationId: crypto.randomUUID(),
                  },
                })
                formElement.reset()
                await router.navigate({
                  to: "/app/requests/$requestId",
                  params: { requestId: child.humanId },
                })
              })
            }}
          >
            <h3 className="font-medium">Create a linked follow-up</h3>
            <Field>
              <FieldLabel htmlFor="follow-up-title">Title</FieldLabel>
              <Input id="follow-up-title" name="title" required />
            </Field>
            <Field>
              <FieldLabel htmlFor="follow-up-question">
                Original follow-up question (optional)
              </FieldLabel>
              <Textarea id="follow-up-question" name="question" />
            </Field>
            <Field>
              <FieldLabel htmlFor="follow-up-url">
                Source URL (optional)
              </FieldLabel>
              <Input id="follow-up-url" name="url" type="url" />
            </Field>
            <Field>
              <FieldLabel htmlFor="follow-up-reason">
                Why this is a new obligation
              </FieldLabel>
              <Input id="follow-up-reason" name="reason" required />
            </Field>
            <Button type="submit" disabled={busy !== null}>
              {busy === "follow-up" ? "Creating…" : "Create follow-up"}
            </Button>
          </form>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </CardContent>
    </Card>
  )
}
