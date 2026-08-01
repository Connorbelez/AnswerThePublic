import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { ArrowLeft } from "lucide-react"

import {
  createExpertInterviewContentRequest,
  createManualContentRequest,
} from "@/application/content-request-server-functions"
import { ContentRequestCreateForm } from "@/components/content-request-create-form"
import { ButtonLink } from "@/components/ui/button-link"
import { useHydrated } from "@/hooks/use-hydrated"

export const Route = createFileRoute("/app/new")({
  component: NewRequestPage,
})

function NewRequestPage() {
  const createRequest = useServerFn(createManualContentRequest)
  const createExpertInterview = useServerFn(createExpertInterviewContentRequest)
  const navigate = useNavigate()
  const hydrated = useHydrated()

  return (
    <main className="workspace workspace--narrow" id="main-content">
      <ButtonLink variant="ghost" to="/app">
        <ArrowLeft data-icon="inline-start" />
        Content requests
      </ButtonLink>
      <ContentRequestCreateForm
        hydrated={hydrated}
        onCreateStandard={(input) => createRequest({ data: input })}
        onCreateExpertInterview={(input) =>
          createExpertInterview({ data: input })
        }
        onCreated={(humanId) =>
          navigate({
            to: "/app/requests/$requestId",
            params: { requestId: humanId },
          })
        }
      />
    </main>
  )
}
