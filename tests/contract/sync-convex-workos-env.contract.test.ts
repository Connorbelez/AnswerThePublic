import { beforeEach, describe, expect, it, vi } from "vitest"

const spawnSync = vi.hoisted(() =>
  vi.fn(
    (
      ...callArguments: [
        command: string,
        args: string[],
        options: { input: string; stdio: string[] },
      ]
    ) => {
      void callArguments
      return { error: undefined, status: 0 }
    }
  )
)

vi.mock("node:child_process", () => ({ spawnSync }))

import {
  requiredLocalWorkosEnvironment,
  requirePersonalDevDeployment,
  syncConvexWorkosEnvironment,
} from "../../scripts/sync-convex-workos-env"

describe("Convex/WorkOS dev environment synchronization", () => {
  beforeEach(() => {
    spawnSync.mockClear()
  })

  it("refuses production and accepts only a personal dev deployment", () => {
    expect(() => requirePersonalDevDeployment("prod:deployment")).toThrow(
      /Refusing to synchronize WorkOS/
    )
    expect(
      requirePersonalDevDeployment("dev:sensible-cheetah-210 # project")
    ).toBe("dev:sensible-cheetah-210")
  })

  it("maps one managed WorkOS environment to the Convex auth variables", () => {
    expect(
      requiredLocalWorkosEnvironment({
        WORKOS_CLIENT_ID: "client_default",
        WORKOS_API_KEY: "sk_test_managed",
        WORKOS_ENVIRONMENT_ID: "environment_managed",
        WORKOS_ORGANIZATION_ID: "org_fairlend",
      })
    ).toEqual({
      WORKOS_CLIENT_ID: "client_default",
      WORKOS_API_KEY: "sk_test_managed",
      WORKOS_ENVIRONMENT_ID: "environment_managed",
      FAIRLEND_WORKOS_ORGANIZATION_ID: "org_fairlend",
    })
  })

  it("fails before writing when the local environment is incomplete", () => {
    expect(() =>
      requiredLocalWorkosEnvironment({ WORKOS_CLIENT_ID: "client_default" })
    ).toThrow(/WORKOS_API_KEY must be configured/)
  })

  it("atomically pipes every value to Convex without exposing secrets in argv", () => {
    syncConvexWorkosEnvironment({
      CONVEX_DEPLOYMENT: "dev:sensible-cheetah-210",
      WORKOS_CLIENT_ID: "client_default",
      WORKOS_API_KEY: "sk_test_managed",
      WORKOS_ENVIRONMENT_ID: "environment_managed",
      WORKOS_ORGANIZATION_ID: "org_fairlend",
    })

    expect(spawnSync).toHaveBeenCalledTimes(1)
    const [command, args, options] = spawnSync.mock.calls[0]
    expect(command).toBe("bunx")
    expect(args).toEqual(["convex", "env", "set", "--force"])
    expect(args).not.toContain("sk_test_managed")
    expect(options).toMatchObject({
      stdio: ["pipe", "inherit", "inherit"],
    })
    expect(options.input).toContain("WORKOS_API_KEY='sk_test_managed'")
    expect(options.input).toContain(
      "FAIRLEND_WORKOS_ORGANIZATION_ID='org_fairlend'"
    )
  })
})
