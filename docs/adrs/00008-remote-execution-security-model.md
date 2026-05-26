# ADR-00008: Remote Execution Security Model

**Status:** Accepted
**Date:** 2026-05-25
**Authors:** viberoots team

## Context

viberoots deploys to protected and shared environments (`shared_nonprod`, `production_facing`) through a shared deployment control plane. Without an explicit security model, the following risks arise:

- A developer workstation checkout or mutable branch could silently substitute for a reviewed source revision at publish time.
- CI could submit stale or unreviewed artifacts and have them accepted as if they were the product of an admitted pipeline run.
- Credentials required for publication could leak into deploy records, logs, or OCI image layers.
- A rollback could be executed by moving a Git branch backward or retagging a provider artifact, bypassing audit history.
- Preview deployments could inadvertently target production namespaces by inheriting ambient provider defaults.
- A lapse in control-plane availability could provide a pretext for routine unreviewed direct mutation.

This ADR records the decisions that define the security properties of remote execution and the boundaries of what each actor is permitted to do.

## Decision

### Admission-first execution

Every protected or shared mutating run freezes an immutable execution snapshot at admission before any waiting, locking, or mutation occurs. Admission is two-stage:

1. **Source admission** — determines the admissible revision and trusted artifact inputs by fetching the reviewed source ref from the configured SCM remote into a submission-scoped ref.
2. **Target-environment run admission** — freezes the execution snapshot for the mutating publish run against the intended target environment.

Later execution revalidates only narrow current invariants. It does not silently consume drifted repo state or drifted provider configuration.

### Source revision binding

The admitted `sourceRevision` is bound to the commit fetched during source admission from the SCM remote, not to an operator workstation checkout or a mutable long-lived local branch. When a client supplies an expected reviewed commit, the control plane compares it against its own freshly snapshotted source ref and fails closed if they differ.

### CI identity requirements

Jenkins and other CI submitters must provide admission evidence that binds:

- Reviewed source revision
- Trusted check results
- Builder identity
- Immutable artifact identity or a retained artifact reference
- Optional SBOM, signature, and provenance references
- Stable idempotency key

Mutable image tags and laptop-local artifact paths are not valid artifact identities for protected or shared CI submissions. CI may build, attest, and submit; it is not a peer mutating authority.

### Artifact immutability

The protected or shared mutating publish phase must consume an admitted immutable artifact. `--source-run-id` selects an earlier admitted run for artifact or source revision reuse; it does not authorize workstation builds or ad hoc mutating rebuilds. `--publish-only` means exact-artifact reuse or delayed exact-artifact publish, never implicit rebuild. Admitted artifacts are stored in control-plane-managed S3-compatible artifact storage.

### Fenced execution

Workers execute provider-specific publish operations with credentials mounted as files. No credentials — Infisical access tokens, Universal Auth client secrets, provider API keys, database URLs, or Vault tokens — may be persisted in deployment records, logs, or diagnostics. No credentials are baked into OCI image layers. All service and worker containers run as non-root users.

### Provider lock and idempotency

Postgres is the authoritative backend for the queue, locks, worker ownership, idempotency, and deploy records. Stage state transitions use compare-and-swap in the same backend transaction as the deploy record. Duplicate-run protection is enforced via stable idempotency keys submitted by CI.

### Preview isolation

Preview deployments must use explicit preview identity selectors. Implementations must not infer preview identity from ambient git state, the current branch name, or provider defaults. A preview publish targets only an explicitly isolated preview target.

### Rollback security

Rollback requires an explicit `--source-run-id` selecting a prior admitted run. Rollback candidates are derived from backend stage history, not from Git refs, mutable provider tags, or release-pointer files. Rolling back by moving a branch backward, editing a release-pointer JSON file, or retagging a provider artifact is out of policy.

### No developer laptop authority for protected or shared targets

Developer laptops do not hold provider, database, artifact-store, Infisical workload, or reviewed-source credentials for protected or shared deployments. A missing `--control-plane-url` for a protected or shared target is a fail-closed configuration error. Mixing the service-routed path with local-only flags (`--records-root`, `--control-plane-database-url`) is out of contract.

### Break-glass

Direct local mutation of protected or shared targets is out of policy except for an explicitly documented, incident-bounded break-glass procedure covering control-plane unavailability. Bootstrap mutation of the deployment authority itself is permitted only through an explicit reviewed bootstrap path on deployment-system-owned infrastructure.

## Consequences

### Positive

- Reviewed source revisions and admitted artifacts cannot be silently substituted by a workstation checkout or a rebuilt image at publish time.
- Credential material is confined to mounted runtime secrets and never appears in records, logs, OCI layers, or diagnostics.
- Rollback history is derived from the backend audit trail, making it tamper-evident and independent of Git ref state.
- Preview deployments are structurally isolated from production-facing targets; the isolation cannot be bypassed by provider-default behavior.
- Duplicate or replayed CI submissions are rejected via idempotency key comparison before any mutation occurs.
- The control plane is the sole mutating authority for protected and shared targets; CI and developer tooling are admission clients, not peers.

### Trade-offs

- Admission-first snapshotting adds latency before a mutating run begins; fast-path optimizations must not weaken the admission invariant.
- CI pipelines must produce and submit immutable artifact references; mutable tag workflows require migration before they are eligible for protected or shared targets.
- Developer iteration on protected or shared targets requires a functioning control plane; there is no sanctioned local fallback path outside the break-glass procedure.
- The two-stage admission model requires coordination between source admission state and target-environment run admission; partial admission state must be surfaced and recoverable rather than silently retried with new state.

### Obligations

- The control plane service must enforce source-revision comparison and fail closed on mismatch before proceeding to any locking or mutation step.
- Every protected or shared worker implementation must mount credentials as runtime files and must not write them to any persistent store, log sink, or response body.
- Break-glass activations must be documented with incident scope and time bounds before any direct mutation is performed.
- The CI integration layer must generate and submit a stable idempotency key per run and must not reuse keys across distinct build inputs.
- Preview selector logic must be implemented as an explicit configuration requirement with no ambient-state fallback.
- Rollback tooling must resolve candidates exclusively from backend stage history and must reject any request that references a Git ref or provider tag as a rollback target.
