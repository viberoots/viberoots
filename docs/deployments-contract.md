# Deployment Contract

This document is the short implementation-facing contract for the deployment model.

Use it as the fail-closed checklist when adding rules, adapters, CLI flows, control-plane APIs,
or deployment records.

If an implementation conflicts with this document, the implementation should change unless the
design has been explicitly updated first.

## Non-Negotiable Rules

- `TARGETS` is the authoritative source of deployment metadata.
- Every concrete deployment lives at `projects/deployments/<deployment-id>/` and exposes a canonical `:deploy` target.
- Buck owns deployment structure, validation, dependency graph, and build artifacts.
- Live deployment side effects do not run as ordinary Buck actions.
- Protected/shared mutation runs only through the shared deployment control plane, except for an explicitly documented incident-bounded break-glass procedure for control-plane unavailability.
- Trusted CI may build, attest, and submit, but it is not a peer mutating authority.
- Preview is `publish_mode = preview`, not a peer `operation_kind`.
- Preview must publish only to an explicitly isolated preview target or be rejected.
- Deployments are single-provider by design; systems that span multiple provider families must be represented as multiple coordinated deployments.
- Every deployment must declare explicit provider-target identity in authoritative metadata.
- `shared_nonprod` and `production_facing` deployments must declare explicit `lane_policy`, `environment_stage`, and `admission_policy` metadata.
- Protected/shared `lane_policy` is branch-backed and must define explicit stage-to-branch mappings that govern promotion for that lane.
- Provider config is provider-native input, not a second source of truth for core deployment facts.
- One deployment id owns one normal mutable live target by default.
- Reviewed migration or alias exceptions must be first-class control-plane objects with explicit scope, lock sharing, and expiry or completion semantics.
- `--publish-only` is exact-artifact reuse or delayed exact-artifact publish, never implicit rebuild.
- For `shared_nonprod` and `production_facing`, immutable-reuse publish paths must resolve to one authoritative admitted source run and its frozen execution snapshot.
- Protected/shared rollback requires an explicit `--source-run-id` selecting the prior admitted run to reuse.
- Same-deployment source-run reuse with `publish_mode = normal` is `retry` unless the operator explicitly requests `--rollback`.
- Rollback source selection must use a prior admitted run for the same deployment.
- Default rollback candidates are prior successful `publish_mode = normal` runs against the same normal live target.
- Default rollback candidates are usable only when any already-applied stateful `release_actions` remain rollback-compatible under their declared data-compatibility posture.
- Protected/shared immutable-reuse flows must replay the recorded execution snapshot rather than reinterpret current repo state.
- Protected/shared replay snapshots must record non-secret secret/config contract references or versions, not secret values.
- Same-deployment protected/shared `retry` and `rollback` reuse the recorded admitted secret/config references by default; `promotion` uses the target deployment's newly admitted target-environment references.
- Protected/shared exact-artifact selectors are in policy only when they deterministically resolve to exactly one admitted source run plus its recorded execution snapshot.
- Promotion between deployment ids that resolve to the same authoritative compatible `lane_policy` must follow that lane's declared `artifact_reuse_mode`.
- `same_artifact` lanes reuse the same admitted artifact across environments.
- `rebuild_per_stage` lanes promote the admitted source revision and build a new admitted stage artifact before publish.
- For promotion, `--source-run-id` may select any earlier admitted run that remains eligible under the lane's current promotion policy; it is not limited to the latest candidate, and it is not an override around lane policy.
- Protected/shared smoke is required and blocking by default unless there is an explicit `smoke.exception`.
- Multi-component retry remains deployment-atomic by default after partial publish failure; already-proven-live components may be treated as no-op reuse only when the adapter can prove their live published identity still matches the intended resolved artifact identity and no declared rollout or release-action rule requires re-publish.
- Protected/shared package-local executable hooks are out of policy for normal mutation paths.
- Protected/shared approvals are target-environment run-admission facts, not reusable artifact facts.
- Self-approval is out of policy by default when human approval is required.
- `promotion` always requires target-environment approval under the target deployment's admission policy.
- `rollback` requires fresh target-environment approval by default for `production_facing`, unless an explicit emergency policy says otherwise.
- `retry` may reuse approval only when the admission policy explicitly allows same-lineage retry reuse and the original approval remains valid.
- `retry` is branch-independent replay of an earlier admitted run for the same deployment by default; later branch movement does not invalidate it unless the admission policy explicitly sets `retry_branch_policy = branch_coupled`.
- Supported protected/shared artifact-reuse paths must retain retrievable immutable artifacts for at least the documented minimum retention window.

## Operator Semantics

- `operation_kind` uses the canonical set: `deploy`, `retry`, `promotion`, `rollback`, `preview_cleanup`.
- `publish_mode` is a separate field from `operation_kind`.
- `preview_cleanup` is a destructive housekeeping run against preview resources; it should preserve preview context in records rather than being treated as a normal publish.
- Final outcome is a separate field from both operation kind and lifecycle state.
- `termination_reason` uses the canonical set `cancelled`, `superseded`, `no_longer_admitted`, `lock_timeout`, or `null` when a canonical terminal outcome exists.
- Supersedence is narrow by default: later admitted runs auto-supersede only older queued `deploy` runs for the same `deployment_id`, same `publish_mode`, and same effective `lock_scope`, unless a stricter reviewed policy says otherwise.
- `--rollback` is the explicit operator signal for same-deployment rollback semantics.
- `--source-run-id` selects an earlier admitted run within policy; it does not override lane or admission policy.
- Same-deployment preview publication defaults to `operation_kind = deploy` plus `publish_mode = preview`, not `retry`.
- Unless `admission_policy` explicitly defines narrower preview rules, protected/shared preview uses the target deployment's normal branch/check/approval requirements.
- Separate preview lock scope is allowed only when the preview meets the stronger independent-execution isolation bar; otherwise preview shares the normal deployment lock even when preview publication itself is in policy.
- Mutating `--from-changes` fans out into ordinary per-deployment runs; it is not one multi-deployment mutating run record.

## Replay Rules

- Replay must use the recorded source-run snapshot plus narrow current invariant checks.
- Narrow current invariants include target ownership, lock scope, provider identity, publisher compatibility, and current admission validity.
- Replay must not silently load newer deployment metadata, provider config, or release-action definitions as if they were part of the original run.
- Recorded `release_actions` replay policy must use one closed disposition per replay context: `rerun`, `skip`, or `fail`.
- Protected/shared replay by exact artifact ref is valid only when the artifact ref resolves unambiguously to one admitted source-run snapshot.

## Protected/Shared Admission Rules

- Every protected/shared mutating run freezes one immutable execution snapshot at admission before queueing or locking.
- Protected/shared first-run deploys use two admission stages: source admission establishes the admissible revision and trusted artifact; target-environment run admission freezes the execution snapshot for the mutating publish run.
- The mutating publish phase consumes an admitted immutable artifact.
- Fresh workstation builds are out of policy for protected/shared mutation.
- Ad hoc control-plane rebuilds for mutation are out of policy unless the lane explicitly uses reviewed `rebuild_per_stage` promotion flow.
- Rollback may use an earlier retained admitted run even when the branch head has moved forward, but the current branch/lane state must still authorize performing rollback.
- Rollback must also honor the recorded data-compatibility posture of any already-applied stateful `release_actions`; unsafe rollback must fail closed rather than re-publish an older artifact by default.
- Admission must preserve enough approval evidence to explain why the run was authorized.
- Break-glass mutation is in policy only for an explicitly documented incident-bounded control-plane-unavailability path with mandatory fencing or equivalent concurrency protection and post-incident reconciliation back into the authoritative deployment record.
- When break-glass mutation is used, the resulting authoritative record must preserve structured emergency evidence sufficient to explain who requested, approved, and executed the action, which incident justified it, which artifact or source-run selection path was used, and why the normal control plane was unavailable or bypassed.

## Required Review Questions

Before approving a deployment-system change, confirm:

- Does this preserve `TARGETS` as the source of truth?
- Does this keep protected/shared mutation inside the control plane?
- Does this preserve exact-artifact semantics for replay and publish-only?
- Does this keep preview isolated from the normal live target?
- Does this preserve canonical provider-target identity and locking semantics?
- Does this preserve the separation of `operation_kind`, `publish_mode`, lifecycle state, and final outcome?

## Companion Docs

- [Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Schema](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-schema.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
- [Deployment Scenarios](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-scenarios.md)
- [Deployment Implementation Plan](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-implementation-plan.md)
