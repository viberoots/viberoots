# Deployment Schema

This document defines the minimum schema contract for deployment metadata, policy objects, replay
snapshots, and deployment records.

It is intentionally schema-oriented rather than implementation-oriented. The goal is to make sure
repo validation, CLI code, control-plane code, and records all speak the same shape.

## 1. Deployment Metadata

Authoritative source: the canonical deployment rule in `projects/deployments/<deployment-id>/TARGETS`.

Minimum fields:

| Field                         | Required                                         | Notes                                                                                                                                                               |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                        | yes                                              | Canonical target name, normally `deploy`.                                                                                                                           |
| `provider`                    | yes                                              | Provider family identifier.                                                                                                                                         |
| `provider_target`             | yes                                              | Structured provider-target identity object.                                                                                                                         |
| `components`                  | yes                                              | Non-empty list of deployable component descriptors.                                                                                                                 |
| `publisher`                   | yes                                              | Structured publish contract.                                                                                                                                        |
| `protection_class`            | yes                                              | `local_only`, `shared_nonprod`, or `production_facing`.                                                                                                             |
| `secret_requirements`         | yes                                              | `{}` allowed and reviewable.                                                                                                                                        |
| `runtime_config_requirements` | yes                                              | `{}` allowed; declares non-secret runtime config inputs.                                                                                                            |
| `provisioner`                 | no                                               | Present only when provisioning is deployment-owned.                                                                                                                 |
| `release_actions`             | no                                               | Present only when release-time actions are needed.                                                                                                                  |
| `smoke`                       | yes for protected/shared                         | Optional for `local_only`.                                                                                                                                          |
| `preview`                     | no                                               | Explicit opt-in only.                                                                                                                                               |
| `prerequisites`               | no                                               | Explicit direct-edge deployment prerequisites.                                                                                                                      |
| `lane_policy`                 | yes for `shared_nonprod` and `production_facing` | Must resolve to authoritative policy object.                                                                                                                        |
| `environment_stage`           | yes for `shared_nonprod` and `production_facing` | Must be defined by the lane policy.                                                                                                                                 |
| `admission_policy`            | yes for `shared_nonprod` and `production_facing` | Repo-owned policy reference.                                                                                                                                        |
| `rollout_policy`              | no                                               | Required when behavior differs from provider default, and also required for protected/shared multi-component deployments even when they match the provider default. |

Single-provider invariant:

- a deployment has exactly one `provider` and one authoritative `provider_target` model
- multi-component deployments are allowed within that provider boundary
- systems that span multiple provider families must be represented as multiple coordinated deployments

### `provider_target`

Required shape:

- structured object, not free-form prose
- includes every field required by the provider's canonical identity rule
- optional shorthand fields such as `id` are allowed only as non-authoritative display metadata unless the provider capability entry explicitly makes them part of canonical identity

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
- plan or diff contract for infra-affecting mutation paths

Minimum plan/diff contract when provisioner-managed infra mutation is reviewable:

- whether the plan surface is provider-native or provider-neutral
- whether routine mutation requires a reviewed pre-mutation plan artifact
- how destructive or replacement actions are surfaced distinctly from create or in-place update
- if no meaningful plan or diff can be produced, the reviewed higher-bar approval posture required for that path

### `runtime_config_requirements`

Required shape:

- dictionary keyed by stable logical runtime-config name
- `{}` is the explicit no-runtime-config value
- each entry should declare the non-secret config contract that must be admitted for deterministic execution or replay

Minimum per-entry keys:

- `name`
- `step`
- `contract_id`
- `required`

Optional per-entry keys:

- `source`
- `preview_variant`
- `notes`

### `release_actions[*]`

Required keys when present:

- `type`
- `phase`
- `run_condition`
- `abort_behavior`
- data-compatibility posture
- replay policy by replay context

Allowed `phase` values:

- `pre_publish`
- `post_publish_pre_smoke`
- `post_smoke`

Allowed `run_condition` values:

- `success_only`
- `failure_only`
- `always`

Minimum replay-policy contract:

- explicit behavior for `deploy_publish_slice`
- explicit behavior for `retry`
- explicit behavior for `rollback`
- explicit behavior for `promotion`
- one closed disposition per replay context from:
  - `rerun`
  - `skip`
  - `fail`

Minimum duplicate-execution-safety contract for side-effecting actions:

- required for every replay context where disposition is `rerun`
- one closed duplicate-safety model from:
  - `provider_idempotent`
  - `control_plane_deduplicated`
  - `not_duplicate_safe`
- stable operation-key contract or equivalent deduplication keying rule for `provider_idempotent` and `control_plane_deduplicated`
- if a replay context is `not_duplicate_safe`, that context must not declare `rerun`

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
- supported preview identity selector kind or kinds
  - `branch`
  - `commit`
  - `source_run`
- either explicit cleanup or TTL policy or a provider-defaulted cleanup policy marker
- any smoke override when deviating from the provider default
- whether separate lock scope is allowed, when overriding the provider default
- provider-default preview cleanup policy and preview-locking defaults must come from the authoritative provider capability entry when deployment metadata omits them
- optional preview-specific admission constraints when intentionally different from the deployment's normal admission policy
  - they may be stricter or lighter only where the deployment contract explicitly allows that variation
- local preview-safe deployments should use branch-scoped or commit-scoped preview identity
- protected/shared preview should use `source_run` identity only

### `prerequisites[*]`

Required keys:

- `deployment_id`
- `mode`

Allowed `mode` values:

- `ordering_only`
- `health_gated`

Validation rule:

- prerequisites must stay within the same lane; cross-lane prerequisites are rejected

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

- `promotion_compatibility`
- stricter rollback-candidate policy
- additional lane-specific admission constraints
- versioned interface bindings or schema refs used by Buck extraction, CLI submission, and control-plane admission

### `promotion_compatibility`

Used to define the closed compatibility contract for cross-deployment promotion within a lane.

Minimum fields when present:

- `match_fields`
  - closed allowlist of deployment-shape fields that must match exactly for promotion in that lane
- `allow_environment_differences`
  - closed allowlist of fields that are expected to differ safely across stages in that lane

Schema expectation:

- any provisioner behavior that matters to promotability must be represented explicitly through this closed compatibility contract or the reviewed lane default it resolves to
- provisioner differences must not be admitted through adapter-local "safe enough" heuristics outside that resolved contract

Optional fields:

- `additional_validations`
  - reviewed lane-specific checks that must be evaluated before mutation

Contract rule:

- protected/shared promotion must evaluate this closed compatibility contract rather than adapter-local heuristics
- if a lane omits `promotion_compatibility`, the reviewed lane default compatibility contract must still resolve to one explicit closed set before promotion is allowed

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
- rollout-level approval policy when later phases require fresh approval beyond ordinary admission
- rollout resume policy when paused or interrupted progressive rollout may continue deterministically
- rollout supersedence policy when a newer run interacts with a pending or paused rollout

Progressive-rollout required semantics for `phased`, `canary`, `blue_green`, and `store_staged`:

- explicit phase-state vocabulary support from:
  - `pending`
  - `running`
  - `paused`
  - `succeeded`
  - `failed`
  - `aborted`
- explicit abort semantics for the selected rollout mode
- explicit resumability declaration:
  - `not_resumable`
  - `resume_from_next_phase`
  - `provider_state_resumable`
- explicit rollback posture for partially completed rollout:
  - `not_supported`
  - `requires_new_rollback_run`
  - `provider_defined_partial_rollback`

Minimum per-phase or per-step fields for progressive rollout:

- stable phase or step id
- advance gate
- phase-local approval requirement when different from rollout default
- terminal behavior on failure or abort
- optional bake or stabilization window
- optional target exposure or slot state for traffic-shifting modes

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
- approval payload-binding requirements when human or policy approval is required

Minimum `artifact_attestation_requirements` contract:

- accepted builder identity or identity set
- accepted provenance or predicate type
- required binding from artifact identity to source revision plus build inputs
- verification rule for the signing or attesting authority
- failure behavior for revoked, expired, or no-longer-trusted attestation material

Minimum approval payload-binding contract when approval is required:

- required immutable payload fields from:
  - `deploy_run_id`
  - execution-snapshot fingerprint or stable snapshot reference
  - canonical target identity
  - selected artifact identity
  - selected source-run snapshot reference
  - selected preview identity when preview publication or preview cleanup is being approved
  - reviewed provisioner plan/diff artifact reference
- validity or expiry rule for approval reuse where reuse is permitted
- fail-closed behavior when any required bound field changes after approval

## 5. Migration / Alias Exception Object

Used when target ownership or target naming is temporarily in transition.

Minimum fields:

| Field                       | Required | Notes                                                                 |
| --------------------------- | -------- | --------------------------------------------------------------------- |
| stable exception id         | yes      | Control-plane object identity.                                        |
| affected deployment ids     | yes      | One or more deployment ids participating in the exception.            |
| exception kind              | yes      | `migration` or `alias`.                                               |
| old normal target identity  | yes      | Prior canonical live-target binding when applicable.                  |
| new normal target identity  | no       | Required for migrations that transfer or rename live-target identity. |
| enforced shared lock scope  | yes      | Lock scope that all affected runs must share during the exception.    |
| approval authority/evidence | yes      | Review ticket, approval record, or equivalent justification.          |
| effective start time        | yes      | Start of validity window.                                             |
| expiry or completion signal | yes      | Explicit expiry time or completion condition.                         |
| reconciliation owner        | yes      | Named owner for cleanup and return to steady state.                   |

Validation expectations:

- admission and replay must consult this object when deciding whether a recorded target binding is still valid
- an expired or completed exception must no longer authorize replay against a stale binding
- the steady-state goal remains one deployment id owning one normal mutable live target

## 6. Replay Snapshot

Used for protected/shared immutable-artifact reuse.

Minimum fields:

| Field                                               | Required          | Notes                                                                                                                 |
| --------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `schema_version`                                    | yes               | Explicit replay schema id.                                                                                            |
| `deployment_id`                                     | yes               | Source deployment id.                                                                                                 |
| resolved component data                             | yes               | Canonical resolved component projection.                                                                              |
| artifact refs and identities                        | yes               | Exact immutable artifact identity.                                                                                    |
| runner implementation identities                    | yes               | Built-in publisher/provisioner/smoke/release-action runner version or digest set used by the run.                     |
| declared normal target identity                     | yes               | Normal live target.                                                                                                   |
| effective run target identity                       | yes               | Actual mutated target for that run.                                                                                   |
| provider-config immutable snapshot or immutable ref | yes               | No silent reinterpretation; bare fingerprints are insufficient for replay.                                            |
| `lane_policy` snapshot/fingerprint                  | yes               | Source-run policy context.                                                                                            |
| `admission_policy` snapshot/fingerprint             | yes               | Source-run policy context.                                                                                            |
| rollout policy snapshot                             | yes when relevant | Source-run rollout semantics.                                                                                         |
| `release_actions` plan snapshot                     | yes when relevant | Includes replay behavior, duplicate-execution-safety details for any `rerun` context, and data-compatibility posture. |
| provisioner plan/diff snapshot or reference         | yes when relevant | Required when a reviewed pre-mutation provisioner plan/diff was part of admission.                                    |
| smoke policy snapshot                               | yes when relevant | Source-run validation contract.                                                                                       |
| secret-contract version/reference                   | yes               | Non-secret contract metadata only.                                                                                    |
| runtime-config reference/fingerprint                | yes when relevant | Non-secret admitted config selector for deterministic replay.                                                         |
| approval payload-binding snapshot or reference      | yes when relevant | Required when human or policy approval was part of admission.                                                         |
| rollout runtime state snapshot                      | yes when relevant | Required for progressive rollout replay, resume, or auditability.                                                     |

Minimum `approval payload-binding snapshot` fields when present:

- approved `deploy_run_id`
- approved execution-snapshot fingerprint or ref
- approved canonical target identity
- approved artifact identity or approved source-run snapshot ref, when publishing
- approved provisioner plan/diff ref, when infra-affecting provisioning was in scope

Minimum `rollout runtime state snapshot` fields when present:

- rollout mode
- current phase or step id
- phase-state map
- resumability status
- latest observed exposure, slot, or track state when applicable
- whether later phases still require fresh approval

## 7. Deployment Record

Minimum required fields for every run:

| Field                                            | Required                               | Notes                                                                                                            |
| ------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `schema_version`                                 | yes                                    | Explicit record schema id.                                                                                       |
| `deploy_run_id`                                  | yes                                    | Globally unique.                                                                                                 |
| `deployment_id`                                  | yes                                    | Concrete deployment id.                                                                                          |
| `deployment_label`                               | yes                                    | Buck deployment label.                                                                                           |
| `operation_kind`                                 | yes                                    | `deploy`, `retry`, `promotion`, `rollback`, `preview_cleanup`.                                                   |
| `lifecycle_state`                                | yes                                    | `queued`, `waiting_for_lock`, `running`, `cancelling`, `finished`, `cancelled`.                                  |
| `termination_reason`                             | yes                                    | Nullable when canonical terminal outcome exists; otherwise uses the closed vocabulary below.                     |
| source revision identifier                       | yes except `preview_cleanup`           | Revision associated with the run; `preview_cleanup` may instead point to preview lineage or source-run ancestry. |
| `requested_by`                                   | yes                                    | Requesting actor identity.                                                                                       |
| publish mode                                     | yes                                    | `normal` or `preview`; `preview_cleanup` records should use `preview`.                                           |
| declared normal provider-target identity         | yes                                    | Normal live target identity.                                                                                     |
| effective run target identity                    | yes                                    | Actual mutated target identity.                                                                                  |
| `lock_scope`                                     | yes                                    | Canonical lock scope.                                                                                            |
| deployment metadata fingerprint or snapshot ref  | yes                                    | Resolved metadata used by the run.                                                                               |
| execution-snapshot reference                     | yes for protected/shared mutating runs | Frozen snapshot actually used.                                                                                   |
| runner implementation identities                 | yes for protected/shared mutating runs | Built-in publisher/provisioner/smoke/release-action runner version or digest set actually used.                  |
| `lane_policy` fingerprint or snapshot ref        | yes when applicable                    | Authoritative lane context.                                                                                      |
| `admission_policy` fingerprint or snapshot ref   | yes when applicable                    | Authoritative admission context.                                                                                 |
| approval evidence or approval record ref         | yes when human approval is required    | Must explain why the run was admitted.                                                                           |
| approval payload-binding ref or embedded summary | yes when human approval is required    | Must prove what immutable payload the approval authorized.                                                       |
| start time and end time                          | yes                                    | Audit timeline.                                                                                                  |
| `final_outcome`                                  | nullable                               | Canonical terminal outcome when reached.                                                                         |

Conditionally required:

- `submitted_by` when distinct from `requested_by`
- `executed_by` for protected/shared runs
- smoke result when a smoke step was declared and reached
- reviewed provisioner plan/diff artifact reference when infra-affecting mutation relied on one
- progressive rollout state when the run uses phased or traffic-shifting rollout semantics
- `parent_run_id` for retry, rollback, and promotion derived from an earlier run
- `release_lineage_id` when the run belongs to a promoted multi-run lineage
- `artifact_lineage_id` when the same artifact is intentionally reused
- `deploy_batch_id` or equivalent grouping id when the run was created from one higher-level mutating batch such as `--from-changes`
- migration or alias exception reference when admission or replay relied on one
- emergency evidence object or structured emergency-evidence reference when break-glass mutation was used
- `failed_step` when `final_outcome` is not `succeeded` and the run reached a canonical lifecycle step after `resolve`
- `cleanup_reason` for `preview_cleanup`
- isolated preview target identity for `preview_cleanup`
- source-run snapshot reference when a protected/shared exact-artifact selector resolved through an earlier admitted run
- explicit preview identity selector summary when `publish_mode = preview` or `operation_kind = preview_cleanup`

### Emergency Evidence

Required when break-glass mutation is used.

Minimum fields:

- incident reference
- requesting identity
- approving identity, when an approver exists for that emergency path
- executing identity
- emergency reason or justification
- artifact or source-run selection path
- why the normal control plane was unavailable or bypassed

### Approval Payload-Binding Evidence

Required when human or policy approval is used for admission.

Minimum fields:

- bound `deploy_run_id`
- bound execution-snapshot fingerprint or ref
- bound canonical target identity
- bound artifact identity or source-run snapshot ref when publishing
- bound preview identity selector when preview publication or preview cleanup is being approved
- bound provisioner plan/diff ref when infra-affecting provisioning was approved
- approval record reference or approver identity

### Progressive Rollout State

Required when the run uses `phased`, `canary`, `blue_green`, or `store_staged`.

Minimum fields:

- rollout mode
- current phase or step id
- current phase state from the closed rollout-state vocabulary
- per-phase state history
- resumability posture
- last observed provider-side exposure, slot, or rollout-track state when the provider exposes it
- whether the rollout is paused awaiting operator action, bake-time expiry, or fresh approval

## 8. Retention Expectations

Minimum operator-facing retention windows:

- protected/shared immutable artifacts plus full replay bundles:
  - `production_facing`: 90 days
  - `shared_nonprod`: 30 days
- protected/shared authoritative deployment records, approval evidence, migration or alias exception records, and break-glass emergency evidence:
  - `production_facing`: 1 year
  - `shared_nonprod`: 180 days

Retention rule:

- audit and authorization evidence must not expire sooner than the corresponding deployment records they justify
- implementations may retain records longer, but must not retain them for less than these minimums

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

## 9. Validation Expectations

Repo validation should reject:

- missing required metadata for the deployment's policy class
- unsupported rollout modes for the selected provider
- protected/shared package-local executable mutation hooks
- preview configuration without isolated-target semantics
- missing canonical provider-target identity fields
- invalid prerequisite graphs
- cross-lane prerequisites
- protected/shared approval-policy shapes that leave retry, promotion, or rollback approval semantics ambiguous
- protected/shared immutable-artifact selectors that do not resolve unambiguously to one admitted source-run snapshot
- protected/shared lane policies whose promotion-compatibility contract is missing, open-ended, or not resolvable to one closed reviewed field set before promotion
- `release_actions` declarations that omit phase, abort behavior, or replay policy
- side-effecting `release_actions` declarations that allow `rerun` without a duplicate-execution-safety contract
- `release_actions` declarations that omit data-compatibility posture for stateful action types
- protected/shared infra-affecting provisioner declarations whose reviewed path requires plan/diff visibility but does not define that contract
- `rollout_policy` declarations that omit mode-required phase, gate, or exposure semantics
- approval-requiring protected/shared admission policies that do not define immutable payload-binding requirements
- protected/shared record or snapshot shapes that preserve approval identity but not the immutable payload those approvals authorized
- progressive rollout declarations that omit required phase-state, resume, abort, or partial-rollback semantics

## 10. Versioned Interface Payloads

These payloads define the minimum versioned contract boundary between Buck extraction, the repo-level
CLI, and the shared control plane.

### Extracted Deployment Metadata Payload

Minimum fields:

- `schema_version`
- deployment id
- deployment label
- extracted authoritative deployment metadata fields
- extraction timestamp or build metadata version

### Mutating Submit Request Payload

Minimum fields:

- `schema_version`
- deployment id
- requested `operation_kind`
- requested `publish_mode`
- any explicit source-run selectors
- caller identity or auth context reference

### Admitted Execution-Snapshot Payload

Minimum fields:

- `schema_version`
- admitted run id
- frozen deployment metadata snapshot ref
- frozen provider-config snapshot ref
- frozen policy snapshot refs
- admitted artifact refs or admitted source revision
- admitted secret/runtime-config refs

### Run-Status / Read-Model Payload

Minimum fields:

- `schema_version`
- `deploy_run_id`
- deployment id
- lifecycle state
- final outcome
- termination reason
- effective target identity
- lock scope
- current rollout state when applicable

### Replay-Selector Payload

Minimum fields:

- `schema_version`
- selector kind such as `source_run_id`
- selected source-run id or equivalent immutable selector
- resolution result or resolution reference once bound

Contract rule:

- these payloads may be transported or serialized differently by implementation, but their schema version and field meaning must remain explicit and fail closed across independently implemented components

## 11. Control-Plane Observability Signals

Minimum required structured event categories for protected/shared mutation:

- submission and admission outcome
- approval granted, reused, expired, or revoked
- lock acquisition attempt, success, timeout, and release
- mutation-step start and finish
- progressive-rollout phase transition
- cancellation, supersedence, and no-longer-admitted termination
- preview cleanup
- break-glass invocation and reconciliation

Minimum required metric categories:

- queue depth and queue wait time
- lock contention and stale-lock or fencing-loss events
- run duration by lifecycle step
- retry counts by step
- failure counts by `final_outcome` and `failed_step`
- age of oldest queued and running runs
- backup, restore-test, and failover success state for the authoritative backend

Minimum required operator-visibility surfaces:

- alerting for resilience, lock, and repeated-run-failure conditions
- dashboards or equivalent views for per-lane run health, queue state, lock state, progressive rollout state, and backend recovery posture

## Companion Docs

- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
- [Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
- [Deployment Scenarios](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-scenarios.md)
- [Deployment Implementation Plan](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-implementation-plan.md)
