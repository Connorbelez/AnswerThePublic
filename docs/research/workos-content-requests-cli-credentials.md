# WorkOS credential strategy for the FairLend Content Requests CLI

**Status:** architecture research and production recommendation  
**As of:** 2026-07-29  
**Source policy:** WorkOS first-party documentation, the current repository implementation and contract tests, and a non-persistent capability probe of the configured production WorkOS application

## Decision

WorkOS Agent Registration is **not the only way** to authenticate a CLI. It is,
however, the only currently implemented credential path that gives an
autonomous FairLend agent its own revocable installation identity while binding
that agent to a user and organization.

Use two intentional modes:

1. **Interactive human CLI:** implement WorkOS CLI Auth (OAuth Device
   Authorization Flow) and send the resulting user access token. This is
   available in the current production environment and does not require WorkOS
   account-team enablement.
2. **Unattended agent/automation:** retain Agent Registration with
   `service_auth` and configure it to issue a durable API key. Ask WorkOS to
   enable Agent Registration for the production environment because that
   surface is not currently present.

Do **not** use the `sk_…` key from the WorkOS Dashboard environment API Keys
page as `CONTENT_REQUESTS_ACCESS_TOKEN`. That is the FairLend backend's
administrative credential for calling WorkOS, not a caller credential for
calling FairLend. WorkOS states that these server keys can perform WorkOS API
requests, must remain private, and are scoped to the WorkOS environment.
[[WorkOS API authentication](https://workos.com/docs/reference/api-authentication)]

## What the repository accepts today

The CLI sends `CONTENT_REQUESTS_ACCESS_TOKEN` as an HTTP bearer token
([`src/cli/content-requests.ts`](../../src/cli/content-requests.ts)).
The server then applies this decision tree:

1. Every bearer is offered to `workos.agents.validateCredential`.
2. A valid Agent Registration access token or API key is resolved to the
   verified registration and its FairLend organization.
3. An invalid opaque credential fails closed.
4. An invalid JWT whose `sub` begins with `agent_reg_` also fails closed, so a
   revoked agent JWT cannot fall through as a human.
5. A non-agent JWT may continue to Convex's regular WorkOS user-session
   authentication path.

That behavior is implemented in
[`src/application/agent-api-auth.server.ts`](../../src/application/agent-api-auth.server.ts)
and
[`src/infrastructure/workos-agent-credential.server.ts`](../../src/infrastructure/workos-agent-credential.server.ts).
The agent path requires a verified registration in the configured organization,
then injects a server-authenticated `agent-editor` principal into Convex
([`src/infrastructure/convex-content-request-repository.ts`](../../src/infrastructure/convex-content-request-repository.ts)).

The human JWT path is still constrained by Convex. The token must validate
against the configured WorkOS issuer/JWKS, target the configured application
where a client ID is present, contain the FairLend `org_id`, and contain one of
the mapped workspace roles. Content Request writes then require an editor role.
See
[`convex/lib/workosAuthConfig.ts`](../../convex/lib/workosAuthConfig.ts),
[`convex/principals.ts`](../../convex/principals.ts), and
[`convex/lib/authorization.ts`](../../convex/lib/authorization.ts).

## Credential options

| Method | Identity and lifecycle | Accepted by FairLend now? | Fit |
| --- | --- | --- | --- |
| Agent Registration + `service_auth` + API key | A verified agent registration delegated by a user, organization-bound, durable until expiry/revocation | **Yes** | Recommended for Codex and unattended automations |
| Agent Registration + `service_auth` + access token | Same delegated agent identity, but short-lived JWT that can be re-minted | **Yes** | Good when local JWT validation and short lifetimes are preferred |
| AuthKit CLI Auth | A signed-in human user; short-lived access token plus rotating refresh token | **Yes, for the authenticated CLI route** | Recommended for interactive operator use |
| AuthKit user- or organization-scoped API key | Durable customer credential with configured permissions and revocation | **No** | Viable fallback architecture, but requires a new FairLend verifier and principal mapping |
| WorkOS Connect M2M | Organization-scoped third-party service; client secret exchanges for short-lived JWTs | **No supported FairLend path** | Appropriate for organization-owned partner integrations, not a user-delegated coding agent |
| WorkOS environment/server API key | FairLend backend administrator calling WorkOS | **No** | Never expose to the CLI or use as a FairLend bearer |

### Agent Registration

Agent Registration supports `anonymous`, `service_auth`, and `refresh`
identity types. `service_auth` requires a claim ceremony that binds the
registration to a user. The resulting assertion can be exchanged for either a
short-lived access token or a durable API key; credential type and lifetime are
configured per environment. Agent access tokens include the registration in
`sub`, the organization in `org_id`, granted permissions in `scope`, and the
delegating user in the `act` claim after a successful claim. API keys must be
validated server-side; access tokens may be validated locally or checked for
revocation through WorkOS.
[[WorkOS Agent Registration](https://workos.com/docs/authkit/agent-auth)]
[[Agent Registration API reference](https://workos.com/docs/reference/authkit/agent-registration)]

This matches the repository's existing audit model: the principal is the agent
identity, while the credential ID is the access token's `jti` or the stable
registration ID. Revoking one registration removes only that installation.

The blocker is commercial/configurational, not technical: WorkOS says Agent
Registration must be enabled per environment and instructs customers to contact
their WorkOS account team when it is unavailable.
[[WorkOS Agent Registration](https://workos.com/docs/authkit/agent-auth)]

### AuthKit CLI Auth

WorkOS CLI Auth uses the OAuth 2.0 Device Authorization Flow. The CLI requests a
device code, shows a user code and verification URL, waits for browser
confirmation, and polls for a user access token and refresh token. WorkOS
explicitly warns not to display the device code and documents the required
polling interval, slowdown handling, terminal errors, and timeout behavior.
[[WorkOS CLI Auth](https://workos.com/docs/authkit/cli-auth)]

WorkOS user access tokens are JWTs containing the user subject and, when an
organization is selected, `org_id`, role, and permissions. Access tokens should
be validated on every request; refresh tokens should be kept in backend-grade
secure storage and replaced when WorkOS rotates them.
[[WorkOS sessions](https://workos.com/docs/authkit/sessions)]

The configured production WorkOS client was probed without logging or
persisting any returned code or token. On 2026-07-29,
`POST https://api.workos.com/user_management/authorize/device` returned
`200`, a device code, a verification URI, and a five-minute lifetime. Therefore
CLI Auth is available now even though Agent Registration is not.

The repository does not yet implement `content-requests auth login`, refresh
storage, or automatic refresh. Its public CLI API route is nevertheless
designed to pass a non-agent JWT to Convex. This means an ephemeral user access
token can unblock an interactive operation, while a durable CLI implementation
should add the complete login/refresh lifecycle.

### AuthKit customer API keys

AuthKit API keys are application-caller credentials, unlike WorkOS environment
server keys. They may be organization-scoped or user-scoped, can carry
configured permissions, are shown in full only once, and can be revoked.
User-owned keys are tied to an active organization membership and are revoked
when that membership is deleted. The application validates them through
`workos.apiKeys.createValidation`.
[[WorkOS AuthKit API keys](https://workos.com/docs/authkit/api-keys)]
[[API Keys API reference](https://workos.com/docs/reference/authkit/api-keys)]

This is a safe permanent fallback if Agent Registration cannot be enabled, but
it is not a no-code substitution. FairLend currently sends every opaque bearer
to `workos.agents.validateCredential`; it does not call the AuthKit API-key
validator. Supporting these keys would require:

1. a distinct customer-API-key verifier;
2. explicit owner-to-principal mapping;
3. FairLend permission checks;
4. a stable audit credential ID;
5. fail-closed tests for revoked, expired, wrong-organization, and
   insufficient-permission keys.

A user-scoped key is closer to the desired delegation model than an
organization-scoped key, but it still represents a user-owned API key rather
than a first-class agent registration.

### WorkOS Connect M2M

WorkOS Connect M2M uses OAuth `client_credentials` for third-party,
organization-scoped integrations. The client ID and secret mint a short-lived
JWT with `org_id`; the resource server validates it with the environment JWKS
or token introspection.
[[WorkOS M2M applications](https://workos.com/docs/authkit/connect/m2m)]

This is a valid architecture for an organization-owned background service, but
not a drop-in FairLend credential. WorkOS documents `org_id`, while FairLend's
current Convex policy also requires one of its mapped `role` claims and a
provisioned principal. Supporting M2M correctly would require a dedicated
service-principal mapping and token verifier rather than pretending the client
is a human or an Agent Registration.

## Recommended setup

### Immediate path: interactive CLI Auth

Use this to complete the current three Expert Interview creations without
waiting for WorkOS feature enablement:

1. Add a `content-requests auth login` command that requests device
   authorization with the configured `WORKOS_CLIENT_ID`.
2. Display only the user code and `verification_uri_complete`; never print the
   device code.
3. Poll at WorkOS's returned interval and honor `authorization_pending`,
   `slow_down`, denial, expiry, and the overall timeout.
4. Require the returned token to contain the production FairLend organization
   and an authorized editor/admin role before saving anything.
5. Store the refresh token in macOS Keychain, not `.env.local`; keep the access
   token in memory and refresh it as needed, atomically replacing a rotated
   refresh token.
6. Send the access token through the existing bearer header and perform a
   read-only identity/preflight request before the first write.
7. Preserve correlation/idempotency behavior for each Expert Interview
   creation and verify each returned stable request ID.

This mode audits the operation as the signed-in human. It should be named and
documented as interactive operator authentication, not an agent installation.

### Permanent path: Agent Registration

Use this for Codex, scheduled jobs, and other unattended installations:

1. Ask WorkOS to enable **Agent Registration** for production environment
   `environment_01KXY1XF5QXW9QGXVBX7J67QCD`.
2. Under **Authentication → Agents → Methods**, enable `service_auth` and leave
   anonymous registration disabled.
3. Under **Authentication → Agents → Configuration**, select API-key
   credentials, set an explicit expiration/rotation policy, configure trusted
   permissions, and publish the protected-resource and authorization-server
   discovery metadata.
4. Run a `service_auth` registration using the operator's email, complete the
   signed-in claim ceremony, and exchange the returned assertion at the token
   endpoint.
5. Store the issued agent API key as
   `CONTENT_REQUESTS_ACCESS_TOKEN` in installation-local secret storage. Keep
   the WorkOS environment server key only in the FairLend backend.
6. Validate the installation through the existing Content Requests endpoint,
   confirm that audit records identify the agent registration, then perform the
   three idempotent Expert Interview creates.
7. Revoke the registration and verify the next request fails before issuing the
   final long-lived credential.

The current server maps any verified same-organization Agent Registration to
`agent-editor`; it does not enforce the WorkOS `scope` claim. Before broadening
Agent Registration beyond trusted internal installations, add an explicit
required-scope check so Dashboard permission configuration is enforced by
FairLend as well.

## Support request

The exact WorkOS request should be:

> Enable AuthKit Agent Registration for production environment
> `environment_01KXY1XF5QXW9QGXVBX7J67QCD`. We need `service_auth`, durable
> API-key credential issuance, trusted organization permissions, registration
> revocation, and OAuth/`auth.md` discovery. Anonymous registration should
> remain disabled.

That support request is required only for the unattended Agent Registration
path. It is **not** required to use the already-available CLI Auth path.
