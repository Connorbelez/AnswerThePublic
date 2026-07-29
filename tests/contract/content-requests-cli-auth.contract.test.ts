import { describe, expect, it, vi } from "vitest"

import { runContentRequestsCli } from "@/cli/content-requests"
import { createMacOsKeychainAuthStore } from "@/cli/content-requests-auth"

function jwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url")
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.signature`
}

describe("Content Requests CLI WorkOS authentication", () => {
  it("completes Device Auth, stores the refresh token, and never prints credentials", async () => {
    const output: Array<string> = []
    const errors: Array<string> = []
    const authStore = {
      read: vi.fn(),
      write: vi.fn(),
      delete: vi.fn(),
    }
    const openUrl = vi.fn()
    const sleep = vi.fn().mockResolvedValue(undefined)
    const accessToken = jwt({
      sub: "user_123",
      org_id: "org_123",
      role: "operator-editor",
      exp: 4_000_000_000,
    })
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          device_code: "device-secret",
          user_code: "FROG-LIME",
          verification_uri: "https://authenticate.workos.com/device",
          verification_uri_complete:
            "https://authenticate.workos.com/device?user_code=FROG-LIME",
          expires_in: 600,
          interval: 1,
        })
      )
      .mockResolvedValueOnce(
        Response.json(
          { error: "authorization_pending" },
          { status: 400 }
        )
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: accessToken,
          refresh_token: "refresh-secret",
          organization_id: "org_123",
          user: { id: "user_123", email: "editor@fairlend.ca" },
        })
      )

    const exitCode = await runContentRequestsCli(["auth", "login"], {
      fetchImpl,
      env: {
        WORKOS_CLIENT_ID: "client_123",
        WORKOS_ORGANIZATION_ID: "org_123",
      },
      io: {
        writeOut: (value) => output.push(value),
        writeError: (value) => errors.push(value),
      },
      authStore,
      openUrl,
      sleep,
    })

    expect(exitCode).toBe(0)
    expect(openUrl).toHaveBeenCalledWith(
      "https://authenticate.workos.com/device?user_code=FROG-LIME"
    )
    expect(sleep).toHaveBeenCalledWith(1_000)
    expect(authStore.write).toHaveBeenCalledWith(
      expect.stringContaining("client_123"),
      "refresh-secret"
    )
    expect(JSON.parse(output.at(-1) ?? "{}")).toMatchObject({
      authenticated: true,
      method: "workos_cli_auth",
      organizationId: "org_123",
      role: "operator-editor",
    })

    const transcript = [...output, ...errors].join("\n")
    expect(transcript).toContain("FROG-LIME")
    expect(transcript).not.toContain("device-secret")
    expect(transcript).not.toContain("refresh-secret")
    expect(transcript).not.toContain(accessToken)
  })

  it("refreshes and rotates the Keychain credential before an API command", async () => {
    const output: Array<string> = []
    const accessToken = jwt({
      sub: "user_123",
      org_id: "org_123",
      role: "operator-editor",
      exp: 4_000_000_000,
    })
    const authStore = {
      read: vi.fn().mockResolvedValue("old-refresh-secret"),
      write: vi.fn(),
      delete: vi.fn(),
    }
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          access_token: accessToken,
          refresh_token: "rotated-refresh-secret",
        })
      )
      .mockResolvedValueOnce(Response.json({ data: [] }))

    const exitCode = await runContentRequestsCli(["list"], {
      fetchImpl,
      env: {
        CONTENT_REQUESTS_API_URL: "https://fairlend.test",
        WORKOS_CLIENT_ID: "client_123",
        WORKOS_ORGANIZATION_ID: "org_123",
      },
      io: { writeOut: (value) => output.push(value), writeError: vi.fn() },
      authStore,
    })

    expect(exitCode).toBe(0)
    expect(authStore.read).toHaveBeenCalledWith(
      expect.stringContaining("client_123")
    )
    expect(authStore.write).toHaveBeenCalledWith(
      expect.stringContaining("client_123"),
      "rotated-refresh-secret"
    )
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://api.workos.com/user_management/authenticate",
      expect.objectContaining({
        method: "POST",
        body: expect.any(URLSearchParams),
      })
    )
    const refreshBody = fetchImpl.mock.calls[0]?.[1]?.body as URLSearchParams
    expect(Object.fromEntries(refreshBody)).toEqual({
      grant_type: "refresh_token",
      client_id: "client_123",
      refresh_token: "old-refresh-secret",
      organization_id: "org_123",
    })
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://fairlend.test/api/v1/cli/content-requests",
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: `Bearer ${accessToken}`,
        }),
      })
    )

    const transcript = output.join("\n")
    expect(transcript).not.toContain("old-refresh-secret")
    expect(transcript).not.toContain("rotated-refresh-secret")
    expect(transcript).not.toContain(accessToken)
  })

  it("reports a validated session and removes it on logout", async () => {
    const output: Array<string> = []
    const accessToken = jwt({
      sub: "user_123",
      org_id: "org_123",
      role: "operator-editor",
      exp: 4_000_000_000,
    })
    const authStore = {
      read: vi.fn().mockResolvedValue("old-refresh-secret"),
      write: vi.fn(),
      delete: vi.fn(),
    }
    const fetchImpl = vi.fn().mockResolvedValue(
      Response.json({
        access_token: accessToken,
        refresh_token: "rotated-refresh-secret",
      })
    )
    const sharedOptions = {
      fetchImpl,
      env: {
        WORKOS_CLIENT_ID: "client_123",
        WORKOS_ORGANIZATION_ID: "org_123",
      },
      io: { writeOut: (value: string) => output.push(value), writeError: vi.fn() },
      authStore,
    }

    await expect(
      runContentRequestsCli(["auth", "status"], sharedOptions)
    ).resolves.toBe(0)
    expect(JSON.parse(output.at(-1) ?? "{}")).toMatchObject({
      authenticated: true,
      method: "workos_cli_auth",
      organizationId: "org_123",
      role: "operator-editor",
    })

    await expect(
      runContentRequestsCli(["auth", "logout"], sharedOptions)
    ).resolves.toBe(0)
    expect(authStore.delete).toHaveBeenCalledWith(
      expect.stringContaining("client_123")
    )
    expect(JSON.parse(output.at(-1) ?? "{}")).toEqual({
      authenticated: false,
      method: "workos_cli_auth",
    })
  })

  it.each([
    {
      name: "a different organization",
      claims: { org_id: "org_wrong", role: "operator-editor" },
      message: "different organization",
    },
    {
      name: "a non-editor role",
      claims: { org_id: "org_123", role: "member" },
      message: "does not have an editor role",
    },
  ])("rejects $name before storing credentials", async ({ claims, message }) => {
    const authStore = {
      read: vi.fn(),
      write: vi.fn(),
      delete: vi.fn(),
    }
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          device_code: "device-secret",
          user_code: "FROG-LIME",
          verification_uri: "https://authenticate.workos.com/device",
          expires_in: 600,
          interval: 1,
        })
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: jwt({
            sub: "user_123",
            exp: 4_000_000_000,
            ...claims,
          }),
          refresh_token: "refresh-secret",
        })
      )

    await expect(
      runContentRequestsCli(["auth", "login"], {
        fetchImpl,
        env: {
          WORKOS_CLIENT_ID: "client_123",
          WORKOS_ORGANIZATION_ID: "org_123",
        },
        io: { writeOut: vi.fn(), writeError: vi.fn() },
        authStore,
        openUrl: vi.fn(),
        sleep: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow(message)
    expect(authStore.write).not.toHaveBeenCalled()
  })

  it("backs off when WorkOS asks the device poller to slow down", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          device_code: "device-secret",
          user_code: "FROG-LIME",
          verification_uri: "https://authenticate.workos.com/device",
          expires_in: 600,
          interval: 1,
        })
      )
      .mockResolvedValueOnce(
        Response.json({ error: "slow_down" }, { status: 400 })
      )
      .mockResolvedValueOnce(
        Response.json({
          access_token: jwt({
            sub: "user_123",
            org_id: "org_123",
            role: "operator-editor",
            exp: 4_000_000_000,
          }),
          refresh_token: "refresh-secret",
        })
      )

    await runContentRequestsCli(["auth", "login"], {
      fetchImpl,
      env: {
        WORKOS_CLIENT_ID: "client_123",
        WORKOS_ORGANIZATION_ID: "org_123",
      },
      io: { writeOut: vi.fn(), writeError: vi.fn() },
      authStore: { read: vi.fn(), write: vi.fn(), delete: vi.fn() },
      openUrl: vi.fn(),
      sleep,
    })

    expect(sleep).toHaveBeenNthCalledWith(1, 1_000)
    expect(sleep).toHaveBeenNthCalledWith(2, 6_000)
  })

  it("writes Keychain secrets through stdin instead of process arguments", async () => {
    const securityRunner = vi.fn().mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
    })
    const store = createMacOsKeychainAuthStore(securityRunner)

    await store.write("client_123:org_123", "refresh-secret")

    expect(securityRunner).toHaveBeenCalledWith(
      ["-i"],
      expect.stringContaining("refresh-secret")
    )
    const argv = securityRunner.mock.calls[0]?.[0] as Array<string>
    expect(argv.join(" ")).not.toContain("refresh-secret")
  })
})
