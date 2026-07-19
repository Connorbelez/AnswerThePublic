import { useState } from "react"
import { Link } from "@tanstack/react-router"
import { useServerFn } from "@tanstack/react-start"
import { Bell } from "lucide-react"

import type { ContentNotification } from "@/application/content-requests"
import { markMyNotificationRead } from "@/application/content-request-server-functions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"

const notificationLabels = {
  request_assigned: "A request was assigned to you",
  critical_escalation: "Critical request needs attention",
  deadline_approaching: "A deadline is approaching",
  response_ready: "A response is ready",
  drafting_failed: "Drafting needs attention",
  delivery_reopened: "A delivery was reopened",
} satisfies Record<ContentNotification["type"], string>

export function NotificationCentre({
  notifications,
}: {
  notifications: Array<ContentNotification>
}) {
  const markRead = useServerFn(markMyNotificationRead)
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
        render={
          <Button
            className="relative"
            variant="ghost"
            size="icon-touch"
            aria-label="Notifications"
          />
        }
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
              <Item
                key={notification.notificationId}
                size="sm"
                variant={unread.includes(notification) ? "muted" : "default"}
                render={
                  <Link
                    to="/app/requests/$requestId"
                    params={{ requestId: notification.requestHumanId }}
                    onClick={() =>
                      readNotification(notification.notificationId)
                    }
                  />
                }
              >
                <ItemContent>
                  <ItemTitle>{notificationLabels[notification.type]}</ItemTitle>
                  <ItemDescription>
                    {notification.requestHumanId}
                  </ItemDescription>
                </ItemContent>
              </Item>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
