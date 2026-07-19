import * as Automerge from "@automerge/automerge"
import { describe, expect, it } from "vitest"

import {
  applyFounderText,
  createFounderDocument,
  decodeAutomergeChange,
  encodeAutomergeChange,
  mergeFounderChanges,
  partitionAutomergeChanges,
} from "@/lib/founder-automerge"

describe("founder Automerge document contract", () => {
  it("partitions arbitrarily long offline histories under the mutation limit", () => {
    const changes = Array.from({ length: 1_001 }, (_, index) => index)
    const batches = partitionAutomergeChanges(changes)
    expect(batches.map((batch) => batch.length)).toEqual([
      250, 250, 250, 250, 1,
    ])
    expect(batches.flat()).toEqual(changes)
  })

  it("merges ordinary concurrent text edits without dropping either edit", () => {
    const base = createFounderDocument("CR-OFFLINE", "Mortgage answer")
    const left = applyFounderText(
      Automerge.clone(base, { actor: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      "Detailed Mortgage answer"
    )
    const right = applyFounderText(
      Automerge.clone(base, { actor: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
      "Mortgage answer with citations"
    )

    const merged = Automerge.merge(left, right)

    expect(merged.text).toContain("Detailed ")
    expect(merged.text).toContain(" with citations")
  })

  it("round-trips binary changes for the authenticated Convex transport", () => {
    const base = createFounderDocument("CR-SYNC", "")
    const edited = applyFounderText(base, "An offline answer")
    const encoded = Automerge.getAllChanges(edited).map(encodeAutomergeChange)

    const merged = mergeFounderChanges(
      createFounderDocument("CR-SYNC", ""),
      encoded.map(decodeAutomergeChange)
    )

    expect(merged.text).toBe("An offline answer")
    expect(Automerge.getHeads(merged)).toEqual(Automerge.getHeads(edited))
  })
})
