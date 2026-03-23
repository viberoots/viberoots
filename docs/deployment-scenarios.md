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

- `pleomino-staging` and `pleomino-prod` are in the same compatible `promotion_lane`
- the lane uses `artifact_reuse_mode = "same_artifact"`

Expected behavior:

- the operator submits `deploy pleomino-prod --publish-only --source-run-id <staging-run-id>`
- the run is classified as `promotion`
- the control plane validates lane compatibility and promotability
- the source artifact identity is reused
- the target deployment uses its own admitted target-environment snapshot and approvals

## 5. Protected/Shared Preview

Situation:

- preview is explicitly enabled in deployment metadata
- the provider can prove preview isolation

Expected behavior:

- the operator or automation submits `deploy pleomino-prod --preview --source-run-id <admitted-run-id>`
- preview is recorded as `publish_mode = preview`
- for same-deployment preview publication, the default `operation_kind` remains `deploy`
- the effective target identity is the isolated preview target
- preview cleanup is a first-class audited `preview_cleanup` operation
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

## Companion Docs

- [Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
- [Deployment Schema](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-schema.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
- [Deployment Implementation Plan](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-implementation-plan.md)
