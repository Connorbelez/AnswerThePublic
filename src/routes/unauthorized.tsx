import { createFileRoute } from "@tanstack/react-router"
import { LogOut, ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export const Route = createFileRoute("/unauthorized")({
  component: UnauthorizedPage,
})

function UnauthorizedPage() {
  return (
    <main className="auth-page">
      <section className="auth-brand" aria-label="FairLend Content Requests">
        <span className="wordmark">FairLend</span>
        <p>Content Requests</p>
      </section>
      <Card className="auth-card" tone="elevated">
        <CardHeader>
          <span className="auth-icon" aria-hidden="true">
            <ShieldAlert />
          </span>
          <CardTitle as="h1" className="text-2xl">
            Your account is not provisioned
          </CardTitle>
          <CardDescription>
            You are signed in, but your WorkOS role does not grant access to
            this workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="auth-assurance">
            Ask a FairLend administrator to assign a Founder, Operator / editor,
            Agent editor, or Administrator role.
          </p>
        </CardContent>
        <CardFooter>
          <Button
            size="lg"
            variant="outline"
            className="w-full justify-between"
            render={<a href="/logout" />}
            nativeButton={false}
          >
            Sign out
            <LogOut data-icon="inline-end" />
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}
