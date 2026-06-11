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

## Phase 5: Resume Feature Work

### Intent

Continue control-plane, remote-build, and deployment feature work only after the setup path is
stable.

### Candidate Work

- Continue non-fixture control-plane token resolution hardening if gaps remain.
- Continue remote build/cache readiness work on top of the now-stable cache fallback.
- Continue AWS control-plane setup automation after the setup guide is proven.
- Continue UI/operator workflow work after CLI diagnostics are stable.

### Acceptance Criteria

- New feature PRs include docs and tests for the operator path they affect.
- New work does not add a second config model.
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
