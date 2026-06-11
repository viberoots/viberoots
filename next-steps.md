# Next Steps

## Purpose

The recent control-plane and SprinkleRef work changed the repository's deployment foundation. This
plan turns that work into a stable operator path before adding more abstractions or feature work.

The immediate goal is not another design expansion. The goal is to prove that a clean clone can be
configured, checked, and explained by the current docs and tooling.

## Current State

- The branch started clean and synced with `github/main`; the current workspace now contains the
  first implementation slice plus the documentation consistency pass.
- The default validation path from `i && b && ALL_TESTS=1 v` passed its default verify suite first:
  18 targets passed, with no failures.
- `ALL_TESTS=1` then expanded verify to the full Buck test surface. The first expanded run reached
  `Pass 1423 / Fail 1`; the single failure was
  `root//:deployments_deployment_service_hosted_token_enforcement_docs`. After diagnosing and
  fixing that docs parity gap, a fresh full run passed with `Pass 1424 / Fail 0 / Fatal 0 / Skip 0 /
Build failure 0`.
- The cleanup harness failure was traced to the test using executable marker scripts as dummy process
  command lines. The failing subtest only needed command-line markers, but the prior dummy wasm
  process depended on executing a `.ts` file with `--experimental-strip-types`, which could exit
  before process inspection observed it. The harness now starts stable Node sleeper processes with
  the relevant marker path as an inert argv value.
- A later static-web HMR failure was traced to Vite serving a stale transformed workspace dependency
  module after a dependency edit through pnpm/workspace symlinks and atomic file replacement. Static,
  PWA, and SSR Vite templates now invalidate workspace dependency module-graph entries by realpath,
  and the test helper cache-busts recursive import evaluation.
- A later OCI image failure was traced to a new deployment helper being untracked: local TypeScript
  tests could import it, but the Nix/Git source snapshot used by the OCI test could not. The helper
  and its test case are now staged so the source snapshot includes them.
- The earlier full-suite docs failure was traced to `docs/deployment-secrets-api.md` losing the exact
  hosted-service "required bearer token" wording that the parity test enforces. The API reference
  now explicitly connects `--control-plane-token <token>`, hosted-service bearer-token enforcement,
  and the `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1` local-fixture exception.
- Targeted validation for the deployment changes passed for:
  `root//:deployments_aws_account_local_sprinkleref`,
  `root//:deployments_aws_account_cli`, and `root//:deployments_sprinkleref_command`.
- The final impacted validation set passed for:
  `root//:deployments_aws_account_local_sprinkleref`,
  `root//:deployments_aws_account_cli`, `root//:deployments_sprinkleref_command`,
  `root//:dev_verify_temp_repo_buck_cleanup_scoped`,
  `root//:deployments_deployment_control_plane_profile_validation`, and
  `root//:deployments_deployment_context_control_plane_boundary`.
- Additional focused validation passed for:
  `root//:scaffolding_webapp_static_dev_hmr_local_ts_dep`,
  `root//:scaffolding_webapp_static_pwa_dev_hmr_local_ts_dep`,
  `root//:scaffolding_webapp_ssr_vite_dev_hmr_local_ts_dep`,
  `root//:deployments_control_plane_oci_image`, and
  `root//:deployments_deployment_service_hosted_token_enforcement_docs`.
- `projects/config/shared.json` is the canonical checked-in shared config surface.
- `projects/config/local.json` is the canonical gitignored individual-user config surface.
- Deployment metadata selects named deployment contexts.
- Deployment contexts may select named control-plane profiles.
- Protected/shared deployment paths fail closed when selected control-plane or selected secret
  backend context is missing or invalid.
- Control-plane service-token refs must be `secret://...` or `runtime://...`, never plaintext or
  `config://...`.
- Non-secret shared coordinates such as AWS account ids, Supabase project refs, Infisical project
  ids, Cloudflare zone ids, domains, and service URLs belong in checked-in shared config or
  `config://` values.
- Optional Nix cache outages no longer fail validation by default; strict cache behavior remains
  opt-in with `VBR_NIX_CACHE_POLICY=strict`.
- Whole-suite validation is green after the fixes: `i && b && ALL_TESTS=1 v` completed with the
  default verify phase passing 18 targets and the expanded `ALL_TESTS=1` phase passing 1424 targets.

## Operating Principles

- Freeze the current config model unless a clean setup run proves a real gap.
- Prefer end-to-end setup evidence over additional speculative design.
- Keep `projects` self-contained so it can later become a submodule.
- Keep app packages backend-neutral.
- Treat missing-value diagnostics as part of the product: they must classify values correctly and
  tell an operator exactly where to put the missing value.
- Keep secrets out of checked-in files and out of broad command output.

## Phase 1: Clean-Clone Setup Rehearsal

Status: complete for the documented first-run command path.

### Intent

Run the setup path as if the repository were freshly cloned by a competent operator who has not
followed the prior design discussion.

### Tasks

1. Identify the documented starting point for control-plane setup, especially AWS setup.
2. Confirm what happens when `projects/config/shared.json` exists and `projects/config/local.json`
   does not.
3. Confirm that missing local values degrade gracefully and produce actionable diagnostics.
4. Walk the expected command sequence for:
   - resolver/project config initialization
   - local config initialization
   - `sprinkleref --check`
   - `control-plane aws-account check`
   - AWS account setup readiness checks
   - Infisical/Supabase control-plane prerequisites
5. Record every place where the operator would need external information.

### Acceptance Criteria

- A clean clone reaches a clear "missing values" state without crashing. Status: verified by a live
  temp-repo run of `sprinkleref --init`, idempotent `sprinkleref --init`,
  `sprinkleref --init-local`, `control-plane aws-account config-init --domain deploy.example.com`,
  and `control-plane aws-account check`.
- Missing values are classified as `config://`, `secret://`, or `runtime://` according to value
  type. Status: verified for AWS/Supabase setup coordinates and the Supabase Management API token.
- Diagnostics name the file, config path, ref, selected category or backend, and remediation.
  Status: verified for local operator config and environment-token source output.
- The AWS setup path has one obvious next command at every step. Status: fixed and verified after
  `config-init --domain` no longer prints stale "fill domain" guidance.

### User Input Points

No input is required for the clean setup mechanics. Real account/profile selection remains an
operator decision outside this generic setup rehearsal.

## Phase 2: Documentation Consistency Pass

Status: first pass complete for the docs most likely to affect control-plane setup.

### Intent

Make the setup and reference docs internally consistent and remove stale mental models.

### Tasks

1. Review the user-facing setup docs:
   - `docs/sprinkleref.md`
   - `docs/deployments-usage.md`
   - `docs/deployments-contract.md`
   - `docs/handbook/troubleshooting.md`
   - `docs/nixos-shared-host-setup.md`
   - control-plane setup and runtime docs under `docs/`
2. Identify stale references to:
   - global control-plane URL as the primary protected/shared path
   - context-free fixture secret backend fallback
   - plaintext or `config://` service tokens
   - Infisical literal keys containing `secret://`
   - `control` environment assumptions that should now route to production control-plane context
   - old local config files made obsolete by `projects/config/local.json`
3. Decide which plan documents are still useful and which should be marked completed, superseded,
   or archived.

### Acceptance Criteria

- The docs explain the same config model everywhere. Status: complete for
  `docs/control-plane-guide.md`, `docs/local-sprinkleref.md`,
  `docs/aws-account-control-plane-and-remote-builds.md`, `docs/deployment-secrets-api.md`,
  `docs/deployments-schema.md`, `docs/secrets-usage.md`, and
  `docs/control-plane-selector.md`.
- AWS setup instructions are precise enough to follow without reading the design history. Status:
  improved in `docs/control-plane-guide.md` and validated by the clean setup rehearsal.
- Troubleshooting entries correspond to actual fail-closed diagnostics. Status: not yet broadly
  audited outside the touched control-plane docs.
- Old plans do not look like active implementation instructions when they are already complete.
  Status: complete for `docs/local-sprinkleref-plan.md` and
  `docs/control-plane-selector-plan.md`; both now have historical implementation-plan headers.

### User Input Points

No input is required for the non-destructive cleanup performed here. The plan documents were kept in
place and labeled historical rather than moved or deleted. `docs/control-plane-guide.md` is the
single start-here guide for AWS control-plane setup.

## Phase 3: Setup Smoke Coverage

Status: complete for the current setup stabilization scope.

### Intent

Add focused test coverage for the clean-clone setup shape so future PRs do not silently regress the
operator path.

### Tasks

1. Find existing tests around:
   - project config loading and local overrides
   - deployment context resolution
   - SprinkleRef check output and missing values
   - control-plane AWS account setup/check flows
   - control-plane token ref fail-closed behavior
2. Identify the smallest useful smoke test that covers:
   - checked-in shared config present
   - local config absent
   - local config initialized with placeholders
   - missing values reported with correct classifications
   - selected deployment context and control-plane profile preserved
3. Prefer extending existing fixtures over creating a new parallel harness.

### Acceptance Criteria

- A targeted test fails if `projects/config/local.json` absence crashes setup. Status: covered by
  `aws-account check classifies missing config refs as project config with absent local config`.
- A targeted test fails if non-secret shared values are reported as `secret://`. Status: covered by
  AWS account CLI/local SprinkleRef classification tests.
- A targeted test fails if service-token refs are accepted as plaintext or `config://`. Status:
  covered by control-plane profile validation tests.
- A targeted test fails if selected control-plane profile resolution falls back to ambient globals.
  Status: covered by protected/shared control-plane selector boundary tests.

### User Input Points

No input required. The setup smoke tests use synthetic minimal fixtures, which keeps them focused on
the config model rather than current Pleomino account choices.

## Phase 4: Stale File and Config Pruning

Status: complete for non-destructive user-facing cleanup.

### Intent

Remove files and fixtures made irrelevant by the canonical `projects/config` design, while keeping
useful historical docs clearly labeled.

### Tasks

1. Search for old local config paths and obsolete resolver files.
2. Confirm whether each is:
   - still active
   - superseded but intentionally retained for docs/history
   - generated output
   - safe to delete
3. Remove or update obsolete references in command help, tests, and docs.

### Acceptance Criteria

- There is one committed shared config surface. Status: `projects/config/shared.json`.
- There is one ignored individual local config surface. Status: `projects/config/local.json`.
- Obsolete paths do not appear in user-facing setup instructions. Status: verified for the active
  setup docs touched in this pass.
- Any retained historical docs are clearly marked as historical. Status: complete for the two active
  plan documents most likely to be mistaken for current runbooks.

### User Input Points

No deletion was performed. Ambiguous historical files were labeled rather than removed, so no
approval is needed for this pass.

## Phase 5: Ordered Feature PR Plan

Status: active.

### Intent

Continue control-plane, remote-build, and deployment feature work only after the setup path is
stable. The ordering below is intentional: make the AWS setup path more executable first, then
harden the token boundary it depends on, then build on that stable account/control-plane base for
remote build/cache readiness, and leave richer operator workflow/UI work until the CLI behavior and
diagnostics have settled.

### Ordering

1. AWS control-plane setup automation. Status: landed as PR-1. This comes first because every later
   operator path needs one executable way to ask "what should I do next?" from a clean or partially
   configured clone.
2. Non-fixture control-plane token resolution hardening. Status: landed as PR-2. This comes
   second because the setup plan must not lead operators into a path where protected/shared
   deployments can accidentally use ambient token material.
3. Remote build/cache readiness on top of the stable cache fallback. Status: landed as PR-3. This
   comes third because cache and remote-build readiness should consume the stable account,
   control-plane, and token-selection model rather than defining a parallel readiness model.
4. Operator workflow/UI improvements after CLI diagnostics are stable. Status: in progress as PR-4. This
   comes last because a higher-level summary should present settled CLI state, not become a second
   source of truth while diagnostics are still changing.

This is primarily a sequencing decision, not a scope discovery decision. The useful work is already
described below; the ordering decides which dependency to stabilize first. PR-1 and PR-2 are
foundational. PR-3 depends on those foundations. PR-4 is intentionally delayed until the CLI behavior
and diagnostics from PR-1 through PR-3 are stable enough to summarize.

Coordinator gates:

- Start the next PR only after the current PR has focused tests, docs, self-review, and a committed
  validation result.
- Keep each PR self-contained: implementation, tests, and docs travel together.
- Use subagents for narrow implementation or review packets, but commit from this coordinator only
  after staged changes and validation evidence are checked here.
- If a broad validation run fails and the PR does not include a fix for that failure, stop the PR
  sequence and investigate the root cause before continuing.

Each PR must include tests and docs for the operator path it changes. No PR in this phase should
introduce a second config model or move app packages away from backend-neutral deployment metadata.

## PR-1: AWS setup automation command plan

### 1. Intent

Turn the proven AWS setup guide into an executable operator checklist that can be generated from the
current repo config, stack config, and readiness checks without mutating durable cloud resources.

### 2. Scope of changes

- Add or extend an AWS setup command surface that prints a deterministic next-step plan for a clean
  clone and for a partially configured clone.
- Reuse existing `control-plane aws-account check`, project config, stack config, and SprinkleRef
  resolution helpers instead of adding a parallel setup model.
- Classify each setup step as one of:
  - repo config initialization
  - local operator config initialization
  - shared non-secret project config value
  - secret backend write
  - runtime credential source
  - AWS login/readiness check
  - Supabase account/project/readiness check
  - reviewed IaC/evidence step
- Make the command output source-aware and secret-safe:
  - print refs and config paths
  - do not print secret values
  - do not ask operators to paste tokens into JSON
  - do not imply that provider dashboards are authoritative evidence
- Keep cloud resource mutation out of this PR. Generated commands may point at reviewed IaC,
  readiness, and evidence commands, but must not create a new imperative AWS provisioning path.
- Update AWS setup docs so the generated plan is the normal way to discover the next command after
  first-run initialization.

### 3. External prerequisites

- No live AWS, Supabase, Infisical, or Vault credentials are required for tests.
- Real operators still need their actual AWS account id, AWS organization id, Supabase org id,
  Supabase project ref, Supabase Management API token, and reviewed AWS login outside the synthetic
  test fixtures.

### 4. Tests to be added

- Add CLI tests proving the setup-plan command works when `projects/config/shared.json` exists and
  `projects/config/local.json` is absent.
- Add CLI tests proving initialized local placeholders produce actionable next steps rather than
  crashes or stale guidance.
- Add tests proving non-secret `config://...` values are reported as project config work and true
  `secret://...` values are reported as secret backend work.
- Add tests proving generated output does not include secret values, plaintext token placeholders, or
  instructions to store secret values in JSON.
- Add tests proving reviewed IaC/evidence steps are described as plan/evidence work, not direct
  durable AWS mutation performed by a custom command.

### 5. Docs to be added or updated

- Update [AWS Control Plane Setup Guide](docs/control-plane-guide.md) to make the setup-plan command
  the recommended first diagnostic after initialization.
- Update [AWS Account Control Plane And Remote Builds](docs/aws-account-control-plane-and-remote-builds.md)
  with the same command flow and value ownership model.
- Update command help text for the affected `control-plane aws-account` command surface.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/aws-account*.ts`
  - `build-tools/tools/deployments/control-plane*.ts` only if needed for existing command dispatch
  - `build-tools/tools/tests/deployments/aws-account*.ts`
  - `docs/control-plane-guide.md`
  - `docs/aws-account-control-plane-and-remote-builds.md`

### 6. Acceptance criteria

- A clean clone can ask the repo for the next AWS setup steps without reading design history.
- The generated plan uses the current `projects/config/shared.json` and `projects/config/local.json`
  model.
- Missing shared values, missing local values, missing secrets, and missing runtime credentials are
  classified differently and remediated precisely.
- The command is read-only with respect to durable AWS/Supabase/Infisical/Vault resources.
- Focused tests and docs cover the operator-facing behavior.

### 7. Risks

- A generated checklist can drift from the setup guide and become another stale runbook.
- A command named like automation can be misread as owning durable AWS mutation.
- Adding setup planning could duplicate existing `check` diagnostics.

### 8. Mitigations

- Build the checklist from the same helpers as `check` where possible.
- Label durable provider work as reviewed IaC/evidence steps.
- Keep docs pointed at the generated command as the canonical next-step surface.

### 9. Consequences of not implementing this PR

AWS setup remains documented and tested, but operators still have to translate a long guide into the
next concrete command themselves.

### 10. Downsides for implementing this PR

The CLI surface grows another setup-oriented command that must stay aligned with `check` and the
AWS setup docs.

## PR-2: Control-plane token resolution hardening

### 1. Intent

Close remaining non-fixture token-resolution gaps so protected/shared deployment paths consistently
use selected `secret://...` or `runtime://...` control-plane token refs and never silently fall back
to ambient token material.

### 2. Scope of changes

- Audit protected/shared service-client resolution for ambient URL/token fallback behavior.
- Fail closed when a deployment context selects a control plane but token resolution would require a
  plaintext, `config://...`, missing backend, missing runtime binding, or mismatched ambient value.
- Preserve explicit local fixture and reviewed break-glass paths only where the command surface
  already makes that mode explicit.
- Keep token values redacted in diagnostics, evidence, logs, and generated command output.
- Update docs and troubleshooting for the final selected-token behavior.

### 3. External prerequisites

- No live secret backend credentials are required for tests; use existing fake SprinkleRef/runtime
  credential fixtures.

### 4. Tests to be added

- Add positive tests for selected `secret://...` and `runtime://...` token refs.
- Add negative tests for plaintext, `config://...`, missing backend context, missing runtime binding,
  and ambient token fallback under a selected deployment context.
- Add diagnostics tests proving output names the selected profile/ref without printing token values.
- Add fixture-mode tests proving local fixture token behavior remains explicit and narrow.

### 5. Docs to be added or updated

- Update [Deployment And Secrets API](docs/deployment-secrets-api.md),
  [Deployments Usage](docs/deployments-usage.md), and
  [Troubleshooting](docs/handbook/troubleshooting.md) where token-resolution wording changes.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/*service-client*.ts`
  - `build-tools/tools/deployments/*control-plane*.ts`
  - `build-tools/tools/tests/deployments/*service-client*.ts`
  - `docs/**`

### 6. Acceptance criteria

- Context-selected protected/shared runs cannot use ambient token material by accident.
- All accepted control-plane service-token sources are `secret://...` or `runtime://...`.
- Diagnostics are actionable and redacted.
- Fixture/break-glass behavior remains explicit.

### 7. Risks

- Tightening token resolution can expose existing tests that rely on implicit fixture behavior.

### 8. Mitigations

- Convert tests to explicit fixture mode rather than adding compatibility fallbacks.

### 9. Consequences of not implementing this PR

Protected/shared deployment authority can remain harder to reason about when ambient operator state
is present.

### 10. Downsides for implementing this PR

Some local commands may require more explicit fixture or runtime setup.

## PR-3: Remote build and cache readiness checks

### 1. Intent

Build on the stable optional-cache fallback by giving operators a clear readiness surface for remote
build/cache setup without making optional cache outages fail local validation by default.

### 2. Scope of changes

- Add or extend readiness checks that describe remote build/cache prerequisites and current status.
- Keep optional cache outage handling dynamic and domain-agnostic.
- Preserve strict cache behavior behind explicit opt-in policy.
- Connect AWS setup evidence and cache readiness without making cache setup a prerequisite for the
  basic AWS control-plane setup rehearsal.
- Update docs and troubleshooting for the readiness states.

### 3. External prerequisites

- No live cache server is required for ordinary tests.
- Tests may use fake/unreachable substituter inputs and local fixture config.

### 4. Tests to be added

- Add tests for reachable optional cache, unreachable optional cache, no optional cache, and strict
  cache policy behavior.
- Add tests proving readiness output derives substituter identities dynamically and does not hardcode
  private domains.
- Add tests proving AWS setup/check paths can report cache readiness without failing the basic setup
  flow.

### 5. Docs to be added or updated

- Update [AWS Control Plane Setup Guide](docs/control-plane-guide.md) and relevant handbook
  troubleshooting docs with cache readiness states and strict-policy behavior.

### 5.5. Expected regression scope

- `deployment-only` and build/dev tooling only where cache-health helpers already live.
- Expected implementation paths:
  - existing cache-health/env setup helpers
  - `build-tools/tools/deployments/**` only for readiness surfacing
  - focused tests under existing verify/deployment test surfaces
  - `docs/**`

### 6. Acceptance criteria

- Optional cache outages do not fail default local validation.
- Strict cache policy remains available and fail-closed.
- Readiness diagnostics are dynamic, domain-agnostic, and actionable.

### 7. Risks

- Cache readiness can blur local developer ergonomics with production readiness.

### 8. Mitigations

- Keep default validation and production readiness checks separate in wording and behavior.

### 9. Consequences of not implementing this PR

Remote build/cache setup remains harder to evaluate, even though optional local fallback is stable.

### 10. Downsides for implementing this PR

The readiness surface adds another status category operators must understand.

## PR-4: Operator workflow and UI readiness surface

### 1. Intent

Improve operator workflow after the CLI behavior is stable by presenting setup, readiness, and
diagnostic state in a clearer operator-facing surface without hiding fail-closed CLI behavior.

### 2. Scope of changes

- Identify the existing operator-facing command or UI surface best suited for control-plane setup
  readiness.
- Add a minimal workflow/readiness view that summarizes:
  - selected deployment context
  - selected control plane
  - selected secret backend
  - missing config values
  - missing secret/runtime credentials
  - AWS/Supabase/cache readiness
- Link back to exact CLI commands for remediation.
- Keep the CLI as the source of truth for mutation, evidence, and fail-closed diagnostics.

### 3. External prerequisites

- PR-1 through PR-3 should have landed so the UI/workflow layer can consume stable setup and
  readiness state.

### 4. Tests to be added

- Add rendering or command-output tests for the summary view.
- Add tests proving missing secrets remain redacted.
- Add tests proving remediation commands match the CLI surfaces from earlier PRs.

### 5. Docs to be added or updated

- Update the setup guide and any operator workflow docs to describe the summary view as a navigation
  aid, not a replacement for reviewed setup/check commands.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths depend on the selected existing workflow/UI surface and should be
  kept narrow.

### 6. Acceptance criteria

- Operators can see a concise readiness summary after the setup/check foundations are stable.
- The summary does not expose secrets and does not bypass CLI guardrails.
- Docs and tests cover the workflow.

### 7. Risks

- A UI or summary layer can mask the exact fail-closed diagnostic that operators need.

### 8. Mitigations

- Include exact command remediation and keep detailed diagnostics in the CLI.

### 9. Consequences of not implementing this PR

Setup remains CLI/documentation-driven only.

### 10. Downsides for implementing this PR

The operator surface must be maintained as setup/readiness commands evolve.

- New work does not weaken fail-closed protected/shared behavior.

## Coordination Model

This top-level thread is the coordinator. Subagents should work on narrow work packets and report
findings back here. The coordinator decides ordering, asks the user for input, and performs final
integration.

Initial work packets:

1. Clean setup rehearsal: inspect command behavior and report exact gaps.
2. Documentation consistency: find stale/conflicting docs and propose edits.
3. Smoke coverage: identify the smallest existing test surface to extend.

The coordinator should not merge broad edits until the findings are compared and the user has
answered the relevant input points.

## Initial Findings

### Clean-Clone Rehearsal

Fresh-clone behavior is mostly graceful, but there is one important semantic mismatch.

Assumed state:

- `projects/config/shared.json` exists.
- `config/control-plane/stack.json` exists.
- `projects/config/local.json` is absent.

Observed behavior before the first implementation slice:

- `sprinkleref --init` is not idempotent when checked-in shared config already exists; it fails with
  a raw `EEXIST` instead of saying the repo is already initialized and suggesting
  `sprinkleref --init-local`.
- `sprinkleref --init-local` creates `projects/config/local.json` and writes local placeholders.
- Missing `projects/config/local.json` degrades gracefully in the project config loader.
- `control-plane aws-account check` exits with missing-value diagnostics rather than crashing.
- `sprinkleref --check` correctly exits nonzero in the real repo when required real secrets are not
  present.

Primary gap found by the rehearsal:

- Current `config/control-plane/stack.json` uses non-secret `config://control-plane/...` refs with
  explicit `category: "control"`.
- Explicit category resolution currently bypasses local/project config handling and attempts to
  resolve those non-secret `config://` refs through SprinkleRef.
- The resulting diagnostic can say a non-secret value such as
  `config://control-plane/aws/account-id` is missing in a SprinkleRef category, even though the
  intended owner is shared/local project config.

First implementation slice now applied:

1. Make AWS setup resolve non-secret `config://...` refs from merged project config before any
   SprinkleRef backend path, even when a stack field has an explicit category.
2. Keep `secret://...` refs on the selected SprinkleRef/backend path.
3. Update diagnostics so missing non-secret `config://...` values point at project config, not a
   secret backend category.
4. Make `sprinkleref --init` idempotent for already-initialized repos.
5. Add one setup rehearsal test for shared config plus stack config plus absent local config.

### Documentation Consistency

The highest-priority documentation issue is `docs/control-plane-guide.md`: it is the AWS setup guide
but does not yet describe the canonical config model.

Recommended docs updates:

- Add a "Repo Config Authority" section to `docs/control-plane-guide.md` before prerequisites.
- Clarify `docs/deployment-secrets-api.md` so `--control-plane-token` and
  `VBR_DEPLOY_CONTROL_PLANE_TOKEN` are not presented as the normal protected/shared path when a
  deployment context selects a control plane.
- Update `docs/deployment-secrets-api.md` so Vault and Infisical are both described as supported
  backends.
- Update `docs/local-sprinkleref.md` examples to include `controlPlanes` and per-context
  `controlPlane`.
- Replace the stale `unfair.ly` example domain in `docs/control-plane-selector.md` or make it an
  explicit checked-in shared config example.
- Mark `docs/local-sprinkleref-plan.md` and `docs/control-plane-selector-plan.md` as completed or
  superseded for operator guidance, retained for traceability.

### Smoke Coverage

Status: first focused smoke coverage added for AWS account setup and SprinkleRef initialization.

The smallest useful coverage expansion should use existing test files:

- `build-tools/tools/tests/deployments/deployment-context-control-plane.test.ts` for clean-clone
  shared config and selected context/profile preservation.
- `build-tools/tools/tests/deployments/aws-account-local-sprinkleref.case-2.ts` for local init and
  missing-value classification.
- `build-tools/tools/tests/deployments/deployment-service-client-provider-front-doors.test.ts` for
  ambient global control-plane URL rejection on context-selected protected/shared paths.

Use synthetic minimal fixtures rather than real Pleomino config for the setup smoke tests.

## Immediate Decisions

Resolved for the first implementation slice:

1. Explicit `category` is ignored for non-secret `config://...` AWS setup refs.
   `config://...` resolves through merged project config first.
2. `sprinkleref --init` is idempotent when `projects/config/shared.json` already exists.
3. The first implementation slice covers the semantic fix, targeted tests, and narrow docs updates
   for the changed behavior.

Open follow-up:

- None for this stabilization pass. The fresh `i && b && ALL_TESTS=1 v` run completed green after
  the cleanup, HMR, OCI source-visibility, and docs parity fixes.
