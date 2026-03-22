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
- trusted CI builds and attests the artifact from the admitted revision
- the control plane admits the run, freezes one execution snapshot, acquires the lock, publishes, runs smoke, and records the run
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
- preview is recorded as `publish_mode = preview`, not a separate operation kind
- the effective target identity is the isolated preview target
- preview cleanup is a first-class audited `preview_cleanup` operation

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

## 8. `--from-changes` With Prerequisites

Situation:

- a changed deployment is an explicit direct prerequisite of another deployment
- the run is mutating and lane-scoped

Expected behavior:

- impact selection widens deterministically according to declared direct prerequisite metadata
- execution remains serial and topological by default
- the selector may over-select for safety but must not under-select

## 9. Protected/Shared Provision-Only With Immutable Inputs

Situation:

- a reviewed provisioner declares `immutable_resolved_inputs`
- the operator wants provisioning without publish

Expected behavior:

- the operator submits `deploy pleomino-prod --provision-only --source-run-id <deploy-run-id>`
- the control plane uses the admitted source-run context required by the provisioner
- no rebuild occurs
- publish and release actions do not run

## 10. Rebuild-Per-Stage Promotion

Situation:

- a lane explicitly declares `artifact_reuse_mode = "rebuild_per_stage"`

Expected behavior:

- source-run selection identifies the admitted source revision being promoted
- trusted CI builds a new stage-specific immutable artifact for the target stage
- the control plane admits that target-stage artifact before publish
- exact-artifact source-run reuse is rejected for that promotion flow

## Companion Docs

- [Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
- [Deployment Schema](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-schema.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
- [Deployment Implementation Plan](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-implementation-plan.md)
