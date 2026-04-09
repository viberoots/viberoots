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
- Bootstrap mutation for the deployment authority itself is allowed only through an explicit reviewed bootstrap path on deployment-system-owned infrastructure; it is not part of the ordinary protected/shared deploy path.
- Trusted CI may build, attest, and submit, but it is not a peer mutating authority.
- Preview is `publish_mode = preview`, not a peer `operation_kind`.
- Preview must publish only to an explicitly isolated preview target or be rejected.
- Preview publication and cleanup must use explicit preview identity selectors; implementations must not infer preview identity from ambient git state, current branch, or provider defaults.
- Deployments are single-provider by design; systems that span multiple provider families must be represented as multiple coordinated deployments.
- Every deployment must declare explicit provider-target identity in authoritative metadata.
- `shared_nonprod` and `production_facing` deployments must declare explicit `lane_policy`, `environment_stage`, and `admission_policy` metadata.
- Protected/shared `lane_policy` is branch-backed and must define explicit stage-to-branch mappings that govern promotion for that lane.
- Provider config is provider-native input, not a second source of truth for core deployment facts.
- One deployment id owns one normal mutable live target by default.
- Reviewed migration or alias exceptions must be first-class control-plane objects with explicit scope, lock sharing, and expiry or completion semantics.
- `--publish-only` is exact-artifact reuse or delayed exact-artifact publish, never implicit rebuild.
- `--publish-only` is in policy only for operation kinds that reuse an already-admitted immutable artifact or admitted same-deployment snapshot; `rebuild_per_stage` promotion is a distinct flow and must be rejected under `--publish-only`.
- For protected/shared mutation, `--provision-only` must still bind to one admitted source revision and frozen execution snapshot, even when no artifact is required.
- For `shared_nonprod` and `production_facing`, immutable-reuse publish paths must resolve to one authoritative admitted source run and its frozen execution snapshot.
- Protected/shared rollback requires an explicit `--source-run-id` selecting the prior admitted run to reuse.
- For `cloudflare-pages`, same-deployment rollback additionally requires `--publish-only` plus `--rollback`, and the selected source run must be a successful normal live-target run for the same deployment.
- Protected/shared preview publish and preview cleanup require an explicit `--source-run-id` selecting the admitted run lineage the preview is derived from.
- Same-deployment source-run reuse with `publish_mode = normal` is classified by operator intent: delayed first publish remains `deploy`, re-publication is `retry`, and explicit restoration uses `--rollback`.
- Same-deployment delayed first publish of an already admitted artifact or admitted run lineage remains `operation_kind = deploy`; same-deployment re-publication of an earlier attempted normal run is `retry`.
- Rollback source selection must use a prior admitted run for the same deployment.
- Default rollback candidates are prior successful `publish_mode = normal` runs against the same normal live target.
- Successful same-deployment `retry`, `rollback`, and `explicit_removal` runs are not default rollback candidates.
- Default rollback candidates are usable only when any already-applied stateful `release_actions` remain rollback-compatible under their declared data-compatibility posture.
- Protected/shared immutable-reuse flows must replay the recorded execution snapshot rather than reinterpret current repo state.
- Protected/shared replay snapshots must record non-secret secret/config contract references or versions, not secret values.
- Protected/shared replay snapshots must preserve immutable provider-config content or an immutable provider-config reference, not only a bare fingerprint.
- Supported multi-component replay snapshots and deployment records must preserve per-component exact artifact references plus per-component publish, smoke, and live-identity state.
- Protected/shared replay snapshots and deployment records must preserve the implementation identity of the built-in publisher, provisioner, smoke runner, and any built-in `release_actions` runner that materially influenced execution.
- Side-effecting built-in `release_actions` may allow `rerun` in a replay context only when their reviewed type contract also defines duplicate-execution safety for that context; otherwise replay must fail closed or skip according to the recorded policy.
- Protected/shared deployment metadata must declare both secret and non-secret runtime-config requirements explicitly, with `{}` as the reviewable empty value for each contract surface.
- Same-deployment protected/shared `retry` and `rollback` reuse the recorded admitted secret/config references by default; `promotion` uses the target deployment's newly admitted target-environment references.
- Protected/shared exact-artifact selectors are in policy only when they deterministically resolve to exactly one admitted source run plus its recorded execution snapshot.
- Promotion between deployment ids that resolve to the same authoritative compatible `lane_policy` must follow that lane's declared `artifact_reuse_mode`.
- Promotion compatibility for protected/shared runs must evaluate one explicit closed compatibility contract; adapters must not decide promotability from ad hoc heuristics or unreviewed field comparisons.
- `same_artifact` lanes reuse the same admitted artifact across environments.
- `rebuild_per_stage` lanes promote the admitted source revision and build a new admitted stage artifact before publish.
- The reviewed `rebuild_per_stage` operator path is a mutating promotion submission with `--source-run-id` plus a target-stage artifact input, not `--publish-only`.
- For promotion, `--source-run-id` may select any earlier admitted run that remains eligible under the lane's current promotion policy; it is not limited to the latest candidate, and it is not an override around lane policy.
- Protected/shared smoke is required and blocking by default unless there is an explicit `smoke.exception`.
- Multi-component retry remains deployment-atomic by default after partial publish failure; already-proven-live components may be treated as no-op reuse only when the adapter can prove their live published identity still matches the intended resolved artifact identity and no declared rollout or release-action rule requires re-publish.
- Protected/shared package-local executable hooks are out of policy for normal mutation paths.
- Protected/shared required checks and required approvals are authoritative blocking admission inputs, not advisory metadata.
- Protected/shared approvals are target-environment run-admission facts, not reusable artifact facts.
- Protected/shared approval evidence must bind to one immutable admission payload, including the admitted `deploy_run_id`, frozen execution snapshot, canonical target identity, selected artifact identity or admitted source-run selector when publishing, and reviewed provisioner plan/diff artifact when infra-affecting mutation is in scope.
- If any bound approval input changes materially after approval, mutation must fail closed or require fresh approval.
- Self-approval is out of policy by default when human approval is required.
- `promotion` always requires target-environment approval under the target deployment's admission policy.
- `rollback` requires fresh target-environment approval by default for `production_facing`, unless an explicit emergency policy says otherwise.
- `retry` may reuse approval only when the admission policy explicitly allows same-lineage retry reuse and the original approval remains valid.
- Protected/shared preview reuses the target deployment's normal branch and required-check gates by default, but should not require a second manual approval by default when previewing an already-admitted artifact or run lineage.
- An admission policy may still require manual preview approval for especially sensitive targets.
- `retry` is branch-independent replay of an earlier admitted run for the same deployment by default; later branch movement does not invalidate it unless the admission policy explicitly sets `retry_branch_policy = branch_coupled`.
- Supported protected/shared artifact-reuse paths must retain retrievable immutable artifacts for at least the documented minimum retention window.
- Protected/shared authoritative deployment records, approval evidence, migration or alias exception records, and break-glass emergency evidence must remain retained for at least the documented minimum audit-retention window.
- `retire-target` and `migrate-target` are separate operator workflows, not aliases for normal `deploy` or provider-local `--remove`.
- Protected/shared infra-affecting provisioner runs must surface a reviewed plan or diff artifact before routine mutation, unless an explicitly reviewed higher-bar exception path says otherwise.
- The authoritative protected/shared control plane must have explicit reviewed backup, restore-test, and recovery objectives; break-glass is an emergency exception path, not the normal resilience model for routine outages.
- Minimum reviewed control-plane resilience objectives are:
  - `shared_nonprod`: target RPO `4h`, target RTO `8h`, minimum admitted-artifact retention `30d`, minimum authoritative record retention `180d`, minimum restore-test cadence `quarterly`
  - `production_facing`: target RPO `15m`, target RTO `1h`, minimum admitted-artifact retention `180d`, minimum authoritative record retention `365d`, minimum restore-test cadence `monthly`
- Implementations may exceed those minimums, but must not operate below them without an explicit reviewed design update.
- The authoritative protected/shared control plane must also provide required audit events, operational metrics, alerts, and dashboards sufficient to operate the published resilience, locking, rollout, and break-glass posture.
- Protected/shared execution must define one reviewed in-doubt-run recovery path for failures after provider-side mutation may have begun but before the authoritative run record is finalized.
- Protected/shared in-doubt-run recovery must prefer provider-state reconciliation over blind retry, and must fail closed when reconciliation cannot prove whether mutation happened and no reviewed duplicate-execution-safe continuation path exists.
- Restarted or replacement workers must reacquire authoritative target ownership, including current lock or fencing authority, before continuing an in-doubt protected/shared run.
- Protected/shared deployment records must preserve material recovery facts when in-doubt recovery occurred, including which step was in doubt, whether provider-state reconciliation succeeded, and whether execution resumed or terminated after reconciliation.
- Required protected/shared observability surfaces must include in-doubt-run detection and recovery outcomes, not only steady-state submission and rollout events.
- Protected/shared logs, audit events, dashboards, exported event payloads, replay snapshots, and deployment records must be secret-safe by construction.
- Secret values, raw credentials, rendered secret-bearing config, and unreviewed provider output that may contain secret-bearing request or response fields must not be persisted or displayed in protected/shared operator-visible observability or durable record surfaces.
- When secret safety of a captured payload cannot be proven, protected/shared implementations must persist only a redacted summary, stable reference, fingerprint, or structured code rather than the raw payload.
- Progressive rollout modes must use one explicit reviewed phase-state model and must define approval, supersedence, resume, abort, and partial-rollout rollback semantics before protected/shared mutation is allowed.
- The implementation boundary between Buck metadata extraction, the repo-level `deploy` CLI, and the shared control-plane API must use explicit versioned payload contracts; independently implemented components must not rely on undocumented in-process conventions.
- Protected/shared mutating submit requests must be idempotent at the control-plane request layer through one explicit stable submission id or idempotency key that survives client retries.
- Reusing the same protected/shared submission id with the same normalized request payload must resolve to the same accepted run or same rejection result; reusing it with different payload contents must fail closed with an explicit idempotency-conflict result.
- The shared control-plane submit API must return one stable reviewed submit-response contract that includes `deploy_run_id` when a run exists, dedupe outcome, initial lifecycle state, and one machine-readable closed rejection code when the request is not accepted.
- First-class protected/shared run actions on existing runs, such as progressive-rollout `resume`, must use their own reviewed versioned request/response contract rather than an ad hoc side channel.
- Protected/shared run-action requests must be idempotent at the control-plane request layer through one explicit stable submission id or idempotency key that survives client retries.
- Reusing the same protected/shared run-action submission id with the same normalized action payload must resolve to the same accepted continuation result or same rejection result; reusing it with different payload contents must fail closed with an explicit idempotency-conflict result.
- The shared control-plane run-action API must return one stable reviewed response contract that includes the target `deploy_run_id`, dedupe outcome, resulting lifecycle or rollout state when a run exists, and one machine-readable closed rejection code when the action is not accepted.
- When a protected/shared request is valid and authorized to request deployment but still needs human approval, the canonical behavior is to create one run in `pending_approval` rather than reject submission and force clients to resubmit after approval.

## Operator Semantics

- `operation_kind` uses the canonical set: `deploy`, `retry`, `promotion`, `rollback`, `preview_cleanup`.
- `publish_mode` is a separate field from `operation_kind`.
- `preview_cleanup` is a destructive housekeeping run against preview resources; it should preserve preview context in records rather than being treated as a normal publish.
- Retire/migrate-target records must preserve old target identity, new target identity when applicable, the reviewed exception object, and the resulting ownership state.
- Final outcome is a separate field from both operation kind and lifecycle state.
- `pending_approval` is a first-class lifecycle state for accepted protected/shared runs awaiting required human approval.
- `termination_reason` uses the canonical set `cancelled`, `superseded`, `no_longer_admitted`, `lock_timeout`, or `null` when a canonical terminal outcome exists.
- Cancellation is a first-class reviewed operator action, not an implementation-specific interrupt.
- A cancel request may be accepted only while the run is in `pending_approval`, `queued`, `waiting_for_lock`, `running`, or `cancelling`.
- Cancellation is always best-effort; after provider-side mutation or side-effecting `release_actions` may have begun, the system must reconcile provider state before choosing a terminal record.
- A run in `cancelling` must not return to `queued` or silently resume ordinary forward progress as if no cancellation request occurred.
- After reconciliation, a cancelled run must settle to exactly one of: `cancelled` with `termination_reason = cancelled` when no mutation occurred, `finished` with a canonical terminal outcome when the resulting state is known, or `finished` with the appropriate failure outcome when reconciliation proves failure during or after mutation.
- Supersedence is narrow by default: later admitted runs auto-supersede only older queued `deploy` runs for the same `deployment_id`, same `publish_mode`, and same effective `lock_scope`, unless a stricter reviewed policy says otherwise.
- `--rollback` is the explicit operator signal for same-deployment rollback semantics.
- `--source-run-id` selects an earlier admitted run within policy; it does not override lane or admission policy.
- Preview-safe local or isolated-preview flows must expose one explicit preview identity selector such as branch name or commit SHA; those selectors identify both preview publication and preview cleanup.
- Supported explicit local preview identity selectors are branch name and commit SHA.
- Same-deployment preview publication defaults to `operation_kind = deploy` plus `publish_mode = preview`, not `retry`.
- Unless `admission_policy` explicitly defines a stricter preview posture, protected/shared preview uses the target deployment's normal branch and required-check requirements, while manual preview approval remains optional by default for already-admitted artifacts or run lineage.
- Separate preview lock scope is allowed only when the preview meets the stronger independent-execution isolation bar; otherwise preview shares the normal deployment lock even when preview publication itself is in policy.
- `--from-changes` selection may over-select for safety, but it must not under-select a deployment whose reviewed metadata or component project was impacted.
- `--from-changes` prerequisite widening is driven only by explicit direct prerequisite edges from authoritative deployment metadata; the selector must not invent transitive or cross-lane fan-out heuristics.
- Mutating `--from-changes` fans out into ordinary per-deployment runs; it is not one multi-deployment mutating run record.
- Grouped `--from-changes` submission may stamp a shared batch id for audit, but each deployment still owns its own `deploy_run_id`, lifecycle, final outcome, and record.
- `ordering_only` prerequisites require one prior successful admitted prerequisite run and constrain ordering only.
- `health_gated` prerequisites require the same ordering proof plus fresh admission-time health evidence against the prerequisite's declared smoke or built-in release-health contract.
- `resume` is a first-class operator action on an existing paused progressive-rollout run, not a new `operation_kind`.
- `resume` keeps the existing `deploy_run_id`, lineage, and frozen execution snapshot; it must reacquire lock and revalidate the paused run under the recorded rollout-resume policy before continuing.
- If a paused rollout is not resumable under recorded rollout state, current approval state, or provider capability contract, `resume` must fail closed rather than creating an implicit replacement run.

## Replay Rules

- Replay must use the recorded source-run snapshot plus narrow current invariant checks.
- Narrow current invariants include target ownership, lock scope, provider identity, publisher compatibility, and current admission validity.
- Replay must not silently load newer deployment metadata, provider config, or release-action definitions as if they were part of the original run.
- Replay-sensitive secret and runtime-config references must resolve exactly to the admitted reference set for the replayed run kind.
- `retry` and `rollback` must fail closed if recorded admitted secret or runtime-config references have expired, been deleted, been revoked, or cannot be resolved exactly; implementations must not silently substitute newer, rotated, ambient, or `latest` values.
- `promotion` uses the target deployment's newly admitted target-environment secret and runtime-config references rather than replaying the source deployment's references.
- Concrete Pleomino example:
  - `pleomino-dev -> pleomino-staging -> pleomino-prod` reuses one exact static-webapp artifact when the lane stays on `artifact_reuse_mode = "same_artifact"`.
  - promotion compatibility is lane-scoped first, but it still requires the reviewed current compatibility gate for provider family, publisher type, component ids and kinds, rollout semantics, and provisioner behavior.
  - the selected source run contributes the immutable artifact plus recorded source snapshot evidence, while the target deployment still freezes its own admitted execution snapshot and target identity before mutation.
  - `parent_run_id` points at the immediately promoted source run, `release_lineage_id` stays stable across the whole promoted release line, and `artifact_lineage_id` stays stable only while the exact same artifact is reused.
  - `pleomino-rebuild-dev -> pleomino-rebuild-staging -> pleomino-rebuild-prod` keeps the same promoted source revision but admits a new stage-specific artifact for each later environment, so `artifact_lineage_id` is not reused across those promotion runs.
- Recorded `release_actions` replay policy must use one closed disposition per replay context: `rerun`, `skip`, or `fail`.
- Recorded side-effecting `release_actions` that declare `rerun` must also record or reference the duplicate-execution safety contract that made rerun admissible for that context.
- Protected/shared replay by exact artifact ref is valid only when the artifact ref resolves unambiguously to one admitted source-run snapshot.
- Progressive-rollout replay or resume is out of policy by default unless the recorded rollout state and provider capability contract define an explicit deterministic resume path.

## Protected/Shared Admission Rules

- Every protected/shared mutating run freezes one immutable execution snapshot at admission before queueing or locking.
- When a protected/shared run includes an infra-affecting reviewed provisioner plan/diff, that plan/diff must be produced from the frozen execution snapshot before mutation and any required approval must bind to that reviewed artifact.
- Protected/shared first-run deploys use two admission stages: source admission establishes the admissible revision and trusted artifact; target-environment run admission freezes the execution snapshot for the mutating publish run.
- The mutating publish phase consumes an admitted immutable artifact.
- Protected/shared non-publishing mutation, including `--provision-only`, still consumes an admitted source revision plus the frozen execution snapshot for that run; it is not an unbound mutable metadata action.
- Fresh workstation builds are out of policy for protected/shared mutation.
- Ad hoc control-plane rebuilds for mutation are out of policy unless the lane explicitly uses reviewed `rebuild_per_stage` promotion flow.
- Artifact attestation verification must enforce the admission policy's reviewed trust contract for accepted builder identities, provenance format, and artifact-to-source binding.
- Rollback may use an earlier retained admitted run even when the branch head has moved forward, but the current branch/lane state must still authorize performing rollback.
- Rollback must also honor the recorded data-compatibility posture of any already-applied stateful `release_actions`; unsafe rollback must fail closed rather than re-publish an older artifact by default.
- Admission must preserve enough approval evidence to explain why the run was authorized.
- Protected/shared admission and execution must preserve enough payload-binding evidence to prove that the approved payload, admitted payload, and executed payload were the same reviewed unit.
- If a reviewed provisioner plan/diff must be regenerated and no longer matches the reviewed artifact materially, the run must fail closed or obtain fresh approval before mutation.
- Break-glass mutation is in policy only for an explicitly documented incident-bounded control-plane-unavailability path with mandatory fencing or equivalent concurrency protection and post-incident reconciliation back into the authoritative deployment record.
- When break-glass mutation is used, the resulting authoritative record must preserve structured emergency evidence sufficient to explain who requested, approved, and executed the action, which incident justified it, which artifact or source-run selection path was used, and why the normal control plane was unavailable or bypassed.
- Bootstrap mutation is in policy only for deployment targets that explicitly declare reviewed bootstrap ownership for deployment-system infrastructure.
- Bootstrap mutation must use explicit bootstrap-scoped authorization, exact immutable admitted artifacts, explicit target-identity proof, and explicit ownership proof; it must fail closed when any proof is absent or mismatched.
- Bootstrap records may start as pending reconciliation evidence, but once the normal control plane is available they must be ingested back into authoritative records and routine updates must return to the normal control-plane path.
- Protected/shared authorization must use one explicit hierarchical scope model with repo-wide administrative scope, lane scope, deployment scope, and incident-bounded break-glass scope.
- Permission evaluation must be least-privilege and resource-scoped by default; CLI, API, and UI authorization decisions must use the same action vocabulary and scope semantics.

## Required Review Questions

Before approving a deployment-system change, confirm:

- Does this preserve `TARGETS` as the source of truth?
- Does this keep protected/shared mutation inside the control plane?
- Does this preserve exact-artifact semantics for replay and publish-only?
- Does this keep preview isolated from the normal live target?
- Does this preserve canonical provider-target identity and locking semantics?
- Does this preserve the separation of `operation_kind`, `publish_mode`, lifecycle state, and final outcome?
- Does this preserve duplicate-execution safety for side-effecting `release_actions`?
- Does this preserve approval binding to the exact immutable admitted payload?
- Does this preserve the required versioned contract boundary between Buck extraction, CLI submission, and control-plane admission?
- Does this preserve submit-layer idempotency and the stable submit-response contract for protected/shared mutation?
- Does this preserve the first-class run-action contract and idempotency model for paused-run continuation such as `resume`?
- Does this preserve the required observability posture for protected/shared mutation?
- Does this preserve the reviewed plan/diff and resilience posture required for protected/shared mutation?

## Companion Docs

- [Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Schema](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-schema.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
- [Deployment Scenarios](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-scenarios.md)
- [Deployment Implementation Plan](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-plan.md)
