/* eslint-disable */
/** Generated Convex function references. */
import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server"
import { anyApi } from "convex/server"

import type * as principals from "../principals"
import type * as contentRequests from "../contentRequests"
import type * as notifications from "../notifications"
import type * as migrations from "../migrations"

const fullApi: ApiFromModules<{
  contentRequests: typeof contentRequests
  notifications: typeof notifications
  migrations: typeof migrations
  principals: typeof principals
}> = anyApi as any

export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any

export const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
> = anyApi as any
