import * as Automerge from "@automerge/automerge"
import { describe, expect, it } from "vitest"

import {
  applyFounderText,
  appendFounderVoiceTranscript,
  createFounderDocument,
  decodeAutomergeChange,
  encodeAutomergeChange,
  mergeFounderChanges,
  materializedFounderText,
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

  it("materializes one transcript when two devices append the same capture", () => {
    const base = createFounderDocument("CR-VOICE", "Typed answer")
    const left = appendFounderVoiceTranscript(
      Automerge.clone(base, { actor: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }),
      "capture-1",
      "Spoken insight",
      1
    )
    const right = appendFounderVoiceTranscript(
      Automerge.clone(base, { actor: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }),
      "capture-1",
      "Spoken insight",
      1
    )

    expect(materializedFounderText(Automerge.merge(left, right))).toBe(
      "Typed answer\n\nSpoken insight"
    )
  })

  it("retains a capture tombstone when editing races the same transcript", () => {
    const base = createFounderDocument("CR-VOICE", "Typed")
    const appended = appendFounderVoiceTranscript(
      base,
      "capture-1",
      "Spoken",
      1
    )
    const edited = applyFounderText(appended, "Typed edited\n\nSpoken")
    const offlineAppend = appendFounderVoiceTranscript(
      Automerge.clone(base, { actor: "cccccccccccccccccccccccccccccccc" }),
      "capture-1",
      "Spoken",
      1
    )
    expect(
      materializedFounderText(Automerge.merge(edited, offlineAppend))
    ).toBe("Typed edited\n\nSpoken")
  })

  it("orders voice segments by recording time, not capture id", () => {
    let document = createFounderDocument("CR-VOICE", "")
    document = appendFounderVoiceTranscript(document, "z-later", "Second", 2)
    document = appendFounderVoiceTranscript(document, "a-earlier", "First", 1)
    expect(materializedFounderText(document)).toBe("First\n\nSecond")
  })
})
