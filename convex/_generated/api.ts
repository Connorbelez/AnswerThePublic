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

const fullApi: ApiFromModules<{
  contentRequests: typeof contentRequests
  principals: typeof principals
}> = anyApi as any

export const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
> = anyApi as any
