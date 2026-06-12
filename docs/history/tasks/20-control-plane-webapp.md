# 22. Simple Control Plane Webapp

**Tier:** Developer Experience
**Priority:** 22 of 44
**Depends on:** #4 Containerize Control Plane, #6 Supabase/WorkOS Auth Provider
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Implement a read-only same-origin web UI on the control plane service: deployment list, queue depth, recent run history, and current stage state, protected by the same session/CSRF/grant model as the API.

## What

Implement PR-5 from `docs/history/plans/control-plane-plan.md`: the same-origin read-only web UI described in
`docs/control-plane-web-ui.md`. This is not a separate web service or a separate container. It is
the same service process that already serves the API, now also serving static UI assets from the
same origin.

**Read-only API surface:**

- `GET /api/v1/read/status` — service instance identity, database connectivity, artifact-store
  connectivity, and worker heartbeat summaries.
- `GET /api/v1/read/queue` — recent queued, running, and completed submissions.
- `GET /api/v1/read/deployments/{deploymentId}` — latest non-secret run state and current stage
  state for one deployment.
- `GET /api/v1/read/auth-context` — authenticated principal and non-secret grant summary.

**UI pages:** status, queue, and deployment detail. The web UI is enabled when `webUi.enabled` is
true and is served from `webUi.basePath`.

**Auth/session model:** Read APIs accept the reviewed service bearer token or a durable browser
session created by `POST /api/v1/web/session`. Sessions, CSRF scaffolding, and future idempotency
scaffolding are stored in the database so service replicas stay stateless and do not require sticky
sessions.

**Redaction:** Every read response passes through the control-plane read redactor. Secret values,
provider tokens, Infisical credentials, raw environment dumps, artifact contents, and unredacted
provider errors must not appear in API responses or in the rendered UI.

**v1 boundary:** No submit, approve, retry, cancel, promote, resume, or abort controls. Future
mutation-capable UI must reuse the same server-side session, CSRF, idempotency, grant, redaction,
and audit boundaries established here, not add a browser-only authorization model alongside them.

## Why Now

Operators currently have no browser path to verify service connectivity, queue depth, or deployment
state. The MCP surface (PR-6, task #X) provides the same read model for agents, but operators
working without an AI client have no visibility beyond the CLI and raw API calls.

The v1 UI also establishes the session and CSRF scaffolding that future mutation-capable UI must
reuse. Doing this before any mutation controls are contemplated keeps the auth primitives correct
from the start. A quick UI added later without this foundation would create a second authorization
path that conflicts with the plan's explicit non-goal: no browser-only authorization model.

The dependency on #4 (containerize control plane) is mandatory because the stateless service
replicas, database-backed session store, and read API handlers all land in PR-1 through PR-4 of
that plan. The dependency on #6 (auth provider) matters because the session flow's OIDC principal
must resolve through the generalized auth-provider abstraction rather than the current
Keycloak-shaped interim path. Wiring the web session to an auth provider that is about to be
replaced would require rework.

## Risks

**Premature mutation surface.** The most significant risk is that a "simple" web UI accretes
submit or approve controls before the server-side session, idempotency, and grant model is fully
hardened. The plan is explicit: v1 has no mutation controls. Tests must assert this (no mutation
endpoints, no mutation UI elements) and the v1 boundary must be treated as a regression gate, not
a convenience.

**Second authorization path.** If the browser session is implemented with any browser-local state
as the correctness mechanism — client-side JWTs stored in localStorage, cookie-only CSRF without
server-side verification, or session state not mirrored to the database — it creates a
browser-only authorization model that the plan explicitly rules out. The session store must be
database-backed end to end.

**Redaction gaps at the read model.** Read APIs are a plausible secret leak channel. Deployment
records contain Infisical credentials, raw provider errors, artifact contents, and environment
values that must not appear in responses. The redaction layer must be tested with fixture records
that contain secret-looking values in every field, not only the obvious ones.

**Reverse proxy base-path breakage.** The web UI must work behind an operator-configured base path
and reverse proxy without sticky sessions. Both asset URLs and API call paths must be base-path
aware. This is easy to get right in isolation and easy to break silently in production if the
base-path logic is only tested under `/`.

**Auth provider timing.** If #6 (auth provider) is not complete when this task lands, the session
flow must either remain wired to the current Keycloak-shaped interim auth or be implemented
against a provider contract that has not stabilized. Coordinate with #6 to ensure the session flow
uses the auth-provider abstraction rather than the provider-specific details.

## Trade-offs

**Same service vs. separate web container.** The plan explicitly non-goals a separate web service
container in v1. This simplifies deployment (one image, same digest), keeps session state and
read APIs co-located, and avoids cross-origin CSRF complexity. The cost is that the HTTP server
in the service process must handle both API requests and static asset serving. This is a deliberate
and documented design choice, not an expedient shortcut.

**Minimal UI vs. polished UI.** The design calls for operational visibility: status, queue depth,
deployment detail. Not a full admin UI, not a deployment trigger surface. A richer UI now would
require mutation controls before the session, idempotency, and grant model are validated in
production. Keeping v1 read-only defers that complexity to a stage where the foundation is proven.

**Database-backed sessions vs. signed client-side tokens.** Database-backed sessions are more
operationally complex (session table, expiry, cleanup) but satisfy the no-sticky-session and
no-browser-only-auth requirements without exception. Signed JWTs in the browser would satisfy the
no-sticky-session requirement but would introduce browser-local authorization state that the plan
explicitly rejects.

**Static assets embedded vs. served from CDN.** Serving static UI assets from the service
container keeps the deployment simple and the same-origin property trivially satisfied. A CDN
would require CORS policy, separate asset versioning, and a separate origin to manage. For a
minimal read-only internal UI used by operators, embedding is the correct trade-off.

## Considerations

- The read API and session model are already specified in `docs/control-plane-web-ui.md`. The
  implementation should follow that document without extending the v1 surface. Any deviation from
  the specified endpoint paths or auth model should update the doc before the code changes.
- The `webUi.enabled` and `webUi.basePath` config keys are already part of the control-plane
  container config schema (defined in the containerization plan's PR-1 scope). The web UI
  implementation should read these keys through the same config loader, not introduce a second
  config path.
- Tests must include: read API authorization (unauthenticated and unauthorized callers rejected),
  redaction against fixture records with secret-looking values in provider error, Infisical,
  artifact, and environment fields, multi-replica session validation (two service instances sharing
  one database session), base-path correctness under `/` and a non-root path, and a no-mutation
  regression test asserting v1 responses expose no mutation endpoints or controls.
- The session CSRF scaffolding added here is the same scaffolding that future mutation workflows
  must consume. Keep the CSRF token generation and verification in a shared server-side helper
  rather than inline in the web session handler, so future mutation endpoints adopt it naturally.
- Operator documentation must cover: how to enable the web UI via `webUi.enabled`, what the
  redaction guarantees are and what operators should expect to see redacted, how to configure the
  reverse proxy to route `webUi.basePath` without sticky sessions, and what the v1 read-only
  boundary means for future approval workflows.
- The NixOS container module already declares `webUi.enabled` and `webUi.basePath` options. The
  nginx config emitted by the module (`manageNginx = true`) should route the base path correctly
  once the service serves UI assets. Verify this is tested in the module evaluation tests (PR-8
  of the containerization plan) rather than leaving it as an assumed runtime behavior.
- Making viberoots public (#43) requires that the control plane not expose operator deployment
  detail to unauthenticated callers. Verify that the read APIs fail closed for unauthenticated
  requests in the same test suite that covers authorization, not as a separate audit pass later.
