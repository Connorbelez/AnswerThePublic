import { CircleAlert, RotateCcw, SearchX } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ButtonAnchor } from "@/components/ui/button-link"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function RouteErrorFallback({ reset }: { reset: () => void }) {
  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand" aria-label="FairLend Content Requests">
        <span className="wordmark">FairLend</span>
        <p>Content Requests</p>
      </section>
      <Card className="auth-card" role="alert">
        <CardHeader>
          <span className="auth-icon" aria-hidden="true">
            <CircleAlert />
          </span>
          <CardTitle as="h1" className="text-2xl">
            We couldn&apos;t load this page
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="auth-assurance">
            The route failed while loading. Try it again; if the problem
            continues, refresh the browser to request a fresh application
            bundle.
          </p>
        </CardContent>
        <CardFooter>
          <Button size="lg" className="w-full justify-between" onClick={reset}>
            Try again
            <RotateCcw data-icon="inline-end" />
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}

export function RouteNotFoundFallback() {
  return (
    <main className="auth-page" id="main-content">
      <section className="auth-brand" aria-label="FairLend Content Requests">
        <span className="wordmark">FairLend</span>
        <p>Content Requests</p>
      </section>
      <Card className="auth-card">
        <CardHeader>
          <span className="auth-icon" aria-hidden="true">
            <SearchX />
          </span>
          <CardTitle as="h1" className="text-2xl">
            Page not found
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="auth-assurance">
            This address doesn&apos;t match a page in the content request
            workspace.
          </p>
        </CardContent>
        <CardFooter>
          <ButtonAnchor
            size="lg"
            className="w-full justify-between"
            href="/app"
          >
            Return to content requests
          </ButtonAnchor>
        </CardFooter>
      </Card>
    </main>
  )
}

export function RoutePendingFallback() {
  return (
    <main
      className="route-pending"
      id="main-content"
      aria-labelledby="route-pending-title"
      aria-busy="true"
    >
      <h1 id="route-pending-title" className="sr-only">
        Loading page
      </h1>
      <div className="route-pending__header" aria-hidden="true" />
      <div className="route-pending__body" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </main>
  )
}
