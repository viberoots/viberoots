# 19. Common Dead-Letter Queue Strategy

**Tier:** Observability & Reliability
**Priority:** 19 of 44
**Depends on:** #4 Containerize Control Plane
**Estimated effort:** S
**Date:** 2026-05-25
**Summary:** Add a `worker_attempt_count` guard to the Postgres queue so submissions that repeatedly crash workers before writing a terminal state are capped, surfaced as a `dlq_depth` metric, and alertable.

## What

Define and implement a consistent strategy for jobs that permanently fail after exhausting retries,
so they are removed from active queue circulation without being silently dropped.

The question mark in the original task name is intentional: the design decision is whether this repo
needs a formal DLQ mechanism at all, and if so what shape it should take given that the queue
backend is already Postgres (not a message broker). This task resolves that question and, if the
answer is yes, implements the minimum viable version.

**Current state of the queue and retry system:**

- The `queue` table in Postgres is the authoritative work queue. Workers claim rows using
  `FOR UPDATE SKIP LOCKED`, hold a fenced lease renewed by heartbeat
  (`VBR_DEPLOY_CONTROL_PLANE_CLAIM_LEASE_MS`, default 30 s), and call `completed_at` when done.
- `deployment-retry-policy.ts` implements per-step retry limits. `NEVER_AUTO_RETRY` covers
  `validate`, `build`, `resolve`, and `provision`. For auto-retryable steps (`publish`, `smoke`),
  `defaultMaxRetriesForStep` returns 2. The retry classifier distinguishes transient codes
  (`smoke_network_transient`, `smoke_readiness_transient`, `publish_transient_idempotent`) from
  hard failures (`non_retryable_error`, `publish_not_proven_safe`).
- When retries are exhausted the error is re-thrown and the worker writes a `finished` submission
  record with a non-`succeeded` `finalOutcome` (e.g. `publish_failed`, `smoke_failed_after_publish`)
  and sets `completed_at` on the queue row. The run does not re-enter the queue.
- The observability layer (`deployment-control-plane-observability.ts`) already counts
  `failureCountsByOutcome` and `failureCountsByStep` across all finished runs, and emits a
  `repeated_target_failure` alert when `publish_failed` reaches two or more.
- There is no `failed` or `poison` lifecycle state analogous to the `platform_jobs` schema in
  `projects/docs/phase_0_architecture.md`. A permanently failed submission transitions directly to
  `finished` with a non-success `finalOutcome`.

**What is actually missing:**

A job only becomes a queue-blocking problem if it stays in an active lifecycle state
(`queued`, `waiting_for_lock`, `running`, `cancelling`) indefinitely. Today that can happen in one
scenario: a worker crashes mid-execution, leaving the claim lease to expire. A replacement worker
will re-claim it. If that worker also crashes — or if the submission has a corrupt execution
snapshot that panics every worker that touches it — the job circulates forever, consuming worker
cycles and blocking same-lock-scope work.

The existing `repeated_target_failure` alert covers the steady-state failure case (two or more
finished runs). It does not cover the circulating-poison-pill case (a single submission that never
reaches `finished` state because it keeps crashing workers before they can write a terminal record).

**The strategy to implement:**

1. Add a `worker_attempt_count` column to the `queue` table. Increment it atomically in the
   `CLAIM_BACKEND_QUEUED_SUBMISSION_SQL` UPDATE at claim time. This is a single-column addition to
   an existing UPDATE that already sets `claimed_by`, `claim_token`, and `claim_expires_at`.

2. Add a `max_worker_attempts` value (suggested default: 5, configurable via
   `VBR_DEPLOY_CONTROL_PLANE_MAX_WORKER_ATTEMPTS`). After a worker claims a submission, check
   whether `worker_attempt_count` exceeds the limit before dispatching to the provider. If it does,
   write a terminal `finished` submission record with a new `finalOutcome` of `worker_attempt_limit`
   and a `failedStep` of `worker_claim`, and call `markQueueDone`. This removes the job from
   circulation.

3. Add a `worker_attempt_limit` outcome to `NixosSharedHostFinalOutcome` and `failedStep` to the
   dispatch path. Surface it in the observability view and add it to `failureCountsByOutcome`.

4. Add a `dlq_depth` metric to the observability output: count of `finished` submissions where
   `finalOutcome = 'worker_attempt_limit'`. Add a `dlq_depth_nonzero` alert at `warn` severity.

5. Add an operator runbook entry explaining how to inspect DLQ submissions by `submission_id`,
   what each exceeded-attempt scenario means (corrupt snapshot, repeated worker crash, transient
   infrastructure gap), and how to replay or abandon them.

**What this task does not include:**

- A separate `dead_letter` table. The `submissions` table already stores `document_json` with full
  diagnostic context. Moving rows to a second table adds schema complexity without observability
  benefit.
- Message-broker semantics (SQS DLQ, RabbitMQ dead-letter exchange). Postgres is the queue; the
  implementation stays Postgres-native.
- Automatic replay. Replay of DLQ'd submissions is a manual operator action using the existing
  `retry` operation kind, after the underlying cause (corrupt snapshot, infra gap) is resolved.

## Why Now

The queue-starvation scenario becomes production-relevant as soon as the containerized control
plane (task #4) is deployed with multiple worker replicas. In a single-worker setup, a crashing
worker simply stops all progress. With two or more replicas, a crash-looping submission will be
re-claimed by healthy workers, consuming lease cycles and blocking same-lock-scope deploys until
a human notices.

The existing `repeated_target_failure` alert fires on finished runs, not on circulating ones.
Without the attempt counter, there is no automated signal that a submission is stuck in a
crash-reclaimble loop. Operators would have to notice indirectly through `oldestRunningAgeMs`
being anomalously high.

This is also a small schema change that gets harder to retrofit cleanly once the queue table has
live production traffic with multiple replicas. It is substantially easier to add `worker_attempt_count`
during the containerization window than after horizontal scaling is in routine production use.

## Risks

**Attempt limit set too low.** If `max_worker_attempts` is set to a value smaller than the number
of transient infrastructure interruptions a job legitimately survives (e.g. a rolling worker restart
deploys mid-execution), legitimate jobs get DLQ'd prematurely. The default of 5 is intended to be
comfortably above the number of planned worker restarts in a routine deployment window.

**Attempt limit set too high.** A poison-pill submission still consumes worker cycles for every
attempt up to the limit. At `max_worker_attempts = 5` with a 30-second lease, a corrupt snapshot
can hold a worker for up to 2.5 minutes total before being quarantined. This is acceptable given
the typical deployment execution time.

**Attempt counter not incremented atomically.** If the increment is applied outside the `FOR UPDATE
SKIP LOCKED` claim transaction rather than inside the UPDATE statement itself, two concurrent workers
could both read the same pre-increment count and both proceed past the limit check. The
implementation must increment `worker_attempt_count` in the same UPDATE that stamps `claimed_by`,
`claim_token`, and `claim_expires_at`.

**DLQ depth alert ignored.** Adding a `dlq_depth_nonzero` alert only helps if there is an operator
watching the observability surface. This task delivers the mechanism; task #18 (monitoring) is
responsible for routing alerts to a paging channel.

**Schema migration on a live queue table.** Adding `worker_attempt_count` with `DEFAULT 0` and
`NOT NULL` to the `queue` table is a non-blocking DDL on Postgres 11+, but must be confirmed
against the specific Postgres version in use. The column addition must be idempotent in the
migration so it does not break local fixture teardown/setup cycles.

## Trade-offs

**Attempt count in `queue` vs. a separate `worker_executions` log table.** A log table would give
richer per-attempt detail (which worker claimed it, when, what error code) at the cost of a join on
every claim. The `worker_attempt_count` integer is a simpler first implementation that answers the
only operationally critical question — "has this been attempted too many times?" — without schema
complexity. Richer per-attempt logging is a follow-on if incident investigations reveal a need.

**DLQ as a status code vs. DLQ as a physical table.** A separate `dead_letter_queue` table is
idiomatic in message-broker systems but redundant here. The `submissions` table with
`finalOutcome = 'worker_attempt_limit'` is already a queryable, durable DLQ. A physical separate
table would require a write transaction that removes the row from `queue` and inserts into
`dead_letter_queue` atomically, adding failure modes for no observable benefit.

**Automatic replay vs. operator-initiated replay.** Automatic replay after a fixed cooling-off
period would reduce operator burden for transient infrastructure gaps. It is excluded here because
the contract rule is that `retry` and `rollback` must use the recorded admitted secret and
runtime-config references, and automatic replay without operator review risks reusing
now-expired or rotated references. Operator-initiated `retry` is the reviewed path.

## Considerations

**The claim SQL already has the right structure for atomic increment.** The
`CLAIM_BACKEND_QUEUED_SUBMISSION_SQL` UPDATE in `nixos-shared-host-control-plane-backend-queue.ts`
sets three columns in one statement inside a `WITH ... FOR UPDATE SKIP LOCKED` block. Adding
`worker_attempt_count = queue.worker_attempt_count + 1` to that SET clause is a one-line addition
that is naturally atomic.

**The check must happen before provider dispatch, not after.** The attempt-limit check in the
worker loop belongs between `claimBackendQueuedSubmission` returning a claimed row and
`dispatchProviderControlPlaneSubmission` (or `executeCloudflarePagesBackendSubmission`) being
called. This is the correct point in `runNixosSharedHostControlPlaneWorkerOnce` in
`nixos-shared-host-control-plane-worker-loop.ts`.

**`worker_attempt_limit` must be added to `NixosSharedHostFinalOutcome` in `nixos-shared-host-records.ts`.**
The type union currently covers `succeeded`, `aborted`, `provision_failed`, `release_action_failed`,
`publish_failed`, `smoke_failed_nonblocking`, `smoke_failed_after_publish`. The new value is a
control-plane-level outcome (the worker never reached the provider), so `failedStep` should be
`worker_claim` rather than any of the existing provider-level step names.

**The observability doc at `docs/deployment-control-plane-observability.md` must be updated** to
list `dlq_depth` as a metric and `dlq_depth_nonzero` as a reviewed alert alongside the existing
four (`repeated_target_failure`, `lock_contention`, `in_doubt_runs_present`,
`restore_test_failed`).

**The local harness claim SQL variant** (`CLAIM_BACKEND_QUEUED_SUBMISSION_LOCAL_HARNESS_SQL` in
`nixos-shared-host-control-plane-backend-queue.ts`) must receive the same `worker_attempt_count`
increment. Both variants are tested in the existing harness. The harness SQL does not use
`FOR UPDATE SKIP LOCKED`, but the semantics of the increment are identical.

**The `phase_0_architecture.md` schema in `projects/docs/`** uses a `'poison'` status string for
its `platform_jobs` table. That is a separate application-layer queue, not the deployment control
plane queue. Do not import that convention here; the control-plane queue uses `finalOutcome` on the
submission document rather than a status column on the queue row, which is the existing reviewed
pattern.
