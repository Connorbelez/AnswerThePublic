import { createFileRoute } from "@tanstack/react-router"
import { ArrowRight, LockKeyhole } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type SignInSearch = {
  returnTo: string
}

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    returnTo:
      typeof search.returnTo === "string" && search.returnTo.startsWith("/")
        ? search.returnTo
        : "/app",
  }),
  component: SignInPage,
})

function SignInPage() {
  const { returnTo } = Route.useSearch()
  const signInUrl = `/api/auth/sign-in?returnPathname=${encodeURIComponent(returnTo)}`

  return (
    <main className="auth-page">
      <section className="auth-brand" aria-label="FairLend Content Requests">
        <span className="wordmark">FairLend</span>
        <p>Content Requests</p>
      </section>
      <Card className="auth-card" tone="elevated">
        <CardHeader>
          <span className="auth-icon" aria-hidden="true">
            <LockKeyhole />
          </span>
          <CardTitle as="h1" className="text-2xl">
            Your content queue is private
          </CardTitle>
          <CardDescription>
            Sign in with your FairLend account to review briefs, capture
            Elie&apos;s input, and finish responses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="auth-assurance">
            Access is managed by WorkOS. Shared request links use a separate,
            explicit public boundary.
          </p>
        </CardContent>
        <CardFooter>
          <Button
            size="lg"
            className="w-full justify-between"
            render={<a href={signInUrl} />}
            nativeButton={false}
          >
            Continue with WorkOS
            <ArrowRight data-icon="inline-end" />
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}
