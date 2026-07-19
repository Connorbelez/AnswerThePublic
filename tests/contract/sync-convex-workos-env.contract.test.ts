import { describe, expect, it } from "vitest"

import {
  requiredLocalWorkosEnvironment,
  requirePersonalDevDeployment,
} from "../../scripts/sync-convex-workos-env"

describe("Convex/WorkOS dev environment synchronization", () => {
  it("refuses production and accepts only a personal dev deployment", () => {
    expect(() => requirePersonalDevDeployment("prod:deployment")).toThrow(
      /Refusing to synchronize WorkOS/
    )
    expect(requirePersonalDevDeployment("dev:sensible-cheetah-210 # project"))
      .toBe("dev:sensible-cheetah-210")
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
})
