import { createFileRoute } from "@tanstack/react-router"
import { ArrowRight, LockKeyhole } from "lucide-react"

import { ButtonAnchor } from "@/components/ui/button-link"
import { ThemeToggle } from "@/components/theme-toggle"
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

function safeReturnTo(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return "/app"
  }

  try {
    const base = new URL("https://fairlend.invalid")
    const resolved = new URL(value, base)
    return resolved.origin === base.origin
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : "/app"
  } catch {
    return "/app"
  }
}

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    returnTo: safeReturnTo(search.returnTo),
  }),
  component: SignInPage,
})

function SignInPage() {
  const { returnTo } = Route.useSearch()
  const signInUrl = `/api/auth/sign-in?returnPathname=${encodeURIComponent(returnTo)}`

  return (
    <main className="auth-page" id="main-content">
      <ThemeToggle className="auth-theme-toggle" />
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
          <ButtonAnchor
            size="lg"
            className="w-full justify-between"
            href={signInUrl}
          >
            Continue with WorkOS
            <ArrowRight data-icon="inline-end" />
          </ButtonAnchor>
        </CardFooter>
      </Card>
    </main>
  )
}
