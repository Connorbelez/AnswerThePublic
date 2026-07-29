import { Clock3, LockKeyhole } from "lucide-react"

import type { GuestAccessView } from "@/application/content-requests"
import { FocusedProoflineBrief } from "@/components/focused-proofline-brief"
import { GuestResponseComposer } from "@/components/guest-response-composer"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase())
}

export function GuestAccessResponse({
  view,
  token,
}: {
  view: GuestAccessView
  token?: string
}) {
  if (view.status === "expired") {
    return (
      <SafeGuestAccessState
        title="This response link has expired"
        description="Your saved work remains in the existing response workspace. Ask the FairLend administrator who shared this link to renew access so you can continue."
      />
    )
  }

  if (view.status === "rate_limited") {
    return (
      <SafeGuestAccessState
        title="Please try again shortly"
        description="Too many access attempts were made from this network. No request information has been disclosed."
      />
    )
  }

  return (
    <main
      className="min-h-svh bg-[var(--workspace-paper)] pb-12"
      id="main-content"
    >
      <header className="border-b border-border/70 bg-background px-5 py-4 md:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div>
            <span className="wordmark">FairLend</span>
            <p className="text-xs text-muted-foreground">
              {view.interview ? "Expert response" : "Content response"}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <LockKeyhole className="size-4" aria-hidden="true" />
            No sign-in required
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-5 pt-6 md:px-10">
        <Alert>
          <Clock3 />
          <AlertTitle>Private response link</AlertTitle>
          <AlertDescription>
            This private response link expires{" "}
            <time dateTime={new Date(view.expiresAt).toISOString()}>
              {new Intl.DateTimeFormat("en-CA", {
                dateStyle: "long",
                timeStyle: "short",
                timeZone: "America/Toronto",
              }).format(view.expiresAt)}
            </time>
            .
          </AlertDescription>
        </Alert>
      </div>

      {view.interview ? (
        <FocusedProoflineBrief
          className="mt-6"
          eyebrow="Expert interview brief"
          requestTypeLabel="Expert interview"
          statusLabel="Ready for response"
          request={view.request}
          brief={{
            topic: view.interview.brief.topic,
            summary: view.interview.brief.summary,
            audience: view.interview.brief.audience,
            framing: [humanize(view.interview.brief.framing)],
            fairlendPosture: view.interview.brief.fairlendPosture,
            respondentContribution: view.interview.brief.founderContribution,
          }}
          questions={view.interview.questions.map((question) => ({
            id: question.id,
            question: question.question,
            motivation: question.motivation,
          }))}
          actionFooter={
            token && view.workspace ? (
              <GuestResponseComposer
                key={token}
                grantId={view.grantId}
                initialWorkspace={view.workspace}
                questions={view.questions}
                token={token}
              />
            ) : null
          }
        />
      ) : (
        <div className="mx-auto mt-6 max-w-5xl bg-background">
          <section
            aria-labelledby="standard-response-request-title"
            className="px-5 py-10 md:px-10"
          >
            <p className="text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
              Standard response request
            </p>
            <h1
              className="mt-3 text-3xl font-semibold tracking-[-0.04em]"
              id="standard-response-request-title"
            >
              {view.request.title}
            </h1>
            {view.request.brief.question ? (
              <div className="mt-6 rounded-2xl bg-muted/35 p-5">
                <p className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">
                  Response prompt
                </p>
                <p className="mt-2 text-base leading-7">
                  {view.request.brief.question}
                </p>
              </div>
            ) : null}
            {view.request.brief.body ? (
              <div className="mt-5">
                <p className="text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">
                  Source context
                </p>
                <div className="mt-2 text-sm leading-7 whitespace-pre-wrap text-muted-foreground">
                  {view.request.brief.body}
                </div>
              </div>
            ) : (
              <p className="mt-5 text-sm text-muted-foreground">
                Use the request title as your response prompt.
              </p>
            )}
          </section>
          {token && view.workspace ? (
            <GuestResponseComposer
              key={token}
              grantId={view.grantId}
              initialWorkspace={view.workspace}
              questions={view.questions}
              token={token}
            />
          ) : null}
        </div>
      )}
    </main>
  )
}

function SafeGuestAccessState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <main
      className="grid min-h-svh place-items-center bg-[var(--workspace-paper)] px-5 py-12"
      id="main-content"
    >
      <section className="w-full max-w-lg rounded-3xl border border-border/70 bg-background p-7 shadow-sm">
        <span className="wordmark">FairLend</span>
        <h1 className="mt-8 text-2xl font-semibold tracking-[-0.035em]">
          {title}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </section>
    </main>
  )
}
