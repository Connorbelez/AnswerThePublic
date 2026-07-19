// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { NotificationCentre } from "@/components/notification-centre"

const { markRead } = vi.hoisted(() => ({ markRead: vi.fn() }))

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: () => markRead,
}))
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, onClick }: React.ComponentProps<"a">) => (
    <a href="#request" onClick={onClick}>
      {children}
    </a>
  ),
}))

describe("Notification centre contract", () => {
  beforeEach(() => markRead.mockReset().mockResolvedValue(undefined))

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
})
