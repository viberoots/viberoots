# Deployment Schema

This document defines the minimum schema contract for deployment metadata, policy objects, replay
snapshots, and deployment records.

It is intentionally schema-oriented rather than implementation-oriented. The goal is to make sure
repo validation, CLI code, control-plane code, and records all speak the same shape.

## 1. Deployment Metadata

Authoritative source: the canonical deployment rule in `projects/deployments/<deployment-id>/TARGETS`.

Minimum fields:

| Field                 | Required                                         | Notes                                                   |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `name`                | yes                                              | Canonical target name, normally `deploy`.               |
| `provider`            | yes                                              | Provider family identifier.                             |
| `provider_target`     | yes                                              | Structured provider-target identity object.             |
| `components`          | yes                                              | Non-empty list of deployable component descriptors.     |
| `publisher`           | yes                                              | Structured publish contract.                            |
| `protection_class`    | yes                                              | `local_only`, `shared_nonprod`, or `production_facing`. |
| `secret_requirements` | yes                                              | `{}` allowed and reviewable.                            |
| `provisioner`         | no                                               | Present only when provisioning is deployment-owned.     |
| `release_actions`     | no                                               | Present only when release-time actions are needed.      |
| `smoke`               | yes for protected/shared                         | Optional for `local_only`.                              |
| `preview`             | no                                               | Explicit opt-in only.                                   |
| `prerequisites`       | no                                               | Explicit direct-edge deployment prerequisites.          |
| `promotion_lane`      | yes for protected/shared promotion               | Optional otherwise.                                     |
| `lane_policy`         | yes unless canonically derived                   | Must resolve to authoritative policy object.            |
| `environment_stage`   | yes for protected/shared promotion               | Must be defined by the lane policy.                     |
| `admission_policy`    | yes for `shared_nonprod` and `production_facing` | Repo-owned policy reference.                            |
| `rollout_policy`      | no                                               | Required when behavior differs from provider default.   |

### `provider_target`

Required shape:

- structured object, not free-form prose
- minimum key `id`
- for protected/shared use, includes every field required by the provider's canonical identity rule

### `components[*]`

Required keys:

- `id`
- `kind`
- `target`

### `publisher`

Required keys:

- `type`

Optional keys:

- provider-specific package-relative config paths such as `config`

### `provisioner`

Required keys when present:

- `type`

Optional keys:

- package-relative config or entry references
- declared input class such as `metadata_only` or `immutable_resolved_inputs`

### `release_actions[*]`

Required keys when present:

- `type`
- `phase`
- `run_condition`
- `abort_behavior`
- data-compatibility posture
- replay policy by operation kind

Allowed `phase` values:

- `pre_publish`
- `post_publish_pre_smoke`
- `post_smoke`

Allowed `run_condition` values:

- `success_only`
- `failure_only`
- `always`

Minimum replay-policy contract:

- explicit behavior for `publish_only`
- explicit behavior for `retry`
- explicit behavior for `rollback`
- explicit behavior for `promotion`
- one closed disposition per operation kind from:
  - `rerun`
  - `skip`
  - `fail`

Minimum data-compatibility contract:

- explicit posture for rollback compatibility with already-applied state changes
- one closed posture from:
  - `backward_compatible`
  - `forward_only`
  - `reversible`
  - `manual_recovery_required`
- if the action type is not `backward_compatible` or `reversible`, protected/shared rollback admission must not assume that re-publishing an earlier artifact is safe

### `smoke`

Required for protected/shared.

Minimum contract:

- validated built-in smoke or release-health type
- enough fields to resolve the smoke target or release-health target

Optional nested field:

- `exception`

Minimum `smoke.exception` fields:

- `owner`
- `reason`
- `scope`
- one review boundary field: `review_by` or `expires_at`

### `preview`

Minimum fields when present:

- `target_derivation`
- `isolation_class`
- either explicit cleanup or TTL policy or a provider-defaulted cleanup policy marker
- any smoke override when deviating from the provider default
- whether separate lock scope is allowed, when overriding the provider default

### `prerequisites[*]`

Required keys:

- `deployment_id`
- `mode`

Allowed `mode` values:

- `ordering_only`
- `health_gated`

## 2. Lane Policy Object

Minimum fields:

| Field                     | Required | Notes                                   |
| ------------------------- | -------- | --------------------------------------- |
| `name`                    | yes      | Stable lane identifier.                 |
| `stages`                  | yes      | Ordered stage list.                     |
| `stage_branches`          | yes      | Stage-to-branch mapping.                |
| `allowed_promotion_edges` | yes      | Explicit forward promotion edges.       |
| `artifact_reuse_mode`     | yes      | `same_artifact` or `rebuild_per_stage`. |

Optional fields:

- stricter compatibility rules
- stricter rollback-candidate policy
- additional lane-specific admission constraints

## 3. Rollout Policy Object

Required fields when `rollout_policy` is present:

| Field   | Required | Notes                                                                       |
| ------- | -------- | --------------------------------------------------------------------------- |
| `mode`  | yes      | Closed enum described below.                                                |
| `abort` | yes      | Deployment-level abort rule for the rollout.                                |
| `smoke` | yes      | Smoke execution mode for the rollout: `per_phase`, `final_only`, or `both`. |

Allowed `mode` values:

- `all_at_once`
- `all_or_nothing`
- `ordered_best_effort`
- `parallel_best_effort`
- `phased`
- `canary`
- `blue_green`
- `store_staged`

Conditionally required:

- `phases` or `steps` in explicit execution order for `phased`, `canary`, `blue_green`, and `store_staged`
- advance gate definition for every declared phase or step
- exposure increments, bake duration, and completion condition for traffic- or audience-shifting modes such as `canary`, `blue_green`, and `store_staged`

Optional fields:

- explicit component groups
- dependency barriers
- provider-specific validated extensions that do not change the provider-neutral meaning of the mode

## 4. Admission Policy Object

Minimum fields:

| Field                               | Required                | Notes                                               |
| ----------------------------------- | ----------------------- | --------------------------------------------------- |
| `name` or stable id                 | yes                     | Versioned policy identity.                          |
| `allowed_refs` or equivalent        | yes                     | Allowed branches/refs.                              |
| `required_checks`                   | yes                     | Required CI or validation checks.                   |
| `required_approvals`                | yes                     | Human/policy approval requirements, possibly empty. |
| `artifact_attestation_requirements` | yes for publishing runs | Build trust requirements.                           |

Optional fields:

- preview admission constraints
- operation-kind-specific restrictions
- whether same-lineage retry approval reuse is allowed
- `retry_branch_policy`, using the closed enum `branch_independent` or `branch_coupled`
- whether fresh approval is required for rollback by protection class

## 5. Replay Snapshot

Used for protected/shared immutable-artifact reuse.

Minimum fields:

| Field                                     | Required          | Notes                                                    |
| ----------------------------------------- | ----------------- | -------------------------------------------------------- |
| `schema_version`                          | yes               | Explicit replay schema id.                               |
| `deployment_id`                           | yes               | Source deployment id.                                    |
| resolved component data                   | yes               | Canonical resolved component projection.                 |
| artifact refs and identities              | yes               | Exact immutable artifact identity.                       |
| declared normal target identity           | yes               | Normal live target.                                      |
| effective run target identity             | yes               | Actual mutated target for that run.                      |
| provider-config snapshot or immutable ref | yes               | No silent reinterpretation.                              |
| `lane_policy` snapshot/fingerprint        | yes               | Source-run policy context.                               |
| `admission_policy` snapshot/fingerprint   | yes               | Source-run policy context.                               |
| rollout policy snapshot                   | yes when relevant | Source-run rollout semantics.                            |
| `release_actions` plan snapshot           | yes when relevant | Includes replay behavior and data-compatibility posture. |
| smoke policy snapshot                     | yes when relevant | Source-run validation contract.                          |
| secret-contract version/reference         | yes               | Non-secret contract metadata only.                       |

## 6. Deployment Record

Minimum required fields for every run:

| Field                                           | Required                               | Notes                                                                                        |
| ----------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `schema_version`                                | yes                                    | Explicit record schema id.                                                                   |
| `deploy_run_id`                                 | yes                                    | Globally unique.                                                                             |
| `deployment_id`                                 | yes                                    | Concrete deployment id.                                                                      |
| `deployment_label`                              | yes                                    | Buck deployment label.                                                                       |
| `operation_kind`                                | yes                                    | `deploy`, `retry`, `promotion`, `rollback`, `preview_cleanup`.                               |
| `lifecycle_state`                               | yes                                    | `queued`, `waiting_for_lock`, `running`, `cancelling`, `finished`, `cancelled`.              |
| `termination_reason`                            | yes                                    | Nullable when canonical terminal outcome exists; otherwise uses the closed vocabulary below. |
| source revision identifier                      | yes                                    | Revision associated with the run.                                                            |
| `requested_by`                                  | yes                                    | Requesting actor identity.                                                                   |
| publish mode                                    | yes                                    | `normal` or `preview`; `preview_cleanup` records should use `preview`.                       |
| declared normal provider-target identity        | yes                                    | Normal live target identity.                                                                 |
| effective run target identity                   | yes                                    | Actual mutated target identity.                                                              |
| `lock_scope`                                    | yes                                    | Canonical lock scope.                                                                        |
| deployment metadata fingerprint or snapshot ref | yes                                    | Resolved metadata used by the run.                                                           |
| execution-snapshot reference                    | yes for protected/shared mutating runs | Frozen snapshot actually used.                                                               |
| `lane_policy` fingerprint or snapshot ref       | yes when applicable                    | Authoritative lane context.                                                                  |
| `admission_policy` fingerprint or snapshot ref  | yes when applicable                    | Authoritative admission context.                                                             |
| approval evidence or approval record ref        | yes when human approval is required    | Must explain why the run was admitted.                                                       |
| start time and end time                         | yes                                    | Audit timeline.                                                                              |
| `final_outcome`                                 | nullable                               | Canonical terminal outcome when reached.                                                     |

Conditionally required:

- `submitted_by` when distinct from `requested_by`
- `executed_by` for protected/shared runs
- smoke result when a smoke step was declared and reached
- `parent_run_id` for retry, rollback, and promotion derived from an earlier run
- `release_lineage_id` when the run belongs to a promoted multi-run lineage
- `artifact_lineage_id` when the same artifact is intentionally reused
- `deploy_batch_id` or equivalent grouping id when the run was created from one higher-level mutating batch such as `--from-changes`
- migration or alias exception reference when admission or replay relied on one
- `failed_step` when `final_outcome` is not `succeeded` and the run reached a canonical lifecycle step after `resolve`
- `cleanup_reason` for `preview_cleanup`
- isolated preview target identity for `preview_cleanup`
- source-run snapshot reference when a protected/shared exact-artifact selector resolved through an earlier admitted run

Canonical `final_outcome` values:

- `validation_failed`
- `build_failed`
- `resolve_failed`
- `provision_failed`
- `release_action_failed`
- `publish_failed`
- `smoke_failed_after_publish`
- `succeeded`
- `null` for no canonical terminal outcome

Canonical `termination_reason` values:

- `cancelled`
- `superseded`
- `no_longer_admitted`
- `lock_timeout`
- `null` when the run reaches a canonical terminal outcome

Notes:

- `failed_step` should use the canonical lifecycle vocabulary such as `release_actions.pre_publish`, `publish`, `release_actions.post_publish_pre_smoke`, `smoke`, or `release_actions.post_smoke`.
- The schema keeps a compact `final_outcome` enum; step-level failure location belongs in `failed_step` rather than expanding `final_outcome` for every phase.
- `termination_reason` is intentionally separate from `final_outcome`; it explains non-canonical terminal exits rather than publish/provision/smoke success or failure.

## 7. Validation Expectations

Repo validation should reject:

- missing required metadata for the deployment's policy class
- unsupported rollout modes for the selected provider
- protected/shared package-local executable mutation hooks
- preview configuration without isolated-target semantics
- missing canonical provider-target identity fields
- invalid prerequisite graphs
- protected/shared approval-policy shapes that leave retry, promotion, or rollback approval semantics ambiguous
- protected/shared immutable-artifact selectors that do not resolve unambiguously to one admitted source-run snapshot
- `release_actions` declarations that omit phase, abort behavior, or replay policy
- `release_actions` declarations that omit data-compatibility posture for stateful action types
- `rollout_policy` declarations that omit mode-required phase, gate, or exposure semantics

## Companion Docs

- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
- [Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
- [Deployment Scenarios](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-scenarios.md)
- [Deployment Implementation Plan](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-implementation-plan.md)
