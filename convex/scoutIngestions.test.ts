// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const identity = {
  subject: "agent_scout",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "agent-editor",
  jti: "credential_scout",
}

const opportunity = {
  title: "Renewal affordability",
  score: 92,
  timingLabel: "while active",
  sourceUrl: "https://Example.com:443/thread/42?utm_source=scout",
  question: "How should a borrower prepare for renewal?",
  sourceMetadata: ["Reddit", "2026-07-18"],
  talkingPoints: ["Build a renewal decision framework"],
  citations: [
    {
      label: "Bank of Canada",
      url: "https://bank.example/rates",
      supports: "Rate context",
    },
  ],
  guardrails: ["Avoid individualized advice"],
  operatorCue: "Answer without link",
}

function report(overrides: Partial<typeof opportunity> = {}) {
  const item = { ...opportunity, ...overrides }
  return `# FairLend Community + Media Opportunity Report — 2026-07-18 09:00 ET

## Executive summary

- Qualified community questions: 1
- Live journalist/source requests: 0
- Beat-aligned journalist/editorial prospects: 0
- Journalist story leads: 0
- New search-demand signals: 0
- Highest-priority action: Answer A1.
- Run notes: Verified public sources.

## A. Community questions to answer

### A1. ${item.title} — Score: ${item.score}/100 — Act by: ${item.timingLabel}

- **Thread:** [Canonical question](${item.sourceUrl})
- **Source:** ${item.sourceMetadata.join("; ")}
- **Question:** ${item.question}
- **Why FairLend can help:** ${item.talkingPoints[0]}
- **What is missing from existing replies:** A structured decision framework.
- **Compliance/moderation check:** ${item.guardrails.join("; ")}
- **Recommended response:** ${item.operatorCue}
- **Optional FairLend resource:** None
- **SEO/content signal:** Durable audience question.

**Draft response**

> Excluded generated draft.

**Evidence used**

- [${item.citations[0].label}](${item.citations[0].url}) — ${item.citations[0].supports}

## B. Live journalist/source requests

- None.

## C. Beat-aligned journalist/editorial prospects

- None.

## D. Journalist story leads from community discussions

- None.

## E. Content-demand ledger

| Audience phrase/question | Source | Intent | Geography | Frequency this run | Existing FairLend answer? | Recommended content action |
|---|---|---|---|---:|---|---|
| Renewal affordability | Community | Learn | Canada | 1 | No | add FAQ section to a relevant page |

## F. Needs manual verification

- None.

## G. Rejected high-surface-area leads

- None.

## H. No-op status

- Not applicable.
`
}

async function backend() {
  const workspace = convexTest(schema, modules)
  const value = workspace.withIdentity(identity)
  await value.mutation(api.principals.syncCurrent)
  return Object.assign(value, {
    withOtherIdentity: (nextIdentity: typeof identity) =>
      workspace.withIdentity(nextIdentity),
  })
}

describe("Scout ingestion workflow contract", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("validates raw Markdown inside the trusted mutation boundary", async () => {
    const app = await backend()
    await expect(
      app.mutation(api.scoutIngestions.apply, {
        idempotencyKey: "invalid-run",
        markdown: "# caller-supplied fake parsed report",
      })
    ).rejects.toMatchObject({ data: { code: "INVALID_SCOUT_REPORT" } })
    await expect(app.query(api.contentRequests.list, {})).resolves.toEqual([])
  })

  it("atomically materializes source evidence and structured context", async () => {
    const app = await backend()
    const result = await app.mutation(api.scoutIngestions.apply, {
      idempotencyKey: "scout-am-1",
      markdown: report(),
    })
    expect(result).toMatchObject({ status: "applied", created: 1, updated: 0 })
    const request = await app.query(api.contentRequests.getByHumanId, {
      humanId: result.requestHumanIds[0],
    })
    expect(request).toMatchObject({
      origin: "automated_scout",
      priority: "high",
      source: {
        body: expect.stringContaining("### A1. Renewal affordability"),
        url: opportunity.sourceUrl,
      },
    })
    const [originalTarget] = await app.query(api.deliveryTracking.list, {
      humanId: result.requestHumanIds[0],
    })
    expect(originalTarget).toMatchObject({
      isOriginal: true,
      channel: "community",
    })
    const context = await app.query(api.scoutIngestions.listContext, {
      humanId: result.requestHumanIds[0],
    })
    expect(context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "talking_points",
          bulletPoints: expect.arrayContaining(opportunity.talkingPoints),
        }),
        expect.objectContaining({
          kind: "citations",
          citations: opportunity.citations,
        }),
        expect.objectContaining({
          kind: "delivery_hint",
          bulletPoints: [opportunity.operatorCue],
        }),
      ])
    )
  })

  it("persists context deck visibility and pin preferences by principal/request", async () => {
    const app = await backend()
    const result = await app.mutation(api.scoutIngestions.apply, {
      idempotencyKey: "preferences-source",
      markdown: report(),
    })
    const humanId = result.requestHumanIds[0]
    const context = await app.query(api.scoutIngestions.listContext, {
      humanId,
    })
    const contextId = context.find(
      (item) => item.kind === "talking_points"
    )?.contextId
    if (!contextId) throw new Error("Missing talking-points context")
    const preferences = {
      visibleContextIds: ["original-question", contextId],
      pinnedContextIds: [contextId],
      knownContextIds: ["original-question", contextId],
    }
    await expect(
      app.mutation(api.scoutIngestions.saveContextDeckPreferences, {
        humanId,
        ...preferences,
        correlationId: "save-context-preferences",
      })
    ).resolves.toEqual(preferences)
    const events = await app.query(api.contentRequests.listAuditEvents, {
      humanId,
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "context_deck.preferences_saved",
          correlationId: "save-context-preferences",
        }),
      ])
    )
    await expect(
      app.query(api.scoutIngestions.getContextDeckPreferences, { humanId })
    ).resolves.toEqual(preferences)
    await expect(
      app.mutation(api.scoutIngestions.saveContextDeckPreferences, {
        humanId,
        ...preferences,
        correlationId: "save-context-preferences",
      })
    ).resolves.toEqual(preferences)
    await expect(
      app.mutation(api.scoutIngestions.saveContextDeckPreferences, {
        humanId,
        ...preferences,
        pinnedContextIds: [],
        correlationId: "save-context-preferences",
      })
    ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })
    const rawAudit = await app.run(async (ctx) => {
      const request = await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_human_id", (index) =>
          index.eq("organizationId", identity.org_id).eq("humanId", humanId)
        )
        .unique()
      if (!request) throw new Error("Missing ingested request")
      return ctx.db
        .query("auditEvents")
        .withIndex("by_request_operation_correlation", (index) =>
          index
            .eq("requestId", request._id)
            .eq("operation", "context_deck.preferences_saved")
            .eq("correlationId", "save-context-preferences")
        )
        .unique()
    })
    expect(rawAudit?.inputFingerprint).toMatch(/^fnv1a32:/)
    expect(rawAudit?.inputFingerprint).not.toContain(contextId)

    const otherEditor = app.withOtherIdentity({
      ...identity,
      subject: "agent_scout_two",
      jti: "credential_scout_two",
    })
    await otherEditor.mutation(api.principals.syncCurrent)
    await expect(
      otherEditor.mutation(api.scoutIngestions.saveContextDeckPreferences, {
        humanId,
        ...preferences,
        pinnedContextIds: [],
        correlationId: "save-context-preferences",
      })
    ).resolves.toEqual({ ...preferences, pinnedContextIds: [] })
  })

  it("replays identical Markdown and rejects key reuse for changed content", async () => {
    const app = await backend()
    const first = await app.mutation(api.scoutIngestions.apply, {
      idempotencyKey: "stable-run",
      markdown: report(),
    })
    const replay = await app.mutation(api.scoutIngestions.apply, {
      idempotencyKey: "stable-run",
      markdown: report(),
    })
    expect(replay).toEqual({ ...first, status: "idempotent_replay" })
    await expect(
      app.mutation(api.scoutIngestions.apply, {
        idempotencyKey: "stable-run",
        markdown: report({ title: "Different content" }),
      })
    ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })
    await expect(app.query(api.contentRequests.list, {})).resolves.toHaveLength(
      1
    )
  })

  it("sorts ingested automation behind manual Critical work", async () => {
    const app = await backend()
    const manual = await app.mutation(api.contentRequests.createManual, {
      title: "Direct operator request",
      origin: "manual",
      correlationId: "direct-first",
    })
    const automated = await app.mutation(api.scoutIngestions.apply, {
      idempotencyKey: "automated-second",
      markdown: report(),
    })
    const queue = await app.query(api.contentRequests.list, {})
    expect(queue.map((item) => item.humanId)).toEqual([
      manual.humanId,
      automated.requestHumanIds[0],
    ])
  })

  it("makes title-only manual creation idempotent by actor correlation", async () => {
    const app = await backend()
    const input = {
      title: "Minimal direct request",
      origin: "manual" as const,
      correlationId: "manual-minimal-stable",
    }
    const first = await app.mutation(api.contentRequests.createManual, input)
    const replay = await app.mutation(api.contentRequests.createManual, input)
    expect(replay).toEqual(first)
    await expect(
      app.mutation(api.contentRequests.createManual, {
        ...input,
        title: "Different content under reused key",
      })
    ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })
    await expect(app.query(api.contentRequests.list, {})).resolves.toHaveLength(
      1
    )
  })

  it("records explicit-source deduplication as an idempotent create operation", async () => {
    const app = await backend()
    const first = await app.mutation(api.contentRequests.createManual, {
      title: "Canonical operator request",
      origin: "manual",
      source: { url: "https://example.com/operator-question" },
      correlationId: "canonical-create",
    })
    const dedupeInput = {
      title: "Same opportunity from another adapter",
      origin: "http_api" as const,
      source: {
        url: "https://EXAMPLE.com:443/operator-question?utm_source=api",
      },
      correlationId: "dedupe-create",
    }
    const deduplicated = await app.mutation(
      api.contentRequests.createManual,
      dedupeInput
    )
    expect(deduplicated.humanId).toBe(first.humanId)
    await expect(
      app.mutation(api.contentRequests.createManual, {
        ...dedupeInput,
        title: "Different content under the dedupe key",
      })
    ).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_KEY_REUSED" } })
    const audit = await app.query(api.contentRequests.listAuditEvents, {
      humanId: first.humanId,
    })
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "content_request.deduplicated",
          correlationId: "dedupe-create",
        }),
      ])
    )
  })

  it("updates derived context while preserving the immutable source snapshot", async () => {
    const app = await backend()
    const first = await app.mutation(api.scoutIngestions.apply, {
      idempotencyKey: "run-one",
      markdown: report(),
    })
    const before = await app.query(api.contentRequests.getByHumanId, {
      humanId: first.requestHumanIds[0],
    })
    const second = await app.mutation(api.scoutIngestions.apply, {
      idempotencyKey: "run-two",
      markdown: report({ talkingPoints: ["Updated talking point"] }),
    })
    expect(second).toMatchObject({
      created: 0,
      updated: 1,
      requestHumanIds: first.requestHumanIds,
    })
    const after = await app.query(api.contentRequests.getByHumanId, {
      humanId: first.requestHumanIds[0],
    })
    expect(after?.source).toEqual(before?.source)
    const context = await app.query(api.scoutIngestions.listContext, {
      humanId: first.requestHumanIds[0],
    })
    expect(context).toContainEqual(
      expect.objectContaining({
        kind: "talking_points",
        bulletPoints: expect.arrayContaining(["Updated talking point"]),
      })
    )
  })

  it("promotes once to manual Critical, preserves naming/source, and notifies", async () => {
    const app = await backend()
    const ingested = await app.mutation(api.scoutIngestions.apply, {
      idempotencyKey: "run-promote",
      markdown: report(),
    })
    const before = await app.query(api.contentRequests.getByHumanId, {
      humanId: ingested.requestHumanIds[0],
    })
    const input = {
      title: "Operator-requested renewal answer",
      origin: "manual" as const,
      source: {
        url: "https://EXAMPLE.com:443/thread/42?utm_medium=manual",
        body: "operator context",
      },
      correlationId: "manual-promote-1",
    }
    const promoted = await app.mutation(api.contentRequests.createManual, input)
    const replay = await app.mutation(api.contentRequests.createManual, input)
    expect(promoted).toMatchObject({
      humanId: before?.humanId,
      origin: "manual",
      priority: "critical",
    })
    expect(replay).toEqual(promoted)
    expect(promoted.source).toEqual(before?.source)
    await app.mutation(api.scoutIngestions.apply, {
      idempotencyKey: "run-after-promotion",
      markdown: report({ title: "Automation must not overwrite this title" }),
    })
    const preserved = await app.query(api.contentRequests.getByHumanId, {
      humanId: promoted.humanId,
    })
    expect(preserved?.title).toBe("Operator-requested renewal answer")
    await expect(app.query(api.contentRequests.list, {})).resolves.toHaveLength(
      1
    )
    await expect(
      app.query(api.contentRequests.listMyNotifications, {})
    ).resolves.toEqual([
      expect.objectContaining({ type: "critical_escalation" }),
    ])
  })

  it("backfills normalized URLs for pre-ingestion source snapshots", async () => {
    const app = await backend()
    const legacy = await app.mutation(api.contentRequests.createManual, {
      title: "Legacy sourced request",
      origin: "manual",
      source: {
        url: "HTTPS://Example.com:443/legacy?utm_source=old&topic=renewal",
      },
      correlationId: "legacy-create",
    })
    await app.run(async (ctx) => {
      const request = await ctx.db
        .query("contentRequests")
        .withIndex("by_organization_human_id", (index) =>
          index
            .eq("organizationId", "org_fairlend")
            .eq("humanId", legacy.humanId)
        )
        .unique()
      if (!request) throw new Error("Missing seeded request")
      await ctx.db.patch(request._id, { normalizedSourceUrl: undefined })
    })
    await app.mutation(internal.migrations.backfillNormalizedSourceUrls, {})
    const migrated = await app.run(async (ctx) =>
      ctx.db
        .query("contentRequests")
        .withIndex("by_organization_human_id", (index) =>
          index
            .eq("organizationId", "org_fairlend")
            .eq("humanId", legacy.humanId)
        )
        .unique()
    )
    expect(migrated?.normalizedSourceUrl).toBe(
      "https://example.com/legacy?topic=renewal"
    )
  })

  it("records legacy normalized-URL collisions for deterministic remediation", async () => {
    const app = await backend()
    const duplicateId = await app.run(async (ctx) => {
      const principal = await ctx.db.query("principals").first()
      if (!principal) throw new Error("Missing principal")
      const common = {
        organizationId: "org_fairlend",
        normalizedTitle: "legacy duplicate",
        searchText: "legacy duplicate",
        aliases: [],
        origin: "manual" as const,
        priority: "critical" as const,
        lifecycle: "pending" as const,
        disposition: "active" as const,
        retention: "active" as const,
        aggregateVersion: 1,
        createdByPrincipalId: principal._id,
        createdAt: 1,
        updatedAt: 1,
      }
      await ctx.db.insert("contentRequests", {
        ...common,
        humanId: "CR-CANONICAL",
        title: "Canonical legacy request",
        normalizedSourceUrl: "https://example.com/collision",
      })
      const requestId = await ctx.db.insert("contentRequests", {
        ...common,
        humanId: "CR-DUPLICATE",
        title: "Duplicate legacy request",
      })
      const sourceSnapshotId = await ctx.db.insert("sourceSnapshots", {
        organizationId: "org_fairlend",
        requestId,
        url: "HTTPS://EXAMPLE.com:443/collision?utm_source=legacy",
        capturedByPrincipalId: principal._id,
        capturedAt: 1,
      })
      await ctx.db.patch(requestId, { sourceSnapshotId })
      return requestId
    })
    await app.mutation(internal.migrations.backfillNormalizedSourceUrls, {})
    const state = await app.run(async (ctx) => ({
      duplicate: await ctx.db.get(duplicateId),
      conflicts: await ctx.db.query("migrationConflicts").collect(),
    }))
    expect(state.duplicate?.normalizedSourceUrl).toBeUndefined()
    expect(state.conflicts).toEqual([
      expect.objectContaining({
        type: "normalized_source_url_collision",
        requestId: duplicateId,
        normalizedSourceUrl: "https://example.com/collision",
        resolved: false,
      }),
    ])
  })
})
