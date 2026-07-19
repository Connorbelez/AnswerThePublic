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
  "reap exhausted agent job leases",
  { minutes: 1 },
  internal.agentJobs.reapExpired,
  {}
)

export default crons
