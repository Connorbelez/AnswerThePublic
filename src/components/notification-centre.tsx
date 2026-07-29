import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Bell } from "lucide-react"

import type { ContentNotification } from "@/application/content-requests"
import { markMyNotificationRead } from "@/application/content-request-server-functions"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useHydrated } from "@/hooks/use-hydrated"

const notificationLabels = {
  request_assigned: "A request was assigned to you",
  founder_handoff: "A request was promoted to you",
  critical_escalation: "Critical request needs attention",
  deadline_approaching: "A deadline is approaching",
  response_ready: "A response is ready",
  drafting_failed: "Drafting needs attention",
  delivery_reopened: "A delivery was reopened",
  guest_submission: "An expert response was submitted",
  guest_expiry_approaching: "An expert response link expires soon",
  guest_upload_failed: "An expert upload needs attention",
} satisfies Record<ContentNotification["type"], string>

export function NotificationCentre({
  notifications,
}: {
  notifications: Array<ContentNotification>
}) {
  const markRead = useServerFn(markMyNotificationRead)
  const hydrated = useHydrated()
  const [locallyRead, setLocallyRead] = useState<Set<string>>(() => new Set())
  const unread = notifications.filter(
    (notification) =>
      !notification.readAt && !locallyRead.has(notification.notificationId)
  )

  function readNotification(notificationId: string) {
    setLocallyRead((current) => new Set(current).add(notificationId))
    void markRead({ data: { notificationId } }).catch(() => {
      setLocallyRead((current) => {
        const next = new Set(current)
        next.delete(notificationId)
        return next
      })
    })
  }
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Notifications"
        className={buttonVariants({ variant: "ghost", size: "icon" })}
        disabled={!hydrated}
        type="button"
      >
        <Bell />
        {unread.length > 0 ? (
          <Badge className="notification-count">{unread.length}</Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end">
        <PopoverHeader>
          <PopoverTitle>Notifications</PopoverTitle>
        </PopoverHeader>
        {notifications.length === 0 ? (
          <p className="notification-empty">Nothing needs your attention.</p>
        ) : (
          <div className="notification-list">
            {notifications.map((notification) => (
              <Link
                key={notification.notificationId}
                to="/app/requests/$requestId"
                params={{ requestId: notification.requestHumanId }}
                hash={
                  notification.deepLink.includes("#")
                    ? notification.deepLink.slice(
                        notification.deepLink.indexOf("#") + 1
                      )
                    : undefined
                }
                onClick={() => readNotification(notification.notificationId)}
              >
                <strong>{notificationLabels[notification.type]}</strong>
                <span>{notification.requestHumanId}</span>
              </Link>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
