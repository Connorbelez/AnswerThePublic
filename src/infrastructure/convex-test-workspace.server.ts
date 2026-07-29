import { convexTest } from "convex-test"
import timelineTest from "convex-timeline/test"
// The Cloudflare E2E worker must instantiate Automerge through its workerd
// export, where the WASM module is compiled at bundle time. Convex production
// still uses the slim/base64 fallback in convex/founderInputs.ts.
import "@automerge/automerge"

import { api, internal } from "../../convex/_generated/api"
import { requestQueueSortKey } from "../../convex/lib/requestOrdering"
import schema from "../../convex/schema"
import type { ExternalIdentity } from "@/application/workspace-session"
import { authorizeExternalIdentity } from "@/application/workspace-session"
import { createGuestAccessResolveArguments } from "@/infrastructure/convex-guest-access-repository"

const modules = import.meta.glob([
  "../../convex/**/*.ts",
  "../../convex/_generated/*.js",
  "!../../convex/**/*.d.ts",
  "!../../convex/**/*.test.ts",
  "!../../convex/**/*.config.ts",
  "!../../convex/**/*.setup.ts",
])

const workspace = convexTest(schema, modules)
timelineTest.register(workspace)

async function withGuestAccessBoundary<T extends { token: string }>(input: T) {
  return {
    ...input,
    ...(await createGuestAccessResolveArguments(
      input.token,
      "e2e-server-fixture"
    )),
  }
}

const triageScoutBody = `## A1. Ontario mortgage discharge — Score: 78/100 — Act by: while active

- **Source:** r/CanadaPersonalFinance; posted approximately five hours ago
- **Why FairLend can help:** The choice affects title clarity, future refinancing or home sales, and how the file appears to lenders and insurers. Ontario has a specific process for each.
- **What is missing from existing replies:** Most replies oversimplify “paid off” as the same as “discharged” and do not explain the registry, title insurance, or rare edge cases such as fraud, disputes, or sales delays.
- **Compliance/moderation check:** Medium risk. Keep the response educational and refer legal or insurance decisions to an Ontario lawyer or licensed insurance professional.

## Draft response

In Ontario, “zero balance” and “registered discharge” are not the same.

A zero balance means the lender reports your mortgage as paid in full, but the mortgage remains on title with a $0 balance. A discharge is a legal document that takes the mortgage off title completely.

For most homeowners, a zero balance is fine and fast. A registered discharge may be preferable when selling soon, refinancing, or resolving a title concern. Ask the lender what it provides by default and whether a discharge fee applies.

## Evidence used

- Financial Consumer Agency of Canada — mortgage discharge process
- Ontario Land Titles Act — effect of a registered discharge
- FSRA — title insurance and title-fraud coverage
- OSFI — revolving secured-credit treatment`

const triageScoutBodyWithoutDraft = triageScoutBody.replace(
  /\n## Draft response[\s\S]*?(?=\n## Evidence used)/,
  ""
)

export function getPublicConvexTestWorkspace() {
  return workspace
}

export async function getConvexTestWorkspace(
  identity: ExternalIdentity,
  configuredOrganizationId = process.env.FAIRLEND_E2E_ORGANIZATION_ID
) {
  const expectedOrganizationId = configuredOrganizationId
  if (!expectedOrganizationId) {
    throw new Error(
      "FAIRLEND_E2E_ORGANIZATION_ID is required for browser tests."
    )
  }
  authorizeExternalIdentity(identity, expectedOrganizationId)
  process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = expectedOrganizationId
  const authenticated = workspace.withIdentity({
    issuer: "https://api.workos.com/",
    subject: identity.subject,
    org_id: identity.organizationId,
    role: identity.workosRole ?? undefined,
    email: identity.email,
  })
  await authenticated.mutation(api.principals.syncCurrent)
  return authenticated
}

export async function createAutomatedE2eRequest(
  identity: ExternalIdentity,
  title: string,
  assigneeSubject: string,
  includeDraft = true
) {
  const authenticated = await getConvexTestWorkspace(identity)
  const createdAt = Date.now()
  const sourceId = crypto.randomUUID()
  const created = await authenticated.mutation(
    api.contentRequests.createManual,
    {
      title,
      origin: "manual",
      source: {
        channel: "Reddit",
        name: "r/CanadaPersonalFinance",
        url: `https://www.reddit.com/r/CanadaPersonalFinance/comments/${sourceId}/e2e_fixture/`,
        question:
          "I’m about to pay off my mortgage in Ontario. My lender says they can report a ‘zero balance’ to the registry instead of doing a full discharge. Is that the same, and what are the downsides?",
        body: includeDraft ? triageScoutBody : triageScoutBodyWithoutDraft,
      },
      correlationId: crypto.randomUUID(),
    }
  )
  await authenticated.run(async (ctx) => {
    const request = await ctx.db.get(created.requestId)
    const assignee = await ctx.db
      .query("principals")
      .withIndex("by_organization_subject", (index) =>
        index
          .eq("organizationId", identity.organizationId)
          .eq("subject", assigneeSubject)
      )
      .unique()
    if (!request || !assignee) throw new Error("E2E fixture setup failed.")
    await ctx.db.patch(request._id, {
      origin: "automated_scout",
      priority: "normal",
      assigneePrincipalId: assignee._id,
      queueSortKey: requestQueueSortKey("automated_scout", "normal", createdAt),
      createdAt,
      updatedAt: createdAt,
    })
  })
  return { humanId: created.humanId }
}

export async function createExpertInterviewE2eRequest(
  identity: ExternalIdentity,
  title: string
) {
  process.env.GUEST_ACCESS_TOKEN_SECRET =
    "e2e-only-guest-access-secret-at-least-32-bytes"
  process.env.GUEST_ACCESS_RESOLVE_SECRET =
    "e2e-only-guest-resolve-secret-at-least-32-bytes"
  process.env.FAIRLEND_ELIE_EMAIL = "elie@fairlend.ca"
  process.env.FAIRLEND_PRINCIPAL_PROVISIONING_KEY =
    "e2e-only-principal-provisioning-key"
  const authenticated = await getConvexTestWorkspace(identity)
  await authenticated.mutation(api.principals.seedFounder, {
    provisioningKey: "e2e-only-principal-provisioning-key",
    email: "elie@fairlend.ca",
    subject: "user_elie",
  })
  const correlationId = `e2e-expert-${crypto.randomUUID()}`
  const created = await authenticated.mutation(
    api.contentRequests.createManual,
    {
      title,
      origin: "manual",
      source: {
        channel: "expert_interview",
        name: "Expert interview",
        question:
          "How do Ontario bridge files recover when dates stop lining up?",
        body: "Production browser-QA fixture for the approved Expert Interview workflow.",
      },
      correlationId: `${correlationId}:request`,
    }
  )
  const expertInterview = await authenticated.mutation(
    api.expertInterviews.savePackage,
    {
      humanId: created.humanId,
      brief: {
        topic: "Bridge financing when purchase and sale dates stop lining up",
        summary:
          "A practical Ontario guide to the decisions practitioners make after a textbook bridge timeline breaks.",
        audience:
          "Ontario homeowners and mortgage professionals handling a time-sensitive purchase.",
        framing: "insider_knowledge",
        fairlendPosture:
          "Demonstrate experienced judgment without turning the article into a direct sales pitch.",
        founderContribution:
          "Reality-on-the-ground process, Ontario nuance, and an anonymized recovery example.",
      },
      gaps: [
        {
          id: "gap-recovery",
          kind: "reality_on_the_ground",
          title: "The official process ends where recovery work begins",
          existingCoverage: "Published guidance explains basic eligibility.",
          whyItFallsShort:
            "It does not explain how practitioners rebuild a broken closing timeline.",
          expertOpportunity:
            "Describe the sequence, evidence, and judgment used to recover the file.",
          citations: [
            {
              label: "FCAC bridge financing guidance",
              url: "https://www.canada.ca/",
              supports: "Baseline consumer guidance and terminology.",
            },
          ],
        },
      ],
      questions: [
        {
          id: "question-first-call",
          question:
            "What is the first call you make when a borrower misses the bank’s bridge timeline?",
          motivation:
            "Readers need a usable recovery sequence, not another eligibility checklist.",
          gapIds: ["gap-recovery"],
        },
        {
          id: "question-warning-sign",
          question:
            "Which warning sign would a less experienced practitioner miss?",
          motivation:
            "This turns lived experience into a transferable decision rule.",
          gapIds: ["gap-recovery"],
        },
      ],
      operatorInstructions:
        "Lead with Ontario-specific recovery decisions before general bridge-loan guidance.",
      correlationId: `${correlationId}:package`,
    }
  )
  const registeredPerson = await authenticated.mutation(api.people.create, {
    humanId: created.humanId,
    displayName: "Morgan Registered",
    email: "morgan.registered@example.ca",
    correlationId: `${correlationId}:person`,
  })
  return { request: created, expertInterview, registeredPerson }
}

export async function seedGuestNotificationSignalsE2e(
  identity: ExternalIdentity,
  requestId: string,
  humanId: string
) {
  const authenticated = await getConvexTestWorkspace(identity)
  const recipient = await authenticated.run(async (ctx) => {
    const request = await ctx.db.get(
      requestId as import("../../convex/_generated/dataModel").Id<"contentRequests">
    )
    const recipient = await ctx.db
      .query("principals")
      .withIndex("by_organization_subject", (index) =>
        index
          .eq("organizationId", identity.organizationId)
          .eq("subject", identity.subject)
      )
      .unique()
    if (
      !request ||
      request.humanId !== humanId ||
      !recipient ||
      recipient.role !== "administrator"
    )
      throw new Error("Administrator E2E notification fixture setup failed.")
    return recipient
  })
  const fixtureId = crypto.randomUUID()
  async function createGrant(label: string) {
    const person = await authenticated.mutation(api.people.create, {
      humanId,
      displayName: `${label} Notification Expert`,
      email: `${label}-${fixtureId}@example.test`,
      correlationId: `e2e-notification:${fixtureId}:${label}:person`,
    })
    const created = await authenticated.mutation(api.guestAccess.create, {
      humanId,
      personId: person.personId,
      correlationId: `e2e-notification:${fixtureId}:${label}:grant`,
    })
    if (!created.token)
      throw new Error("Expected one-time E2E notification guest token.")
    return created
  }
  async function openWorkspace(
    label: string,
    created: Awaited<ReturnType<typeof createGrant>>
  ) {
    const resolved = await authenticated.mutation(
      api.guestAccess.resolve,
      await createGuestAccessResolveArguments(
        created.token!,
        `e2e-notification:${fixtureId}:${label}`
      )
    )
    if (!resolved || resolved.status !== "available")
      throw new Error("Expected available E2E guest workspace.")
    const leaseId = `e2e-notification:${fixtureId}:${label}:lease`
    const lease = await authenticated.mutation(
      api.guestAccess.acquireEditorLease,
      await withGuestAccessBoundary({
        token: created.token!,
        leaseId,
        operationId: `e2e-notification:${fixtureId}:${label}:acquire`,
      })
    )
    if (!lease || lease.status !== "editing")
      throw new Error("Expected E2E guest editor lease.")
    return {
      leaseGeneration: lease.editorLease.generation,
      leaseId,
      token: created.token!,
    }
  }

  const submissionGrant = await createGrant("submission")
  const submissionWorkspace = await openWorkspace("submission", submissionGrant)
  const saved = await authenticated.mutation(
    api.guestAccess.saveResponseWorkspace,
    await withGuestAccessBoundary({
      ...submissionWorkspace,
      operationId: `e2e-notification:${fixtureId}:submission:save`,
      expectedRevision: 0,
      answerMode: "batch",
      batchText: "A notification fixture response.",
      questionAnswers: [
        { questionId: "question-first-call", text: "" },
        { questionId: "question-warning-sign", text: "" },
      ],
    })
  )
  if (!saved || saved.status !== "saved")
    throw new Error("Expected saved E2E notification response.")
  const submissionArgs = {
    ...submissionWorkspace,
    operationId: `e2e-notification:${fixtureId}:submission:submit`,
    expectedRevision: saved.workspace.revision,
    confirmed: true,
  }
  const submitted = await authenticated.mutation(
    api.guestAccess.submitResponseWorkspace,
    await withGuestAccessBoundary(submissionArgs)
  )
  await authenticated.mutation(
    api.guestAccess.submitResponseWorkspace,
    await withGuestAccessBoundary(submissionArgs)
  )
  if (!submitted || submitted.status !== "submitted")
    throw new Error("Expected submitted E2E notification response.")

  const expiryGrant = await createGrant("expiry")
  const expiryNow = Date.now()
  await authenticated.run((ctx) =>
    ctx.db.patch(expiryGrant.grant.grantId, {
      expiresAt: expiryNow + 60 * 60 * 1_000,
      updatedAt: expiryNow,
      latestActivityAt: expiryNow,
    })
  )
  await authenticated.mutation(
    internal.notifications.scheduleGuestExpiryNotifications,
    { now: expiryNow, state: "generated" }
  )
  await authenticated.mutation(
    internal.notifications.scheduleGuestExpiryNotifications,
    { now: expiryNow, state: "generated" }
  )

  const uploadGrant = await createGrant("upload")
  const uploadWorkspace = await openWorkspace("upload", uploadGrant)
  const upload = await authenticated.mutation(
    api.guestEvidence.beginUpload,
    await withGuestAccessBoundary({
      ...uploadWorkspace,
      clientAssetId: `e2e-notification:${fixtureId}:upload:asset`,
      kind: "attachment",
      scope: { kind: "batch" },
      fileName: "failed-notification-evidence.pdf",
      mimeType: "application/pdf",
      sizeBytes: 128,
    })
  )
  const uploadFailureArgs = {
    ...uploadWorkspace,
    assetId: upload.asset.assetId,
    uploadSessionId: upload.uploadSessionId,
    failureCode: "E2E_UPLOAD_FAILED",
  }
  await authenticated.mutation(
    api.guestEvidence.markUploadFailed,
    await withGuestAccessBoundary(uploadFailureArgs)
  )
  await authenticated.mutation(
    api.guestEvidence.markUploadFailed,
    await withGuestAccessBoundary(uploadFailureArgs)
  )

  const evidence = await authenticated.run(async (ctx) => {
    const notifications = (
      await ctx.db
        .query("notifications")
        .withIndex("by_request_created_at", (index) =>
          index.eq(
            "requestId",
            requestId as import("../../convex/_generated/dataModel").Id<"contentRequests">
          )
        )
        .collect()
    ).filter(
      (notification) => notification.recipientPrincipalId === recipient._id
    )
    const notificationIds = new Set(
      notifications.map((notification) => String(notification._id))
    )
    const deliveries = (
      await ctx.db.query("notificationEmailOutbox").collect()
    ).filter((delivery) => notificationIds.has(String(delivery.notificationId)))
    const audits = (
      await ctx.db
        .query("auditEvents")
        .withIndex("by_request_occurred_at", (index) =>
          index.eq(
            "requestId",
            requestId as import("../../convex/_generated/dataModel").Id<"contentRequests">
          )
        )
        .collect()
    ).filter(({ operation }) =>
      [
        "guest_response.submitted",
        "notification.guest_expiry_approaching",
        "guest_evidence.upload_failed",
      ].includes(operation)
    )
    return {
      notificationTypes: notifications.map(({ type }) => type).sort(),
      deliveryTemplates: deliveries.map(({ template }) => template).sort(),
      auditOperations: audits.map(({ operation }) => operation).sort(),
      allNotificationsQueuedEmail: notifications.every(
        ({ emailQueued }) => emailQueued
      ),
    }
  })
  return {
    submission: {
      grantId: submissionGrant.grant.grantId,
      submissionId: submitted.submission.submissionId,
    },
    expiry: { grantId: expiryGrant.grant.grantId },
    upload: {
      grantId: uploadGrant.grant.grantId,
      assetId: upload.asset.assetId,
    },
    evidence,
  }
}

export async function expireGuestGrantE2e(
  identity: ExternalIdentity,
  grantId: string
) {
  const authenticated = await getConvexTestWorkspace(identity)
  return authenticated.run(async (ctx) => {
    const id =
      grantId as import("../../convex/_generated/dataModel").Id<"guestAccessGrants">
    const grant = await ctx.db.get(id)
    if (!grant || grant.organizationId !== identity.organizationId)
      throw new Error("Guest grant E2E fixture not found.")
    const expiredAt = Date.now() - 1
    await ctx.db.patch(id, {
      expiresAt: expiredAt,
      updatedAt: expiredAt,
      latestActivityAt: expiredAt,
    })
    return { grantId, expiredAt }
  })
}

export async function guestEditorLeaseStateE2e(
  identity: ExternalIdentity,
  grantId: string,
  action: "inspect" | "expire"
) {
  const authenticated = await getConvexTestWorkspace(identity)
  return authenticated.run(async (ctx) => {
    const id =
      grantId as import("../../convex/_generated/dataModel").Id<"guestAccessGrants">
    const grant = await ctx.db.get(id)
    if (!grant || grant.organizationId !== identity.organizationId)
      throw new Error("Guest grant E2E fixture not found.")
    const responseWorkspace = await ctx.db
      .query("responseWorkspaces")
      .withIndex("by_grant", (index) => index.eq("grantId", id))
      .unique()
    if (
      !responseWorkspace ||
      responseWorkspace.organizationId !== identity.organizationId
    )
      throw new Error("Guest response workspace E2E fixture not found.")
    if (action === "expire") {
      await ctx.db.patch(responseWorkspace._id, {
        leaseExpiresAt: Date.now() - 1,
      })
    }
    const current = await ctx.db.get(responseWorkspace._id)
    if (!current) throw new Error("Guest response workspace E2E fixture lost.")
    return {
      active: Boolean(
        current.leaseHolderHash && (current.leaseExpiresAt ?? 0) > Date.now()
      ),
      generation: current.leaseGeneration ?? 0,
      expiresAt: current.leaseExpiresAt ?? null,
    }
  })
}

export async function createPublicShareE2e(identity: ExternalIdentity) {
  process.env.PUBLIC_SHARE_TOKEN_SECRET =
    "e2e-only-public-share-secret-at-least-32-bytes"
  const authenticated = await getConvexTestWorkspace(identity)
  const request = await authenticated.mutation(
    api.contentRequests.createManual,
    {
      title: "Public FairLend response",
      origin: "manual",
      correlationId: crypto.randomUUID(),
    }
  )
  const [primary] = await authenticated.query(api.deliverables.list, {
    humanId: request.humanId,
  })
  await authenticated.mutation(api.deliverables.createVersion, {
    deliverableId: primary.deliverableId,
    body: "This is the explicitly approved public response.",
    correlationId: crypto.randomUUID(),
  })
  await authenticated.mutation(api.deliverables.createVersion, {
    deliverableId: primary.deliverableId,
    body: "PRIVATE_CANDIDATE_SECRET",
    correlationId: crypto.randomUUID(),
  })
  await authenticated.run(async (ctx) => {
    const principal = await ctx.db.query("principals").first()
    if (!principal) throw new Error("Missing E2E principal")
    await ctx.db.insert("founderInputDocuments", {
      organizationId: identity.organizationId,
      requestId: request.requestId,
      founderPrincipalId: principal._id,
      text: "PRIVATE_FOUNDER_BROWSER_SECRET",
      revision: 1,
      hasMeaningfulDraft: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  })
  return authenticated.mutation(api.publicShares.create, {
    humanId: request.humanId,
    contextItemIds: [],
    deliverableIds: [primary.deliverableId],
    correlationId: crypto.randomUUID(),
  })
}

export async function revokePublicShareE2e(
  identity: ExternalIdentity,
  shareId: string
) {
  const authenticated = await getConvexTestWorkspace(identity)
  return authenticated.mutation(api.publicShares.revoke, {
    shareId:
      shareId as import("../../convex/_generated/dataModel").Id<"publicShares">,
    correlationId: crypto.randomUUID(),
  })
}
