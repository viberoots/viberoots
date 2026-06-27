# 16. Centralized Structured Logging

**Tier:** Observability & Reliability
**Priority:** 16 of 44
**Depends on:** #4 Containerize Control Plane, #11 Backend Service Build Template(s)
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Add structured JSON logging to the control plane service and worker (currently bare `console.log` or silent), define the shared field schema and redaction rules, and wire a configurable log destination into the runtime config.

## What

Introduce a thin, shared structured logging library used by both the TypeScript control plane and
any Go application services, and wire it into a centralized log aggregation destination so all
runtime output is queryable in one place.

AGENTS.md lists "Centralized Logging: Error handling and diagnostic output with JSON
integration" as a Phase 0 must-have. As of this writing no such facility exists: the control plane
emits bare `console.log` / `console.error` calls (e.g., `nixos-shared-host-control-plane-service.ts`
lines 76, 106, 111; `nixos-shared-host-control-plane-worker.ts` line 86), and the worker loop
produces no structured output at all. Request correlation works through the `X-Request-Id` header
(already read in `deployment-control-plane-mcp.ts:requestIdFor`) and through audit event
`requestId` fields, but nothing binds those IDs to process-level log lines.

**TypeScript logging library** (`build-tools/tools/lib/logger.ts`)

A single module, under 250 lines, that:

- Exports a `createLogger(service: string, context?: Record<string, unknown>)` factory that
  returns a logger bound to a fixed `service` field.
- Writes NDJSON lines to stdout for `info` and `debug` levels; writes to stderr for `warn` and
  `error`, matching the existing convention that `console.error` goes to stderr.
- Emits a consistent field set on every line: `timestamp` (ISO 8601), `level`, `service`,
  `instance_id` (when available), `request_id` (when provided), and `message`. Additional fields
  are passed as a plain object argument.
- Exposes a `child(extra: Record<string, unknown>)` method that returns a new logger with merged
  context fields, so a request handler can bind `request_id` once and pass the child logger down.
- Does not accept or log raw `Error` objects directly: callers extract the message; the library
  never serializes `stack` or `cause` chains to the log line.
- The module has no runtime dependencies beyond Node built-ins.

**Control plane wiring**

Replace all `console.log` / `console.error` calls inside long-running service and worker entry
points with structured logger calls. Concretely:

- `nixos-shared-host-control-plane-service.ts` — emit a structured `info` line on bind (fields:
  `url`, `instance_id`, `mode`) instead of `JSON.stringify({ url })`.
- `nixos-shared-host-control-plane-worker.ts` — emit `info` on start and `error` on fatal exit.
- `nixos-shared-host-control-plane-server.ts` — the top-level `catch` block (line 225) currently
  calls `writeJson` silently; add an `error` log line with `request_id` extracted from the
  incoming request headers before writing the error response.
- The MCP handler in `deployment-control-plane-mcp.ts` already threads `requestId` through every
  operation; bind it to a child logger so failures carry the ID in the log line, not only in the
  audit table.

**Redaction enforcement**

Log lines are subject to the same redaction boundary that governs operator-visible deploy records
(`deployment-control-plane-redaction.ts`). The logger library must not accept a raw `Error`
message as a log field without passing it through `redactOperatorText` first. The `SECRET_PATTERN`
and `SECRET_VALUE_PATTERN` regexes already encode what constitutes a sensitive field or value; the
logger should apply that test to any field whose name matches `SECRET_PATTERN` and to any string
value that matches `SECRET_VALUE_PATTERN`, replacing the value with `"(redacted)"` and setting a
`redacted: true` flag on the line. This is not a full audit trail (that is task #17); it is a
floor that prevents credentials from landing in a log aggregator.

**Aggregation destination**

All containers (service replicas and workers) write structured stdout/stderr to the container
runtime. The NixOS container module (`deployment-control-plane-container-module.nix`) already
manages `virtualisation.oci-containers` entries; the module should be extended to configure log
forwarding from those containers to a single destination. The chosen destination must support
NDJSON ingestion and be reachable from wherever the containers run:

- For the legacy NixOS self-hosted control-plane host: systemd-journal captures container stdout automatically;
  `journald` can forward to a remote Loki or a cloud logging endpoint via `systemd-journal-remote`
  or a Promtail sidecar. Either is acceptable as the initial transport.
- For the containerized cloud deployment: the container host's native log driver (e.g., a cloud
  provider's container logging integration) is the simplest aggregation path; no additional
  sidecar is required if the host provides structured log capture.

The exact destination is an operator decision. What this task must deliver is the NDJSON format on
stdout that any standard log forwarder can consume without transformation.

**Tests**

- Logger unit tests: each level writes the correct field set; `child()` merges context fields
  without mutating the parent; a field whose name matches `SECRET_PATTERN` is redacted; a value
  matching `SECRET_VALUE_PATTERN` is redacted regardless of field name.
- Redaction round-trip: confirm that a real `DeploymentOperatorVisiblePayload` produced by
  `redactOperatorText` does not, when logged, expand back into the raw text it summarized.
- Worker-loop integration smoke: a single `runNixosSharedHostControlPlaneWorkerOnce` call in local
  fixture mode emits at least one structured log line with the expected fields.

## Why Now

You cannot operate a production system without logs. The control plane runs deployment mutations
on live infrastructure, and right now a failing worker loop produces no searchable output — the
only signal available is the audit record written to Postgres if the worker reached that point.
Failures before or during claim-lease renewal are silent.

The dependency on #4 (Containerize Control Plane) is structural: log aggregation requires stable
process boundaries and a container runtime that provides a consistent stdout/stderr capture path.
The dependency on #11 (Backend Service Build Templates) matters for any Go services added under the
template: they need the same NDJSON contract from the start rather than retrofitting it.

This task directly unblocks:

- **#18 Monitoring** — alerting rules need log-derived signals (error rate, specific error codes)
  that do not exist yet as metrics.
- **#17 Audit Logging** — audit events share the same transport; the log library's redaction
  enforcement is the prerequisite for safely shipping audit lines to an external destination.

## Risks

**Redaction correctness at the log call site.** The control plane's existing `redactOperatorText`
function was designed for operator-visible deploy records, not for general log output. Extending it
to cover log field values introduces new call sites. A bug at any one of those sites — for example,
logging a raw `authorization` header before it reaches the redaction check — would write a
credential to the aggregator. The test suite must cover this path explicitly.

**NDJSON serialization of circular structures.** Node's `JSON.stringify` throws on circular
references. If an `Error` or a deeply nested options object is passed as a log field, the logger
will either throw or produce a truncated line. The library must serialize defensively (e.g., via a
safe replacer) rather than rely on callers to never pass circular values.

**Log volume and cost at the aggregator.** The worker loop polls on a short interval (default
100 ms) and will emit heartbeat or no-op log lines at high frequency if not rate-limited. If the
aggregator charges by ingest volume, a default `debug`-level worker is expensive. The logger must
default to `info` level in production and support a runtime level override through an environment
variable (`VBR_LOG_LEVEL`).

**Divergence between TypeScript and future Go loggers.** If a Go service is added under #11 before
a canonical NDJSON field contract is written down, the Go service will invent its own field names
and the two log streams will not join on `request_id`. The field contract must be documented as
part of this task, not deferred.

## Trade-offs

**Thin custom library vs. adopting pino or similar.** Pino is a mature structured logging library
for Node that produces NDJSON, supports child loggers, and has been battle-tested in production.
However, introducing a third-party runtime dependency into the `build-tools/tools/lib/` path
complicates the esbuild bundle for the control plane image, where the current design bundles only
Node built-ins. The thin custom library avoids this. If the custom library grows to the point where
it is reimplementing pino, revisit the decision.

**Structured stdout vs. writing to a log file.** Writing NDJSON to stdout delegates transport to
the container runtime, which is the correct separation of concerns for a containerized service.
Writing to a file inside the container would require a volume mount, a rotation policy, and an
agent to ship the file, adding operational surface area. Stdout wins.

**Per-request log lines at info level vs. debug-only.** Logging each inbound request at `info`
produces a reliable access log but increases volume. The trade-off taken here: the server logs
unhandled errors and explicit error responses at `info`; normal 200 responses are logged at
`debug`. This keeps the high-frequency happy path out of the production aggregator by default
without losing error visibility.

**Redaction inside the logger vs. at each call site.** Centralizing redaction inside the logger
means no call site can accidentally skip it. The cost is that the logger becomes slightly more
opinionated and the redaction logic must handle arbitrary field values, not just structured deploy
records. This is the safer choice given that credentials surfacing in logs is a harder problem to
detect than a test failure.

## Considerations

**Field contract must be written down.** Before any implementation starts, define and commit the
canonical NDJSON field names: `timestamp`, `level`, `service`, `instance_id`, `request_id`,
`message`, and the conventions for additional fields (snake_case, no nesting beyond one level). Go
services added under #11 consume this contract; TypeScript and Go must agree on it before either
lands.

**`instance_id` is already available.** The runtime config type (`ControlPlaneRuntimeConfig`) has
a top-level `instanceId` field that is threaded through to `startNixosSharedHostControlPlaneServer`
and exposed on `/healthz`. The logger factory should accept `instance_id` at construction time so
every line from a given container is tagged without per-call overhead.

**`request_id` propagation does not require middleware.** The MCP handler already calls
`requestIdFor(request)`, which reads `X-Request-Id` or generates a UUID. The server's top-level
request handler should do the same and pass it to a child logger, which is then passed into each
handler function. This does not require a middleware framework; it is a two-line change at the top
of the existing `http.createServer` callback.

**The worker loop has no request ID concept.** Worker iterations are not HTTP requests. Log lines
from the worker should use `submission_id` and `worker_id` (already present in the claim result)
as the correlation identifiers rather than `request_id`. The field contract should accommodate
this: `request_id` is optional; `submission_id` and `worker_id` are additional context fields when
present.

**Do not log the full submission or snapshot document.** The submission and execution snapshot
documents contain deployment configuration that may include paths, environment names, or other
values that have not been through the redaction boundary. Log only scalar identifiers (`submissionId`,
`deploymentId`, `provider`) alongside the operation outcome. The full document is already persisted
in Postgres and on disk; it does not need to appear in the log stream.

**Aggregator destination is a deployment decision, not a code decision.** The task delivers the
NDJSON format on stdout. The choice of Loki, a cloud provider's managed log service, or
`systemd-journal-remote` is documented in the operator runbook, not hard-coded. The NixOS module
change in this task adds a commented-out example Promtail config under the container module option;
it does not enable it by default.
