# Deployment Scenarios

This document gives canonical policy scenarios for the deployment model.

If two implementations would handle one of these scenarios differently, the design or companion
contracts still need clarification.

Operator-command note:

- deployment ids such as `pleomino-prod` remain the conceptual identity of the release target
- the reviewed public repo-level CLI selects that target with a Buck label such as
  `--deployment //projects/deployments/pleomino-prod:deploy`
- start with [Deployments Usage](/Users/kiltyj/Code/viberoots/docs/deployments-usage.md)
  when you need the reviewed day-to-day operator path before the scenario-level
  policy detail

## Workflow-Separated Authorization Shapes

These are all in-policy reviewed examples when grants use the same canonical role and scope model:

- human submitter + human approver
- CI reporter + human submitter
- CI submitter + human approver
- CI submitter + CI approver in lower-risk scopes

Concrete policy examples:

- human-only production approval:
  `deploy-submitters-pleomino-prod` submits while `deploy-approvers-pleomino-prod` approves
- human manual check reporting:
  a reviewed human may use `--admit-and-deploy` only when the same principal
  also holds `admission_reporter` for that deployment scope
- CI dev auto-submit:
  `deploy-automation-jenkins-submitters-dev` grants `submitter` for reviewed `dev` deployments
- CI global evidence reporting:
  `deploy-automation-jenkins-admission-reporters-all-deployments` grants
  `admission_reporter` for the closed `all_deployments` domain
- CI structured evidence after real validation:
  the automation principal may attach `admissionEvidence.checks` only when it
  holds both `submitter` and matching `admission_reporter` grants
- CI lower-environment auto-approval:
  `deploy-automation-jenkins-approvers-dev` grants `approver` for reviewed
  lower-risk `dev` deploys

## 1. Protected/Shared Normal Deploy

Situation:

- deployment: `pleomino-prod`
- protection class: `production_facing`
- provider: `cloudflare-pages`
- lane mode: `same_artifact`

Expected behavior:

- the operator submits `deploy --deployment //projects/deployments/pleomino-prod:deploy`
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

- the operator submits `deploy --deployment //projects/deployments/pleomino-prod:deploy --publish-only --source-run-id <failed-run-id>`
- the run is classified as `retry`
- the control plane replays the recorded snapshot for the selected source run
- no rebuild occurs
- provisioning does not run
- smoke still runs unless explicit policy says otherwise

## 2.1. Repo-Owned `s3-static` Provision + Publish

Situation:

- deployment: `pleomino-staging-s3`
- protection class: `shared_nonprod`
- provider: `s3-static`
- publisher: `aws-s3-sync`
- provisioner: `terraform-stack` or `cdktf-stack`

Expected behavior:

- the operator submits `deploy --deployment //projects/deployments/pleomino-staging-s3:deploy`
- the control plane admits one exact static artifact for the reviewed source-ref policy
- the deploy path materializes one reviewed non-destructive provisioner plan artifact for the
  bucket/CDN identity owned by deployment metadata
- checked-in provider config may add local publish flags, but it must not retarget `bucket`,
  `region`, or reviewed `distribution`
- publish runs through the built-in `aws-s3-sync` path against the authoritative bucket identity
- built-in smoke validates the canonical distribution or bucket website URL after publish

## 2.2. Managed `nixos-shared-host` SSR Deploy

Situation:

- deployment: `demoapp-dev`
- protection class: `shared_nonprod`
- provider: `nixos-shared-host`
- component kind: `ssr-webapp`
- publisher: `nixos-shared-host-ssr-webapp`
- runtime contract: `node-dist-server-v1`

Expected behavior:

- the operator submits `deploy --deployment //projects/deployments/demoapp-dev:deploy`
- the control plane admits one immutable SSR artifact plus the reviewed runtime
  contract
- host realization preserves the canonical shared-host target identity from
  deployment metadata rather than inferring it from provider-local state
- publish stages the SSR artifact, activates the reviewed Node runtime, and
  keeps nginx routing pointed at the admitted host target
- built-in smoke validates `https://${appName}.apps.kilty.io/` and any
  declared `healthPath` against the admitted SSR runtime instead of treating
  the artifact like a static asset tree
- records and replay snapshots preserve the SSR runtime-contract provenance
  needed for later retry, rollback, and promotion-safety checks

## 3. Same-Deployment Rollback

Situation:

- a bad production release is already live
- an earlier successful normal-target run remains retained

Expected behavior:

- the operator submits `deploy --deployment //projects/deployments/pleomino-prod:deploy --publish-only --source-run-id <known-good-run-id> --rollback`
- the run is classified as `rollback`
- the current lane policy and control-plane stage state must authorize rollback
- the selected rollback source run may be older than the currently admitted stage revision
- the control plane replays the recorded snapshot for the selected run
- no rebuild occurs

## 4. Cross-Deployment Promotion

Situation:

- `pleomino-staging` and `pleomino-prod` resolve to the same authoritative compatible `lane_policy`
- the lane uses `artifact_reuse_mode = "same_artifact"`
- the source and target deployments may use different reviewed providers as long as the lane and component compatibility contract still matches
- the selected staging run is an earlier admitted candidate that is still eligible under the lane's current promotion policy

Expected behavior:

- the operator submits `deploy --deployment //projects/deployments/pleomino-prod:deploy --publish-only --source-run-id <staging-run-id>`
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

- the operator or automation submits `deploy --deployment //projects/deployments/pleomino-prod:deploy --preview --source-run-id <admitted-run-id>`
- preview is recorded as `publish_mode = preview`
- for same-deployment preview publication, the default `operation_kind` remains `deploy`
- unless the deployment's `admission_policy` explicitly defines a stricter preview posture, the preview run uses the same target-environment source-ref policy and required-check requirements as a normal protected/shared publish for `pleomino-prod`
- by default, previewing that already-admitted artifact does not require a second manual approval
- the effective target identity is the isolated preview target
- the shared/protected preview selector is the admitted source run id, not an ambient branch or commit
- the preview run may still share the normal deployment lock unless the preview also satisfies the stronger independent-execution isolation requirements for a separate preview lock scope
- preview cleanup is a first-class audited `preview_cleanup` operation
- explicit cleanup uses `deploy --deployment //projects/deployments/pleomino-prod:deploy --preview-cleanup --source-run-id <admitted-run-id>`
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
- the operator wants one grouped submission for audit

Expected behavior:

- the operator submits `deploy --from-changes --group`
- impact selection uses explicit `--changed` paths when provided, otherwise the repo's changed-path collector
- deployment-owned path changes select the owning deployment directly
- component-project changes select deployments whose component projects fall in the impacted Buck closure
- broad build-system or unmatched deployment-package changes may widen to all deployments in the safe lane-scoped set
- impact selection widens deterministically according to declared direct prerequisite metadata
- selection widens only one direct prerequisite edge during planning; it does not recursively pull an arbitrary transitive tree
- selection is rejected if the resulting deployments span multiple lanes
- execution remains serial and topological by default
- `ordering_only` prerequisites affect order only
- `ordering_only` still requires one prior successful admitted prerequisite run before the dependent deployment may mutate
- `health_gated` prerequisites require that same ordering proof plus fresh admission-time health evidence against the prerequisite's declared smoke or built-in release-health contract
- the mutating invocation fans out into ordinary per-deployment runs rather than one multi-deployment run record
- every run keeps its own `deploy_run_id`, lifecycle, and final outcome even when the CLI also attaches one shared `deploy_batch_id`
- the selector may over-select for safety but must not under-select

## 10.1 Phase 0 Coordinated Release

Situation:

- the operator promotes the Phase 0 foundation, worker, web, and console
  packages through one lane stage
- providers differ, so the release cannot be atomic

Expected behavior:

- the release remains a batch of ordinary single-provider deployment runs
- add-capability order is foundation/schema, worker, web, console
- removal order is console, web, worker, then foundation cleanup
- each run records its own artifact identity and provider target identity
- all Phase 0 records in the batch share one reviewed source revision unless
  the divergent run has an expiring reviewed compatibility-window exception
- console waits for web readiness, console-to-web runtime config, migration
  evidence, and smoke or release-health evidence before mutating

## 11. Protected/Shared Provision-Only With Immutable Inputs

Situation:

- a reviewed provisioner declares `immutable_resolved_inputs`
- the operator wants provisioning without publish

Expected behavior:

- the operator submits `deploy --deployment //projects/deployments/pleomino-prod:deploy --provision-only --source-run-id <deploy-run-id>`
- the control plane uses the admitted source-run context required by the provisioner
- no rebuild occurs
- publish and release actions do not run

## 12. Rebuild-Per-Stage Promotion

Situation:

- a lane explicitly declares `artifact_reuse_mode = "rebuild_per_stage"`

Expected behavior:

- the operator must not use `--publish-only` for this promotion, because the target stage requires a newly built admitted artifact
- the reviewed operator path is `deploy --deployment //projects/deployments/pleomino-rebuild-staging:deploy --source-run-id <deploy-run-id> --artifact-dir <target-stage-artifact-dir>`
- source-run selection identifies the admitted source revision being promoted
- trusted CI builds a new stage-specific immutable artifact for the target stage
- the control plane admits that target-stage artifact before publish
- exact-artifact source-run reuse is rejected for that promotion flow
- the promotion preserves `release_lineage_id` but does not reuse the earlier stage's `artifact_lineage_id`

## 13. Production Rollback Approval

Situation:

- a production rollback is requested for `pleomino-prod`
- the selected source run is a prior known-good production run
- the deployment requires human approval

Expected behavior:

- the operator submits `deploy --deployment //projects/deployments/pleomino-prod:deploy --publish-only --source-run-id <known-good-run-id> --rollback`
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

- the operator submits `deploy --deployment //projects/deployments/pleomino-prod:deploy --publish-only --source-run-id <known-good-run-id> --rollback`
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

- a protected/shared retry run is queued or paused
- a newer normal deploy is submitted for the same target

Expected behavior:

- the retry is not silently treated as the same thing as a later normal deploy
- the system preserves the retry's own replay intent, lineage, and review posture
- ordinary supersedence policy remains narrow and reviewed

## 18. Deployment-Authority Bootstrap And Reconciliation

Situation:

- the deployment authority itself must be brought up for first install or restored after an outage
- the target declares reviewed bootstrap ownership for deployment-system infrastructure

Expected behavior:

- the operator submits an explicit bootstrap flow with exact immutable admitted artifacts plus explicit bootstrap authority
- bootstrap fails closed unless target identity and ownership proof are explicit and match the reviewed deployment target
- bootstrap records the bounded mutation as bootstrap evidence rather than pretending the normal control plane already exists
- once the normal control plane is available again, bootstrap evidence is reconciled into authoritative records
- after reconciliation, routine updates return to the normal control-plane deploy path instead of continuing through bootstrap

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

- [Deployment Design](/Users/kiltyj/Code/viberoots/docs/deployments-design.md)
- [Deployment Contract](/Users/kiltyj/Code/viberoots/docs/deployments-contract.md)
- [Deployment Schema](/Users/kiltyj/Code/viberoots/docs/deployments-schema.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/viberoots/docs/deployment-provider-capabilities.md)
- [Deployment Implementation Plan](/Users/kiltyj/Code/viberoots/docs/deployment-plan.md)
