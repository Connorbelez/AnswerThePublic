import { describe, expect, it } from "vitest"

import {
  toPublicShareResponse,
  type PublicShareView,
} from "@/application/content-requests"

describe("public share response contract", () => {
  it("projects an allowlisted response shape and strips private adapter fields", () => {
    const unsafe = {
      shareId: "share-1",
      request: {
        humanId: "CR-1",
        title: "Public title",
        priority: "critical",
        createdAt: 1,
        founderInput: "PRIVATE_FOUNDER_SECRET",
      },
      briefSections: [],
      deliverables: [{ kind: "primary", name: "Response", body: "Public" }],
      expiresAt: null,
      createdAt: 2,
      agentJobs: [{ body: "PRIVATE_JOB_SECRET" }],
      auditEvents: [{ credentialId: "PRIVATE_CREDENTIAL" }],
    } as PublicShareView
    const response = toPublicShareResponse(unsafe)
    expect(response).toEqual({
      shareId: "share-1",
      request: {
        humanId: "CR-1",
        title: "Public title",
        priority: "critical",
        createdAt: 1,
      },
      briefSections: [],
      deliverables: [{ kind: "primary", name: "Response", body: "Public" }],
      expiresAt: null,
      createdAt: 2,
    })
    expect(JSON.stringify(response)).not.toMatch(
      /PRIVATE_|agentJobs|auditEvents/
    )
  })
})
