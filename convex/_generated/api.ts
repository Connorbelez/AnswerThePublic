/* eslint-disable */
/** Generated Convex function references. */
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server"
import { anyApi } from "convex/server"
import { componentsGeneric } from "convex/server"
import type { ComponentApi as TimelineComponentApi } from "convex-timeline/_generated/component.js"

import type * as principals from "../principals"
import type * as contentRequests from "../contentRequests"
import type * as agentJobs from "../agentJobs"
import type * as founderInputs from "../founderInputs"
import type * as notifications from "../notifications"
import type * as migrations from "../migrations"
import type * as scoutIngestions from "../scoutIngestions"
import type * as semanticConflicts from "../semanticConflicts"
import type * as voiceCaptures from "../voiceCaptures"

const fullApi: ApiFromModules<{
  agentJobs: typeof agentJobs
  contentRequests: typeof contentRequests
  founderInputs: typeof founderInputs
  notifications: typeof notifications
  migrations: typeof migrations
  principals: typeof principals
  scoutIngestions: typeof scoutIngestions
  semanticConflicts: typeof semanticConflicts
  voiceCaptures: typeof voiceCaptures
}> = anyApi as any

export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any

export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any

export const components = componentsGeneric() as unknown as {
  timeline: TimelineComponentApi
}
