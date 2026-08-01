import { createFileRoute, notFound } from "@tanstack/react-router"

import { getPublicShareView } from "@/application/content-request-server-functions"
import { MarkdownContent } from "@/components/markdown-content"
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
    <main
      className="workspace workspace--narrow public-share"
      id="main-content"
    >
      <header className="public-share__header">
        <div className="flex flex-wrap gap-2">
          <Badge>{share.request.priority}</Badge>
          <Badge variant="outline">{share.request.humanId}</Badge>
        </div>
        <h1>{share.request.title}</h1>
        <p className="text-sm text-muted-foreground">
          Shared by FairLend · Read only
        </p>
      </header>
      <section className="public-share__content" aria-label="Shared response">
        {share.briefSections.map((section, index) => (
          <Card className="platform-panel" key={`${section.kind}:${index}`}>
            <CardHeader>
              <CardTitle as="h2">{section.title}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <ul className="grid gap-2 pl-5">
                {section.bulletPoints.map((point) => (
                  <li key={point}>
                    <MarkdownContent minimumHeadingLevel={3}>
                      {point}
                    </MarkdownContent>
                  </li>
                ))}
              </ul>
              {section.citations.map((citation) => (
                <a
                  key={citation.url}
                  href={citation.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm underline"
                >
                  {citation.label}
                </a>
              ))}
            </CardContent>
          </Card>
        ))}
        {share.deliverables.map((deliverable, index) => (
          <Card className="platform-panel" key={`${deliverable.kind}:${index}`}>
            <CardHeader>
              <CardTitle as="h2">{deliverable.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <MarkdownContent minimumHeadingLevel={3}>
                {deliverable.body}
              </MarkdownContent>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  )
}
