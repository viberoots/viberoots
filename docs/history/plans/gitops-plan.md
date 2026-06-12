# GitOps Alignment Plan

Status: implementation plan, not an operator runbook. Use current deployment docs under `docs/`
for commands and current behavior; update this plan only when continuing this specific PR sequence.

This plan implements the deployment model described in
[Deployment Design Adjustment](../../history/designs/deployment-adjustment.md). The goal is to align the deployment
system with best-practice Git-driven delivery while keeping Buck2, not Kustomize, as the
authoritative deployment composition and validation layer.

Reviewed context:

- The current deployment model already treats `TARGETS` as authoritative metadata, Buck2 as the
  structure/build/validation authority, and the shared control plane as the protected/shared
  mutation authority.
- The current design and contract still contain branch-backed lane requirements such as
  `stage_branches`, `env/<family>/<stage>` refs, and language that treats environment branch state
  as authoritative for promotion.
- The adjusted design removes long-lived environment branches from the normal model. `main` becomes
  the only Git source of deployment configuration.
- The control plane becomes the authoritative source of deployment state: admitted runs, current
  stage state, artifact identities, promotion lineage, approval evidence, rollback candidates,
  lifecycle state, and audit events.
- Release-pointer JSON should not be mirrored into Git by default. If a future governance need adds
  a Git-visible mirror, it must be derived audit evidence, not an authoritative deployment input.
- CI, including Jenkins, may remain Git-driven: Git events decide when to request deployment, CI
  builds and attests immutable artifacts, and the control plane decides whether to admit and execute
  the run.
- Kustomize should not be introduced as the primary base/overlay mechanism. Buck2/Starlark shared
  deployment macros, family defaults, provider-native renderers, and control-plane artifact
  admission should provide the equivalent composition model.
- Kubernetes deployments must use immutable image digests or admitted artifact references, rendered
  manifest/value snapshots or fingerprints, and explicit drift policy. Humans, CI, and scripts must
  not promote by editing YAML, Helm values, mutable tags, or environment branches.
- The repository already has a deployment-impact classifier. Reviewed deployment-owned paths such as
  `build-tools/deployments/**`, `build-tools/tools/deployments/**`, and
  `build-tools/tools/tests/deployments/**` can run the deployment suite instead of the full
  build-system scope, while shared paths such as `build-tools/tools/dev/**`,
  `build-tools/tools/lib/**`, `build-tools/lang/**`, root Buck/Nix config, and unknown
  `build-tools/**` paths correctly broaden to `mixed-build-system`.

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no functionality that lands without tests in the same PR
- no adoption of Kustomize as the primary deployment composition layer
- no long-lived branch-per-environment promotion model
- no hand-maintained Git release-pointer files as an authoritative input
- no mutable image tags as release identity
- no CI or Jenkins path that directly mutates protected/shared targets outside the control plane
- no backwards-compatibility layer for the removed environment-branch model; the repository has no
  deployment users yet, so new GitOps behavior should be clean and unburdened by legacy schema
- no compatibility mode where environment branches and control-plane stage state are both
  authoritative
- no rollback by branch rewind, tag reassignment, or pointer-file edit
- no production rebuild-on-promotion unless the lane explicitly declares `rebuild_per_stage` and the
  target-stage artifact is separately admitted
- no shared verify/dev/lib/lang/build-system edits solely to avoid placing GitOps deployment logic in
  the reviewed deployment-owned implementation area

Each PR below must update this plan if implementation changes invalidate the remaining sequence,
scope, or assumptions.

Completion criteria:

- All protected/shared deployment configuration is sourced from `main` through Buck2 metadata.
- `lane_policy` no longer requires or exposes authoritative `stage_branches`.
- Admission policies use reviewed source-ref policy such as protected `main`, release tags, or
  reviewed commits rather than `env/<family>/<stage>` refs.
- The control plane stores and exposes current stage state for every protected/shared deployment
  stage.
- Promotion, retry, rollback, and preview cleanup operate from admitted run IDs and immutable
  artifact identities without environment branches.
- CI/Jenkins can trigger dev deployment from protected `main` and can request staging/prod
  promotion without bypassing the control plane.
- Buck2/Starlark shared deployment composition replaces Kustomize-style base/overlay usage.
- Kubernetes deployment paths inject admitted immutable image digests or artifact refs, retain
  rendered values/manifests or fingerprints, and detect or reconcile drift explicitly.
- Existing deployment docs, including `docs/history/plans/deployment-plan.md`, `docs/history/designs/deployments-design.md`,
  `docs/deployments-contract.md`, and operator usage docs, are updated by the feature PRs that
  change the corresponding behavior.

Verify-scope sequencing:

- The plan should not need a dedicated full build-system PR if implementation keeps new GitOps
  deployment behavior inside the existing reviewed deployment-owned paths.
- Put source-ref policy, stage state, promotion, CI/Jenkins submission support, Kubernetes render
  evidence, drift handling, operator status, and stale environment-branch enforcement under
  `build-tools/tools/deployments/**` and `build-tools/tools/tests/deployments/**` unless there is a
  clean design reason not to.
- Put Buck deployment metadata and rule changes under `build-tools/deployments/**`.
- Put concrete deployment-package migrations under `projects/deployments/**`; these should classify
  as `deployment-and-project-impact`, not full build-system scope.
- Do not modify shared selector, wrapper, test-loader, dev-tool, generic lib, `build-tools/lang/**`,
  or root Buck/Nix config paths just to wire this feature. If a PR discovers a real clean-design need
  to touch one of those paths, update this plan and isolate that work into the smallest
  `mixed-build-system` PR. Quality and correctness take precedence over scope minimization.
- Expected scope if implementation follows this plan:
  - PR-1: `deployment-and-project-impact` because it changes deployment rules and concrete
    deployment packages.
  - PR-2: `deployment-only`.
  - PR-3: `deployment-only`.
  - PR-4: `deployment-only`.
  - PR-5: `deployment-only`.
  - PR-6: `deployment-and-project-impact` because it changes shared deployment composition and
    concrete deployment packages.
  - PR-7: `deployment-only`, or `deployment-and-project-impact` only if concrete Kubernetes
    deployment packages are migrated in the same PR.
  - PR-8: `deployment-only`.
  - PR-9: `deployment-only`.
  - PR-10: `deployment-only`, or `deployment-and-project-impact` only if final concrete deployment
    package cleanup is included.

Scope-review handoff guidance:

- Before asking for scope review, fix the class of issue, not only the exact lines from the prior
  review. Use broad `rg` sweeps across docs, Buck templates, generated goldens, installers,
  fixtures, concrete deployment packages, and deployment tests for stale model terms and generated
  examples.
- Treat review findings as evidence of a possible pattern. If a reviewer finds one stale
  environment-branch phrase, one branch-backed fixture, or one inert governance field, audit nearby
  surfaces that can express the same old contract.
- PR-1 handoff checklist:
  - no generated or concrete protected/shared lane uses `stage_branches` for normal promotion
  - no normal protected/shared admission policy uses `env/<family>/<stage>` as the source ref
  - no normative deployment doc says environment, stage, normal-branch, or stage-ref state is
    mandatory or authoritative for normal promotion
  - scaffolding templates, scaffolding goldens, fixture installers, cquery fixtures, and concrete
    shared deployment `TARGETS` files all show source-ref lane governance
  - `source_ref_policies`, `trusted_reporter_identities`, and `required_approval_boundaries` are
    documented, extracted, validated, and enforced consistently enough to be meaningful policy
    rather than inert metadata
- If a PR changes generated examples or schema fields, focused validation should include the
  relevant extraction, installer, scaffold, and concrete-package tests before the review handoff.

Future PR churn-reduction notes:

- Before implementation, derive a short removal-surface checklist from the PR acceptance criteria.
  Apply it to production code, normative docs, Buck rules, templates, generated goldens, installer
  helpers, provider fixtures, concrete deployment packages, and deployment tests before the first
  scope-review handoff.
- Treat fixture generators, scaffold templates, installer helpers, and golden examples as part of
  the active contract. If they still emit removed deployment concepts, fix them in the same PR that
  changes the schema or behavior.
- For each removed concept, add both a happy-path test for the replacement behavior and a negative
  semantic test proving the old model is rejected. Prefer deleting stale compatibility paths over
  adding translation shims unless a later PR explicitly depends on a temporary bridge.
- Keep a PR-boundary note when old runtime behavior is intentionally deferred to a later PR. The
  note should distinguish accepted temporary runtime debt from stale schema, generated examples, or
  normative docs that must be fixed in the current PR.
- Validate every affected fixture family directly. Provider-specific paths such as NixOS, Jenkins,
  front-door, mobile, App Store, Google Play, S3, Cloudflare, and Kubernetes should have focused
  selectors when their generated deployment metadata or admission policy shape changes.
- Before declaring ready for scope review, run targeted `rg` sweeps for the old terms named by that
  PR. For this GitOps sequence, likely sweeps include model terms such as `stage_branches`,
  `branch_protections`, `env/`, `authoritative stage`, `stage ref`, `branch-backed`,
  `normal branch`, `target-environment branch`, release-pointer inputs, mutable image tags, and
  provider-specific stale examples.

## PR-1: Lane policy schema without environment branches

### 1. Intent

Remove environment branches from the authoritative lane policy model and establish the new
main-backed lane governance contract.

### 2. Scope of changes

- Remove `stage_branches` as a required lane policy field for protected/shared deployments.
- Replace environment-branch governance with source-ref and promotion governance metadata.
- Update `deployment_lane_policy` and `deployment_lane_governance` Buck rules to express:
  - ordered stages
  - allowed promotion edges
  - artifact reuse mode
  - promotion compatibility
  - reviewed source-ref policy
  - trusted CI/admission reporter identities
  - required approval boundaries
- Update deployment metadata extraction so lane policies no longer emit environment branch mappings
  as authoritative state.
- Update validation to reject new protected/shared lane definitions that require
  `env/<family>/<stage>` branches for normal promotion.
- Migrate existing lane definitions under `projects/deployments/*-shared/TARGETS` to the new shape.
- Keep local-only or historical references out of the normal protected/shared policy path.

### 3. External prerequisites

- Repository maintainers must accept that `env/<family>/<stage>` branches are no longer part of the
  normal promotion model.
- Any external branch-protection automation that exists only for environment branches must be
  retired or replaced by source-ref and control-plane approval policy.

### 4. Tests to be added

- Add Buck extraction tests proving lane policies emit stages, promotion edges, artifact reuse mode,
  and governance without `stage_branches`.
- Add validation tests rejecting protected/shared lane metadata that treats `env/...` branches as
  required promotion state.
- Add fixture migrations for existing platform and Pleomino lane policies.
- Add stale-schema tests proving `stage_branches` is not required for protected/shared lane policy.

### 5. Docs to be added or updated

- Update `docs/history/designs/deployments-design.md`, `docs/deployments-contract.md`,
  `docs/deployments-schema.md`, and `docs/deployments-usage.md` to remove branch-backed lane
  requirements.
- Update `docs/history/plans/deployment-plan.md` where it assumes environment branches are authoritative.
- Document the new lane-governance fields and their Buck rule examples.

### 6. Acceptance criteria

- Protected/shared lane policies can be defined without `stage_branches`.
- Existing concrete deployment lanes build and validate under the new schema.
- No normative deployment doc says environment branches are mandatory or authoritative for normal
  promotion.

### 7. Risks

- Existing code may implicitly use `stage_branches` for admission or promotion eligibility.
- Removing branch mappings too early could create unclear source-admission behavior.

### 8. Mitigations

- Keep this PR focused on schema, extraction, validation, and doc contract changes.
- Fail closed where runtime admission still depends on environment branches until PR-2 replaces that
  logic.

### 9. Consequences of not implementing this PR

The deployment system would retain the branch-per-environment design that the adjustment explicitly
removes.

### 10. Downsides for implementing this PR

It breaks compatibility with any operator workflow or fixture that still assumes
`env/<family>/<stage>` branches.

## PR-2: Main-backed source admission and policy evaluation

### 1. Intent

Make protected/shared source admission resolve reviewed source revisions from protected `main`,
release tags, or explicit reviewed commits instead of environment branches.

### 2. Scope of changes

- Replace environment-branch source admission with a reviewed source-ref policy evaluator.
- Update admission policies so `allowed_refs` can express:
  - protected `main`
  - release tags
  - explicit reviewed commit references
  - future closed source-ref classes without free-form provider heuristics
- Update deploy CLI validation output to show source-ref policy, required checks, required
  approvals, and trusted admission reporters without environment branch language.
- Update control-plane source snapshotting to bind admitted `sourceRevision` to the reviewed source
  ref or explicit commit selected by the request.
- Reject submissions where a client tries to use an `env/...` branch as the normal protected/shared
  source authority.
- Preserve existing exact-artifact replay behavior for retry and rollback where the selected prior
  run remains valid under current policy.

### 3. External prerequisites

- The Git provider must expose enough information for the control plane or CI reporter to prove that
  a submitted source revision is reachable from protected `main`, a reviewed tag, or an explicitly
  reviewed commit.
- CI identities that report checks for `main` must be registered in deployment auth/governance.

### 4. Tests to be added

- Add source-admission tests for protected `main` reachability.
- Add release-tag and explicit-reviewed-commit admission tests.
- Add negative tests for normal protected/shared admission from `env/...` branches.
- Add tests proving required checks and required approvals are evaluated against the new source-ref
  policy.
- Add replay tests proving retry and rollback do not re-read current `main` metadata except for
  narrow current invariant checks.

### 5. Docs to be added or updated

- Update admission-policy examples from `allowed_refs = ["env/..."]` to protected `main`, release
  tags, or reviewed commit policy.
- Update operator docs describing `--validate-only`, `--admit-and-deploy`, and protected/shared
  source selection.
- Update `docs/history/plans/deployment-plan.md` source-admission language to match the adjusted model.

### 6. Acceptance criteria

- A protected/shared deploy can be admitted from a protected `main` revision without an environment
  branch.
- Normal protected/shared admission from `env/...` is rejected.
- Operator-visible validation explains the new source policy in machine-readable and readable forms.

### 7. Risks

- Source-ref policy may become too provider-specific if GitHub details leak into generic admission
  code.
- Replay flows may accidentally become branch-coupled.

### 8. Mitigations

- Use a closed source-ref policy contract with provider adapters below it.
- Keep retry and rollback replay tests explicit and branch-independent unless policy says otherwise.

### 9. Consequences of not implementing this PR

Removing `stage_branches` from schema would not be enough; runtime admission would still rely on the
old branch-backed model.

### 10. Downsides for implementing this PR

It requires reworking source-admission assumptions across CLI, control-plane, fixtures, and docs.

## PR-3: Control-plane current stage state

### 1. Intent

Add authoritative control-plane stage state so operators can answer what is deployed in each stage
without reading Git branches or release-pointer files.

### 2. Scope of changes

- Add a versioned current-stage-state model keyed by deployment id and environment stage.
- Store at least:
  - current run id
  - source run id when applicable
  - source revision
  - artifact identity
  - artifact reuse mode
  - parent run id
  - release lineage id
  - artifact lineage id when exact artifact lineage exists
  - final outcome and update timestamp
- Persist current-stage-state updates transactionally with successful deploy, promotion, rollback,
  and retry outcomes.
- Add read APIs for current stage state and stage history.
- Add CLI/status rendering for "what is deployed and why" using backend-native identifiers.
- Ensure release-pointer JSON in Git is not read or required by any runtime path.

### 3. External prerequisites

- The configured control-plane backend must be durable for protected/shared deployments.
- Backup and retention settings must meet the protection class requirements already described in the
  deployment contract.

### 4. Tests to be added

- Add backend tests for current-stage-state creation and update after successful deploy.
- Add promotion, rollback, and retry tests proving the stage state records parent/source lineage.
- Add status API tests showing current stage state by deployment id and by stage.
- Add negative tests proving no Git release-pointer file is required or trusted.
- Add idempotency tests proving duplicate accepted submissions resolve to the same stage-state
  effect.

### 5. Docs to be added or updated

- Document the current-stage-state schema and retention expectations.
- Update operator usage docs with commands/API examples for inspecting current stage state.
- Update `docs/deployments-contract.md` and `docs/history/plans/deployment-plan.md` to identify control-plane
  state, not Git release pointers, as authoritative.

### 6. Acceptance criteria

- Operators can list current deployed source revision, artifact identity, parent run, and approval
  context for a stage through the control plane.
- Successful deploy, promotion, retry, and rollback update stage state consistently.
- No runtime path depends on a Git-mirrored release pointer.

### 7. Risks

- Stage state can become inconsistent if updated separately from deploy records.
- Operators may lose easy Git-based visibility if status APIs are weak.

### 8. Mitigations

- Update stage state in the same backend transaction or finalized run transition as the deploy
  record.
- Make status output explicit and include enough explanation to replace environment branch
  inspection.

### 9. Consequences of not implementing this PR

The system would remove environment branches without providing an authoritative replacement for
current deployment state.

### 10. Downsides for implementing this PR

It increases the control plane's state-management responsibility and backup importance.

## PR-4: CI and Jenkins artifact admission path

### 1. Intent

Make Git-driven CI deployments first-class without allowing CI to bypass the control plane.

### 2. Scope of changes

- Add or update CI submission contracts for dev deploys from protected `main`.
- Support Jenkins-provided admission evidence for:
  - source revision
  - check results
  - builder identity
  - artifact identity
  - SBOM/signature/provenance references where policy requires them
  - idempotency key
- Ensure the control plane verifies CI identity and `admission_reporter` authority before accepting
  reported checks.
- Ensure CI-submitted artifact references are immutable digests or retained artifact refs, not
  mutable tags.
- Add deploy CLI helpers for Jenkins-safe command generation from Buck deployment metadata.
- Keep Jenkins helper implementation in deployment-owned CLI modules; do not add shared CI wrapper
  or generic dev-tool changes unless that proves necessary for a clean design.
- Reject Jenkins or CI attempts to directly mutate protected/shared targets without service-routed
  admission.

### 3. External prerequisites

- Jenkins credentials and OIDC/client identity must be registered in deployment governance.
- Artifact storage must retain admitted artifacts for the required protection-class window.

### 4. Tests to be added

- Add Jenkins submission contract tests for protected `main` dev deploys.
- Add authorization tests proving `submitter` and `admission_reporter` are distinct capabilities.
- Add negative tests for mutable image tags and laptop-local artifact paths in protected/shared CI
  submissions.
- Add idempotency tests for retried Jenkins submissions.
- Add command-generation tests proving Jenkins helpers derive deployment identity and do not require
  hand-maintained target details.

### 5. Docs to be added or updated

- Document the Git-triggered, CI-built, Buck2-defined, control-plane-admitted flow.
- Add Jenkins examples for dev deploy and staging/prod promotion requests.
- Update deployment auth docs for CI reporter and builder identity requirements.

### 6. Acceptance criteria

- Jenkins can request a dev deployment from a protected `main` SHA using immutable artifact
  evidence.
- The control plane, not Jenkins, remains the mutating authority.
- Unauthorized or mutable-tag CI submissions fail closed.

### 7. Risks

- CI evidence could become a parallel trust channel if not bound to deployment authorization.
- Jenkins helper output may expose secrets or over-broad authority.

### 8. Mitigations

- Reuse the existing deployment auth scope model and redaction rules.
- Bind CI evidence to the same normalized admission payload used by final submit.

### 9. Consequences of not implementing this PR

The deployment system would be control-plane based but not practically Git-driven for routine dev
automation.

### 10. Downsides for implementing this PR

It adds CI identity and evidence contracts that must be maintained alongside operator auth policy.

## PR-5: Promotion without environment branches

### 1. Intent

Make promotion use admitted source-run selectors, lane policy, current stage state, and immutable
artifact identity without consulting environment branches.

### 2. Scope of changes

- Update promotion eligibility to use:
  - selected `--source-run-id`
  - source run's admitted artifact or admitted source revision
  - lane stage ordering and allowed promotion edges
  - target deployment's current policy and approvals
  - current stage state for source and target deployments
  - provider promotion compatibility
- Preserve `same_artifact` promotion as exact artifact reuse.
- Preserve `rebuild_per_stage` promotion as promoted source revision plus newly admitted
  target-stage artifact.
- Record parent run, release lineage, artifact lineage, source run, and target stage state for
  successful promotions.
- Reject promotion attempts that depend on environment branch movement, mutable tags, or
  unretained artifacts.
- Ensure target-environment approval binds to the exact promotion payload.

### 3. External prerequisites

- PR-3 current-stage-state APIs must exist.
- Admitted source artifacts must be retained and retrievable for the target lane's promotion window.

### 4. Tests to be added

- Add `same_artifact` promotion tests from dev to staging and staging to prod without environment
  branches.
- Add `rebuild_per_stage` promotion tests requiring a new target-stage artifact and rejecting
  `--publish-only`.
- Add negative tests for skipped promotion edges, incompatible providers, unretained artifacts, and
  mutable tag promotion.
- Add approval-binding tests for target-environment promotion approval.
- Add stage-state update tests after successful promotion.

### 5. Docs to be added or updated

- Update promotion usage examples to use `--source-run-id` and control-plane state.
- Update design/contract language that says environment branch state is authoritative for
  promotion.
- Update `docs/history/plans/deployment-plan.md` promotion sections to match the adjusted model.

### 6. Acceptance criteria

- Promotion works end to end without environment branches.
- Same-artifact and rebuild-per-stage lanes have distinct, tested behavior.
- Promotion records and stage state preserve lineage and artifact identity.

### 7. Risks

- Promotion eligibility could become too permissive without the old branch gate.
- Rebuild-per-stage could accidentally look like exact-artifact reuse.

### 8. Mitigations

- Keep promotion compatibility as a closed contract.
- Add explicit negative tests around every promotion footgun listed in the adjustment doc.

### 9. Consequences of not implementing this PR

The system would support dev deploys but not safe stage promotion under the adjusted design.

### 10. Downsides for implementing this PR

Promotion logic becomes more dependent on retained run records and artifact storage.

## PR-6: Buck2 deployment-family composition guardrails

### 1. Intent

Use Buck2/Starlark shared deployment composition as the repository-native replacement for
Kustomize base/overlay behavior.

### 2. Scope of changes

- Add shared deployment-family macro patterns for common defaults and controlled stage deltas.
- Make stage-specific deltas explicit for:
  - provider target identity
  - protection class
  - admission policy
  - runtime config requirements
  - secret requirements
  - resource sizing
  - ingress hostnames
  - smoke checks
  - rollout policy
  - prerequisites
- Add validation that rejects duplicate or drifted fields that should come from family defaults.
- Migrate concrete platform and Pleomino deployment packages to the shared-family pattern.
- Keep provider-native config below the Buck metadata layer and validate that it does not
  contradict core deployment facts.

### 3. External prerequisites

- Owners of existing deployment packages must accept minor `TARGETS` reshaping to eliminate
  copy-paste drift.

### 4. Tests to be added

- Add cquery/extraction tests proving shared family defaults flow into concrete stage deployments.
- Add negative tests for drifted provider target, component identity, lane policy, or artifact reuse
  semantics.
- Add provider-native config drift tests where provider config contradicts Buck metadata.
- Add fixture tests for stage-specific allowed deltas.

### 5. Docs to be added or updated

- Document the Buck2 base/overlay replacement pattern.
- Add examples for shared-family Starlark macros and concrete stage deployments.
- Update scaffolding and usage docs that currently imply copy-paste deployment packages are normal.

### 6. Acceptance criteria

- Concrete deployment families use shared Buck/Starlark composition instead of ad hoc repeated
  metadata.
- Validation catches meaningful per-stage drift while allowing reviewed stage deltas.
- No doc recommends Kustomize as the primary composition mechanism.

### 7. Risks

- Overzealous drift validation may reject legitimate stage-specific differences.
- Macro abstraction can hide deployment facts from reviewers if it becomes too clever.

### 8. Mitigations

- Keep allowed stage deltas explicit and visible in extracted metadata.
- Prefer small shared helpers over a framework-style macro layer.

### 9. Consequences of not implementing this PR

The repository would remove Kustomize but lack an equivalent guardrail against duplicated
per-environment config drift.

### 10. Downsides for implementing this PR

It refactors deployment package structure and may create review churn across `TARGETS` files.

## PR-7: Kubernetes immutable render and drift contract

### 1. Intent

Bring Kubernetes deployments into the adjusted model by using admitted immutable artifacts, Buck2
metadata, retained render evidence, and explicit drift handling instead of YAML/tag edits.

### 2. Scope of changes

- Require Kubernetes publish paths to use immutable image digests or admitted artifact references.
- Reject mutable image tags such as `latest`, `dev`, `staging`, or `prod` as deployment identity.
- Inject admitted artifact identities into Helm/provider-native render inputs through the control
  plane.
- Render or validate Kubernetes values/manifests before mutation.
- Preserve rendered values/manifests or stable fingerprints in the execution snapshot.
- Add drift detection or reviewed reconciliation policy for live Kubernetes resources.
- Ensure provider-native config cannot override Buck metadata for cluster, namespace, release,
  ingress mode, health path, service kind, or provider target identity.

### 3. External prerequisites

- Kubernetes artifact producers must emit immutable digest/ref information.
- Kubernetes credentials must be available through declared secret requirements, not ambient
  kubeconfig.

### 4. Tests to be added

- Add Kubernetes admission tests for immutable digest injection.
- Add negative tests for mutable tags and ambient kubeconfig/Helm credentials.
- Add rendered manifest/value snapshot tests.
- Add drift detection tests for live state mismatch.
- Add provider config drift tests for cluster, namespace, release, ingress, and service identity.
- Add promotion and rollback tests proving Kubernetes reuses admitted artifact identity rather than
  re-rendering from current mutable inputs.

### 5. Docs to be added or updated

- Document Kubernetes digest injection and render-snapshot behavior.
- Update Kubernetes deployment usage examples to avoid YAML/tag edits.
- Update secrets docs to emphasize declared Kubernetes publish credentials.

### 6. Acceptance criteria

- Kubernetes protected/shared mutation uses admitted immutable artifact identity.
- Render evidence is retained for replay safety.
- Manual or CI-driven YAML/tag edits are not part of the promotion path.
- Drift policy is explicit and tested.

### 7. Risks

- Retaining rendered manifests may expose secret-bearing values if redaction is incomplete.
- Some Helm charts may produce nondeterministic output.

### 8. Mitigations

- Persist redacted manifests or fingerprints when raw rendered output cannot be proven secret-safe.
- Add deterministic rendering checks and reject nondeterministic provider config where replay safety
  depends on it.

### 9. Consequences of not implementing this PR

Kubernetes would remain the main gap between the Buck2/control-plane model and practical GitOps
best-practice alignment.

### 10. Downsides for implementing this PR

It tightens Kubernetes publish contracts and may require changes to existing chart/value patterns.

## PR-8: Retry, rollback, and preview cleanup under control-plane stage state

### 1. Intent

Finish source-run-scoped operational flows without branch rewinds, pointer edits, mutable tags, or
ambient provider state.

### 2. Scope of changes

- Ensure rollback uses a prior known-good admitted run for the same deployment and normal live
  target.
- Ensure rollback updates current stage state with the rollback run while preserving parent/source
  lineage.
- Ensure retry reuses the recorded admitted artifact and replay snapshot according to current
  policy.
- Ensure preview publish and preview cleanup use explicit preview identity selectors and admitted
  source-run lineage.
- Reject rollback by branch rewind, mutable tag reassignment, release-pointer edit, or current
  workspace rebuild.
- Preserve data-compatibility checks for release actions before rollback.
- Ensure current-stage-state APIs expose rollback candidates and retry lineage clearly.

### 3. External prerequisites

- Prior deploy records and artifacts must be retained for the documented rollback/retry windows.
- Release actions must declare replay and data-compatibility behavior.

### 4. Tests to be added

- Add rollback tests for prior known-good admitted runs.
- Add negative rollback tests for failed runs, preview runs, removed targets, mutable tags, and
  branch/pointer-based rollback attempts.
- Add retry tests proving recorded artifacts and snapshots are reused.
- Add preview cleanup tests proving explicit preview identity and source-run lineage are required.
- Add stage-state tests showing rollback and retry lineage in operator output.

### 5. Docs to be added or updated

- Update rollback, retry, and preview cleanup usage examples.
- Update contract language that references target normal branch behavior for preview where it should
  now reference source-ref policy and admitted lineage.
- Update `docs/history/plans/deployment-plan.md` replay and rollback sections to match control-plane stage state.

### 6. Acceptance criteria

- Retry, rollback, and preview cleanup work without environment branches or Git release pointers.
- Rollback candidates are visible and policy-filtered.
- Replay uses admitted snapshots plus narrow current invariant checks.

### 7. Risks

- Rollback may be unsafe when release actions or external state changed after the prior run.
- Preview cleanup may accidentally target normal live resources if identity handling is loose.

### 8. Mitigations

- Keep rollback candidate selection conservative.
- Require explicit preview identity selectors and provider isolation checks.

### 9. Consequences of not implementing this PR

Normal deploy and promotion could align with the adjusted design while operational recovery flows
still depend on old or unsafe assumptions.

### 10. Downsides for implementing this PR

It may make some previously convenient ad hoc retries or rollbacks fail closed until records and
artifacts are complete.

## PR-9: Operator status, audit, and resilience surfaces for release state

### 1. Intent

Make the control-plane-owned release-state model operationally usable and auditable enough to
replace environment branch inspection.

### 2. Scope of changes

- Add or finalize operator commands/API responses for:
  - current deployed state by deployment
  - current deployed state by lane/stage
  - promotion lineage
  - artifact identity
  - source revision
  - approval state
  - required checks
  - rollback candidates
  - drift status
  - retained render evidence
- Add audit events for stage-state updates and promotion/rollback lineage.
- Add deployment-owned backup/restore validation hooks or checks for current stage state and
  retained artifacts.
- Add deployment-owned metric/status payload surfaces needed to operate current stage state,
  in-doubt recovery, and drift.
- Ensure all status/audit surfaces are secret-safe by construction.

### 3. External prerequisites

- Operators must have access to the control-plane status API or CLI for protected/shared
  deployments.
- Control-plane backend backup settings must be configured for the protection class.

### 4. Tests to be added

- Add status-format tests for current stage state and explanation fields.
- Add audit-event tests for deploy, promotion, retry, rollback, cancellation, and recovery updates.
- Add secret-redaction tests for status and audit payloads.
- Add backup/restore fixture tests covering current stage state and artifact references.
- Add drift status reporting tests.

### 5. Docs to be added or updated

- Document operator inspection workflows replacing environment branch inspection.
- Document audit and retention expectations for current stage state.
- Update troubleshooting docs for drift, in-doubt runs, missing artifacts, and failed approvals.

### 6. Acceptance criteria

- Operators can answer "what is deployed in prod and why" from the control plane alone.
- Audit events preserve who/what/when/why for deployment state changes.
- Status output is secret-safe and includes backend-native identifiers.

### 7. Risks

- Status output can become noisy or leak internal implementation details.
- Audit payloads can accidentally persist secret-bearing provider data.

### 8. Mitigations

- Keep response contracts versioned and closed.
- Persist stable references, fingerprints, and redacted summaries instead of raw provider payloads
  when secret safety is not proven.

### 9. Consequences of not implementing this PR

The adjusted model would be technically correct but operationally weaker than branch-inspection
workflows.

### 10. Downsides for implementing this PR

It adds product surface area and long-term API compatibility obligations.

## PR-10: Remove stale environment-branch paths and complete doc alignment

### 1. Intent

Complete the migration by removing stale environment-branch code paths, adding enforcement against
regression, and aligning the remaining deployment docs with the adjusted model.

### 2. Scope of changes

- Remove obsolete runtime code that fetches, snapshots, advances, or validates
  `env/<family>/<stage>` branches for normal protected/shared deployment.
- Remove stale fixtures and examples that model environment branches as authoritative.
- Add deployment-domain source enforcement that fails on new normative environment-branch
  requirements outside historical migration notes or explicitly allowed tests. Keep this enforcement
  under deployment-owned tests instead of adding a generic stale-name/dev-tool rule unless the
  generic path is genuinely required.
- Ensure `deployment_lane_policy`, `deployment_lane_governance`, admission, promotion, rollback,
  retry, preview, CI, Kubernetes, and operator docs consistently use the adjusted model.
- Update `docs/history/plans/deployment-plan.md` so it is fully aligned with `docs/history/designs/deployment-adjustment.md` and
  no longer describes branch-backed lanes as a target-state requirement.
- Keep `docs/history/designs/deployment-adjustment.md` as a concise addendum or fold its stable content into the
  normative docs if the repository convention prefers that after implementation.

### 3. External prerequisites

- All earlier PRs in this plan must have landed.
- Operators must have migrated to control-plane status and promotion commands.

### 4. Tests to be added

- Add stale-reference enforcement for active source and normative docs that fails on mandatory
  `stage_branches`, `env/<family>/<stage>` promotion, or environment branch as normal source
  authority.
- Add end-to-end tests proving dev deploy, staging promotion, prod promotion, retry, rollback, and
  Kubernetes render paths work without environment branches.
- Add CLI help and usage snapshot tests proving old branch-oriented guidance is absent.
- Add regression tests proving no deploy path reads Git release-pointer files as authoritative.

### 5. Docs to be added or updated

- Update all remaining deployment design, contract, usage, scenario, schema, implementation-plan,
  CI, Kubernetes, secrets, and operator docs touched by branch-backed assumptions.
- Document the final phrasing:
  "Git-triggered, CI-built, Buck2-defined, control-plane-admitted deployments."
- Document any explicitly historical or deprecated environment-branch material as non-normative.

### 6. Acceptance criteria

- `docs/history/plans/deployment-plan.md` is fully aligned with the adjusted design.
- Active code and normative docs no longer require environment branches for protected/shared
  deployment.
- End-to-end tests cover the adjusted dev, promotion, retry, rollback, and Kubernetes paths.
- Stale environment-branch assumptions are guarded by tests or enforcement.

### 7. Risks

- Broad stale-reference cleanup can accidentally rewrite historical context or useful migration
  notes.
- Final end-to-end tests may be slow or fixture-heavy.

### 8. Mitigations

- Keep enforcement scoped to active source and normative docs.
- Use targeted fixture-based e2e tests where real providers are not required.

### 9. Consequences of not implementing this PR

The implementation could work, but stale docs and dead code would keep reintroducing
branch-backed-lane assumptions.

### 10. Downsides for implementing this PR

This PR is cleanup-heavy and may touch many docs and fixtures after the main behavior already works.
