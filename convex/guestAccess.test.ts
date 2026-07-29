// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const operatorIdentity = {
  subject: "guest-access-operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "guest-access-operator-session",
}

const packageInput = {
  brief: {
    topic: "Bridge financing when a bank closing is delayed",
    summary: "A practical Ontario guide to recovering a time-sensitive deal.",
    audience: "Ontario mortgage brokers and borrowers",
    framing: "insider_knowledge" as const,
    fairlendPosture: "Useful first; commercial relevance disclosed.",
    founderContribution: "A real recovery sequence and decision criteria.",
  },
  gaps: [
    {
      id: "gap-1",
      kind: "reality_on_the_ground" as const,
      title: "The first hour",
      existingCoverage: "Guides list bridge-loan eligibility.",
      whyItFallsShort: "They do not describe a live closing failure.",
      expertOpportunity: "Explain who gets called first and why.",
      citations: [
        {
          label: "Bridge eligibility guide",
          url: "https://example.test/bridge-eligibility",
          supports: "The published eligibility coverage that omits recovery.",
        },
      ],
    },
  ],
  questions: [
    {
      id: "q-1",
      question: "What do you do in the first hour after the bank slips?",
      motivation: "Capture the recovery sequence missing from indexed guides.",
      gapIds: ["gap-1"],
    },
  ],
  operatorInstructions: "Preserve the respondent's practical sequence.",
}

async function resolveArgs(
  token: string,
  networkSource: string,
  networkTimestamp = Date.now()
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(process.env.GUEST_ACCESS_RESOLVE_SECRET!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(
      `guest-access-resolve:v1\n${networkTimestamp}\n${networkSource}\n${token}`
    )
  )
  const networkProof = Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("")
  return { token, networkSource, networkTimestamp, networkProof }
}

async function withGuestAccessBoundary<T extends { token: string }>(input: T) {
  return {
    ...input,
    ...(await resolveArgs(input.token, "guest-access-test-source")),
  }
}

async function workspace() {
  const anonymous = convexTest(schema, modules)
  const backend = anonymous.withIdentity(operatorIdentity)
  await backend.mutation(api.principals.syncCurrent)
  const { principalId: founderPrincipalId } = await backend.mutation(
    api.principals.seedFounder,
    {
      provisioningKey: "guest-access-provisioning-key",
      email: "elie@fairlend.ca",
      subject: "founder-elie",
    }
  )
  const request = await backend.mutation(api.contentRequests.createManual, {
    title: "How bridge financing works when the timeline breaks",
    origin: "manual",
    correlationId: "guest-request-1",
  })
  await backend.mutation(api.expertInterviews.savePackage, {
    humanId: request.humanId,
    ...packageInput,
    correlationId: "guest-package-1",
  })
  return { anonymous, backend, request, founderPrincipalId }
}

describe("Person-assigned Guest Access Grants", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
    process.env.FAIRLEND_ELIE_EMAIL = "elie@fairlend.ca"
    process.env.FAIRLEND_PRINCIPAL_PROVISIONING_KEY =
      "guest-access-provisioning-key"
    process.env.GUEST_ACCESS_TOKEN_SECRET =
      "guest-access-test-secret-with-at-least-32-bytes"
    process.env.GUEST_ACCESS_RESOLVE_SECRET =
      "guest-access-resolve-test-secret-at-least-32-bytes"
  })

  it("searches the organization Person directory by name or email and defaults to its founder", async () => {
    const { backend, founderPrincipalId } = await workspace()

    const founderResults = await backend.query(api.people.search, {
      query: "elie",
      limit: 10,
    })
    const emailResults = await backend.query(api.people.search, {
      query: "fairlend.ca",
      limit: 10,
    })

    expect(founderResults.defaultPersonId).toBeTruthy()
    expect(founderResults.people).toContainEqual(
      expect.objectContaining({
        displayName: "Elie Tchitava",
        email: "elie@fairlend.ca",
        principalId: founderPrincipalId,
        isFounder: true,
      })
    )
    expect(emailResults.people.map((person) => person.personId)).toContain(
      founderResults.defaultPersonId
    )
  })

  it("does not change directory or audit state while searching", async () => {
    const { backend } = await workspace()
    const snapshot = () =>
      backend.run(async (ctx) => ({
        people: await ctx.db.query("people").collect(),
        operations: await ctx.db.query("personOperations").collect(),
        audits: await ctx.db.query("auditEvents").collect(),
      }))
    const before = await snapshot()

    await backend.query(api.people.search, { query: "elie", limit: 10 })
    await backend.query(api.people.search, { query: "", limit: 10 })

    await expect(snapshot()).resolves.toEqual(before)
  })

  it("defaults to the configured founder when an organization has multiple founders", async () => {
    const { backend } = await workspace()
    await backend.run(async (ctx) => {
      const principalId = await ctx.db.insert("principals", {
        subject: "founder-other",
        organizationId: "org_fairlend",
        role: "founder",
        kind: "human",
        email: "other-founder@fairlend.ca",
        displayName: "Other Founder",
        updatedAt: 1,
      })
      await ctx.db.insert("people", {
        organizationId: "org_fairlend",
        displayName: "Other Founder",
        normalizedDisplayName: "other founder",
        email: "other-founder@fairlend.ca",
        normalizedEmail: "other-founder@fairlend.ca",
        searchText: "other founder other-founder@fairlend.ca",
        principalId,
        isFounder: true,
        createdAt: 0,
        updatedAt: 0,
      })
    })

    const results = await backend.query(api.people.search, {
      query: "",
      limit: 10,
    })
    const defaultPerson = results.people.find(
      ({ personId }) => personId === results.defaultPersonId
    )

    expect(defaultPerson).toMatchObject({
      email: "elie@fairlend.ca",
      isFounder: true,
    })
  })

  it("searches the complete organization directory beyond the initial result window", async () => {
    const { backend } = await workspace()
    await backend.run(async (ctx) => {
      for (let index = 0; index < 501; index += 1) {
        const email = `decoy-${String(index).padStart(3, "0")}@example.ca`
        await ctx.db.insert("people", {
          organizationId: "org_fairlend",
          displayName: `Decoy ${index}`,
          normalizedDisplayName: `decoy ${index}`,
          email,
          normalizedEmail: email,
          searchText: `decoy ${index} ${email}`,
          isFounder: false,
          createdAt: index,
          updatedAt: index,
        })
      }
      await ctx.db.insert("people", {
        organizationId: "org_fairlend",
        displayName: "Needle Expert",
        normalizedDisplayName: "needle expert",
        email: "needle.expert@example.ca",
        normalizedEmail: "needle.expert@example.ca",
        searchText: "needle expert needle.expert@example.ca",
        isFounder: false,
        createdAt: 10_000,
        updatedAt: 10_000,
      })
      await ctx.db.insert("people", {
        organizationId: "org_elsewhere",
        displayName: "Needle Foreign",
        normalizedDisplayName: "needle foreign",
        email: "needle.foreign@example.ca",
        normalizedEmail: "needle.foreign@example.ca",
        searchText: "needle foreign needle.foreign@example.ca",
        isFounder: false,
        createdAt: 10_001,
        updatedAt: 10_001,
      })
    })

    const result = await backend.query(api.people.search, {
      query: "needle.expert",
      limit: 10,
    })

    expect(result.people).toContainEqual(
      expect.objectContaining({
        displayName: "Needle Expert",
        email: "needle.expert@example.ca",
      })
    )
    expect(result.people).not.toContainEqual(
      expect.objectContaining({ email: "needle.foreign@example.ca" })
    )
  })

  it("creates a missing organization-scoped Person inline and makes it searchable", async () => {
    const { backend, request } = await workspace()

    const created = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Priya Shah",
      email: "priya@example.ca",
      correlationId: "person-priya-1",
    })
    const retried = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Priya Shah",
      email: "priya@example.ca",
      correlationId: "person-priya-1",
    })
    const results = await backend.query(api.people.search, {
      query: "PRIYA@EXAMPLE.CA",
      limit: 10,
    })

    expect(retried).toEqual(created)
    expect(results.people).toContainEqual(created)
    const audits = await backend.run((ctx) =>
      ctx.db
        .query("auditEvents")
        .withIndex("by_request_occurred_at", (index) =>
          index.eq("requestId", request.requestId)
        )
        .collect()
    )
    expect(
      audits.filter((event) => event.operation === "person.created")
    ).toEqual([
      expect.objectContaining({
        organizationId: "org_fairlend",
        requestId: request.requestId,
        requestHumanId: request.humanId,
        operation: "person.created",
        correlationId: "person-priya-1",
        beforeVersion: expect.any(Number),
        afterVersion: expect.any(Number),
      }),
    ])
    await expect(
      backend.mutation(api.people.create, {
        humanId: request.humanId,
        displayName: "Different Person",
        email: "different@example.ca",
        correlationId: "person-priya-1",
      })
    ).rejects.toMatchObject({
      data: { code: "IDEMPOTENCY_KEY_REUSED" },
    })
  })

  it("creates independent request-scoped grants, returns each plaintext token once, and never lists or persists it", async () => {
    const { backend, request } = await workspace()
    const firstPerson = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Priya Shah",
      email: "priya@example.ca",
      correlationId: "person-priya-2",
    })
    const secondPerson = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Noah Williams",
      email: "noah@example.ca",
      correlationId: "person-noah-1",
    })

    const first = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: firstPerson.personId,
      correlationId: "grant-priya-1",
    })
    const replay = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: firstPerson.personId,
      correlationId: "grant-priya-1",
    })
    const second = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: secondPerson.personId,
      correlationId: "grant-noah-1",
    })
    const listed = await backend.mutation(api.guestAccess.list, {
      humanId: request.humanId,
    })

    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(second.token).not.toBe(first.token)
    expect(replay.token).toBeNull()
    expect(replay.grant).toMatchObject({
      grantId: first.grant.grantId,
      tokenVersion: 1,
      expiresAt: first.grant.expiresAt,
    })
    if (!first.token) throw new Error("Expected one-time grant token")
    await expect(
      backend.mutation(
        api.guestAccess.resolve,
        await resolveArgs(first.token, "198.51.100.20")
      )
    ).resolves.toMatchObject({
      status: "available",
      grantId: first.grant.grantId,
    })
    expect(first.grant.expiresAt - first.grant.createdAt).toBe(
      48 * 60 * 60 * 1_000
    )
    expect(listed).toHaveLength(2)
    expect(JSON.stringify(listed)).not.toContain(first.token)
    expect(JSON.stringify(listed)).not.toContain(second.token)
    expect(listed.map((grant) => grant.person.personId)).toEqual(
      expect.arrayContaining([firstPerson.personId, secondPerson.personId])
    )

    const persisted = await backend.run(async (ctx) => ({
      grants: await ctx.db.query("guestAccessGrants").collect(),
      operations: await ctx.db.query("guestAccessOperations").collect(),
      audits: await ctx.db.query("auditEvents").collect(),
    }))
    expect(JSON.stringify(persisted)).not.toContain(first.token)
    expect(JSON.stringify(persisted)).not.toContain(second.token)
    const persistedFirstGrant = persisted.grants.find(
      ({ _id }) => _id === first.grant.grantId
    )
    expect(persistedFirstGrant).toMatchObject({
      organizationId: "org_fairlend",
      requestId: request.requestId,
      assignedPersonId: firstPerson.personId,
      createdByPrincipalId: expect.any(String),
      tokenVersion: 1,
    })
    expect(persistedFirstGrant).not.toHaveProperty("token")
  })

  it("replays the immutable create result after the request is archived", async () => {
    const { backend, request } = await workspace()
    const person = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Delayed Create Expert",
      email: "delayed-create@example.ca",
      correlationId: "delayed-create-person",
    })
    const created = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: person.personId,
      correlationId: "delayed-create-operation",
    })

    await backend.mutation(api.requestDisposition.archive, {
      humanId: request.humanId,
      correlationId: "archive-before-create-replay",
    })

    await expect(
      backend.mutation(api.guestAccess.create, {
        humanId: request.humanId,
        personId: person.personId,
        correlationId: "delayed-create-operation",
      })
    ).resolves.toEqual({
      grant: created.grant,
      token: null,
    })
  })

  it("replays the immutable renewal result after a later renewal and revocation", async () => {
    const { backend, request } = await workspace()
    const person = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Delayed Renewal Expert",
      email: "delayed-renewal@example.ca",
      correlationId: "delayed-renewal-person",
    })
    const created = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: person.personId,
      correlationId: "delayed-renewal-grant",
    })
    const firstRenewal = await backend.mutation(api.guestAccess.renew, {
      grantId: created.grant.grantId,
      correlationId: "delayed-renewal-first",
    })
    await backend.mutation(api.guestAccess.renew, {
      grantId: created.grant.grantId,
      correlationId: "delayed-renewal-second",
    })

    await expect(
      backend.mutation(api.guestAccess.renew, {
        grantId: created.grant.grantId,
        correlationId: "delayed-renewal-first",
      })
    ).resolves.toEqual({
      grant: firstRenewal.grant,
      token: null,
    })

    await backend.mutation(api.guestAccess.revoke, {
      grantId: created.grant.grantId,
      correlationId: "revoke-before-renewal-replay",
    })
    await expect(
      backend.mutation(api.guestAccess.renew, {
        grantId: created.grant.grantId,
        correlationId: "delayed-renewal-first",
      })
    ).resolves.toEqual({
      grant: firstRenewal.grant,
      token: null,
    })
  })

  it("opens only the assigned request's approved guest brief without authentication", async () => {
    const { anonymous, backend, request } = await workspace()
    const person = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Priya Shah",
      email: "priya@example.ca",
      correlationId: "person-priya-3",
    })
    const created = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: person.personId,
      correlationId: "grant-priya-2",
    })
    if (!created.token) throw new Error("Expected one-time grant token")

    const view = await anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(created.token, "198.51.100.44")
    )

    expect(view).toMatchObject({
      status: "available",
      grantId: created.grant.grantId,
      request: {
        humanId: request.humanId,
        title: "How bridge financing works when the timeline breaks",
      },
      interview: {
        brief: packageInput.brief,
        questions: packageInput.questions.map(
          ({ id, question, motivation }) => ({ id, question, motivation })
        ),
      },
    })
    expect(JSON.stringify(view)).not.toContain("guest-access-operator")
    expect(JSON.stringify(view)).not.toContain("operatorInstructions")
    expect(JSON.stringify(view)).not.toContain("gaps")
    expect(JSON.stringify(view)).not.toContain("gapIds")
    expect(JSON.stringify(view)).not.toContain("Priya Shah")
    expect(JSON.stringify(view)).not.toContain("priya@example.ca")

    for (let reload = 0; reload < 12; reload += 1) {
      await expect(
        anonymous.mutation(
          api.guestAccess.resolve,
          await resolveArgs(created.token, "198.51.100.44")
        )
      ).resolves.toMatchObject({
        status: "available",
        grantId: created.grant.grantId,
      })
    }
    const openAudits = await backend.run(async (ctx) => {
      const events = await ctx.db
        .query("auditEvents")
        .withIndex("by_request_occurred_at", (index) =>
          index.eq("requestId", request.requestId)
        )
        .collect()
      return events.filter(
        ({ operation }) => operation === "guest_access.opened"
      )
    })
    expect(openAudits).toEqual([
      expect.objectContaining({
        requestId: request.requestId,
        requestHumanId: request.humanId,
        actorGrantId: created.grant.grantId,
        operation: "guest_access.opened",
        correlationId: `guest-access-open:${created.grant.grantId}`,
        credentialId: `guest-access-grant:${created.grant.grantId}`,
      }),
    ])
    expect(openAudits[0]?.actorPrincipalId).toBeUndefined()
    await expect(
      backend.run((ctx) => ctx.db.query("guestAccessAttempts").collect())
    ).resolves.toEqual([])
  })

  it("blocks resolution and token mutations when the parent request is archived while leaving an unrelated request available", async () => {
    const { anonymous, backend, request } = await workspace()
    const archivedPerson = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Archived Request Expert",
      email: "archived-request@example.ca",
      correlationId: "archived-parent-person",
    })
    const archivedGrant = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: archivedPerson.personId,
      correlationId: "archived-parent-grant",
    })
    if (!archivedGrant.token) throw new Error("Expected archived request token")
    await anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(archivedGrant.token, "198.51.100.151")
    )
    const archivedLease = await anonymous.mutation(
      api.guestAccess.acquireEditorLease,
      await withGuestAccessBoundary({
        token: archivedGrant.token,
        leaseId: "archived-parent-editor",
        operationId: "archived-parent-acquire",
      })
    )
    if (!archivedLease || archivedLease.status !== "editing")
      throw new Error("Expected archived request editor lease")

    const activeRequest = await backend.mutation(
      api.contentRequests.createManual,
      {
        title: "An unrelated active expert request",
        origin: "manual",
        correlationId: "unrelated-active-request",
      }
    )
    await backend.mutation(api.expertInterviews.savePackage, {
      humanId: activeRequest.humanId,
      ...packageInput,
      correlationId: "unrelated-active-package",
    })
    const activePerson = await backend.mutation(api.people.create, {
      humanId: activeRequest.humanId,
      displayName: "Active Request Expert",
      email: "active-request@example.ca",
      correlationId: "unrelated-active-person",
    })
    const activeGrant = await backend.mutation(api.guestAccess.create, {
      humanId: activeRequest.humanId,
      personId: activePerson.personId,
      correlationId: "unrelated-active-grant",
    })
    if (!activeGrant.token) throw new Error("Expected active request token")

    await backend.mutation(api.requestDisposition.archive, {
      humanId: request.humanId,
      correlationId: "archive-parent-request",
    })

    await expect(
      anonymous.mutation(
        api.guestAccess.resolve,
        await resolveArgs(archivedGrant.token, "198.51.100.151")
      )
    ).resolves.toBeNull()
    await expect(
      anonymous.mutation(
        api.guestAccess.heartbeatEditorLease,
        await withGuestAccessBoundary({
          token: archivedGrant.token,
          leaseId: "archived-parent-editor",
          leaseGeneration: archivedLease.editorLease.generation,
          operationId: "archived-parent-heartbeat",
        })
      )
    ).rejects.toMatchObject({ data: { code: "ARCHIVED_REQUEST" } })
    await expect(
      anonymous.mutation(
        api.guestAccess.saveResponseWorkspace,
        await withGuestAccessBoundary({
          token: archivedGrant.token,
          leaseId: "archived-parent-editor",
          leaseGeneration: archivedLease.editorLease.generation,
          operationId: "archived-parent-save",
          expectedRevision: 0,
          answerMode: "batch",
          batchText: "Must not save against an archived parent.",
          questionAnswers: [{ questionId: "q-1", text: "" }],
        })
      )
    ).rejects.toMatchObject({ data: { code: "ARCHIVED_REQUEST" } })
    await expect(
      anonymous.mutation(
        api.guestAccess.submitResponseWorkspace,
        await withGuestAccessBoundary({
          token: archivedGrant.token,
          leaseId: "archived-parent-editor",
          leaseGeneration: archivedLease.editorLease.generation,
          operationId: "archived-parent-submit",
          expectedRevision: 0,
          confirmed: true,
        })
      )
    ).rejects.toMatchObject({ data: { code: "ARCHIVED_REQUEST" } })
    await expect(
      anonymous.mutation(
        api.guestAccess.resolve,
        await resolveArgs(activeGrant.token, "198.51.100.152")
      )
    ).resolves.toMatchObject({
      status: "available",
      request: { humanId: activeRequest.humanId },
    })

    const retained = await backend.run(async (ctx) => ({
      grant: await ctx.db.get(archivedGrant.grant.grantId),
      workspace: await ctx.db
        .query("responseWorkspaces")
        .withIndex("by_grant", (index) =>
          index.eq("grantId", archivedGrant.grant.grantId)
        )
        .unique(),
    }))
    expect(retained.grant).not.toBeNull()
    expect(retained.workspace).not.toBeNull()
  })

  it("returns the safe expired projection and rejects mutations when the parent request expires", async () => {
    const { anonymous, backend, request } = await workspace()
    const person = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Expired Request Expert",
      email: "expired-request@example.ca",
      correlationId: "expired-parent-person",
    })
    const grant = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: person.personId,
      correlationId: "expired-parent-grant",
    })
    if (!grant.token) throw new Error("Expected expired request token")
    await anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(grant.token, "198.51.100.153")
    )
    await backend.run(async (ctx) => {
      await ctx.db.patch(request.requestId, {
        disposition: "expired",
        updatedAt: Date.now(),
      })
    })

    await expect(
      anonymous.mutation(
        api.guestAccess.resolve,
        await resolveArgs(grant.token, "198.51.100.153")
      )
    ).resolves.toEqual({ status: "expired" })
    await expect(
      anonymous.mutation(
        api.guestAccess.acquireEditorLease,
        await withGuestAccessBoundary({
          token: grant.token,
          leaseId: "expired-parent-editor",
          operationId: "expired-parent-acquire",
        })
      )
    ).rejects.toMatchObject({ data: { code: "EXPIRED_REQUEST" } })
  })

  it("projects a Standard Request's approved source brief without admin metadata", async () => {
    const anonymous = convexTest(schema, modules)
    const backend = anonymous.withIdentity(operatorIdentity)
    await backend.mutation(api.principals.syncCurrent)
    const request = await backend.mutation(api.contentRequests.createManual, {
      title: "Explain a portable mortgage",
      origin: "manual",
      source: {
        question: "Can I take my mortgage with me when I move?",
        body: "The borrower wants a plain-language portability explanation.",
      },
      correlationId: "standard-guest-request",
    })
    const person = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Alex Borrower",
      email: "alex@example.ca",
      correlationId: "standard-guest-person",
    })
    const created = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: person.personId,
      correlationId: "standard-guest-grant",
    })
    if (!created.token) throw new Error("Expected one-time grant token")

    const opened = await anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(created.token, "192.0.2.22")
    )
    const standardQuestionId = `standard-prompt:${request.requestId}`
    expect(opened).toMatchObject({
      status: "available",
      request: {
        title: "Explain a portable mortgage",
        brief: {
          question: "Can I take my mortgage with me when I move?",
          body: "The borrower wants a plain-language portability explanation.",
        },
      },
      interview: null,
      questions: [
        {
          id: standardQuestionId,
          question: "Can I take my mortgage with me when I move?",
          motivation:
            "The borrower wants a plain-language portability explanation.",
        },
      ],
      workspace: {
        questionAnswers: [{ questionId: standardQuestionId, text: "" }],
      },
    })

    const lease = await anonymous.mutation(
      api.guestAccess.acquireEditorLease,
      await withGuestAccessBoundary({
        token: created.token,
        leaseId: "standard-response-editor",
        operationId: "standard-response-acquire",
      })
    )
    if (!lease || lease.status !== "editing")
      throw new Error("Expected Standard Request editor lease")
    await anonymous.mutation(
      api.guestAccess.saveResponseWorkspace,
      await withGuestAccessBoundary({
        token: created.token,
        leaseId: "standard-response-editor",
        leaseGeneration: lease.editorLease.generation,
        operationId: "standard-response-save",
        expectedRevision: 0,
        answerMode: "batch",
        batchText:
          "Porting transfers the mortgage terms, subject to lender approval and timing.",
        questionAnswers: [{ questionId: standardQuestionId, text: "" }],
      })
    )

    const provisional = await backend.query(
      api.guestAccess.inspectResponseWorkspace,
      { grantId: created.grant.grantId }
    )
    expect(provisional).toMatchObject({
      questions: [
        {
          questionId: standardQuestionId,
          question: "Can I take my mortgage with me when I move?",
          motivation:
            "The borrower wants a plain-language portability explanation.",
        },
      ],
      workspace: {
        batchText:
          "Porting transfers the mortgage terms, subject to lender approval and timing.",
        locked: false,
      },
      submissions: [],
    })

    await anonymous.mutation(
      api.guestAccess.submitResponseWorkspace,
      await withGuestAccessBoundary({
        token: created.token,
        leaseId: "standard-response-editor",
        leaseGeneration: lease.editorLease.generation,
        operationId: "standard-response-submit",
        expectedRevision: 1,
        confirmed: true,
      })
    )
    const submitted = await backend.query(
      api.guestAccess.inspectResponseWorkspace,
      { grantId: created.grant.grantId }
    )
    expect(submitted).toMatchObject({
      workspace: { locked: true },
      submissions: [
        {
          batchText:
            "Porting transfers the mortgage terms, subject to lender approval and timing.",
          questions: [
            {
              questionId: standardQuestionId,
              question: "Can I take my mortgage with me when I move?",
              motivation:
                "The borrower wants a plain-language portability explanation.",
            },
          ],
        },
      ],
    })
  })

  it("reconciles the legacy Standard placeholder into the canonical prompt scope without losing draft text", async () => {
    const anonymous = convexTest(schema, modules)
    const backend = anonymous.withIdentity(operatorIdentity)
    await backend.mutation(api.principals.syncCurrent)
    const request = await backend.mutation(api.contentRequests.createManual, {
      title: "Explain renewal timing",
      origin: "manual",
      source: {
        question: "When should I start a mortgage renewal?",
        body: "Give the borrower a practical planning window.",
      },
      correlationId: "standard-legacy-scope-request",
    })
    const person = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Taylor Borrower",
      email: "taylor@example.ca",
      correlationId: "standard-legacy-scope-person",
    })
    const created = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: person.personId,
      correlationId: "standard-legacy-scope-grant",
    })
    if (!created.token) throw new Error("Expected one-time grant token")
    await anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(created.token, "192.0.2.23")
    )
    await backend.run(async (ctx) => {
      const workspace = await ctx.db
        .query("responseWorkspaces")
        .withIndex("by_grant", (index) =>
          index.eq("grantId", created.grant.grantId)
        )
        .unique()
      if (!workspace) throw new Error("Expected Standard workspace")
      await ctx.db.patch(workspace._id, {
        questionAnswers: [
          {
            questionId: "request",
            text: "Start comparing renewal options several months early.",
          },
        ],
      })
    })

    const reopened = await anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(created.token, "192.0.2.24")
    )
    expect(reopened).toMatchObject({
      status: "available",
      questions: [
        {
          id: `standard-prompt:${request.requestId}`,
          question: "When should I start a mortgage renewal?",
        },
      ],
      workspace: {
        questionAnswers: [
          {
            questionId: `standard-prompt:${request.requestId}`,
            text: "Start comparing renewal options several months early.",
          },
        ],
      },
    })
  })

  it("reveals no request metadata for invalid tokens and actually bounds repeated attempts per token fingerprint and network source", async () => {
    const { backend } = await workspace()
    const invalidToken = "x".repeat(43)

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      await expect(
        backend.mutation(
          api.guestAccess.resolve,
          await resolveArgs(invalidToken, "203.0.113.17")
        )
      ).resolves.toBeNull()
    }
    await expect(
      backend.mutation(
        api.guestAccess.resolve,
        await resolveArgs(invalidToken, "203.0.113.17")
      )
    ).resolves.toEqual({ status: "rate_limited" })
    await expect(
      backend.mutation(
        api.guestAccess.resolve,
        await resolveArgs(invalidToken, "203.0.113.18")
      )
    ).resolves.toEqual({ status: "rate_limited" })

    const attempts = await backend.run((ctx) =>
      ctx.db.query("guestAccessAttempts").collect()
    )
    expect(attempts).toHaveLength(1)
    expect(JSON.stringify(attempts)).not.toContain(invalidToken)
    expect(attempts.find((attempt) => attempt.count === 10)).toBeTruthy()
  })

  it("bounds token fingerprints and network sources independently", async () => {
    const { backend } = await workspace()
    const repeatedToken = "a".repeat(43)

    for (let attempt = 0; attempt < 10; attempt += 1)
      await backend.mutation(
        api.guestAccess.resolve,
        await resolveArgs(repeatedToken, `198.51.100.${attempt}`)
      )
    await expect(
      backend.mutation(
        api.guestAccess.resolve,
        await resolveArgs(repeatedToken, "198.51.100.250")
      )
    ).resolves.toEqual({ status: "rate_limited" })

    for (let attempt = 0; attempt < 10; attempt += 1)
      await backend.mutation(
        api.guestAccess.resolve,
        await resolveArgs(
          `${String(attempt).padStart(2, "0")}${"b".repeat(41)}`,
          "203.0.113.200"
        )
      )
    await expect(
      backend.mutation(
        api.guestAccess.resolve,
        await resolveArgs("z".repeat(43), "203.0.113.200")
      )
    ).resolves.toEqual({ status: "rate_limited" })
  })

  it("rejects an unauthenticated network-source assertion without recording it", async () => {
    const { backend } = await workspace()
    await expect(
      backend.mutation(api.guestAccess.resolve, {
        token: "x".repeat(43),
        networkSource: "198.51.100.200",
        networkTimestamp: Date.now(),
        networkProof: "forged",
      })
    ).resolves.toBeNull()
    await expect(
      backend.mutation(
        api.guestAccess.resolve,
        await resolveArgs(
          "y".repeat(43),
          "198.51.100.201",
          Date.now() - 6 * 60 * 1_000
        )
      )
    ).resolves.toBeNull()
    await expect(
      backend.run((ctx) => ctx.db.query("guestAccessAttempts").collect())
    ).resolves.toEqual([])
  })

  it("rejects oversized token-facing payloads before proof HMAC work", async () => {
    const { backend } = await workspace()
    delete process.env.GUEST_ACCESS_RESOLVE_SECRET

    await expect(
      backend.mutation(api.guestAccess.resolve, {
        token: "x".repeat(100_000),
        networkSource: "198.51.100.202",
        networkTimestamp: Date.now(),
        networkProof: "0".repeat(64),
      })
    ).resolves.toBeNull()
  })

  it("requires the signed network boundary on direct editor mutation calls", async () => {
    const { backend } = await workspace()

    await expect(
      backend.mutation(api.guestAccess.acquireEditorLease, {
        token: "x".repeat(43),
        leaseId: "direct-caller",
        operationId: "direct-caller-acquire",
      } as never)
    ).rejects.toThrow()
  })

  it("rejects cross-organization Person assignment as a generic missing resource", async () => {
    const { backend, request } = await workspace()
    const foreignPersonId = await backend.run((ctx) =>
      ctx.db.insert("people", {
        organizationId: "org_elsewhere",
        displayName: "Foreign Person",
        normalizedDisplayName: "foreign person",
        email: "foreign@example.test",
        normalizedEmail: "foreign@example.test",
        searchText: "foreign person foreign@example.test",
        isFounder: false,
        createdByPrincipalId: undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    )

    await expect(
      backend.mutation(api.guestAccess.create, {
        humanId: request.humanId,
        personId: foreignPersonId,
        correlationId: "grant-foreign-1",
      })
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } })
  })

  it("autosaves one isolated text workspace per grant and returns recoverable stale conflicts", async () => {
    const { anonymous, backend, request } = await workspace()
    const firstPerson = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "First Expert",
      email: "first@example.ca",
      correlationId: "workspace-first-person",
    })
    const secondPerson = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Second Expert",
      email: "second@example.ca",
      correlationId: "workspace-second-person",
    })
    const firstGrant = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: firstPerson.personId,
      correlationId: "workspace-first-grant",
    })
    const secondGrant = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: secondPerson.personId,
      correlationId: "workspace-second-grant",
    })
    if (!firstGrant.token || !secondGrant.token)
      throw new Error("Expected one-time grant tokens")

    const opened = await anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(firstGrant.token, "198.51.100.90")
    )
    expect(opened).toMatchObject({
      status: "available",
      workspace: {
        answerMode: "one_by_one",
        batchText: "",
        questionAnswers: [{ questionId: "q-1", text: "" }],
        progress: { completed: 0, total: 1 },
        revision: 0,
      },
    })
    const firstEditor = await anonymous.mutation(
      api.guestAccess.acquireEditorLease,
      await withGuestAccessBoundary({
        token: firstGrant.token,
        leaseId: "workspace-first-editor",
        operationId: "workspace-first-acquire",
      })
    )
    if (!firstEditor || firstEditor.status !== "editing")
      throw new Error("Expected the first editor lease")

    const saved = await anonymous.mutation(
      api.guestAccess.saveResponseWorkspace,
      await withGuestAccessBoundary({
        token: firstGrant.token,
        leaseId: "workspace-first-editor",
        leaseGeneration: firstEditor.editorLease.generation,
        operationId: "workspace-first-save-1",
        expectedRevision: 0,
        answerMode: "batch",
        batchText: "The first call is to the closing lawyer.",
        questionAnswers: [
          {
            questionId: "q-1",
            text: "This independent answer must not be replaced.",
          },
        ],
      })
    )
    expect(saved).toMatchObject({
      status: "saved",
      workspace: {
        answerMode: "batch",
        batchText: "The first call is to the closing lawyer.",
        questionAnswers: [
          {
            questionId: "q-1",
            text: "This independent answer must not be replaced.",
          },
        ],
        progress: { completed: 1, total: 1 },
        revision: 1,
      },
    })
    await expect(
      anonymous.mutation(
        api.guestAccess.saveResponseWorkspace,
        await withGuestAccessBoundary({
          token: firstGrant.token,
          leaseId: "workspace-first-editor",
          leaseGeneration: firstEditor.editorLease.generation,
          operationId: "workspace-first-save-1",
          expectedRevision: 0,
          answerMode: "batch",
          batchText: "The first call is to the closing lawyer.",
          questionAnswers: [
            {
              questionId: "q-1",
              text: "This independent answer must not be replaced.",
            },
          ],
        })
      )
    ).resolves.toEqual(saved)

    await expect(
      anonymous.mutation(
        api.guestAccess.saveResponseWorkspace,
        await withGuestAccessBoundary({
          token: firstGrant.token,
          leaseId: "workspace-first-editor",
          leaseGeneration: firstEditor.editorLease.generation,
          operationId: "workspace-first-save-stale",
          expectedRevision: 0,
          answerMode: "one_by_one",
          batchText: "stale overwrite",
          questionAnswers: [{ questionId: "q-1", text: "stale overwrite" }],
        })
      )
    ).resolves.toMatchObject({
      status: "conflict",
      workspace: {
        batchText: "The first call is to the closing lawyer.",
        revision: 1,
      },
    })

    const firstReopened = await anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(firstGrant.token, "198.51.100.90")
    )
    expect(firstReopened).toMatchObject({
      status: "available",
      workspace: {
        answerMode: "batch",
        batchText: "The first call is to the closing lawyer.",
        questionAnswers: [
          {
            questionId: "q-1",
            text: "This independent answer must not be replaced.",
          },
        ],
        progress: { completed: 1, total: 1 },
        revision: 1,
      },
    })

    const secondOpened = await anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(secondGrant.token, "198.51.100.91")
    )
    expect(secondOpened).toMatchObject({
      status: "available",
      workspace: {
        batchText: "",
        questionAnswers: [{ questionId: "q-1", text: "" }],
        revision: 0,
      },
    })

    const adminProjection = await backend.query(
      api.guestAccess.inspectResponseWorkspace,
      { grantId: firstGrant.grant.grantId }
    )
    expect(adminProjection).toMatchObject({
      grantId: firstGrant.grant.grantId,
      requestHumanId: request.humanId,
      assignedPerson: { displayName: "First Expert" },
      questions: [
        {
          questionId: "q-1",
          question: "What do you do in the first hour after the bank slips?",
          motivation:
            "Capture the recovery sequence missing from indexed guides.",
        },
      ],
      workspace: {
        batchText: "The first call is to the closing lawyer.",
        revision: 1,
      },
    })
    expect(JSON.stringify(adminProjection)).not.toContain(firstGrant.token)

    const persisted = await backend.run(async (ctx) => ({
      workspaces: await ctx.db.query("responseWorkspaces").collect(),
      operations: await ctx.db.query("responseWorkspaceOperations").collect(),
    }))
    expect(persisted.workspaces).toHaveLength(2)
    expect(persisted.workspaces.map(({ grantId }) => grantId)).toEqual(
      expect.arrayContaining([
        firstGrant.grant.grantId,
        secondGrant.grant.grantId,
      ])
    )
    expect(persisted.operations).toHaveLength(1)
  })

  it("reconciles reordered, added, removed, and restored interview questions by stable ID", async () => {
    const { anonymous, backend, request } = await workspace()
    const person = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Changing Brief Expert",
      email: "changing-brief@example.ca",
      correlationId: "changing-brief-person",
    })
    const created = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: person.personId,
      correlationId: "changing-brief-grant",
    })
    if (!created.token) throw new Error("Expected one-time grant token")
    const token = created.token
    await anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(token, "198.51.100.92")
    )
    const lease = await anonymous.mutation(
      api.guestAccess.acquireEditorLease,
      await withGuestAccessBoundary({
        token,
        leaseId: "changing-brief-editor",
        operationId: "changing-brief-acquire",
      })
    )
    if (!lease || lease.status !== "editing")
      throw new Error("Expected editor lease")
    await anonymous.mutation(
      api.guestAccess.saveResponseWorkspace,
      await withGuestAccessBoundary({
        token,
        leaseId: "changing-brief-editor",
        leaseGeneration: lease.editorLease.generation,
        operationId: "changing-brief-save-q1",
        expectedRevision: 0,
        answerMode: "one_by_one",
        batchText: "",
        questionAnswers: [{ questionId: "q-1", text: "Retain q-1." }],
      })
    )

    const replaceQuestions = async (questions: typeof packageInput.questions) =>
      backend.run(async (ctx) => {
        const interview = await ctx.db
          .query("expertInterviews")
          .withIndex("by_request", (index) =>
            index.eq("requestId", request.requestId)
          )
          .unique()
        if (!interview) throw new Error("Expected interview")
        await ctx.db.patch(interview._id, {
          questions,
          updatedAt: interview.updatedAt + 1,
        })
      })
    const q2 = {
      id: "q-2",
      question: "Which warning sign matters?",
      motivation: "Capture a transferable decision rule.",
      gapIds: ["gap-1"],
    }
    const q3 = {
      id: "q-3",
      question: "What caveat should readers know?",
      motivation: "Keep the answer accurate.",
      gapIds: ["gap-1"],
    }

    await replaceQuestions([q2, packageInput.questions[0]])
    await expect(
      anonymous.mutation(
        api.guestAccess.resolve,
        await resolveArgs(token, "198.51.100.92")
      )
    ).resolves.toMatchObject({
      status: "available",
      workspace: {
        questionAnswers: [
          { questionId: "q-2", text: "" },
          { questionId: "q-1", text: "Retain q-1." },
        ],
        progress: { completed: 1, total: 2 },
        revision: 2,
      },
    })
    const savedWithQ2 = await anonymous.mutation(
      api.guestAccess.saveResponseWorkspace,
      await withGuestAccessBoundary({
        token,
        leaseId: "changing-brief-editor",
        leaseGeneration: lease.editorLease.generation,
        operationId: "changing-brief-save-q2",
        expectedRevision: 2,
        answerMode: "one_by_one",
        batchText: "",
        questionAnswers: [
          { questionId: "q-2", text: "Retain q-2 while inactive." },
          { questionId: "q-1", text: "Retain q-1." },
        ],
      })
    )

    await replaceQuestions([packageInput.questions[0], q3])
    await expect(
      anonymous.mutation(
        api.guestAccess.resolve,
        await resolveArgs(token, "198.51.100.92")
      )
    ).resolves.toMatchObject({
      status: "available",
      workspace: {
        questionAnswers: [
          { questionId: "q-1", text: "Retain q-1." },
          { questionId: "q-3", text: "" },
        ],
        progress: { completed: 1, total: 2 },
        revision: 4,
      },
    })

    await replaceQuestions([q2, packageInput.questions[0], q3])
    await expect(
      anonymous.mutation(
        api.guestAccess.resolve,
        await resolveArgs(token, "198.51.100.92")
      )
    ).resolves.toMatchObject({
      status: "available",
      workspace: {
        questionAnswers: [
          { questionId: "q-2", text: "Retain q-2 while inactive." },
          { questionId: "q-1", text: "Retain q-1." },
          { questionId: "q-3", text: "" },
        ],
        progress: { completed: 2, total: 3 },
        revision: 5,
      },
    })
    await expect(
      anonymous.mutation(
        api.guestAccess.saveResponseWorkspace,
        await withGuestAccessBoundary({
          token,
          leaseId: "changing-brief-editor",
          leaseGeneration: lease.editorLease.generation,
          operationId: "changing-brief-save-q2",
          expectedRevision: 2,
          answerMode: "one_by_one",
          batchText: "",
          questionAnswers: [
            { questionId: "q-2", text: "Retain q-2 while inactive." },
            { questionId: "q-1", text: "Retain q-1." },
          ],
        })
      )
    ).resolves.toEqual(savedWithQ2)
  })

  it("enforces one renewable editor lease and rejects the stale device after an idempotent takeover", async () => {
    const { anonymous, backend, request } = await workspace()
    const person = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Lease Expert",
      email: "lease@example.ca",
      correlationId: "lease-person",
    })
    const created = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: person.personId,
      correlationId: "lease-grant",
    })
    if (!created.token) throw new Error("Expected one-time grant token")
    const token = created.token
    const opened = await anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(token, "198.51.100.100")
    )
    expect(opened).toMatchObject({
      status: "available",
      workspace: {
        editorLease: { active: false, generation: 0, expiresAt: null },
      },
    })

    const first = await anonymous.mutation(
      api.guestAccess.acquireEditorLease,
      await withGuestAccessBoundary({
        token,
        leaseId: "device-a-lease",
        operationId: "lease-acquire-a",
      })
    )
    expect(first).toMatchObject({
      status: "editing",
      editorLease: {
        active: true,
        generation: 1,
        expiresAt: expect.any(Number),
      },
    })
    await expect(
      anonymous.mutation(
        api.guestAccess.acquireEditorLease,
        await withGuestAccessBoundary({
          token,
          leaseId: "device-a-lease",
          operationId: "lease-acquire-a",
        })
      )
    ).resolves.toEqual(first)
    const resumed = await anonymous.mutation(
      api.guestAccess.acquireEditorLease,
      await withGuestAccessBoundary({
        token,
        leaseId: "device-a-lease",
        operationId: "lease-resume-a",
      })
    )
    expect(resumed).toMatchObject({
      status: "editing",
      editorLease: { active: true, generation: 1 },
    })
    expect(resumed?.editorLease.expiresAt ?? 0).toBeGreaterThanOrEqual(
      first?.editorLease.expiresAt ?? 0
    )
    await expect(
      anonymous.mutation(
        api.guestAccess.acquireEditorLease,
        await withGuestAccessBoundary({
          token,
          leaseId: "device-b-lease",
          operationId: "lease-acquire-b",
        })
      )
    ).resolves.toMatchObject({
      status: "conflict",
      editorLease: { active: true, generation: 1 },
    })

    const heartbeat = await anonymous.mutation(
      api.guestAccess.heartbeatEditorLease,
      await withGuestAccessBoundary({
        token,
        leaseId: "device-a-lease",
        leaseGeneration: 1,
        operationId: "lease-heartbeat-a",
      })
    )
    expect(heartbeat).toMatchObject({
      status: "editing",
      editorLease: { active: true, generation: 1 },
    })
    await expect(
      anonymous.mutation(
        api.guestAccess.heartbeatEditorLease,
        await withGuestAccessBoundary({
          token,
          leaseId: "device-a-lease",
          leaseGeneration: 1,
          operationId: "lease-heartbeat-a",
        })
      )
    ).resolves.toEqual(heartbeat)

    await expect(
      anonymous.mutation(
        api.guestAccess.saveResponseWorkspace,
        await withGuestAccessBoundary({
          token,
          leaseId: "device-a-lease",
          leaseGeneration: 1,
          operationId: "lease-save-a",
          expectedRevision: 0,
          answerMode: "one_by_one",
          batchText: "",
          questionAnswers: [
            { questionId: "q-1", text: "Current device answer." },
          ],
        })
      )
    ).resolves.toMatchObject({ status: "saved", workspace: { revision: 1 } })

    const takeover = await anonymous.mutation(
      api.guestAccess.takeoverEditorLease,
      await withGuestAccessBoundary({
        token,
        leaseId: "device-b-lease",
        expectedGeneration: 1,
        operationId: "lease-takeover-b",
      })
    )
    expect(takeover).toMatchObject({
      status: "editing",
      editorLease: { active: true, generation: 2 },
    })
    const takeoverActivityAt = await backend.run(
      async (ctx) => (await ctx.db.get(created.grant.grantId))?.latestActivityAt
    )
    await expect(
      anonymous.mutation(
        api.guestAccess.takeoverEditorLease,
        await withGuestAccessBoundary({
          token,
          leaseId: "device-b-lease",
          expectedGeneration: 1,
          operationId: "lease-takeover-b",
        })
      )
    ).resolves.toEqual(takeover)

    await expect(
      anonymous.mutation(
        api.guestAccess.acquireEditorLease,
        await withGuestAccessBoundary({
          token,
          leaseId: "device-a-lease",
          operationId: "lease-acquire-a",
        })
      )
    ).resolves.toMatchObject({
      status: "conflict",
      editorLease: { active: true, generation: 2 },
    })
    await expect(
      anonymous.mutation(
        api.guestAccess.heartbeatEditorLease,
        await withGuestAccessBoundary({
          token,
          leaseId: "device-a-lease",
          leaseGeneration: 1,
          operationId: "lease-heartbeat-a",
        })
      )
    ).resolves.toMatchObject({
      status: "conflict",
      editorLease: { active: true, generation: 2 },
    })
    await expect(
      anonymous.mutation(
        api.guestAccess.saveResponseWorkspace,
        await withGuestAccessBoundary({
          token,
          leaseId: "device-a-lease",
          leaseGeneration: 1,
          operationId: "lease-save-a",
          expectedRevision: 0,
          answerMode: "one_by_one",
          batchText: "",
          questionAnswers: [
            { questionId: "q-1", text: "Current device answer." },
          ],
        })
      )
    ).resolves.toMatchObject({
      status: "lease_conflict",
      workspace: { revision: 1 },
      editorLease: { active: true, generation: 2 },
    })

    await expect(
      anonymous.mutation(
        api.guestAccess.heartbeatEditorLease,
        await withGuestAccessBoundary({
          token,
          leaseId: "device-a-lease",
          leaseGeneration: 1,
          operationId: "lease-heartbeat-stale-a",
        })
      )
    ).resolves.toMatchObject({
      status: "conflict",
      editorLease: { active: true, generation: 2 },
    })
    await expect(
      anonymous.mutation(
        api.guestAccess.saveResponseWorkspace,
        await withGuestAccessBoundary({
          token,
          leaseId: "device-a-lease",
          leaseGeneration: 1,
          operationId: "lease-save-stale-a",
          expectedRevision: 1,
          answerMode: "batch",
          batchText: "This must not overwrite the current editor.",
          questionAnswers: [
            { questionId: "q-1", text: "This must not overwrite." },
          ],
        })
      )
    ).resolves.toMatchObject({
      status: "lease_conflict",
      workspace: {
        revision: 1,
        questionAnswers: [
          { questionId: "q-1", text: "Current device answer." },
        ],
      },
      editorLease: { generation: 2 },
    })

    const persisted = await backend.run(async (ctx) => ({
      workspace: await ctx.db
        .query("responseWorkspaces")
        .withIndex("by_grant", (index) =>
          index.eq("grantId", created.grant.grantId)
        )
        .unique(),
      events: await ctx.db
        .query("responseWorkspaceEvents")
        .withIndex("by_grant_occurred_at", (index) =>
          index.eq("grantId", created.grant.grantId)
        )
        .collect(),
      leaseOperations: await ctx.db
        .query("responseWorkspaceLeaseOperations")
        .collect(),
      leaseAudits: (await ctx.db.query("auditEvents").collect()).filter(
        ({ operation }) => operation.startsWith("guest_access.lease_")
      ),
      grant: await ctx.db.get(created.grant.grantId),
      guestNotifications: (
        await ctx.db.query("notifications").collect()
      ).filter(({ type }) => type.startsWith("guest_")),
    }))
    expect(persisted.workspace?.leaseHolderHash).not.toBe("device-a-lease")
    expect(persisted.workspace?.leaseHolderHash).not.toBe("device-b-lease")
    expect(
      persisted.events
        .map(({ kind }) => kind)
        .filter((kind) => kind.startsWith("lease_"))
    ).toEqual(["lease_acquired", "lease_taken_over"])
    expect(
      persisted.events
        .filter(({ kind }) => kind.startsWith("lease_"))
        .map(({ actorGrantId, credentialId }) => ({
          actorGrantId,
          credentialId,
        }))
    ).toEqual([
      {
        actorGrantId: created.grant.grantId,
        credentialId: `guest-access-grant:${created.grant.grantId}`,
      },
      {
        actorGrantId: created.grant.grantId,
        credentialId: `guest-access-grant:${created.grant.grantId}`,
      },
    ])
    expect(JSON.stringify(persisted.events)).not.toContain("device-")
    expect(JSON.stringify(persisted.leaseOperations)).not.toContain("device-")
    expect(
      persisted.leaseAudits.map(
        ({ operation, correlationId, actorGrantId, actorPrincipalId }) => ({
          operation,
          correlationId,
          actorGrantId,
          actorPrincipalId,
        })
      )
    ).toEqual([
      {
        operation: "guest_access.lease_acquired",
        correlationId: "lease-acquire-a",
        actorGrantId: created.grant.grantId,
        actorPrincipalId: undefined,
      },
      {
        operation: "guest_access.lease_taken_over",
        correlationId: "lease-takeover-b",
        actorGrantId: created.grant.grantId,
        actorPrincipalId: undefined,
      },
    ])
    expect(persisted.grant?.latestActivityAt).toBeGreaterThan(
      created.grant.latestActivityAt
    )
    expect(persisted.grant?.latestActivityAt).toBe(takeoverActivityAt)
    expect(persisted.guestNotifications).toEqual([])
    expect(JSON.stringify(takeover)).not.toContain("leaseId")
    expect(JSON.stringify(takeover)).not.toContain("leaseHolder")
  })

  it("acquires an expired editor lease without recording a destructive takeover", async () => {
    const { anonymous, backend, request } = await workspace()
    const person = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Lease Expiry Expert",
      email: "lease-expiry@example.ca",
      correlationId: "lease-expiry-person",
    })
    const created = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: person.personId,
      correlationId: "lease-expiry-grant",
    })
    if (!created.token) throw new Error("Expected one-time grant token")
    await anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(created.token, "198.51.100.101")
    )
    await anonymous.mutation(
      api.guestAccess.acquireEditorLease,
      await withGuestAccessBoundary({
        token: created.token,
        leaseId: "expired-device-a",
        operationId: "lease-expired-acquire-a",
      })
    )
    await backend.run(async (ctx) => {
      const responseWorkspace = await ctx.db
        .query("responseWorkspaces")
        .withIndex("by_grant", (index) =>
          index.eq("grantId", created.grant.grantId)
        )
        .unique()
      if (!responseWorkspace) throw new Error("Workspace missing")
      await ctx.db.patch(responseWorkspace._id, {
        leaseExpiresAt: Date.now() - 1,
      })
      const acquireOperation = await ctx.db
        .query("responseWorkspaceLeaseOperations")
        .withIndex("by_workspace_operation", (index) =>
          index
            .eq("workspaceId", responseWorkspace._id)
            .eq("operationId", "lease-expired-acquire-a")
        )
        .unique()
      if (!acquireOperation) throw new Error("Lease operation missing")
      await ctx.db.patch(acquireOperation._id, {
        resultExpiresAt: Date.now() - 1,
      })
    })

    await expect(
      anonymous.mutation(
        api.guestAccess.acquireEditorLease,
        await withGuestAccessBoundary({
          token: created.token,
          leaseId: "expired-device-a",
          operationId: "lease-expired-acquire-a",
        })
      )
    ).resolves.toMatchObject({
      status: "conflict",
      editorLease: { active: false, generation: 1 },
    })

    await expect(
      anonymous.mutation(
        api.guestAccess.acquireEditorLease,
        await withGuestAccessBoundary({
          token: created.token,
          leaseId: "expired-device-b",
          operationId: "lease-expired-acquire-b",
        })
      )
    ).resolves.toMatchObject({
      status: "editing",
      editorLease: { active: true, generation: 2 },
    })
    const events = await backend.run(async (ctx) =>
      ctx.db
        .query("responseWorkspaceEvents")
        .withIndex("by_grant_occurred_at", (index) =>
          index.eq("grantId", created.grant.grantId)
        )
        .collect()
    )
    expect(events.map(({ kind }) => kind)).toEqual([
      "lease_acquired",
      "lease_acquired",
    ])
  })

  it("renews and revokes grants independently while retaining workspace history and invalidating old tokens", async () => {
    const { anonymous, backend, request } = await workspace()
    const person = await backend.mutation(api.people.create, {
      humanId: request.humanId,
      displayName: "Lifecycle Expert",
      email: "lifecycle@example.ca",
      correlationId: "lifecycle-person",
    })
    const first = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: person.personId,
      correlationId: "lifecycle-first",
    })
    const second = await backend.mutation(api.guestAccess.create, {
      humanId: request.humanId,
      personId: person.personId,
      correlationId: "lifecycle-second",
    })
    if (!first.token || !second.token) throw new Error("Expected tokens")
    await anonymous.mutation(
      api.guestAccess.resolve,
      await resolveArgs(first.token, "198.51.100.201")
    )
    const lease = await anonymous.mutation(
      api.guestAccess.acquireEditorLease,
      await withGuestAccessBoundary({
        token: first.token,
        leaseId: "lifecycle-editor",
        operationId: "lifecycle-acquire",
      })
    )
    if (!lease || lease.status !== "editing") throw new Error("Lease missing")
    await anonymous.mutation(
      api.guestAccess.saveResponseWorkspace,
      await withGuestAccessBoundary({
        token: first.token,
        leaseId: "lifecycle-editor",
        leaseGeneration: lease.editorLease.generation,
        operationId: "lifecycle-save",
        expectedRevision: 0,
        answerMode: "one_by_one",
        batchText: "",
        questionAnswers: [{ questionId: "q-1", text: "Retained evidence." }],
      })
    )
    const firstProgressAudit = await backend.run(async (ctx) =>
      (await ctx.db.query("auditEvents").collect()).find(
        ({ operation }) => operation === "guest_access.first_progress"
      )
    )
    expect(firstProgressAudit).toMatchObject({
      actorGrantId: first.grant.grantId,
      credentialId: `guest-access-grant:${first.grant.grantId}`,
      correlationId: "lifecycle-save",
    })
    expect(firstProgressAudit?.actorPrincipalId).toBeUndefined()
    expect(JSON.stringify(firstProgressAudit)).not.toContain(first.token)
    await backend.run((ctx) =>
      ctx.db.patch(first.grant.grantId, { expiresAt: Date.now() - 1 })
    )
    await expect(
      anonymous.mutation(
        api.guestAccess.resolve,
        await resolveArgs(first.token, "198.51.100.202")
      )
    ).resolves.toEqual({ status: "expired" })

    const beforeRenew = Date.now()
    const renewed = await backend.mutation(api.guestAccess.renew, {
      grantId: first.grant.grantId,
      correlationId: "lifecycle-renew",
    })
    expect(renewed.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    if (!renewed.token) throw new Error("Expected one-time renewed token")
    expect(renewed.grant.expiresAt).toBeGreaterThanOrEqual(
      beforeRenew + 48 * 60 * 60 * 1_000
    )
    const renewedRecord = await backend.run((ctx) =>
      ctx.db.get(first.grant.grantId)
    )
    expect(
      (renewedRecord?.expiresAt ?? 0) - (renewedRecord?.updatedAt ?? 0)
    ).toBe(48 * 60 * 60 * 1_000)
    const renewReplay = await backend.mutation(api.guestAccess.renew, {
      grantId: first.grant.grantId,
      correlationId: "lifecycle-renew",
    })
    expect(renewReplay).toEqual({
      grant: renewed.grant,
      token: null,
    })
    await expect(
      anonymous.mutation(
        api.guestAccess.resolve,
        await resolveArgs(first.token, "198.51.100.203")
      )
    ).resolves.toBeNull()
    if (!renewed.token) {
      throw new Error("Expected renewal to return its one-time token")
    }
    await expect(
      anonymous.mutation(
        api.guestAccess.resolve,
        await resolveArgs(renewed.token, "198.51.100.204")
      )
    ).resolves.toMatchObject({
      status: "available",
      workspace: {
        revision: 1,
        questionAnswers: [{ questionId: "q-1", text: "Retained evidence." }],
      },
    })

    const revoked = await backend.mutation(api.guestAccess.revoke, {
      grantId: second.grant.grantId,
      correlationId: "lifecycle-revoke",
    })
    await expect(
      backend.mutation(api.guestAccess.revoke, {
        grantId: second.grant.grantId,
        correlationId: "lifecycle-revoke",
      })
    ).resolves.toEqual(revoked)
    await expect(
      anonymous.mutation(
        api.guestAccess.resolve,
        await resolveArgs(second.token, "198.51.100.205")
      )
    ).resolves.toBeNull()
    await expect(
      backend.mutation(api.guestAccess.renew, {
        grantId: second.grant.grantId,
        correlationId: "lifecycle-renew-revoked",
      })
    ).rejects.toMatchObject({
      data: { code: "GUEST_ACCESS_GRANT_REVOKED" },
    })

    const grants = await backend.mutation(api.guestAccess.list, {
      humanId: request.humanId,
    })
    expect(grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          grantId: first.grant.grantId,
          person: expect.objectContaining({ personId: person.personId }),
          state: "in_progress",
          progress: { completed: 1, total: 1 },
          tokenVersion: 2,
          events: expect.arrayContaining([
            expect.objectContaining({ kind: "expired", actor: "system" }),
            expect.objectContaining({
              kind: "renewed",
              actor: "administrator",
              actorName: expect.any(String),
            }),
          ]),
        }),
        expect.objectContaining({
          grantId: second.grant.grantId,
          state: "revoked",
          events: expect.arrayContaining([
            expect.objectContaining({ kind: "revoked" }),
          ]),
        }),
      ])
    )
  })
})
