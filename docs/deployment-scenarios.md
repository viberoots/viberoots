# Deployment Scenarios

This document gives canonical policy scenarios for the deployment model.

If two implementations would handle one of these scenarios differently, the design or companion
contracts still need clarification.

## 1. Protected/Shared Normal Deploy

Situation:

- deployment: `pleomino-prod`
- protection class: `production_facing`
- provider: `cloudflare-pages`
- lane mode: `same_artifact`

Expected behavior:

- the operator submits `deploy pleomino-prod`
- the source-admission path determines the admissible revision
- trusted CI builds and attests the artifact for that admitted revision
- the control plane then admits the target-environment mutating run, freezes one execution snapshot, acquires the lock, publishes, runs smoke, and records the run
- the mutating publish phase uses only the admitted immutable artifact

## 2. Publish-Only Retry

Situation:

- the prior publish failed during provider upload
- the destination is already provisioned
- the earlier admitted run already identified the artifact

Expected behavior:

- the operator submits `deploy pleomino-prod --publish-only --source-run-id <failed-run-id>`
- the run is classified as `retry`
- the control plane replays the recorded snapshot for the selected source run
- no rebuild occurs
- provisioning does not run
- smoke still runs unless explicit policy says otherwise

## 3. Same-Deployment Rollback

Situation:

- a bad production release is already live
- an earlier successful normal-target run remains retained

Expected behavior:

- the operator submits `deploy pleomino-prod --publish-only --source-run-id <known-good-run-id> --rollback`
- the run is classified as `rollback`
- the current branch/lane policy must authorize rollback
- the selected rollback source run may be older than the current branch head
- the control plane replays the recorded snapshot for the selected run
- no rebuild occurs

## 4. Cross-Deployment Promotion

Situation:

- `pleomino-staging` and `pleomino-prod` resolve to the same authoritative compatible `lane_policy`
- the lane uses `artifact_reuse_mode = "same_artifact"`
- the source and target deployments may use different reviewed providers as long as the lane and component compatibility contract still matches
- the selected staging run is an earlier admitted candidate that is still eligible under the lane's current promotion policy

Expected behavior:

- the operator submits `deploy pleomino-prod --publish-only --source-run-id <staging-run-id>`
- the run is classified as `promotion`
- the control plane validates lane compatibility and promotability
- the source artifact identity is reused
- the target deployment uses its own admitted target-environment snapshot and approvals
- `parent_run_id`, `release_lineage_id`, and `artifact_lineage_id` make the promoted lineage explicit across deployment ids even when the provider changes

## 5. Protected/Shared Preview

Situation:

- preview is explicitly enabled in deployment metadata
- the provider can prove preview isolation

Expected behavior:

- the operator or automation submits `deploy pleomino-prod --preview --source-run-id <admitted-run-id>`
- preview is recorded as `publish_mode = preview`
- for same-deployment preview publication, the default `operation_kind` remains `deploy`
- unless the deployment's `admission_policy` explicitly defines a stricter preview posture, the preview run uses the same target-environment branch and required-check requirements as a normal protected/shared publish for `pleomino-prod`
- by default, previewing that already-admitted artifact does not require a second manual approval
- the effective target identity is the isolated preview target
- the shared/protected preview selector is the admitted source run id, not an ambient branch or commit
- the preview run may still share the normal deployment lock unless the preview also satisfies the stronger independent-execution isolation requirements for a separate preview lock scope
- preview cleanup is a first-class audited `preview_cleanup` operation
- explicit cleanup uses `deploy pleomino-prod --preview-cleanup --source-run-id <admitted-run-id>`
- preview cleanup acquires the effective lock scope for that preview, whether that is the shared normal lock or a separate isolated preview lock
- preview cleanup records `publish_mode = preview`, the isolated preview target identity, and a cleanup reason such as TTL expiry or PR close

## 6. Rejected Preview On Non-Isolated Target

Situation:

- the provider cannot prove isolated preview targeting

Expected behavior:

- preview submission is rejected before mutation
- the system must not silently publish to the normal live target with preview-like labeling

## 7. Rollback After Artifact Retention Failure

Situation:

- operators select an earlier rollback candidate
- the artifact is no longer retrievable within a supposedly supported reuse window

Expected behavior:

- the run fails clearly
- the system records a retention or retrieval failure
- the system does not rebuild a lookalike artifact and pretend it is equivalent

## 8. Rejected Ambiguous Exact-Artifact Replay

Situation:

- an operator presents an exact artifact selector for a protected/shared publish-only flow
- that selector does not resolve to exactly one admitted source run and frozen execution snapshot

Expected behavior:

- submission is rejected before mutation
- the system requires `--source-run-id` or another unambiguous selector
- the system does not guess which admitted snapshot should govern replay

## 9. Rejected Rollback Without Explicit Source Run

Situation:

- an operator requests protected/shared rollback without `--source-run-id`

Expected behavior:

- submission is rejected before mutation
- the system does not guess the rollback source from recency or "latest known good"
- the operator must choose the exact prior admitted run to reuse

## 10. `--from-changes` With Prerequisites

Situation:

- a changed deployment is an explicit direct prerequisite of another deployment
- the run is mutating and lane-scoped

Expected behavior:

- impact selection widens deterministically according to declared direct prerequisite metadata
- execution remains serial and topological by default
- the mutating invocation fans out into ordinary per-deployment runs rather than one multi-deployment run record
- the selector may over-select for safety but must not under-select

## 11. Protected/Shared Provision-Only With Immutable Inputs

Situation:

- a reviewed provisioner declares `immutable_resolved_inputs`
- the operator wants provisioning without publish

Expected behavior:

- the operator submits `deploy pleomino-prod --provision-only --source-run-id <deploy-run-id>`
- the control plane uses the admitted source-run context required by the provisioner
- no rebuild occurs
- publish and release actions do not run

## 12. Rebuild-Per-Stage Promotion

Situation:

- a lane explicitly declares `artifact_reuse_mode = "rebuild_per_stage"`

Expected behavior:

- the operator must not use `--publish-only` for this promotion, because the target stage requires a newly built admitted artifact
- source-run selection identifies the admitted source revision being promoted
- trusted CI builds a new stage-specific immutable artifact for the target stage
- the control plane admits that target-stage artifact before publish
- exact-artifact source-run reuse is rejected for that promotion flow

## 13. Production Rollback Approval

Situation:

- a production rollback is requested for `pleomino-prod`
- the selected source run is a prior known-good production run
- the deployment requires human approval

Expected behavior:

- the operator submits `deploy pleomino-prod --publish-only --source-run-id <known-good-run-id> --rollback`
- the run is classified as `rollback`
- the control plane requires fresh target-environment approval by default for that production rollback
- approval from the original successful run is evidence for source quality, not authorization for the new mutation

## 14. Migration Exception Invalidates Replay

Situation:

- a reviewed migration transfers the normal live target from one deployment id to another
- an operator later tries to replay an old run against the former owner

Expected behavior:

- admission checks the recorded migration or alias exception object
- replay against the stale target binding is rejected clearly
- the system does not guess target ownership from old snapshots once the reviewed migration has changed it

## 15. Rollback Blocked By Forward-Only Release Action

Situation:

- a deployment's successful run included a stateful `release_action` such as a schema migration
- that action's recorded data-compatibility posture is `forward_only`
- an operator later requests artifact rollback to an older run

Expected behavior:

- the operator submits `deploy pleomino-prod --publish-only --source-run-id <known-good-run-id> --rollback`
- admission evaluates the recorded action posture before mutation
- the rollback is rejected clearly unless the deployment declares another explicitly compatible rollback or repair path
- the system does not assume that re-publishing the older artifact is safe once shared state has advanced

## 16. Queued Normal Deploy Superseded By Newer Normal Deploy

Situation:

- a protected/shared normal deploy run is queued waiting on the live-target lock
- a later normal deploy run for the same deployment, same publish mode, and same effective lock scope is admitted

Expected behavior:

- the older queued run is marked `superseded` before mutation
- the deployment record preserves `final_outcome = null` and `termination_reason = superseded`
- the later admitted normal deploy run becomes the candidate that may proceed after lock acquisition

## 17. Retry Is Not Auto-Superseded

Situation:

- an operator submits a protected/shared `retry` for a failed publish
- while it is queued, a separate fresh normal deploy is admitted for the same deployment

Expected behavior:

- the retry is not auto-superseded by default just because a newer normal deploy exists
- the control plane still applies ordinary revalidation, approval, and queue-time policies before mutation
- if the retry should no longer run, that decision must come from explicit cancellation, admission failure, or a stricter reviewed policy rather than implicit supersedence

## 18. Multi-Component Partial Publish Retry

Situation:

- a multi-component deployment publishes component `frontend` successfully
- component `api` then fails during the same deployment run
- the provider and rollout policy do not support partial component retry as a separate operator workflow

Expected behavior:

- the original run records per-component publish state and artifact identity for both components
- the follow-up operator action is still one deployment-level retry, not an implicitly narrowed component-only repair command
- on retry, `frontend` may be treated as a no-op only if the adapter can prove its live published identity still matches the intended resolved artifact identity and no rollout or `release_action` rule requires it to be published again
- if the adapter cannot prove that equivalence, the retry republishes `frontend` or fails clearly rather than guessing
- `api` is retried using the recorded deployment state and normal retry admission rules
- the deployment remains the operator-atomic recovery unit unless a reviewed provider capability entry and rollout contract explicitly allow a narrower replay unit

## 19. Control-Plane-Outage Break-Glass Mutation

Situation:

- a `production_facing` deployment needs emergency stabilization
- the normal shared control plane or one of its core online dependencies is unavailable
- an incident-bounded break-glass procedure has been documented for that target class

Expected behavior:

- the emergency action may proceed only through the documented break-glass path, not through an ad hoc alternate workflow
- the emergency path still prefers exact admitted-artifact reuse over rebuild when a retained admitted artifact is available
- the emergency path uses explicit fencing, target freeze, or equivalent reviewed concurrency protection before mutation
- the emergency path preserves structured emergency evidence including incident reference, requesting identity, approving identity when applicable, executing identity, artifact or source-run selection path, and why the normal control plane was unavailable or bypassed
- once the incident is stabilized, that evidence is reconciled into the authoritative deployment record before the environment returns to steady-state normal operations

## Companion Docs

- [Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
- [Deployment Schema](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-schema.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
- [Deployment Implementation Plan](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-implementation-plan.md)
