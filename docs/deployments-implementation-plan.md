# Deployment Implementation Plan

This document translates the deployment design into a narrow first implementation plan.

The goal is to implement the common safe path first, with validation gates that prevent accidental
policy drift while broader capability is still under construction.

## Phase 1 Scope

Build only the smallest slice that proves the model end to end:

- one built-in provider:
  - `cloudflare-pages`
- one protected/shared component shape:
  - `static-webapp`
- single-component deployments only
- `artifact_reuse_mode = "same_artifact"` only
- one normal protected/shared deploy flow
- one publish-only retry flow
- one same-deployment rollback flow
- one cross-deployment promotion flow
- preview only if isolated target semantics are clean and enforceable

Explicitly out of initial scope:

- multi-component protected/shared rollout
- `rebuild_per_stage`
- arbitrary package-local executable hooks in protected/shared paths
- advanced rollout modes such as `canary` or `blue_green`

## Validation Gates

### Buck / Repo Validation

Must reject:

- missing required deployment metadata for protected/shared deployments
- missing canonical provider-target identity fields
- protected/shared deployment-local executable mutation hooks
- unsupported rollout modes for the selected provider
- invalid prerequisite graphs
- preview declarations that do not satisfy the provider capability contract

### CLI Submission Validation

Must reject:

- ambiguous same-deployment source-run reuse without explicit `--rollback` for rollback intent
- protected/shared `--publish-only` without exact artifact or source-run selection
- preview requests without explicit preview support
- source-run reuse across incompatible lanes

### Control-Plane Admission Validation

Must enforce:

- protected/shared mutation only through control-plane admission
- immutable execution snapshot frozen before queueing/locking
- admitted immutable artifact for protected/shared publish
- rollback authorization from current branch/lane policy
- replay from recorded snapshot for immutable-reuse flows
- exact-artifact semantics for publish-only, retry, rollback, and same-artifact promotion

## Suggested Work Order

1. Implement deployment metadata extraction for canonical deployment targets.
2. Implement provider-target identity normalization for the first provider.
3. Implement lane-policy and admission-policy resolution.
4. Implement deployment-record and replay-snapshot persistence contracts.
5. Implement control-plane admission and lock flow.
6. Implement one built-in publisher and smoke runner for the first provider.
7. Implement `retry`, `rollback`, and `promotion` classification from source-run selectors.
8. Add policy-focused validation tests before broadening provider or rollout support.

## Policy-Focused Tests To Add Early

- reject preview that reuses the normal live target
- reject protected/shared package-local mutation hooks
- reject ambiguous same-deployment source-run reuse without `--rollback`
- reject promotion across incompatible lanes
- reject rollback sourced from preview-only success
- reject replay paths that would rebuild implicitly

## Exit Criteria For Phase 1

Phase 1 is complete when all of the following are true:

- one provider works end to end for normal protected/shared deploy
- replay snapshot persistence is implemented for immutable-reuse flows
- `retry`, `rollback`, and `promotion` are recorded with canonical `operation_kind`
- smoke is enforced and blocking by default for protected/shared paths
- provider-target identity, lock scope, and record identity use one canonical rule
- policy-focused validation tests pass

## Phase 2 Candidates

After Phase 1 is stable, likely next expansions are:

- additional provider capability entries
- additional component kinds
- isolated protected/shared preview if not already included
- multi-component deployment support
- `rebuild_per_stage`
- richer rollout modes

## Companion Docs

- [Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
- [Deployment Schema](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-schema.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
- [Deployment Scenarios](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-scenarios.md)
