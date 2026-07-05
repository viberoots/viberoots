# Deployment Control Plane Web UI

The service exposes a minimal same-origin browser UI when `webUi.enabled` is true. The UI is served
from `webUi.basePath` and uses read-only APIs under the same base path:

- `GET /api/v1/read/status` reports service instance, database connectivity, artifact-store
  connectivity, and worker heartbeat summaries.
- `GET /api/v1/read/queue` lists recent queued, running, and completed submissions.
- `GET /api/v1/read/worker-heartbeats` returns worker heartbeat state for replica visibility.
- `GET /api/v1/read/deployments/{deploymentId}` returns latest non-secret run state and current
  stage state, recent audit summaries, and artifact references for one deployment.
- `GET /api/v1/read/resource-graph` lists the non-authoritative resource graph index built from
  extracted deployment intent and admitted runtime facts, including status links, retained
  evidence references, and secret-safe source-selection evidence when indexed.
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

Same-origin UI and read API responses set `Cache-Control: no-store` and echo the request
correlation id in `x-request-id`. If a caller omits `x-request-id`, the service generates one for
the response and read-audit row.

## API Payload Stability

Read payloads are versioned with a top-level `schemaVersion` field such as
`control-plane-read-status@1`. The `@1` schemas are additive within the v1 API: existing fields keep
their meaning, new non-secret fields may be added, and removed or renamed fields require a new
schema version. Clients should ignore unknown fields and key automation on `schemaVersion` plus the
stable identifiers in the payload, such as `deploymentId`, `submissionId`, `deployRunId`,
`workerId`, and artifact reference digests or object keys.

Payloads expose summaries and references, not raw authority material. Deployment detail responses
may include recent audit summaries and artifact references, but they must not include provider
credentials, database URLs, Infisical client secrets, artifact contents, raw environment dumps, or
unredacted provider output. Redacted fields use the control-plane read redactor and should be treated
as intentionally unavailable rather than as missing data.

The resource graph read payload is a read model, not a mutation authority. Deployment submission,
idempotency, queueing, locks, run actions, artifact challenges, upload sessions, deploy records,
stage state, worker heartbeats, browser sessions, auth sessions, and audit rows remain in their
deployment-specific authoritative tables. Runtime graph nodes and edges are derived from those
tables so operators can inspect admitted runs, actions, challenges, upload sessions, retained
evidence, and current state without getting a generic mutation path.

When the resource graph import includes admitted runtime-source evidence, the same payload also
links validator-backed `RuntimeInput`, `AuthProviderProfile`,
`ControlPlaneReadinessEvidence`, `ControlPlaneObservabilityEvidence`, and
`MiniMigrationPreflightEvidence` nodes. Those nodes expose either durable evidence references or
the existing validator-backed non-secret evidence shape. Missing, stale, malformed, or
non-admitted evidence fails the resource graph import and should be fixed at the evidence producer
or setup/cutover workflow before re-importing. These evidence nodes are read-only status facts;
they do not add a generic runtime evidence mutation API or replace the deployment-specific tables.
None of the PR-10 runtime-source evidence kinds remain intentionally export-only once they are
admitted into the backend import. Runtime inventory facts outside that set remain export-only until
they have a durable backend table, object-store reference, or existing authoritative control-plane
record to link without inventing a mutation path.

## Troubleshooting

When `/api/v1/read/status` reports `database.ok: false`, check the service runtime database
credential file, managed Postgres network allowlist, and database migration state before restarting
workers. The service can be alive while readiness is false, so use the status payload instead of
`/healthz` for dependency diagnosis.

When `artifactStore.ok: false`, verify the configured bucket, endpoint, signing region, and mounted
artifact-store credential files. A missing `control-plane/.health` object is acceptable; other
metadata-read failures indicate the service cannot prove artifact-store reachability.

When the queue shows submissions stuck in `queued` or `running`, compare `/api/v1/read/queue` with
`/api/v1/read/worker-heartbeats`. Missing or stale worker heartbeat rows usually mean no worker
replica is polling the shared queue or lease renewal has stopped.

When deployment detail shows a failed latest run, use `latestRun.failedStep`,
`latestRun.errorFingerprint`, `auditSummary`, and `artifactReferences` to identify the failing phase
without reading raw provider logs or artifact contents from the database. Use the echoed
`x-request-id` to correlate UI/API inspection with service logs.
