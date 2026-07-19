// @vitest-environment edge-runtime
import * as Automerge from "@automerge/automerge"
import { convexTest } from "convex-test"
import timelineTest from "convex-timeline/test"
import { beforeEach, describe, expect, it } from "vitest"

import {
  applyFounderText,
  createFounderDocument,
  encodeAutomergeChange,
  founderDocumentHeads,
  hashAutomergeChange,
} from "../src/lib/founder-automerge"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { modules } from "./test.setup"

const operatorIdentity = {
  subject: "user_operator",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "operator-editor",
  jti: "operator-session",
}

const founderIdentity = {
  subject: "user_elie",
  issuer: "https://api.workos.com/",
  org_id: "org_fairlend",
  role: "founder",
  jti: "founder-session",
}

function encodedChanges(changes: Array<Uint8Array>) {
  return changes.map((change) => ({
    data: encodeAutomergeChange(change),
    hash: hashAutomergeChange(change),
  }))
}

async function assignedRequest() {
  const workspace = convexTest(schema, modules)
  timelineTest.register(workspace)
  const operator = workspace.withIdentity(operatorIdentity)
  const founder = workspace.withIdentity(founderIdentity)
  await operator.mutation(api.principals.syncCurrent)
  const founderPrincipal = await founder.mutation(api.principals.syncCurrent)
  const request = await operator.mutation(api.contentRequests.createManual, {
    title: "Offline founder response",
    origin: "manual",
    correlationId: "create-offline",
  })
  await operator.mutation(internal.contentRequests.assign, {
    humanId: request.humanId,
    assigneePrincipalId: founderPrincipal.principalId,
    correlationId: "assign-offline",
  })
  return { workspace, operator, founder, request }
}

describe("founder offline synchronization and version history", () => {
  beforeEach(() => {
    process.env.FAIRLEND_WORKOS_ORGANIZATION_ID = "org_fairlend"
  })

  it("deduplicates authenticated Automerge changes and reports durable heads", async () => {
    const { founder, request } = await assignedRequest()
    const document = createFounderDocument(
      request.humanId,
      "Saved while offline"
    )
    const changes = encodedChanges(Automerge.getAllChanges(document))
    const heads = founderDocumentHeads(document)

    const first = await founder.mutation(
      api.founderInputs.submitAutomergeChanges,
      {
        humanId: request.humanId,
        documentId: "automerge:founder-device-document",
        changes,
        heads,
        text: "Saved while offline",
        correlationId: "sync-one",
      }
    )
    const replay = await founder.mutation(
      api.founderInputs.submitAutomergeChanges,
      {
        humanId: request.humanId,
        documentId: "automerge:founder-device-document",
        changes,
        heads,
        text: "Saved while offline",
        correlationId: "sync-replay",
      }
    )

    expect(first.durableHeads).toEqual(heads)
    expect(replay.revision).toBe(first.revision)
    await expect(
      founder.query(api.founderInputs.assertDurablySynced, {
        humanId: request.humanId,
        heads,
      })
    ).resolves.toEqual({ synced: true, durableHeads: heads })
    const pulled = await founder.query(api.founderInputs.pullAutomergeChanges, {
      humanId: request.humanId,
      documentId: "automerge:founder-device-document",
    })
    expect(pulled.changes).toEqual(changes)
    expect(pulled.materializedText).toBe("Saved while offline")
  })

  it("provides attributable undo and redo through the timeline component", async () => {
    const { founder, request } = await assignedRequest()
    const firstDocument = createFounderDocument(
      request.humanId,
      "First version"
    )
    await founder.mutation(api.founderInputs.submitAutomergeChanges, {
      humanId: request.humanId,
      documentId: "automerge:versioned-document",
      changes: encodedChanges(Automerge.getAllChanges(firstDocument)),
      heads: founderDocumentHeads(firstDocument),
      text: "First version",
      correlationId: "sync-version-one",
    })
    const secondDocument = applyFounderText(firstDocument, "Second version")
    await founder.mutation(api.founderInputs.submitAutomergeChanges, {
      humanId: request.humanId,
      documentId: "automerge:versioned-document",
      changes: encodedChanges(
        Automerge.getChanges(firstDocument, secondDocument)
      ),
      heads: founderDocumentHeads(secondDocument),
      text: "Second version",
      correlationId: "sync-version-two",
    })

    const history = await founder.query(api.founderInputs.getVersionHistory, {
      humanId: request.humanId,
    })
    expect(history).toMatchObject({ canUndo: true, canRedo: false, length: 2 })
    expect(history.entries.map((entry) => entry.state)).toMatchObject([
      {
        actorSubject: "user_elie",
        correlationId: "sync-version-one",
      },
      {
        actorSubject: "user_elie",
        correlationId: "sync-version-two",
      },
    ])

    const undone = await founder.mutation(api.founderInputs.undo, {
      humanId: request.humanId,
      correlationId: "undo-one",
    })
    expect(undone.text).toBe("First version")
    await expect(
      founder.mutation(api.founderInputs.undo, {
        humanId: request.humanId,
        correlationId: "undo-one",
      })
    ).resolves.toEqual(undone)
    expect(
      await founder.query(api.founderInputs.getVersionHistory, {
        humanId: request.humanId,
      })
    ).toMatchObject({ canUndo: false, canRedo: true, position: 0 })
    const redone = await founder.mutation(api.founderInputs.redo, {
      humanId: request.humanId,
      correlationId: "redo-one",
    })
    expect(redone.text).toBe("Second version")
  })

  it("reconstructs the canonical document and merges concurrent offline branches", async () => {
    const { founder, request } = await assignedRequest()
    const base = createFounderDocument(request.humanId, "Opening ")
    const deviceA = applyFounderText(
      Automerge.clone(base),
      "Opening from device A"
    )
    const deviceB = applyFounderText(
      Automerge.clone(base),
      "Opening from device B"
    )
    const documentId = "automerge:concurrent-canonical-document"

    await founder.mutation(api.founderInputs.submitAutomergeChanges, {
      humanId: request.humanId,
      documentId,
      changes: encodedChanges(Automerge.getAllChanges(deviceA)),
      heads: ["client-head-is-not-trusted"],
      text: "client text is not trusted",
      correlationId: "sync-device-a",
    })
    const saved = await founder.mutation(
      api.founderInputs.submitAutomergeChanges,
      {
        humanId: request.humanId,
        documentId,
        changes: encodedChanges(Automerge.getChanges(base, deviceB)),
        heads: ["another-untrusted-head"],
        text: "another untrusted materialization",
        correlationId: "sync-device-b",
      }
    )

    const canonical = Automerge.merge(deviceA, deviceB)
    expect(saved.text).toBe(canonical.text)
    expect(saved.durableHeads).toEqual(founderDocumentHeads(canonical))
  })

  it("rejects corrupt or mismatched change streams without losing durable work", async () => {
    const { founder, request } = await assignedRequest()
    await expect(
      founder.mutation(api.founderInputs.submitAutomergeChanges, {
        humanId: request.humanId,
        documentId: "automerge:corrupt",
        changes: [{ data: btoa("bad"), hash: "not-the-hash" }],
        heads: ["head-bad"],
        text: "must not save",
        correlationId: "sync-corrupt",
      })
    ).rejects.toMatchObject({ data: { code: "VALIDATION_FAILED" } })
    await expect(
      founder.query(api.founderInputs.getMine, {
        humanId: request.humanId,
      })
    ).resolves.toBeNull()
  })

  it("rejects validly hashed bytes that are not a founder Automerge document", async () => {
    const { founder, request } = await assignedRequest()
    const bytes = Uint8Array.from([1, 2, 3, 4])
    await expect(
      founder.mutation(api.founderInputs.submitAutomergeChanges, {
        humanId: request.humanId,
        documentId: "automerge:invalid-schema",
        changes: encodedChanges([bytes]),
        heads: [],
        text: "must not save",
        correlationId: "sync-invalid-schema",
      })
    ).rejects.toMatchObject({ data: { code: "VALIDATION_FAILED" } })
  })

  it("bounds undo snapshots and projects attribution instead of full text", async () => {
    const { founder, request } = await assignedRequest()
    const documentId = "automerge:bounded-version-history"
    let document = createFounderDocument(request.humanId, "Version 0")
    await founder.mutation(api.founderInputs.submitAutomergeChanges, {
      humanId: request.humanId,
      documentId,
      changes: encodedChanges(Automerge.getAllChanges(document)),
      heads: founderDocumentHeads(document),
      text: document.text,
      correlationId: "bounded-version-0",
    })
    for (let version = 1; version < 55; version += 1) {
      const previous = document
      document = applyFounderText(previous, `Version ${version}`)
      await founder.mutation(api.founderInputs.submitAutomergeChanges, {
        humanId: request.humanId,
        documentId,
        changes: encodedChanges(Automerge.getChanges(previous, document)),
        heads: founderDocumentHeads(document),
        text: document.text,
        correlationId: `bounded-version-${version}`,
      })
    }

    const history = await founder.query(api.founderInputs.getVersionHistory, {
      humanId: request.humanId,
    })
    expect(history).toMatchObject({ length: 50, canUndo: true })
    expect(history.entries).toHaveLength(50)
    expect(history.entries.at(-1)?.state).toMatchObject({
      actorSubject: "user_elie",
      correlationId: "bounded-version-54",
    })
    expect(history.entries.some((entry) => "text" in entry.state)).toBe(false)

    let cursor: string | null = null
    let isDone = false
    const archivedVersions: Array<{
      versionId: Id<"founderInputVersions">
      correlationId: string
    }> = []
    while (!isDone) {
      const archivePage: {
        page: Array<{
          versionId: Id<"founderInputVersions">
          correlationId: string
        }>
        continueCursor: string
        isDone: boolean
      } = await founder.query(api.founderInputs.listArchivedVersions, {
        humanId: request.humanId,
        paginationOpts: { numItems: 10, cursor },
      })
      archivedVersions.push(...archivePage.page)
      cursor = archivePage.continueCursor
      isDone = archivePage.isDone
    }
    expect(archivedVersions).toHaveLength(55)
    const oldest = archivedVersions.find(
      (version) => version.correlationId === "bounded-version-0"
    )
    if (!oldest) throw new Error("Expected the oldest archived version")
    const restored = await founder.mutation(
      api.founderInputs.restoreArchivedVersion,
      {
        humanId: request.humanId,
        versionId: oldest.versionId,
        correlationId: "restore-oldest-version",
      }
    )
    expect(restored.text).toBe("Version 0")
    await expect(
      founder.mutation(api.founderInputs.restoreArchivedVersion, {
        humanId: request.humanId,
        versionId: oldest.versionId,
        correlationId: "restore-oldest-version",
      })
    ).resolves.toEqual(restored)
  })
})
