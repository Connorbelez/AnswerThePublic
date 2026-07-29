/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentJobs from "../agentJobs.js"
import type * as contentRequests from "../contentRequests.js"
import type * as crons from "../crons.js"
import type * as deliverables from "../deliverables.js"
import type * as deliveryTracking from "../deliveryTracking.js"
import type * as expertInterviews from "../expertInterviews.js"
import type * as expertSynthesis from "../expertSynthesis.js"
import type * as founderHandoffs from "../founderHandoffs.js"
import type * as founderInputs from "../founderInputs.js"
import type * as guestAccess from "../guestAccess.js"
import type * as guestEvidence from "../guestEvidence.js"
import type * as lib_agentJobCompletion from "../lib/agentJobCompletion.js"
import type * as lib_authorization from "../lib/authorization.js"
import type * as lib_deliverableLifecycle from "../lib/deliverableLifecycle.js"
import type * as lib_deliveryLifecycle from "../lib/deliveryLifecycle.js"
import type * as lib_expiration from "../lib/expiration.js"
import type * as lib_founderHandoff from "../lib/founderHandoff.js"
import type * as lib_guestAccessBoundary from "../lib/guestAccessBoundary.js"
import type * as lib_notificationOutbox from "../lib/notificationOutbox.js"
import type * as lib_operatorWorkspaceProjection from "../lib/operatorWorkspaceProjection.js"
import type * as lib_requestLimits from "../lib/requestLimits.js"
import type * as lib_requestOrdering from "../lib/requestOrdering.js"
import type * as lib_storageOwnership from "../lib/storageOwnership.js"
import type * as lib_workosAuthConfig from "../lib/workosAuthConfig.js"
import type * as migrations from "../migrations.js"
import type * as notifications from "../notifications.js"
import type * as operatorWorkspace from "../operatorWorkspace.js"
import type * as people from "../people.js"
import type * as principals from "../principals.js"
import type * as productMetrics from "../productMetrics.js"
import type * as publicShares from "../publicShares.js"
import type * as requestDisposition from "../requestDisposition.js"
import type * as scoutIngestions from "../scoutIngestions.js"
import type * as semanticConflicts from "../semanticConflicts.js"
import type * as storageMaintenance from "../storageMaintenance.js"
import type * as voiceCaptures from "../voiceCaptures.js"

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server"

declare const fullApi: ApiFromModules<{
  agentJobs: typeof agentJobs
  contentRequests: typeof contentRequests
  crons: typeof crons
  deliverables: typeof deliverables
  deliveryTracking: typeof deliveryTracking
  expertInterviews: typeof expertInterviews
  expertSynthesis: typeof expertSynthesis
  founderHandoffs: typeof founderHandoffs
  founderInputs: typeof founderInputs
  guestAccess: typeof guestAccess
  guestEvidence: typeof guestEvidence
  "lib/agentJobCompletion": typeof lib_agentJobCompletion
  "lib/authorization": typeof lib_authorization
  "lib/deliverableLifecycle": typeof lib_deliverableLifecycle
  "lib/deliveryLifecycle": typeof lib_deliveryLifecycle
  "lib/expiration": typeof lib_expiration
  "lib/founderHandoff": typeof lib_founderHandoff
  "lib/guestAccessBoundary": typeof lib_guestAccessBoundary
  "lib/notificationOutbox": typeof lib_notificationOutbox
  "lib/operatorWorkspaceProjection": typeof lib_operatorWorkspaceProjection
  "lib/requestLimits": typeof lib_requestLimits
  "lib/requestOrdering": typeof lib_requestOrdering
  "lib/storageOwnership": typeof lib_storageOwnership
  "lib/workosAuthConfig": typeof lib_workosAuthConfig
  migrations: typeof migrations
  notifications: typeof notifications
  operatorWorkspace: typeof operatorWorkspace
  people: typeof people
  principals: typeof principals
  productMetrics: typeof productMetrics
  publicShares: typeof publicShares
  requestDisposition: typeof requestDisposition
  scoutIngestions: typeof scoutIngestions
  semanticConflicts: typeof semanticConflicts
  storageMaintenance: typeof storageMaintenance
  voiceCaptures: typeof voiceCaptures
}>

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>

export declare const components: {
  timeline: import("convex-timeline/_generated/component.js").ComponentApi<"timeline">
}
