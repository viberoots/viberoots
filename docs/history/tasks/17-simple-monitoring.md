# 18. Simple Monitoring (Prometheus / OpenTelemetry / Tracing / Status Page)

**Tier:** Observability & Reliability
**Priority:** 18 of 44
**Depends on:** #4 Containerize Control Plane, #14 Unified Health/Readiness Contract, #16 Centralized Structured Logging
**Estimated effort:** L
**Date:** 2026-05-25
**Summary:** Wire control plane metrics into a Prometheus scrape endpoint, deploy a minimal OTel collector, add distributed tracing to the control plane, and publish a status page aggregating health and alert state.

## What

Stand up a minimal but production-grade monitoring stack for the deployment control plane, hosted on
infrastructure that is deliberately separate from the control plane itself. The work has four
concrete pieces:

**1. Prometheus metrics endpoint on the control-plane service**

Add a `/metrics` HTTP route to the service container. Expose the metric set that the existing
observability layer already computes in
`build-tools/tools/deployments/deployment-control-plane-observability.ts`:

- `queue_depth` — current count of `pending_approval`, `queued`, and `waiting_for_lock` submissions
- `queue_wait_age_ms` — age of the oldest queued submission in milliseconds
- `running_age_ms` — age of the oldest running submission in milliseconds
- `lock_contention_count` — number of lock-conflict rejections
- `failure_count_by_outcome{outcome}` — per-`finalOutcome` failure counter
- `failure_count_by_step{step}` — per-`failedStep` failure counter
- `in_doubt_run_count` — number of currently running (potentially in-doubt) submissions
- `recovered_run_count` — cumulative recovered submission count
- `drifted_stage_count` — number of stage states with `driftStatus = "drifted"`
- `worker_heartbeat_age_seconds{worker_id}` — seconds since each worker's last heartbeat, derived
  from the `worker_heartbeats` table already written by `writeWorkerHeartbeat` in
  `control-plane-process-health.ts`
- `restore_test_status` — 0 or 1 gauge from the resilience backup check

The endpoint must be authenticated or restricted to the monitoring network at the infrastructure
level. It must not include any value that passes through the redaction boundary (no deployment ids
in label values that could expose secret-bearing target names, no raw error text in metric labels).
All label values must be drawn from the same `display_safe` class already defined in
`deployment-control-plane-redaction.ts`.

**2. OpenTelemetry trace instrumentation for worker execution spans**

Add OTLP trace export to the worker process. Each deployment execution should produce a root span
covering the full worker execution from queue claim to final outcome, with child spans for
admitted-artifact verification, provider dispatch, stage-state compare-and-swap, and audit record
write. Span attributes must follow the same redaction rules as the metrics endpoint: no
secret-bearing values in span attributes or events. The `deploymentId` attribute is acceptable only
if deploymentId is established as `display_safe` for tracing purposes (deploymentIds are
structured, not secret). Provider tokens, Infisical credential values, artifact contents, and raw
errors are prohibited from span payloads.

Instrument the service process with a shorter span set: one span per authenticated API request,
carrying HTTP method, route pattern, response status, and correlation/request id. No request body
content, no credential values.

Use the OpenTelemetry SDK for Node.js (`@opentelemetry/sdk-node`) to avoid pulling in a
language-different runtime. Export via OTLP/gRPC or OTLP/HTTP to a collector sidecar or a
collector endpoint configured in the runtime config. The OTLP endpoint must be a non-secret config
value (URL only, no embedded API keys); any collector authentication credentials must use the
file-backed credential contract introduced in PR-1.

**3. Isolated monitoring host**

Deploy Prometheus and an OpenTelemetry collector on a host or cloud project that is separate from
the control-plane host. The control plane must not be the system that monitors itself: if the
control plane is down, the monitoring system must still be reachable and must still be accumulating
evidence. Concretely:

- Prometheus scrapes `/metrics` from the control-plane service on a configured interval (60 s is a
  reasonable starting point).
- The OTel collector receives OTLP from the control-plane service and worker containers and
  forwards spans to a backend (Jaeger, Tempo, or a hosted alternative).
- Alert rules cover the four reviewed alerts already defined in
  `deployment-control-plane-observability.ts`: `repeated_target_failure`,
  `lock_contention`, `in_doubt_runs_present`, and `restore_test_failed`. These map to
  `failure_count_by_outcome{outcome="publish_failed"} >= 2`, the `lock_contention_count` gauge,
  the `in_doubt_run_count` gauge, and the `restore_test_status` gauge respectively.
- Worker heartbeat staleness is a fifth alert: any worker with `worker_heartbeat_age_seconds > 120`
  is considered silent.
- The monitoring stack itself must be deployed through the reviewed control-plane deployment path,
  not hand-applied. Use the Kubernetes or Cloudflare-Containers provider that is established by the
  time this task executes.

**4. Public-facing status page**

Add a minimal status page at a public URL (e.g. `status.the project domain` or similar) that shows
stakeholder-visible health without exposing internal operational detail. The page must show:

- overall control-plane health: up / degraded / down, derived from the Prometheus `restore_test_status`
  gauge and the `/healthz` and `/readyz` endpoints
- worker availability: at least N of M workers have reported a heartbeat in the last two minutes
- last successful deployment: timestamp of the most recent `finalOutcome = "succeeded"` run, with
  no deployment target name or content

The status page must not expose queue depths, failure counts by step, lock contention counts, raw
error text, deployment ids, provider names, or any metric that could leak information about what is
being deployed. It is a stakeholder-level "is the system up" surface, not an operator console.

## Why Now

The control plane processes protected/shared production deployments. Without monitoring, the first
signal of a broken worker, a silent queue, or a failing restore test is a failed deploy noticed by
a developer. The reviewed alert set in `deployment-control-plane-observability.ts` already
specifies what to alert on; this task wires those specifications into a real alerting pipeline.

The dependencies are concrete:

- **#4 Containerize control plane** must land first because `/metrics`, OTLP export, and a stable
  `/healthz` and `/readyz` all require the long-running service and worker process modes introduced
  in PR-4 of that plan. Scraping a one-shot CLI script is not feasible.
- **#14 Health/readiness contract** must land first because the `/healthz` and `/readyz` endpoints
  are the simplest monitoring signals and the status page depends on them as its primary liveness
  source. The `checkControlPlaneReadiness` function in `control-plane-process-health.ts` already
  performs the database and artifact-store checks; `/readyz` must be proven stable before it is
  treated as an alerting source.
- **#16 Centralized structured logging** must land first because traces correlate with log lines via
  trace-id and span-id fields injected into structured logs. Without structured logs there is no
  correlation surface, making traces less useful for incident investigation.

This task blocks #41 autoscaling: autoscaling decisions require `queue_depth` and
`worker_heartbeat_age_seconds` metrics from a running Prometheus instance. It also blocks #43
making viberoots public: a public project should have a public status page before it invites
external users.

The AGENTS.md requirement to "maintain performance baselines and regression detection" applies
here. The `queue_wait_age_ms` and `running_age_ms` metrics, once scraped by Prometheus, serve as
the baseline for detecting worker throughput regressions between releases.

## Risks

**Metric labels leaking deployment context.** The existing observability layer computes metrics
from deployment records that contain deployment ids, provider target identities, and error text.
Prometheus metric labels are effectively public if the `/metrics` endpoint is ever misconfigured.
Labels must be limited to the same `display_safe`-class values the operator view already enforces.
`finalOutcome` and `failedStep` values are enumerated known strings that are safe. Deployment ids
and provider target identities must not appear as metric label values without an explicit reviewed
exception.

**OTLP collector as a new credential surface.** If the OTel collector endpoint requires an API key
or bearer token, that credential must follow the file-backed credential contract from PR-1. If the
collector is on an unauthenticated internal network, the network boundary is the trust boundary,
which must be documented.

**Monitoring host availability.** The isolated monitoring host is itself a service that must be
operated. If it goes down, alerts stop firing. This is a standard bootstrapping problem for
monitoring; the mitigation is to keep the monitoring stack simple enough that it rarely needs
maintenance, and to treat a silent Prometheus as an implicit alert (dead man's switch alerting via
a watchdog).

**Status page availability vs. control plane availability.** If the status page is served by the
same host as the control plane, it will report the control plane as down at the same moment it
becomes unreachable. The status page should be served from the isolated monitoring host or a
separate static hosting surface (Cloudflare Pages is a natural fit) that can be updated by
Prometheus alertmanager webhooks or a lightweight polling process.

## Trade-offs

**prom-client (Node.js) vs. exposing metrics through a sidecar.** The service and worker are Node
processes (TypeScript/zx). Adding `prom-client` as a dependency keeps the metrics close to the
code and avoids a sidecar. The downside is adding a runtime dependency to the control-plane image.
A statsd or OTLP push approach (emit metrics from the application, collect externally) would avoid
adding Prometheus semantics to the service process, but push-based metrics are harder to detect
gaps in (a silent process looks the same as a process emitting zeros). Prometheus pull is the
safer default for the reviewed alert model.

**Jaeger vs. Tempo vs. hosted trace backend.** Jaeger is self-hosted and already in the nixpkgs
ecosystem; Tempo is Grafana's alternative with better Prometheus integration. A hosted backend
(Grafana Cloud, Honeycomb) removes operational burden but adds an external dependency and
potentially transmits span data outside the current trust boundary. For a first implementation,
the decision between self-hosted Jaeger/Tempo and a hosted backend should be made at the point
this task starts, based on what Kubernetes or other reviewed cloud infrastructure is available.
The OTel instrumentation work is backend-agnostic; only the collector configuration changes.

**Status page as a static Cloudflare Pages site vs. a live-query service.** A static page updated
by Prometheus alertmanager webhooks is simpler and more resilient than a page that live-queries
the control plane on every load. The webhook model means status updates have a propagation delay
(up to one alerting interval) but the page remains available even when the control plane is
completely down. This is the right trade-off for a stakeholder-facing status surface.

## Considerations

- The `/metrics` endpoint must be added to the same HTTP server that handles `/healthz` and
  `/readyz` in `nixos-shared-host-control-plane-server.ts`, behind the same authentication guard
  as other protected routes, or restricted at the reverse proxy level to the Prometheus scrape
  source IP. Do not make it publicly reachable without a reviewed access control decision.

- The `readDeploymentControlPlaneObservability` function in
  `deployment-control-plane-observability.ts` reads from the filesystem (`recordsRoot`). For the
  Prometheus endpoint, metrics must come from the live Postgres-backed state (queue table,
  `worker_heartbeats` table, resilience table) rather than from the filesystem records root, which
  may not be the authoritative source in the horizontally scaled runtime introduced by PR-2 and PR-3
  of the containerization plan.

- Worker heartbeats are written to the database by `writeWorkerHeartbeat` in
  `control-plane-process-health.ts` on a regular interval. The `worker_heartbeat_age_seconds` gauge
  in Prometheus must query the `worker_heartbeats` table (`last_seen_at` column) directly, not a
  cached in-memory snapshot, so that a silent worker registers as stale even if the service process
  is healthy.

- The `ControlPlaneRuntimeConfig` type in `control-plane-runtime-config-types.ts` does not
  currently include an `observability` section. Add an `observability` block covering
  `metricsPath` (default `"/metrics"`), `otlpEndpoint` (optional string), and
  `otlpEndpointCredentialFile` (optional path under the credential directory). Keep it optional so
  existing deployments without the new block continue to start without observability.

- The monitoring host is "isolated cloud" in the task title. This means it should be a separate
  Kubernetes namespace, a separate Cloudflare project, or a separate VM from the control-plane
  host, not a sidecar on the same pod or a container on the same NixOS host. The separation must
  survive a control-plane host outage.

- The status page content must be reviewed for redaction before launch. Specifically, the
  "last successful deployment" timestamp must carry no deployment target name, no provider type,
  and no artifact identifier. A plain ISO 8601 timestamp is the maximum acceptable content.

- The four alert rule thresholds from `deployment-control-plane-observability.ts` are the
  starting set. The `restore_test_failed` alert maps to the `restore_test_status` gauge going to 0;
  this assumes the resilience restore test runs on a reviewed schedule and writes its result to the
  database before the next Prometheus scrape.

- Before adding OTLP instrumentation, confirm that the `@opentelemetry/sdk-node` package and its
  transitive dependencies do not embed credential-adjacent code that logs environment variables or
  config at startup. The process environment scrubbing introduced in PR-4 of the containerization
  plan must cover the OTel SDK initialization path.
