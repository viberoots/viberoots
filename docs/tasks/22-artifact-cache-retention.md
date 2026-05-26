# 26. Artifact Cache / Retention Tools and Policy

**Tier:** Developer Experience
**Priority:** 26 of 44
**Depends on:** #4 Containerize Control Plane
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Implement a batch GC command applying the existing per-run retention eligibility functions across all artifact objects, add `deleteObject` to the store interface, and sweep expired upload sessions whose S3 objects were never admitted.

## What

Implement the operator-facing tools and enforcement logic that govern how long admitted deployment
artifacts are retained in the S3-compatible artifact store, and when they may be safely evicted.

The retention policy is already defined in `docs/deployments-contract.md` and
`docs/deployments-design.md`, and the per-run eligibility check already exists in
`build-tools/tools/deployments/deployment-control-plane-retention.ts`. What does not yet exist is
the operational layer that acts on those checks at scale:

- **A retention-inspection CLI command** — given a deploy run id and protection class, emit a
  structured JSON report using `inspectProtectedSharedRetention`. The command should surface
  `artifactRetentionDeadline`, `recordRetentionDeadline`, `replayBundleComplete`, `replayUsable`,
  `deletionAllowed`, and any `missingPaths` or `failures`.

- **An eviction/GC command** — enumerate admitted artifact objects from the `artifact_objects`
  Postgres table, cross-reference with `deploy_records` and `current_stage_state`, invoke
  `assertProtectedSharedDeletionAllowed`, and delete from the S3-compatible store only runs where
  both the artifact retention window and the record retention window have elapsed. Eviction must be
  a two-phase operation: compute eligible candidates first, write a dry-run report, then delete only
  after explicit operator confirmation or a `--yes` flag. Eviction must be scoped per protection
  class: `shared_nonprod` artifacts become eligible after 30 days; `production_facing` artifacts
  after 180 days. Authoritative records must not be deleted below 180 days and 365 days respectively.

- **A staged-upload session sweeper** — the `static_webapp_upload_sessions` table already stores an
  `expires_at` column. A periodic task (or CLI subcommand) should delete expired sessions and, for
  any whose `archiveObject` was written to S3 but never admitted, issue the corresponding S3 delete.
  The `artifact_cleanup_janitor_records` table (capped at 100 rows) already records failed staged
  cleanup attempts that the sweeper should also retry.

- **A retention policy enforcement gate** — before a rollback or replay flow resolves an artifact
  reference, the worker path must call `assertProtectedSharedReplayUsable` and surface a clear
  operator-visible error when the artifact window has expired, rather than silently attempting to
  rebuild or re-fetch. This gate is partially implemented but must be wired into every immutable
  artifact reuse path (rollback, retry, `--publish-only`, and promotion for `same_artifact` lanes)
  in the worker dispatch code.

The scope of "artifact cache" does not include Buck2 remote cache or Nix store management. Those
systems govern intermediate build outputs and are distinct from the admitted deployment artifact
store. The `docs/deployments-design.md` is explicit that upstream caches are not the retention
authority for promotion, retry, rollback, or historical rebuild guarantees; the artifact/provenance
store is.

## Why Now

The S3-compatible artifact store has no eviction path. Every admitted run writes objects under
keys of the form `control-plane/artifact/sha256/<hex>/provenance/<provenance-hash>` and
`control-plane/execution-snapshot/sha256/<hex>/provenance/<provenance-hash>`. The `artifact_objects`
table records every write but there is no read path that enumerates candidates for deletion, and
the `ControlPlaneArtifactStore` interface exposes only `putObject`, `getObject`, and
`getObjectMetadata` — no `listObjects` or `deleteObject`. At production scale every CI run, every
client upload session, and every build produces retained objects that accumulate indefinitely.

The retention logic in `deployment-control-plane-retention.ts` computes correct deadlines and the
`deletionAllowed` flag, but nothing calls `assertProtectedSharedDeletionAllowed` in a batch
context. The enforcement gate `assertProtectedSharedReplayUsable` exists but is not consistently
wired into all worker reuse paths. Until both gaps are closed, the contract guarantee ("must retain
for at least the documented minimum retention window") cannot be verified, and the corollary ("may
evict after that window") cannot be acted on.

This task is also a prerequisite for meaningful backup and DR testing (task #37): a restore
validation run that checks `retainedArtifactEvidence` references against a restored snapshot is
only trustworthy if the S3 object set is managed against a known policy rather than accumulating
unboundedly.

## Risks

**Evicting a rollback candidate.** The eviction logic must not delete an object that is still
referenced by a row in `current_stage_state` or `stage_state_history` for any deployment where
`finalOutcome = "succeeded"` and the run is still within the rollback candidate window. The
`rollbackStageStateErrors` function resolves candidates from `readBackendStageHistory`; the GC
command must query that same history table and exclude any run where the artifact identity maps to
an object that is still a live candidate. A bug here permanently breaks rollback for the affected
target.

**Missing `deleteObject` on the store interface.** `ControlPlaneArtifactStore` has no delete
operation. Adding one requires updating the `createS3CompatibleArtifactStore` implementation, the
store type, and the `assertProductionArtifactStore` guard. The implementation must use the same
AWS Signature Version 4 path already implemented for PUT, GET, and HEAD — but DELETE must be
exercised with a fixture test before it is used in a GC path.

**Object-key to artifact identity mapping.** Keys are content-addressed and provenance-tagged. A
single artifact content digest may have multiple object keys (one per unique provenance JSON
fingerprint, e.g., different `submissionId` values for the same content). The GC command must
enumerate by run eligibility derived from `deploy_records` and then resolve object keys through
`artifact_objects`, not by iterating S3 directly. Iterating S3 directly would require listing
support that is not in the current interface and risks matching shared-content keys that belong to
an eligible run for one deployment but are still needed by a non-eligible run for another.

**Staged upload sessions that were never admitted.** Upload sessions stored by
`createStaticWebappUploadSession` write an `archiveObject` to S3 immediately on creation (30-minute
TTL). If the final submit is rejected or never arrives, the object is stranded. The
`artifact_cleanup_janitor_records` table handles the filesystem-backed case; the object-store-backed
case is not yet covered by any sweeper.

**Protection-class misclassification.** The `ProtectedDeploymentClass` is currently inferred from
deployment metadata at eviction time. If the protection class recorded at admission time is not
persisted on `deploy_records`, an operator who later changes a deployment's classification could
inadvertently evict artifacts that should have been retained longer. The eviction logic must anchor
to the protection class at admission, not at eviction time.

## Trade-offs

**Dry-run-first vs. auto-delete on schedule.** A scheduled automatic GC that auto-deletes without
a dry-run review window is operationally simpler but leaves no recovery window for a policy bug.
Given the correctness risks above, the first implementation should be operator-triggered with an
explicit dry-run report that must be reviewed before `--yes` is passed. Automation can be added
once the dry-run output has been validated against real data in production.

**Batch GC vs. run-at-completion GC.** An alternative design would mark each run as eligible for
deletion when its window elapses and delete incrementally. This avoids large batch operations but
requires a background job per run and complicates the state machine. Batch GC at operator-selected
cadence is simpler and maps directly to the existing `inspectProtectedSharedRetention` inspection
shape.

**Deleting S3 objects vs. tombstoning.** Hard-deleting from S3 is irreversible. Tombstoning (marking
as eligible in Postgres and deleting after a second confirmation pass) adds a recovery window at the
cost of maintaining a new column on `artifact_objects`. For v1, hard-delete after the confirmed dry-
run report is acceptable; tombstoning is a future hardening option.

**Extending `ControlPlaneArtifactStore` vs. a separate admin client.** Adding `deleteObject` and
`listObjects` to the current interface widens the surface that all callers share. An alternative is
a separate `ControlPlaneArtifactStoreAdmin` interface used only by the GC command. This keeps the
production mutation paths narrower and avoids accidental deletion from worker code. The admin
interface approach is preferred.

## Considerations

**`inspectProtectedSharedRetention` is already correct.** The retention check logic, deadline
arithmetic, `deletionAllowed` flag, and bundle completeness check are implemented and tested. The GC
command should call this function rather than reimplement any deadline math. The resilience policy
constants in `deployment-control-plane-resilience-policy.ts` (`minimumArtifactRetentionDays: 30`
for `shared_nonprod`, `180` for `production_facing`; `minimumRecordRetentionDays: 180` and `365`)
are the single source of truth and must not be duplicated.

**The `artifact_objects` table is the GC inventory.** Every object written through
`putVerifiedArtifactObject` or `putImmutableArtifactObject` records a row in `artifact_objects`.
The GC command should start from this table, join against `deploy_records` by
`provenance_json->>submissionId` or `artifactIdentity`, and compute eligibility per run via
`inspectProtectedSharedRetention`. Objects whose `provenance_json` carries no `deploymentId`
(e.g., staged upload objects that were never admitted) should be handled by the upload session
sweeper using the `expires_at` column on `static_webapp_upload_sessions`.

**The enforcement gate must be fail-closed.** `assertProtectedSharedReplayUsable` raises on
expired or incomplete bundles. Every worker path that resolves an artifact for rollback, retry, or
`--publish-only` must call this before loading the artifact bytes, and the resulting error must
propagate as a terminal run failure with a `no_longer_admitted` termination reason, not a generic
infrastructure error.

**Upload session TTL is already 30 minutes.** The constant `UPLOAD_SESSION_TTL_MS = 30 * 60 * 1000`
in `static-webapp-upload-sessions.ts` and the `expires_at` column on `static_webapp_upload_sessions`
are already in place. The sweeper only needs to query `WHERE expires_at < NOW()` and delete
associated S3 objects before removing the row.

**The `artifact_cleanup_janitor_records` table caps at 100 rows.** The existing cap (DELETE all but
the 100 most recent) is a deliberate safeguard against table growth. The sweeper should surface
janitor records as part of its report output and retry the failed cleanup for any entries it finds,
removing the janitor record on success.

**Test coverage must include the no-delete cases.** Fixture tests for the GC command must verify that
runs still within retention window, runs that are current rollback candidates, and runs whose
record retention window has not elapsed are all excluded from the deletion set, even when the
artifact window has passed independently. The `inspectProtectedSharedRetention` function already
accepts a `now` override for time-injection; the GC tests should use it.
