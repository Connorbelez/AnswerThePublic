import { createFileRoute, notFound } from "@tanstack/react-router"

import { getPublicShareView } from "@/application/content-request-server-functions"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export const Route = createFileRoute("/share/$token")({
  loader: async ({ params }) => {
    const share = await getPublicShareView({ data: { token: params.token } })
    if (!share) throw notFound()
    return share
  },
  component: PublicSharePage,
})

function PublicSharePage() {
  const share = Route.useLoaderData()
  return (
    <main className="workspace workspace--narrow py-8">
      <header className="grid gap-2 pb-6">
        <div className="flex flex-wrap gap-2">
          <Badge>{share.request.priority}</Badge>
          <Badge variant="outline">{share.request.humanId}</Badge>
        </div>
        <h1 className="text-3xl leading-tight font-semibold tracking-[-0.035em] sm:text-4xl">
          {share.request.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          Shared by FairLend · Read only
        </p>
      </header>
      <section className="grid gap-4" aria-label="Shared response">
        {share.briefSections.map((section, index) => (
          <Card key={`${section.kind}:${index}`}>
            <CardHeader>
              <CardTitle as="h2">{section.title}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <ul className="grid gap-2 pl-5">
                {section.bulletPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              {section.citations.map((citation) => (
                <a
                  key={citation.url}
                  href={citation.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline underline-offset-4"
                >
                  {citation.label}
                </a>
              ))}
            </CardContent>
          </Card>
        ))}
        {share.deliverables.map((deliverable, index) => (
          <Card key={`${deliverable.kind}:${index}`}>
            <CardHeader>
              <CardTitle as="h2">{deliverable.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="font-sans whitespace-pre-wrap">
                {deliverable.body}
              </pre>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  )
}
