// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createGuestAccessGrant: vi.fn(),
  createPerson: vi.fn(),
  invalidate: vi.fn(),
  renewGuestAccessGrant: vi.fn(),
  revokeGuestAccessGrant: vi.fn(),
  searchPeople: vi.fn(),
}))

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate }),
}))

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (serverFn: unknown) => serverFn,
}))

vi.mock("@/application/content-request-server-functions", () => ({
  createGuestAccessGrant: mocks.createGuestAccessGrant,
  createPerson: mocks.createPerson,
  renewGuestAccessGrant: mocks.renewGuestAccessGrant,
  revokeGuestAccessGrant: mocks.revokeGuestAccessGrant,
  searchPeople: mocks.searchPeople,
}))

import { GuestAccessGrantPanel } from "@/components/guest-access-grant-panel"

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("GuestAccessGrantPanel", () => {
  it("returns and selects a newly created Person without waiting for route invalidation", async () => {
    mocks.createPerson.mockResolvedValue({
      personId: "person-created",
      displayName: "Jamie Broker",
      email: "jamie@example.ca",
      principalId: null,
      isFounder: false,
    })
    mocks.invalidate.mockReturnValue(new Promise(() => undefined))

    render(
      <GuestAccessGrantPanel
        humanId="CR-0241"
        people={[
          {
            personId: "person-founder",
            displayName: "Elie Tavor",
            email: "elie@fairlend.ca",
            principalId: "principal-founder",
            isFounder: true,
          },
        ]}
        defaultPersonId="person-founder"
        grants={[]}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Add a person" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), {
      target: { value: "Jamie Broker" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "Email address" }), {
      target: { value: "jamie@example.ca" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create person" }))

    await waitFor(() =>
      expect(mocks.createPerson).toHaveBeenCalledWith({
        data: {
          humanId: "CR-0241",
          displayName: "Jamie Broker",
          email: "jamie@example.ca",
          correlationId: expect.any(String),
        },
      })
    )
    expect(
      (
        screen.getByRole("combobox", {
          name: "Response recipient",
        }) as HTMLInputElement
      ).value
    ).toContain("Jamie Broker")
    expect(mocks.invalidate).toHaveBeenCalledTimes(1)
  })
})
