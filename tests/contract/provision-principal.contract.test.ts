import { describe, expect, it } from "vitest"

import { isExpectedProvisioningAccessDenial } from "@/infrastructure/convex-error-code"

describe("provisioning access denial handling", () => {
  it("treats missing WorkOS workspace roles as a soft denial", () => {
    expect(
      isExpectedProvisioningAccessDenial({
        data: { code: "ROLE_ACCESS_DENIED" },
      })
    ).toBe(true)
    expect(
      isExpectedProvisioningAccessDenial(
        new Error('Uncaught ConvexError: {"code":"ROLE_ACCESS_DENIED"}')
      )
    ).toBe(true)
  })

  it("still fails closed for unrelated provisioning errors", () => {
    expect(
      isExpectedProvisioningAccessDenial({
        data: { code: "PRINCIPAL_PROVISIONING_DENIED" },
      })
    ).toBe(false)
    expect(isExpectedProvisioningAccessDenial(new Error("network"))).toBe(false)
  })
})
