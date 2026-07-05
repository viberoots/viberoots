# Deployment Control Plane Horizontal Scaling

The containerized control plane treats service and worker containers as stateless replicas. Durable
coordination lives in the control-plane database; mounted volumes are only scratch, credential, and
local fixture surfaces.

## Coordination Contract

- Service submit and run-action requests use durable idempotency keys. Duplicate requests with the
  same payload return the original durable target; payload drift for the same key fails closed.
- Worker queue claims are atomic database updates. Each claim receives a unique token and a lease
  expiry.
- Only the worker that still owns the current claim token can renew a lease or finalize state.
  Expired leases, changed claim tokens, completed queue rows, and terminal/superseded submissions
  revoke worker authority.
- Provider locks are scoped by deployment/provider target and carry fencing tokens. A worker must
  still own the fenced lock before mutating provider state and before committing final durable
  records.
- Stage-state updates support compare-and-swap expected-run guards for mutation paths that need to
  prove they are updating the durable state they reviewed.
- Retry and recovery read submission, snapshot, deploy-record, and stage-state facts from the
  durable backend. Worker-local temporary directories are mirrors for execution, not authority.
- Artifact payloads and execution snapshots are exchanged through S3-compatible object storage.
  Database rows store object keys, digests, sizes, content types, provenance, and admitted run
  metadata; workers use direct key reads and recorded digests rather than object listing.
- Audit rows are database-backed and include request id, actor or service principal, operation,
  idempotency key when present, deployment id, result, and a redacted non-secret failure summary.

## Operator Notes

Run at least two worker replicas only against the same database and artifact store. A dead worker is
replaced after its queue lease expires; operators should inspect the queue row and audit events
before forcing recovery. Stuck submissions should be recovered by durable submission id or deploy
run id, not by deleting worker-local scratch files.

The intended minimum production topology is one service replica and two worker replicas. Additional
service replicas remain stateless as long as they use the same database and object store. Additional
workers are safe because queue claims, leases, provider locks, stage state, audit, and heartbeat rows
are all database-backed.

Use `/healthz` for process liveness and `/readyz` for dependency readiness. A ready service has
database connectivity, artifact-store metadata-read connectivity, and can read worker heartbeat
state. Worker heartbeat rows are advisory for operators; queue leases and fencing tokens remain the
mutation authority.

`GET /api/v1/worker-heartbeats` remains the direct authenticated runtime probe for worker heartbeat
evidence. The response uses `control-plane-worker-heartbeat-probe@1` and contains secret-safe
`control-plane-worker-evidence@1` entries with worker id, control-plane association, supported
execution modes, health, and any existing claim links to deploy runs and execution snapshots.
Status output is diagnostic only: `authorizesWork` is always false, and mutation still requires the
current queue claim, live lease, and provider fencing token.

WorkerPool remains deferred. The checked decision record
`build-tools/tools/deployments/resource-graph-worker-pool-decision.fixture.json` must use
`resource-graph-worker-pool-decision@1`, choose only `defer`, `needs-more-evidence`, or
`propose-worker-pool`, and name the evidence inputs used. `propose-worker-pool` is valid only for a
concrete workflow class such as remote builds, deployment-worker capacity, customer-hosted
execution, or regulated placement, with supporting evidence named in the inputs. The decision record
does not authorize scheduler work.

If a host uses local fixture mode, file-backed mirrors and local locks are test conveniences only.
Production container profiles must use the database-backed queue, locks, idempotency, stage-state,
audit, and artifact records.

## Managed Postgres Conformance

External Postgres backends must pass the startup conformance check before schema initialization. The
check uses temporary table data only and verifies the SQL features the control plane relies on:

- Postgres 12 or newer via `server_version_num`.
- `jsonb` payload storage and `jsonb_build_object`.
- common table expressions with `UPDATE ... RETURNING`.
- atomic queue-claim shape with `FOR UPDATE SKIP LOCKED`.
- idempotent write shape with `INSERT ... ON CONFLICT`.

The default fixture suite covers this contract without live credentials. To run the optional live
check against a throwaway managed database, set both values below; do not point them at production:

```bash
VBR_CONTROL_PLANE_LIVE_POSTGRES_CONFORMANCE=1 \
VBR_CONTROL_PLANE_LIVE_POSTGRES_DATABASE_URL='postgres://...' \
v //build-tools/tools/tests/deployments:control-plane-coordination-hardening
```
