import { cronJobs } from "convex/server"

import { internal } from "./_generated/api"

const crons = cronJobs()

crons.interval(
  "recover notification email deliveries",
  { minutes: 1 },
  internal.notifications.reapEmailDeliveries,
  {}
)

crons.interval(
  "notify unfinished guest grants approaching expiry",
  { minutes: 15 },
  internal.notifications.scheduleGuestExpiryNotifications,
  {}
)

crons.interval(
  "reap exhausted agent job leases",
  { minutes: 1 },
  internal.agentJobs.reapExpired,
  {}
)

crons.interval(
  "expire stale automated content requests",
  { minutes: 1 },
  internal.requestDisposition.expireDue,
  {}
)

crons.interval(
  "reap unclaimed storage uploads",
  { hours: 1 },
  internal.storageMaintenance.reapOrphanedStorageObjects,
  {}
)

export default crons
