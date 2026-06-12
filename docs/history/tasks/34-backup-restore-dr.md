# 37. Validated Backup/Restore/Disaster Recovery Procedures

**Tier:** Security Hardening
**Priority:** 37 of 44
**Depends on:** #4 Containerize Control Plane, #5 Kubernetes / OpenTofu Deployment, #30 Migration/Versioning Conventions
**Estimated effort:** L
**Date:** 2026-05-25
**Summary:** Write and validate runbooks for Postgres PITR, S3 object replication, and Infisical credential backup against defined resilience targets, with restoration drills that include running a fixture deployment through the restored state.

## What

Implement, document, and regularly exercise backup, restore, and disaster recovery procedures for
all authoritative viberoots control-plane state. "Validated" means restore has been performed
against real data, not just documented as a plan.

**State surfaces that must be covered:**

- **Postgres (primary):** The Postgres database is the single authoritative store for queue claims
  and leases, provider locks and fencing tokens, idempotency keys, worker heartbeats, deployment
  submissions and records, stage state (keyed by deployment id and `environment_stage`), stage
  history, audit rows, and approval evidence. If Postgres is lost without a valid restore, the
  current deployed state of every `shared_nonprod` and `production_facing` deployment is unknown.
- **S3-compatible artifact store (secondary):** Admitted artifact payloads and execution-snapshot
  payloads live here, keyed by immutable object key. Artifact metadata, digests, and provenance are
  in Postgres. If S3 objects are lost, immutable-reuse flows (`retry`, `rollback`, `publish-only`,
  `same_artifact` lane promotion) cannot execute because workers verify digest/provenance from
  stored keys before execution.
- **Infisical/Infisical deployment secrets:** Deployment secret values (Cloudflare API tokens, database
  URLs, provider credentials) live in Infisical KV v2 under the
  `secret://deployments/<family>/<contract>` path convention. The unseal key shares and initial root
  token are the only time Infisical prints these; they require separate escrow. Infisical Universal Auth
  client ids and secrets are file-backed per deployment and require their own rotation and
  backup posture.
- **Identity provider state:** The Keycloak `deployments` realm configuration (realm definition,
  clients, mappers, group shape, membership) is the authorization source for deployer, approver,
  and admission reporter grants. The reviewed `deployment-auth-realm.json` and
  `deployment-auth-memberships.json` artifacts are generated from deployment metadata but persist
  in the Keycloak database. If that database is lost, all human deploy sessions and cross-grant
  mappings must be re-bootstrapped.

**Minimum recovery objectives (from `deployments-contract.md`):**

- `shared_nonprod`: RPO 4h, RTO 8h, admitted-artifact retention 30d, record retention 180d,
  restore-test cadence quarterly.
- `production_facing`: RPO 15m, RTO 1h, admitted-artifact retention 180d, record retention 365d,
  restore-test cadence monthly.

These are contractual floor values — the control plane must not operate below them without a
reviewed design update.

**What "validated" requires specifically:**

1. Postgres PITR (point-in-time recovery) enabled and tested by restoring to a non-production
   target, running a fixture deployment through the restored database, and confirming stage state,
   audit rows, and queue behavior match expectations.
2. S3 object versioning or cross-region replication enabled and tested by listing and reading back
   a fixture artifact from a restored or replicated bucket.
3. Infisical credential recovery key shares verified in escrow — not just stored, but confirmed readable and
   sufficient to unseal a fresh Infisical node.
4. Break-glass Infisical reseal/unseal procedure documented and exercised on a non-production Infisical
   instance.
5. Restore runbooks executed, not just written. At least one full DR drill per tier per the cadence
   above.
6. Recovery objectives measured against actual restore timing from each drill.

## Why Now

The control plane must not reach production scale while backup and recovery remain untested
documentation. The contract (`deployments-contract.md`) is explicit: the authoritative
protected/shared control plane must have explicit reviewed backup, restore-test, and recovery
objectives. Break-glass is an emergency exception path, not the normal resilience model for routine
outages.

The specific timing driver: #30 (migration/versioning conventions) establishes schema versioning
semantics that are required for safe Postgres restore. Without a known schema version at restore
time, a PITR restore could land a database at a schema revision that the current binary does not
match, producing silent correctness failures. #4 (containerize) and #5 (Kubernetes/OpenTofu)
establish the infrastructure against which backup jobs, S3 replication policy, and monitoring can
actually be configured and verified. Running drills against ephemeral local state is not equivalent.

This task blocks #43 (make viberoots public) because:

- A publicly visible deployment authority with no validated recovery posture is an operational
  liability.
- Any public consumer of the deploy CLI or control plane API needs assurance that the run record
  and stage state behind their deployments is durably maintained.

## Risks

**Postgres restore lands at the wrong schema version.** If PITR drops the database to a point
before a migration that the current binary expects, startup will succeed but behavior will be
wrong. Schema version checking at startup (from #30) is the mitigation; this task must verify that
the restored database and the binary agree on schema version before declaring the drill successful.

**Audit rows are irrecoverable within the RPO gap.** A 15-minute RPO for `production_facing` means
up to 15 minutes of audit events are lost in the worst case. This is acceptable by the contract
floor but must be documented. Operators invoking post-incident forensics must know the precise
window of potential audit loss.

**Infisical quorum loss.** Infisical uses Raft storage with 5 key shares and a threshold of 3. If the
unseal key shares are not distributed across independent escrow locations, a single physical loss
event could prevent unsealing. The credential bootstrap runbook describes the intended escrowing model
but does not specify where shares are stored. An untested escrow is not a working escrow.

**In-doubt runs at restore time.** If the Postgres restore lands mid-flight — during a deploy run
where the worker has already performed provider-side mutation but the authoritative record is not
yet finalized — the restored state will show the run as in-flight with no terminal record. The
in-doubt recovery path (reconcile provider state before blind retry) must be explicitly exercised
during DR drills, not just documented. Without this, a DR scenario involving an active deployment
risks a duplicate mutation when workers restart against the restored database.

**S3 key loss is not recoverable from Postgres alone.** Postgres holds artifact metadata, digest,
size, content type, and provenance. The actual payload bytes live only in S3. Deleting or
corrupting S3 objects while the Postgres record remains intact breaks `retry`, `rollback`,
`publish-only`, and `same_artifact` promotion for any run whose artifact was in the deleted range.
Versioning or replication must protect the object store independently of the database backup.

**Secret rotation races a restore.** If Infisical KV paths are rotated after a PITR snapshot but
before the backup is taken, restoring Postgres to the snapshot and replaying secrets from Infisical
will resolve the wrong version for any retry or rollback of a run that referenced the pre-rotation
secret reference. The `deployments-contract.md` rule is explicit: retry and rollback must fail
closed when admitted secret references have been deleted or revoked. This must be tested as part of
the restore drill.

## Trade-offs

**Managed Postgres PITR vs. self-managed WAL archiving.** Supabase Postgres (the candidate backend
from `cloud-control-design.md`) provides PITR through its managed service. This is operationally
simpler but means the backup posture is partially dependent on Supabase's own retention and
recovery capabilities. If the RPO/RTO contract cannot be satisfied by Supabase PITR's defaults,
either a higher-tier Supabase plan or supplemental WAL archiving to an independent bucket is
required. The decision must be made explicitly and documented; assuming Supabase defaults meet the
contract without verification is not acceptable.

**Drill frequency vs. operational burden.** Monthly full restore drills for `production_facing` and
quarterly for `shared_nonprod` are non-trivial. Each drill requires standing up a restored database,
confirming schema version, running fixture deployments against it, reconciling any in-doubt runs,
and measuring elapsed time against the RTO target. Automating the drill reduces the burden but adds
infrastructure complexity. A partially automated drill (snapshot restore to a non-production
environment via IaC, manual verification of stage state and audit rows) is a reasonable first
implementation.

**Infisical HA vs. single-node Infisical.** The current Infisical deployment is a single NixOS node using Raft
storage at the Infisical data directory. A single-node Infisical cannot survive host loss without a restore
operation. Adding a second Infisical node (raft join) would make unsealing survivable across one node
failure but adds operational complexity. The trade-off must be made explicitly before
production-facing deployments rely on Infisical as the secret source of truth.

**Identity provider recovery as manual bootstrap vs. automated.** The `infisical-production-bootstrap.md`
runbook documents the `deploy admin identity sync` path to reconcile Keycloak realm state from
generated artifacts. This is not a push-button restore; it requires an operator with admin access
to a running Keycloak instance. Automating this as a DR procedure requires a tested runbook
(not just the existing documentation) and a non-production Keycloak target against which to
exercise it.

## Considerations

**Postgres is the single source of truth for deployed state.** The `deployments-contract.md`
explicitly prohibits treating Git release-pointer JSON, mutable provider tags, or container-local
writable layers as authoritative deployment state. `GET /api/v1/current-stage-state` and
`GET /api/v1/stage-history` are the operator surfaces for current deployed stage. If Postgres is
unrecoverable, there is no canonical fallback for determining what is currently deployed. This is
not a documentation gap — it is a design invariant that makes database backup non-negotiable.

**Schema versioning from #30 is a gate for safe restore.** A PITR restore puts the database at a
point-in-time schema state. Without schema version awareness at startup, the control-plane binary
may apply pending migrations on top of an already-migrated or partially-migrated database. #30's
migration conventions are required so that restore drills can confirm "binary X started against
schema version Y" as part of drill success criteria.

**Artifact retention minimums are contractual, not advisory.** Admitted-artifact retention of 30d
for `shared_nonprod` and 180d for `production_facing` is the floor from `deployments-contract.md`.
S3 lifecycle rules must be configured to enforce these minimums. Versioning alone is insufficient
if the lifecycle rule deletes non-current versions before the retention window expires. The
retention policy and the lifecycle rule must be documented together and verified during drills.

**Infisical credential recovery key escrow must be split.** The bootstrap runbook specifies 5 shares with a
threshold of 3. The current escrow location for those shares is not specified in the reviewed
documentation. Before this task is considered complete, each share must be in an independently
accessible, reviewed location (e.g., separate operator custody, hardware security tokens, or a
secrets manager separate from Infisical itself), and a quorum must be confirmed readable in a
non-production unseal drill.

**Break-glass mutation must be in policy before a DR event, not invented during one.** The
`deployments-contract.md` requires that break-glass mutation use explicit incident-bounded
authorization, produce structured emergency evidence, and reconcile back into authoritative records
once the normal control plane is available. If break-glass procedures are not documented and
exercised before a DR event, operators will either be blocked from acting or will act outside
policy. This task must produce a reviewed break-glass runbook alongside the backup runbooks.

**In-doubt run recovery is part of DR.** The control plane contract requires one reviewed in-doubt
recovery path for failures after provider-side mutation may have begun but before the authoritative
run record is finalized. A database restore drops the system into exactly this state for any run
that was in-flight at the RPO boundary. DR drills must simulate at least one in-doubt run and
confirm that the recovery path (provider-state reconciliation before retry) produces a correct
terminal record rather than a duplicate mutation.

**Monitoring and alerting must cover backup failure, not just service failure.** The observability
task (#18) focuses on service health and deployment metrics. Backup procedures need their own alert
surface: failed backup job, PITR window shorter than RPO, S3 replication lag exceeding RPO,
Infisical sealed or unreachable. These alerts are distinct from deployment-run health and must be
owned by this task, not assumed to fall out of general monitoring.
