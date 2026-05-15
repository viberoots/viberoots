# Deployment Control Plane Web UI

The service exposes a minimal same-origin browser UI when `webUi.enabled` is true. The UI is served
from `webUi.basePath` and uses read-only APIs under the same base path:

- `GET /api/v1/read/status` reports service instance, database connectivity, artifact-store
  connectivity, and worker heartbeat summaries.
- `GET /api/v1/read/queue` lists recent queued, running, and completed submissions.
- `GET /api/v1/read/deployments/{deploymentId}` returns latest non-secret run state and current
  stage state for one deployment.
- `GET /api/v1/read/auth-context` returns the authenticated principal and non-secret grant summary.

Read APIs accept the reviewed service bearer token or a durable browser session created by
`POST /api/v1/web/session`. Browser sessions, CSRF scaffolding, and future idempotency scaffolding
are stored in the backend database so service replicas stay stateless and do not require sticky
sessions.

The v1 UI is read-only. It intentionally has no submit, approve, retry, cancel, promote, resume, or
abort controls. Future approval workflows must reuse the same server-side session, CSRF,
idempotency, grant, redaction, and audit boundaries instead of adding browser-only authorization.

Every read response is passed through the control-plane read redactor. Secret values, provider
tokens, Infisical credentials, raw environment dumps, artifact contents, and unredacted provider
errors must not appear in API responses or rendered UI. Operators should expose the service behind
host-managed TLS and route the configured base path through the reverse proxy without requiring
sticky sessions.
