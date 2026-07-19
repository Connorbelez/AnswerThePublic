import { afterEach, describe, expect, it, vi } from "vitest"

const getRequestUrl = vi.hoisted(() => vi.fn())

vi.mock("@tanstack/react-start/server", () => ({
  getRequestUrl,
}))

describe("WorkOS logout returnTo", () => {
  afterEach(() => {
    getRequestUrl.mockReset()
    delete process.env.FAIRLEND_APP_URL
    delete process.env.WORKOS_REDIRECT_URI
    vi.resetModules()
  })

  it("uses the current request origin instead of a relative path", async () => {
    getRequestUrl.mockReturnValue(new URL("http://localhost:3000/unauthorized"))
    const { resolveWorkosLogoutReturnTo } =
      await import("@/infrastructure/workos-logout-return-to.server")

    expect(resolveWorkosLogoutReturnTo("/")).toBe("http://localhost:3000/")
  })

  it("falls back to WORKOS_REDIRECT_URI origin when request context is unavailable", async () => {
    getRequestUrl.mockImplementation(() => {
      throw new Error("no request")
    })
    process.env.WORKOS_REDIRECT_URI =
      "http://localhost:3000/api/auth/callback"
    const { resolveWorkosLogoutReturnTo } =
      await import("@/infrastructure/workos-logout-return-to.server")

    expect(resolveWorkosLogoutReturnTo("/")).toBe("http://localhost:3000/")
  })
})
