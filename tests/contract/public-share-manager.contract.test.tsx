// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { PublicShareManager } from "@/components/public-share-manager"

const mocks = vi.hoisted(() => ({
  createToken: Symbol("create-public-share"),
  revokeToken: Symbol("revoke-public-share"),
  create: vi.fn(),
  revoke: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock("@/application/content-request-server-functions", () => ({
  createPublicShare: mocks.createToken,
  revokePublicShare: mocks.revokeToken,
}))

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (token: symbol) =>
    token === mocks.createToken ? mocks.create : mocks.revoke,
}))

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate }),
}))

describe("Public share manager contract", () => {
  it("keeps revocation touch-safe on mobile", () => {
    render(
      <PublicShareManager
        humanId="CR-ONE"
        contextItems={[]}
        deliverables={[]}
        shares={[
          {
            shareId: "share-1",
            briefSectionCount: 1,
            deliverableCount: 1,
            expiresAt: null,
            revokedAt: null,
            createdAt: 1,
          },
        ]}
      />
    )

    expect(screen.getByRole("button", { name: "Revoke" }).className).toContain(
      "h-11"
    )
  })
})
