// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { NotificationCentre } from "@/components/notification-centre"

const { markRead } = vi.hoisted(() => ({ markRead: vi.fn() }))

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => markRead,
}))
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    onClick,
    params,
    hash,
  }: React.ComponentProps<"a"> & {
    params: { requestId: string }
    hash?: string
  }) => (
    <a
      href={`/app/requests/${params.requestId}${hash ? `#${hash}` : ""}`}
      onClick={(event) => {
        event.preventDefault()
        onClick?.(event)
      }}
    >
      {children}
    </a>
  ),
}))

describe("Notification centre contract", () => {
  beforeEach(() => markRead.mockReset().mockResolvedValue(undefined))
  afterEach(cleanup)

  it("expands its existing popover trigger and restores focus after keyboard dismissal", async () => {
    render(<NotificationCentre notifications={[]} />)
    const trigger = screen.getByRole("button", { name: "Notifications" })

    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    trigger.focus()
    fireEvent.click(trigger)
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("true")
    )
    expect(screen.getByText("Nothing needs your attention.")).toBeTruthy()

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    })
    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("false")
    )
    expect(document.activeElement).toBe(trigger)
  })

  it("defers a populated notification trigger until hydration, then opens from a browser pointer sequence", async () => {
    const notifications = [
      {
        notificationId: "submission",
        requestHumanId: "CR-GUEST",
        type: "guest_submission" as const,
        emailQueued: true,
        emailStatus: "queued" as const,
        createdAt: 3,
        readAt: null,
        deepLink: "/app/requests/CR-GUEST#guest-access-grant-1",
      },
    ]
    const documentDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "document"
    )
    let serverHtml: string
    try {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: undefined,
      })
      serverHtml = renderToString(
        <NotificationCentre notifications={notifications} />
      )
    } finally {
      Object.defineProperty(globalThis, "document", documentDescriptor!)
    }
    const container = document.createElement("div")
    container.innerHTML = serverHtml
    document.body.append(container)
    expect(
      screen
        .getByRole("button", { name: "Notifications" })
        .hasAttribute("disabled")
    ).toBe(true)

    render(<NotificationCentre notifications={notifications} />, {
      container,
      hydrate: true,
    })
    const trigger = screen.getByRole("button", { name: "Notifications" })
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false))

    fireEvent.pointerDown(trigger)
    fireEvent.mouseDown(trigger)
    fireEvent.pointerUp(trigger)
    fireEvent.mouseUp(trigger)
    fireEvent.click(trigger)

    await waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("true")
    )
    expect(screen.getByText("An expert response was submitted")).toBeTruthy()
  })

  it("optimistically clears the unread badge and persists the read", async () => {
    render(
      <NotificationCentre
        notifications={[
          {
            notificationId: "notification-1",
            requestHumanId: "CR-ONE",
            type: "request_assigned",
            emailQueued: true,
            emailStatus: "sent",
            createdAt: 1,
            readAt: null,
            deepLink: "/app/requests/CR-ONE",
          },
          {
            notificationId: "notification-2",
            requestHumanId: "CR-TWO",
            type: "critical_escalation",
            emailQueued: true,
            emailStatus: "sent",
            createdAt: 2,
            readAt: null,
            deepLink: "/app/requests/CR-TWO",
          },
        ]}
      />
    )

    expect(screen.getByText("2")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }))
    fireEvent.click(await screen.findByText("A request was assigned to you"))
    expect(screen.getByText("1")).toBeTruthy()
    await waitFor(() =>
      expect(markRead).toHaveBeenCalledWith({
        data: { notificationId: "notification-1" },
      })
    )
  })

  it("renders actionable guest signals with their grant-aware deep links", async () => {
    render(
      <NotificationCentre
        notifications={[
          {
            notificationId: "submission",
            requestHumanId: "CR-GUEST",
            type: "guest_submission",
            emailQueued: true,
            emailStatus: "queued",
            createdAt: 3,
            readAt: null,
            deepLink: "/app/requests/CR-GUEST#guest-access-grant-1",
          },
          {
            notificationId: "expiry",
            requestHumanId: "CR-GUEST",
            type: "guest_expiry_approaching",
            emailQueued: true,
            emailStatus: "queued",
            createdAt: 2,
            readAt: null,
            deepLink: "/app/requests/CR-GUEST#guest-access-grant-2",
          },
          {
            notificationId: "upload",
            requestHumanId: "CR-GUEST",
            type: "guest_upload_failed",
            emailQueued: true,
            emailStatus: "queued",
            createdAt: 1,
            readAt: null,
            deepLink:
              "/app/requests/CR-GUEST#guest-access-grant-3-asset-asset-1",
          },
        ]}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Notifications" }))
    expect(
      await screen.findByText("An expert response was submitted")
    ).toBeTruthy()
    expect(
      screen.getByText("An expert response link expires soon")
    ).toBeTruthy()
    expect(screen.getByText("An expert upload needs attention")).toBeTruthy()
    expect(
      screen
        .getByText("An expert upload needs attention")
        .closest("a")
        ?.getAttribute("href")
    ).toBe("/app/requests/CR-GUEST#guest-access-grant-3-asset-asset-1")
  })
})
