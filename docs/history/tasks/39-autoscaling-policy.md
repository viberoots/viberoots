# 41. Autoscaling Policy & Tools

**Tier:** Advanced Capabilities
**Priority:** 41 of 44
**Depends on:** #5 Kubernetes / OpenTofu Deployment, #18 Simple Monitoring
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Define the HPA policy for control plane workers (min 2 replicas, scale on `queue_depth` via KEDA or Prometheus Adapter), implement it as OpenTofu resources in the k8s stack, and set `terminationGracePeriodSeconds` conservatively to avoid mid-execution scale-down.

**Scope note:** This task covers deployment control-plane worker autoscaling. It is not the remote
build/Buck2 RE worker-fleet autoscaling plan; remote build fleet concepts live in
[`../../build-tools/docs/remote-build-setup.md`](../../../build-tools/docs/remote-build-setup.md).

## What

Define and implement autoscaling policy for the deployment control plane worker replicas running on
Kubernetes, and provide operator tooling to observe and tune scaling behavior.

The control plane already supports horizontal scaling by design: as documented in
`docs/control-plane-horizontal-scaling.md`, queue claims are atomic database updates with unique
fencing tokens, provider locks carry fencing tokens, stage-state updates use compare-and-swap
guards, and artifact payloads are exchanged through S3-compatible object storage. No shared POSIX
filesystem is involved in multi-replica coordination. Additional worker replicas are safe to add at
any time — each competing worker will claim queue rows it wins and will lose authority if its lease
expires. The coordination contract is already correct; this task makes replica count track load
automatically rather than requiring operator intervention.

**Worker HPA (Horizontal Pod Autoscaler)**

Define a Kubernetes HPA targeting the worker Deployment. Workers are the throughput bottleneck:
each worker claims one queue item at a time and holds a lease for the duration of execution. Adding
workers increases the number of submissions that can run concurrently. The HPA should:

- Scale on `queue_depth` (the `queueDepth` metric already computed in
  `deployment-control-plane-observability.ts` and exposed as a Prometheus gauge by task #18) as the
  primary scaling signal, using a Prometheus Adapter or KEDA `ScaledObject` to feed the metric into
  the Kubernetes custom-metrics API.
- Keep a minimum of 2 worker replicas at all times, matching the minimum production topology
  documented in `cloud-control-design.md` and the NixOS container module default
  (`workerReplicas = 2` in `deployment-control-plane-container-module.nix`).
- Set a maximum replica count that reflects the Postgres connection limit and Infisical API
  rate-limit budget. Each worker holds at least one Postgres connection for its claim/lease loop;
  the max replica count must be chosen so that worker connection pool usage stays within the
  external Postgres connection limit (Supabase connection pooling, or a PgBouncer layer if the pool
  is not already in place from task #5).
- Apply a cooldown (scale-down stabilization window) long enough to absorb the lease expiry window.
  A dead or slow worker's lease expires on a timer; scaling down before the expired lease is
  released or claimed by another worker would not cause data loss (the fencing token enforces that),
  but unnecessary scale-down/up oscillation wastes cold-start time. A stabilization window of at
  least two lease expiry intervals is a safe starting point.

**Service HPA**

The control-plane service is stateless: sessions are database-backed, idempotency keys are
durable, and the web UI and MCP surfaces require no sticky sessions (established in PR-5 of the
containerization plan). An HPA on the service Deployment based on CPU utilization is appropriate
for handling submit-burst load from CI pipelines. The service HPA is lower priority than the
worker HPA because service replicas handle short HTTP requests while workers handle long-running
provider mutations; service overload manifests as latency spikes, worker undercount manifests as
queue buildup.

**Operator tooling**

Add a documented runbook and, optionally, a CLI subcommand or script that:

- Reports current queue depth, worker count, worker heartbeat ages (from the `worker_heartbeats`
  table), and the HPA's current desired/min/max state.
- Identifies workers that have not reported a heartbeat within the last two heartbeat intervals
  (a silent worker may be consuming a lease without making progress, which blocks that queue slot).
- Allows an operator to manually set the minimum replica count for a maintenance window without
  editing Kubernetes YAML directly.

## Why Now

Priority 39 reflects that autoscaling is an optimization, not a correctness requirement. The
control plane runs correctly with a fixed replica count; autoscaling only reduces the operator
burden of capacity planning and the latency penalty of burst queue depth. Two concrete dependencies
determine the earliest this can happen:

**#5 Kubernetes/OpenTofu Deployment** must land first because the HPA is a Kubernetes object. There
is no HPA until there is a Kubernetes Deployment for the workers to target. The OpenTofu stack
introduced in task #5 is also the natural home for the HPA and Prometheus Adapter/KEDA
`ScaledObject` definitions, since those are cluster-level infrastructure wiring rather than
application code.

**#18 Simple Monitoring** must land first because the only meaningful autoscaling signal is
`queue_depth` scraped from Prometheus. Scaling on raw CPU is a weak proxy for deployment worker
load — a worker executing a fast Cloudflare Pages publish and a worker executing a slow NixOS host
deploy consume very different amounts of CPU for the same queue contribution. `queue_depth` is the
correct signal because it directly measures the backlog that additional workers would drain.
Without a running Prometheus instance scraping `/metrics`, the custom-metrics API has nothing to
feed the HPA.

Worker heartbeat staleness (`worker_heartbeat_age_seconds` from task #18's metric set) is a useful
supplementary signal for detecting silent workers that are leaking lease slots, which is an
autoscaling-adjacent problem.

## Risks

**Max replica count and Postgres connection exhaustion.** Each worker establishes at least one
database connection for its claim loop. If the HPA is configured with a high max without
accounting for the external Postgres connection limit (or the Supabase pooler's session limit),
a spike in queue depth could cause the HPA to add workers faster than Postgres can accept
connections, producing startup failures that make the situation worse. The max replica count must
be explicitly calculated against the known connection budget before the HPA is applied.

**Metric pipeline latency introducing oscillation.** The HPA acts on metrics scraped by Prometheus
and surfaced through the custom-metrics API. Prometheus scrapes on a fixed interval (60 s is the
value from task #18). If queue depth spikes and drains within one scrape interval, the HPA may
never see the spike, or may see a stale high value after the queue has already drained, triggering
unnecessary scale-up. The cooldown and stabilization window must be tuned to absorb this lag. KEDA
supports configurable polling intervals that can be tighter than the Prometheus scrape interval if
needed.

**Scale-down terminating a running worker.** Kubernetes will terminate a pod gracefully when
scaling down. A worker in the middle of a provider mutation (e.g., a Helm upgrade) must complete
or yield its lease before the pod exits. Graceful shutdown handling was introduced in PR-4 of the
containerization plan; the HPA scale-down behavior must be validated to confirm the shutdown signal
reaches the worker before the pod is force-killed, and that the worker's lease is released or
expired before the pod count drops. The pod's `terminationGracePeriodSeconds` must be at least as
long as the maximum expected provider execution time for the workloads being deployed.

**Autoscaling the control plane itself is a trust boundary question.** The HPA is managed by
Kubernetes, which is not a deployment authority (per `cloud-control-design.md`'s non-goals).
Autoscaling must not change the image digest, provider credentials, or reviewed deployment
metadata. It only changes replica count. The Kubernetes deployment must remain pinned by immutable
image digest regardless of how many replicas are running.

## Trade-offs

**KEDA vs. Prometheus Adapter for custom metrics.** Both approaches can surface `queue_depth` to
the Kubernetes HPA. KEDA provides a higher-level `ScaledObject` abstraction with built-in
Prometheus source support, configurable polling intervals, and a scale-to-zero capability that the
Prometheus Adapter does not offer. Scale-to-zero is not appropriate for the worker (minimum 2
replicas is required by the horizontal scaling contract), but KEDA's tighter polling interval is
useful for reducing metric lag. The Prometheus Adapter is simpler and requires fewer cluster-level
components. The choice should match whatever is already installed in the Kubernetes cluster used by
task #5; do not install both.

**Scale-to-zero for non-production workers.** In a dedicated staging cluster or non-production
environment, scaling workers to zero during idle periods would reduce cost. Scale-to-zero is
incompatible with the minimum-2-replica requirement for `production_facing` deployments. A
separate HPA policy for staging (minimum 0, scale up on first queue item) versus production
(minimum 2 always) is a valid approach and could be parameterized in the OpenTofu stack
introduced by task #5.

**`queue_depth` as the sole signal vs. composite.** `queue_wait_age_ms` (age of the oldest queued
submission) is a richer signal than raw `queue_depth` for detecting when the queue is stuck rather
than simply deep. A submission that has been queued for ten minutes with one worker available is a
different situation from ten submissions queued with ten workers available. A composite HPA trigger
(scale up if `queue_depth > N` OR `oldest_queued_age_ms > T`) better addresses the stuck-worker
scenario, but KEDA and the Prometheus Adapter both require a single numeric metric per scaler. The
simplest correct first policy is `queue_depth` with the `oldest_queued_age_ms > T` alert from task
#18 as a human escalation path for the stuck-worker case.

## Considerations

- The HPA and any KEDA `ScaledObject` or Prometheus Adapter configuration should live in the
  OpenTofu stack introduced by task #5, not as separately hand-applied Kubernetes YAML. They are
  cluster infrastructure wiring, not application code, and must go through the reviewed
  `maybeRunOpenTofuReviewedApply` path to be admitted.

- The minimum replica count of 2 is not an autoscaling policy decision — it is a constraint from
  the horizontal scaling design. If a single worker holds a lease and the pod is terminated (node
  failure, eviction), a second worker must already be available to claim the expired lease without
  waiting for the HPA to react. The HPA's `minReplicas` must be at least 2 for the worker
  Deployment in all production-class environments.

- Worker heartbeat ages from the `worker_heartbeats` table are already computed and available as
  `worker_heartbeat_age_seconds{worker_id}` in the metric set defined by task #18. An HPA or
  KEDA trigger can use these to detect silent workers, but the simpler operational path is to
  treat a silent-worker alert as a signal to investigate rather than to automatically add replicas.
  Automatically adding replicas when a worker is silent may mask a lease-leak bug in the worker
  implementation.

- The `terminationGracePeriodSeconds` on the worker pod must be long enough for a worker to
  complete graceful shutdown after receiving SIGTERM. PR-4 of the containerization plan introduced
  graceful shutdown handling; the HPA scale-down path exercises the same code. Validate that the
  pod's grace period is not shorter than the worst-case provider execution time in the test
  environment before enabling autoscaling in production.

- The Postgres connection budget calculation should account for: service replicas (each holds a
  small connection pool for submit and read APIs), worker replicas (each holds at least one
  connection for claim/lease/heartbeat), and any monitoring queries run by Prometheus against the
  database. If Supabase is the Postgres backend, check the session limit for the selected plan
  before setting the HPA max. If a PgBouncer layer is in place from task #5, the max can be set
  higher since PgBouncer multiplexes application connections over fewer server connections.

- The operator tooling for reporting queue depth, worker count, and heartbeat ages can be a thin
  wrapper over the Prometheus API and the `worker_heartbeats` table query already used by the
  `/metrics` endpoint. It does not need to be a new CLI command if a pre-built Prometheus query or
  Grafana dashboard (from task #18) already surfaces the same information; the runbook can point to
  those queries directly.
