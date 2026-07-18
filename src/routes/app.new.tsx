import { useState } from "react"
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { ArrowLeft, LoaderCircle } from "lucide-react"

import { createManualContentRequest } from "@/application/content-request-server-functions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export const Route = createFileRoute("/app/new")({
  component: NewRequestPage,
})

function NewRequestPage() {
  const createRequest = useServerFn(createManualContentRequest)
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  return (
    <main className="workspace workspace--narrow">
      <Button variant="ghost" render={<Link to="/app" />}>
        <ArrowLeft data-icon="inline-start" />
        Content requests
      </Button>
      <Card className="request-form-card">
        <CardHeader>
          <CardTitle>Create a Content Request</CardTitle>
          <p>
            Direct asks are Critical by default. Add only what you know—the rest
            can stay blank.
          </p>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={async (event) => {
              event.preventDefault()
              setSubmitting(true)
              setError(null)
              const form = new FormData(event.currentTarget)
              const title = String(form.get("title") ?? "").trim()
              const source = {
                question: String(form.get("question") ?? ""),
                body: String(form.get("body") ?? ""),
                url: String(form.get("url") ?? ""),
              }
              try {
                const created = await createRequest({
                  data: {
                    title,
                    source: Object.values(source).some(
                      (value) => value.length > 0
                    )
                      ? Object.fromEntries(
                          Object.entries(source).filter(([, value]) => value)
                        )
                      : undefined,
                    correlationId: crypto.randomUUID(),
                  },
                })
                await navigate({
                  to: "/app/requests/$requestId",
                  params: { requestId: created.humanId },
                })
              } catch (submissionError) {
                setError(
                  submissionError instanceof Error
                    ? submissionError.message
                    : "The request could not be created."
                )
                setSubmitting(false)
              }
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="title">Title</FieldLabel>
                <Input
                  id="title"
                  name="title"
                  required
                  autoFocus
                  placeholder="What does Elie need to respond to?"
                />
                <FieldDescription>The only required field.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="question">Original question</FieldLabel>
                <Textarea
                  id="question"
                  name="question"
                  placeholder="Paste the question exactly as it appeared."
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="body">Original source material</FieldLabel>
                <Textarea
                  id="body"
                  name="body"
                  placeholder="Optional post body, request text, or source notes."
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="url">Source URL</FieldLabel>
                <Input
                  id="url"
                  name="url"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                />
              </Field>
            </FieldGroup>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="form-actions">
              <Button variant="ghost" render={<Link to="/app" />}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <LoaderCircle className="animate-spin" /> : null}
                Create Critical request
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
