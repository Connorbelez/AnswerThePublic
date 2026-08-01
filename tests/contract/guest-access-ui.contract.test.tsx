// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  GuestAccessGrantManager,
  type GuestAccessPerson,
} from "@/components/guest-access-grant-manager"
import { GuestAccessResponse } from "@/components/guest-access-response"
import { FocusedProoflineBrief } from "@/components/focused-proofline-brief"

const people: Array<GuestAccessPerson> = [
  {
    personId: "person-founder",
    displayName: "Elie Tavor",
    email: "elie@fairlend.ca",
    isFounder: true,
  },
  {
    personId: "person-expert",
    displayName: "Sally Expert",
    email: "sally@example.com",
    isFounder: false,
  },
]

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("Guest Access Grant manager", () => {
  it("shows lifecycle history and requires explicit revocation confirmation while renewal returns a copyable rotated URL", async () => {
    const onRevoke = vi.fn().mockResolvedValue(undefined)
    const onRenew = vi.fn().mockResolvedValue({
      token: "renewed-secret-token",
      expiresAt: Date.UTC(2026, 7, 1, 12),
    })
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
    render(
      <GuestAccessGrantManager
        people={people}
        defaultPersonId="person-founder"
        grants={[
          {
            grantId: "grant-1",
            person: people[1]!,
            state: "in_progress",
            expiresAt: Date.UTC(2026, 6, 30, 12),
            createdAt: Date.UTC(2026, 6, 28, 12),
            latestActivityAt: Date.UTC(2026, 6, 29, 9),
            progress: { completed: 1, total: 2 },
            submitted: false,
            events: [
              {
                kind: "opened",
                occurredAt: Date.UTC(2026, 6, 28, 13),
                actor: "guest",
                tokenVersion: null,
              },
            ],
          },
        ]}
        onCreatePerson={vi.fn()}
        onGenerate={vi.fn()}
        onRevoke={onRevoke}
        onRenew={onRenew}
        onSearchPeople={vi.fn().mockResolvedValue([])}
      />
    )
    expect(screen.getByText("1 of 2 answered", { exact: false })).toBeTruthy()
    expect(document.getElementById("guest-access-grant-1")).toBeTruthy()
    expect(screen.getByText(/opened/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }))
    expect(onRevoke).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Confirm revoke" }))
    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith("grant-1"))
    fireEvent.click(screen.getByRole("button", { name: "Renew link" }))
    await waitFor(() => expect(onRenew).toHaveBeenCalledWith("grant-1"))
    expect(
      (
        (await screen.findByLabelText(
          "Generated access link"
        )) as HTMLInputElement
      ).value
    ).toContain("/respond/renewed-secret-token")
  })

  it("defaults to the founder and preserves a manual copy fallback", async () => {
    const generate = vi.fn().mockResolvedValue({
      token: "super-secret-token",
      expiresAt: Date.UTC(2026, 6, 30, 12),
    })
    const writeText = vi.fn().mockRejectedValue(new Error("denied"))
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    })

    render(
      <GuestAccessGrantManager
        people={people}
        defaultPersonId="person-founder"
        grants={[]}
        onCreatePerson={vi.fn()}
        onGenerate={generate}
        onSearchPeople={vi.fn().mockResolvedValue([])}
      />
    )

    expect(
      (
        screen.getByRole("combobox", {
          name: "Response recipient",
        }) as HTMLInputElement
      ).value
    ).toContain("Elie Tavor")

    fireEvent.click(
      screen.getByRole("button", { name: "Generate & copy link" })
    )

    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith({
        personId: "person-founder",
      })
    )
    const accessLink = await screen.findByLabelText("Generated access link")
    expect((accessLink as HTMLInputElement).value).toBe(
      `${window.location.origin}/respond/super-secret-token`
    )
    expect(
      screen.getByRole("button", { name: "Copy access link" })
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Automatic copy was blocked. Use the Copy button or select the link."
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        "FairLend will not send this link. Share it through the channel you choose."
      )
    ).toBeTruthy()
  })

  it("creates a missing Person inline and selects that immutable recipient", async () => {
    const createdPerson: GuestAccessPerson = {
      personId: "person-created",
      displayName: "Jamie Broker",
      email: "jamie@example.com",
      isFounder: false,
    }
    const createPerson = vi.fn().mockResolvedValue(createdPerson)
    const generate = vi.fn().mockResolvedValue({
      token: "created-person-token",
      expiresAt: Date.UTC(2026, 6, 30, 12),
    })
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    })

    render(
      <GuestAccessGrantManager
        people={people}
        defaultPersonId="person-founder"
        grants={[]}
        onCreatePerson={createPerson}
        onGenerate={generate}
        onSearchPeople={vi.fn().mockResolvedValue([])}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Add a person" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), {
      target: { value: "Jamie Broker" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "Email address" }), {
      target: { value: "jamie@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create person" }))

    await waitFor(() =>
      expect(createPerson).toHaveBeenCalledWith({
        displayName: "Jamie Broker",
        email: "jamie@example.com",
      })
    )
    expect(
      (
        screen.getByRole("combobox", {
          name: "Response recipient",
        }) as HTMLInputElement
      ).value
    ).toContain("Jamie Broker")

    fireEvent.click(
      screen.getByRole("button", { name: "Generate & copy link" })
    )
    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith({ personId: "person-created" })
    )
  })

  it("queries the organization directory as the operator types and exposes remote matches", async () => {
    const remotePerson: GuestAccessPerson = {
      personId: "person-remote",
      displayName: "Morgan Remote",
      email: "morgan.remote@example.ca",
      isFounder: false,
    }
    const searchPeople = vi.fn().mockResolvedValue([remotePerson])

    render(
      <GuestAccessGrantManager
        people={people}
        defaultPersonId="person-founder"
        grants={[]}
        onCreatePerson={vi.fn()}
        onGenerate={vi.fn()}
        onSearchPeople={searchPeople}
      />
    )

    const selector = screen.getByRole("combobox", {
      name: "Response recipient",
    })
    fireEvent.change(selector, { target: { value: "morgan.remote" } })

    await waitFor(() =>
      expect(searchPeople).toHaveBeenCalledWith("morgan.remote")
    )
    const trigger = screen
      .getAllByRole("button")
      .find((button) => button.getAttribute("aria-haspopup") === "listbox")
    if (!trigger) throw new Error("Expected Person selector trigger")
    fireEvent.click(trigger)
    expect(await screen.findByText("Morgan Remote")).toBeTruthy()
    expect(screen.getByText("morgan.remote@example.ca")).toBeTruthy()
  })
})

describe("Focused Proofline guest brief", () => {
  it("presents the approved brief and question motivations without identity UI", () => {
    render(
      <FocusedProoflineBrief
        eyebrow="Expert interview brief"
        statusLabel="Ready for response"
        request={{
          humanId: "CR-0241",
          title: "How bridge financing works when the timeline breaks",
        }}
        brief={{
          topic: "Ontario bridge financing",
          summary: "A practical guide for broken closing timelines.",
          audience: "Ontario homeowners and mortgage professionals.",
          framing: ["Insider knowledge", "Educational"],
          fairlendPosture: "Show experienced judgment without a sales pitch.",
          respondentContribution:
            "Real process, local nuance, and an anonymized example.",
        }}
        questions={[
          {
            id: "question-1",
            question:
              "What happens first when the closing dates stop lining up?",
            motivation: "Generic guides stop before the operational sequence.",
          },
          {
            id: "question-2",
            question: "Which Ontario rule changes the recommendation?",
            motivation: "The brief needs practitioner interpretation.",
          },
        ]}
      />
    )

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "How bridge financing works when the timeline breaks",
      })
    ).toBeTruthy()
    expect(screen.getByText("Ontario bridge financing")).toBeTruthy()
    expect(
      screen.getByText(
        "What happens first when the closing dates stop lining up?"
      )
    ).toBeTruthy()
    expect(
      screen.getByText("Generic guides stop before the operational sequence.")
    ).toBeTruthy()
    expect(
      screen.queryByRole("combobox", { name: /person|identity|recipient/i })
    ).toBeNull()
    expect(screen.queryByText(/operator instructions/i)).toBeNull()
  })
})

describe("token-scoped guest response route", () => {
  it("renders only the approved no-sign-in interview projection", () => {
    render(
      <GuestAccessResponse
        view={{
          status: "available",
          grantId: "grant-1",
          expiresAt: Date.UTC(2026, 6, 30, 12),
          request: {
            humanId: "CR-0241",
            title: "How bridge financing works when the timeline breaks",
            requestType: "expert_interview",
            brief: { question: null, body: null },
          },
          interview: {
            brief: {
              topic: "Ontario bridge financing",
              summary: "A practical guide for broken closing timelines.",
              audience: "Ontario homeowners.",
              framing: "insider_knowledge",
              fairlendPosture: "Explain the practical tradeoffs.",
              founderContribution: "Share the real operational sequence.",
            },
            questions: [
              {
                id: "question-1",
                question: "What happens first?",
                motivation: "Generic sources omit the sequence.",
              },
            ],
          },
          questions: [
            {
              id: "question-1",
              question: "What happens first?",
              motivation: "Generic sources omit the sequence.",
            },
          ],
        }}
      />
    )

    expect(screen.getByText("No sign-in required")).toBeTruthy()
    expect(screen.getByText("Private response link")).toBeTruthy()
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "How bridge financing works when the timeline breaks",
      })
    ).toBeTruthy()
    expect(screen.getByText("What happens first?")).toBeTruthy()
    expect(screen.queryByText("Sally Expert")).toBeNull()
    expect(screen.queryByText(/email/i)).toBeNull()
    expect(screen.queryByRole("combobox")).toBeNull()
  })

  it("reveals no request metadata for an expired grant", () => {
    render(<GuestAccessResponse view={{ status: "expired" }} />)

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "This response link has expired",
      })
    ).toBeTruthy()
    expect(
      screen.getByText(
        "Your saved work remains in the existing response workspace. Ask the FairLend administrator who shared this link to renew access so you can continue."
      )
    ).toBeTruthy()
    expect(screen.queryByText(/CR-/)).toBeNull()
    expect(screen.queryByText(/expert interview brief/i)).toBeNull()
  })
})
