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
- Protected/shared mutation runs only through the shared deployment control plane.
- Trusted CI may build, attest, and submit, but it is not a peer mutating authority.
- Preview is `publish_mode = preview`, not a peer `operation_kind`.
- Preview must publish only to an explicitly isolated preview target or be rejected.
- Every deployment must declare explicit provider-target identity in authoritative metadata.
- Provider config is provider-native input, not a second source of truth for core deployment facts.
- One deployment id owns one normal mutable live target by default.
- `--publish-only` is exact-artifact reuse or delayed exact-artifact publish, never implicit rebuild.
- Same-deployment source-run reuse is `retry` unless the operator explicitly requests `--rollback`.
- Rollback source selection must use a prior admitted run for the same deployment.
- Default rollback candidates are prior successful `publish_mode = normal` runs against the same normal live target.
- Protected/shared immutable-reuse flows must replay the recorded execution snapshot rather than reinterpret current repo state.
- Promotion between deployment ids must follow the lane's declared `artifact_reuse_mode`.
- `same_artifact` lanes reuse the same admitted artifact across environments.
- `rebuild_per_stage` lanes promote the admitted source revision and build a new admitted stage artifact before publish.
- Protected/shared smoke is required and blocking by default unless there is an explicit `smoke.exception`.
- Protected/shared package-local executable hooks are out of policy for normal mutation paths.

## Operator Semantics

- `operation_kind` uses the canonical set: `deploy`, `retry`, `promotion`, `rollback`, `preview_cleanup`.
- `publish_mode` is a separate field from `operation_kind`.
- Final outcome is a separate field from both operation kind and lifecycle state.
- `--rollback` is the explicit operator signal for same-deployment rollback semantics.
- `--source-run-id` selects an earlier admitted run within policy; it does not override lane or admission policy.

## Replay Rules

- Replay must use the recorded source-run snapshot plus narrow current invariant checks.
- Narrow current invariants include target ownership, lock scope, provider identity, publisher compatibility, and current admission validity.
- Replay must not silently load newer deployment metadata, provider config, or release-action definitions as if they were part of the original run.

## Protected/Shared Admission Rules

- Every protected/shared mutating run freezes one immutable execution snapshot at admission before queueing or locking.
- The mutating publish phase consumes an admitted immutable artifact.
- Fresh workstation builds are out of policy for protected/shared mutation.
- Ad hoc control-plane rebuilds for mutation are out of policy unless the lane explicitly uses reviewed `rebuild_per_stage` promotion flow.
- Rollback may use an earlier retained admitted run even when the branch head has moved forward, but the current branch/lane state must still authorize performing rollback.

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
