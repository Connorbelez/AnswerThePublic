// @vitest-environment edge-runtime
import { convexTest } from "convex-test"
import { beforeEach, describe, expect, it } from "vitest"

import { api, internal } from "./_generated/api"
import schema from "./schema"
import { modules } from "./test.setup"

const identity = (subject: string, role: string, credential: string) => ({
  subject,
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role,
  jti: credential,
})

describe("semantic singleton conflict workflow", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("preserves both concurrent assignee values, requires attention, and audits resolution", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("operator", "operator-editor", "operator-session")
    )
    const agent = workspace.withIdentity(
      identity("agent", "agent-editor", "agent-session")
    )
    const founderA = workspace.withIdentity(
      identity("founder-a", "founder", "founder-a-session")
    )
    const founderB = workspace.withIdentity(
      identity("founder-b", "founder", "founder-b-session")
    )
    const operatorPrincipal = await operator.mutation(
      api.principals.syncCurrent
    )
    await agent.mutation(api.principals.syncCurrent)
    const principalA = await founderA.mutation(api.principals.syncCurrent)
    const principalB = await founderB.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Concurrent assignment",
      origin: "manual",
      correlationId: "create-conflict",
    })
    await operator.mutation(internal.contentRequests.assign, {
      humanId: request.humanId,
      assigneePrincipalId: principalA.principalId,
      correlationId: "assign-a",
    })

    const result = await agent.mutation(
      api.semanticConflicts.proposeAssigneeChange,
      {
        humanId: request.humanId,
        expectedAssigneePrincipalId: operatorPrincipal.principalId,
        proposedAssigneePrincipalId: principalB.principalId,
        correlationId: "concurrent-assign-b",
      }
    )

    expect(result).toMatchObject({
      outcome: "attention_required",
      conflict: {
        field: "assigneePrincipalId",
        expectedValue: operatorPrincipal.principalId,
        currentValue: principalA.principalId,
        proposedValue: principalB.principalId,
        status: "open",
      },
    })
    expect(
      await operator.query(api.semanticConflicts.listOpen, {
        humanId: request.humanId,
      })
    ).toHaveLength(1)
    expect(
      await operator.query(api.contentRequests.getByHumanId, {
        humanId: request.humanId,
      })
    ).toMatchObject({ assignee: { principalId: principalA.principalId } })

    if (!result.conflict) throw new Error("Expected a conflict")
    const resolved = await operator.mutation(api.semanticConflicts.resolve, {
      conflictId: result.conflict.conflictId,
      selectedValue: principalB.principalId,
      correlationId: "resolve-conflict-b",
    })
    expect(resolved).toMatchObject({
      status: "resolved",
      resolvedValue: principalB.principalId,
    })
    expect(
      await operator.query(api.contentRequests.getByHumanId, {
        humanId: request.humanId,
      })
    ).toMatchObject({ assignee: { principalId: principalB.principalId } })
    expect(
      await operator.query(api.contentRequests.listAuditEvents, {
        humanId: request.humanId,
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "content_request.semantic_conflict_created",
          correlationId: "concurrent-assign-b",
        }),
        expect.objectContaining({
          operation: "content_request.semantic_conflict_resolved",
          correlationId: "resolve-conflict-b",
        }),
      ])
    )
  })

  it("rejects founder conflict resolution and arbitrary third values", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("operator", "operator-editor", "operator-session")
    )
    const founderA = workspace.withIdentity(
      identity("founder-a", "founder", "founder-a-session")
    )
    const founderB = workspace.withIdentity(
      identity("founder-b", "founder", "founder-b-session")
    )
    const operatorPrincipal = await operator.mutation(
      api.principals.syncCurrent
    )
    const principalA = await founderA.mutation(api.principals.syncCurrent)
    const principalB = await founderB.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Protected conflict resolution",
      origin: "manual",
      correlationId: "create-protected-conflict",
    })
    await operator.mutation(internal.contentRequests.assign, {
      humanId: request.humanId,
      assigneePrincipalId: principalA.principalId,
      correlationId: "assign-protected-a",
    })
    const result = await operator.mutation(
      api.semanticConflicts.proposeAssigneeChange,
      {
        humanId: request.humanId,
        expectedAssigneePrincipalId: operatorPrincipal.principalId,
        proposedAssigneePrincipalId: principalB.principalId,
        correlationId: "make-protected-conflict",
      }
    )
    if (!result.conflict) throw new Error("Expected a conflict")
    await expect(
      founderA.mutation(api.semanticConflicts.resolve, {
        conflictId: result.conflict.conflictId,
        selectedValue: principalB.principalId,
        correlationId: "founder-cannot-resolve",
      })
    ).rejects.toMatchObject({ data: { code: "ROLE_ACCESS_DENIED" } })
    await expect(
      operator.mutation(api.semanticConflicts.resolve, {
        conflictId: result.conflict.conflictId,
        selectedValue: operatorPrincipal.principalId,
        correlationId: "invalid-third-value",
      })
    ).rejects.toMatchObject({ data: { code: "VALIDATION_FAILED" } })
  })

  it("replays successful proposals and resolutions without applying them twice", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("operator", "operator-editor", "operator-session")
    )
    const founderA = workspace.withIdentity(
      identity("founder-a", "founder", "founder-a-session")
    )
    const founderB = workspace.withIdentity(
      identity("founder-b", "founder", "founder-b-session")
    )
    const operatorPrincipal = await operator.mutation(
      api.principals.syncCurrent
    )
    const principalA = await founderA.mutation(api.principals.syncCurrent)
    const principalB = await founderB.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Idempotent singleton operations",
      origin: "manual",
      correlationId: "create-idempotency",
    })

    const appliedInput = {
      humanId: request.humanId,
      expectedAssigneePrincipalId: operatorPrincipal.principalId,
      proposedAssigneePrincipalId: principalA.principalId,
      watcherPrincipalIds: [principalB.principalId],
      reason: "Founder owns the answer",
      correlationId: "apply-idempotently",
    }
    await expect(
      operator.mutation(
        api.semanticConflicts.proposeAssigneeChange,
        appliedInput
      )
    ).resolves.toEqual({ outcome: "applied", conflict: null })
    await expect(
      operator.mutation(
        api.semanticConflicts.proposeAssigneeChange,
        appliedInput
      )
    ).resolves.toEqual({ outcome: "applied", conflict: null })

    const conflict = await operator.mutation(
      api.semanticConflicts.proposeAssigneeChange,
      {
        humanId: request.humanId,
        expectedAssigneePrincipalId: operatorPrincipal.principalId,
        proposedAssigneePrincipalId: principalB.principalId,
        correlationId: "create-idempotent-resolution",
      }
    )
    if (!conflict.conflict) throw new Error("Expected a conflict")
    const resolutionInput = {
      conflictId: conflict.conflict.conflictId,
      selectedValue: principalB.principalId,
      correlationId: "resolve-idempotently",
    }
    const first = await operator.mutation(
      api.semanticConflicts.resolve,
      resolutionInput
    )
    await expect(
      operator.mutation(api.semanticConflicts.resolve, resolutionInput)
    ).resolves.toEqual(first)

    const events = await operator.query(api.contentRequests.listAuditEvents, {
      humanId: request.humanId,
    })
    expect(
      events.filter((event) => event.correlationId === "apply-idempotently")
    ).toHaveLength(1)
    expect(
      events.filter((event) => event.correlationId === "resolve-idempotently")
    ).toHaveLength(1)
  })

  it("rebases stale conflict resolution instead of overwriting a newer third value", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("operator", "operator-editor", "operator-session")
    )
    const founderA = workspace.withIdentity(
      identity("founder-a", "founder", "founder-a-session")
    )
    const founderB = workspace.withIdentity(
      identity("founder-b", "founder", "founder-b-session")
    )
    const founderC = workspace.withIdentity(
      identity("founder-c", "founder", "founder-c-session")
    )
    const operatorPrincipal = await operator.mutation(
      api.principals.syncCurrent
    )
    const principalA = await founderA.mutation(api.principals.syncCurrent)
    const principalB = await founderB.mutation(api.principals.syncCurrent)
    const principalC = await founderC.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Stale conflict resolution",
      origin: "manual",
      correlationId: "create-stale-resolution",
    })
    await operator.mutation(internal.contentRequests.assign, {
      humanId: request.humanId,
      assigneePrincipalId: principalA.principalId,
      correlationId: "assign-stale-a",
    })
    const result = await operator.mutation(
      api.semanticConflicts.proposeAssigneeChange,
      {
        humanId: request.humanId,
        expectedAssigneePrincipalId: operatorPrincipal.principalId,
        proposedAssigneePrincipalId: principalB.principalId,
        correlationId: "conflict-stale-a-b",
      }
    )
    if (!result.conflict) throw new Error("Expected a conflict")
    await operator.mutation(internal.contentRequests.assign, {
      humanId: request.humanId,
      assigneePrincipalId: principalC.principalId,
      correlationId: "newer-third-value",
    })

    const rebased = await operator.mutation(api.semanticConflicts.resolve, {
      conflictId: result.conflict.conflictId,
      selectedValue: principalB.principalId,
      correlationId: "rebase-stale-resolution",
    })
    expect(rebased).toMatchObject({
      status: "open",
      currentValue: principalC.principalId,
      proposedValue: principalB.principalId,
    })
    expect(
      await operator.query(api.contentRequests.getByHumanId, {
        humanId: request.humanId,
      })
    ).toMatchObject({ assignee: { principalId: principalC.principalId } })
  })

  it("treats convergent stale proposals and resolutions as already applied", async () => {
    const workspace = convexTest(schema, modules)
    const operator = workspace.withIdentity(
      identity("operator", "operator-editor", "operator-session")
    )
    const founderA = workspace.withIdentity(
      identity("founder-a", "founder", "founder-a-session")
    )
    const founderB = workspace.withIdentity(
      identity("founder-b", "founder", "founder-b-session")
    )
    const operatorPrincipal = await operator.mutation(
      api.principals.syncCurrent
    )
    const principalA = await founderA.mutation(api.principals.syncCurrent)
    const principalB = await founderB.mutation(api.principals.syncCurrent)
    const request = await operator.mutation(api.contentRequests.createManual, {
      title: "Convergent singleton writes",
      origin: "manual",
      correlationId: "create-convergent",
    })
    await operator.mutation(internal.contentRequests.assign, {
      humanId: request.humanId,
      assigneePrincipalId: principalA.principalId,
      correlationId: "assign-convergent-a",
    })
    await expect(
      operator.mutation(api.semanticConflicts.proposeAssigneeChange, {
        humanId: request.humanId,
        expectedAssigneePrincipalId: operatorPrincipal.principalId,
        proposedAssigneePrincipalId: principalA.principalId,
        correlationId: "propose-convergent-a",
      })
    ).resolves.toEqual({ outcome: "applied", conflict: null })
    await expect(
      operator.query(api.semanticConflicts.listOpen, {
        humanId: request.humanId,
      })
    ).resolves.toEqual([])

    const conflict = await operator.mutation(
      api.semanticConflicts.proposeAssigneeChange,
      {
        humanId: request.humanId,
        expectedAssigneePrincipalId: operatorPrincipal.principalId,
        proposedAssigneePrincipalId: principalB.principalId,
        correlationId: "conflict-convergent-b",
      }
    )
    if (!conflict.conflict) throw new Error("Expected a conflict")
    await operator.mutation(internal.contentRequests.assign, {
      humanId: request.humanId,
      assigneePrincipalId: principalB.principalId,
      correlationId: "assign-newer-convergent-b",
    })
    await expect(
      operator.mutation(api.semanticConflicts.resolve, {
        conflictId: conflict.conflict.conflictId,
        selectedValue: principalB.principalId,
        correlationId: "resolve-convergent-b",
      })
    ).resolves.toMatchObject({
      status: "resolved",
      resolvedValue: principalB.principalId,
    })
    await expect(
      operator.query(api.semanticConflicts.listOpen, {
        humanId: request.humanId,
      })
    ).resolves.toEqual([])
  })
})
