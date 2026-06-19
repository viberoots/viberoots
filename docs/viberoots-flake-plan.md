# Viberoots Flake And Buck Cell Implementation Plan

This plan implements the split described in
[`docs/viberoots-flake.md`](viberoots-flake.md): project code remains in the consuming workspace
under `projects/`, while reusable viberoots tooling becomes a separately versioned Nix flake and
Buck cell, initially consumed through a local `viberoots/` submodule.

Reviewed context:

- [`docs/viberoots-flake.md`](viberoots-flake.md) defines the target architecture: explicit
  `workspaceSrc`, local `.viberoots/current` indirection, `workspace_providers` for generated
  provider glue, viberoots as a Buck cell, and all user-facing executables provided by Nix.
- [`docs/history/process/turbo-mode.md`](history/process/turbo-mode.md) allows focused validation
  per PR, milestone full validation, and an integration debt ledger when the team explicitly accepts
  faster execution at limited short-term integration risk.
- [`build-tools/docs/build-system-design.md`](../build-tools/docs/build-system-design.md) remains
  the source of truth for Buck as graph authority, Nix as hermetic tool provider/artifact builder,
  importer-scoped lockfiles, generated provider glue, and build-system validation expectations.
- Current validation found the architecture feasible, but the implementation is root-coupled:
  many paths still assume `//build-tools`, `$WORKSPACE_ROOT/build-tools`,
  `$FLK_ROOT/build-tools`, and `//third_party/providers`.

Non-goals:

- no attempt to redesign `projects/apps/*` and `projects/libs/*` project label conventions
- no docs-only PRs
- no tests-only PRs
- no functionality that lands without tests and documentation for its scope
- no switch away from Nix-provided user-facing tools
- no permanent top-level `third_party/` provider layout
- no hidden copy of viberoots for local submodule mode; local mode must use the live checkout
- no provider dependency on Buck for installing command-line tools
- no external project template before the in-repo dogfood workspace passes its de-risking gates
- no compatibility shims, legacy migration paths, or support for the pre-split monorepo
  build-system layout after the viberoots split. There are no external users yet, so PRs 8-10
  should make the repository clean before users exist rather than preserving old root-cell paths.
- This does not remove supported viberoots source modes. The clean design must keep supporting a
  local top-level `viberoots/` directory, `viberoots/` as a Git submodule, and a remote
  flake/source-store viberoots source for external consumers.
- Consumer workflows must treat `VIBEROOTS_ROOT` as read-only reusable source. This is required for
  remote flake/source-store mode, where the resolved source may live in the immutable Nix store, and
  it keeps local submodule mode honest. Normal `i`, `b`, `v`, provider generation, graph export,
  hash update, and status flows must write generated state under `WORKSPACE_ROOT`, primarily
  `.viberoots/workspace/**`, root `buck-out/`, or `projects/**` according to ownership. They must
  not rely on creating or cleaning generated workspace state inside the reusable viberoots source
  checkout.
- The unsupported legacy layout is root `build-tools/`, root `prelude/`, root `toolchains/`, root
  `third_party/providers/`, `//build-tools` loads, `//third_party/providers` labels, shims that
  forward old paths or labels to the new cells, and provider generation that writes both old and new
  provider locations.

Turbo-mode policy for this plan:

- Use focused validation for each PR.
- Run scope review for every PR before commit.
- Every PR is expected to leave the repository with tests passing for its declared scope. Turbo mode
  changes how much validation is run before merging a PR; it does not permit known failing tests or
  broken workflows to be carried forward.
- Record deferred broad validation in an integration debt ledger in this plan.
- Run full validation at the explicit de-risking checkpoints below. The default plan requires two
  full-suite runs.
- Treat shared Nix/Buck/root-resolution changes as high risk even in turbo mode; those PRs need
  broader targeted validation than docs or fixture-only PRs.
- If focused validation fails, investigate the root cause before continuing. Do not add fallbacks
  that hide root-coupling bugs.
- Do not weaken test assertions to make the turbo cadence pass. Do not delete tests, narrow tested
  behavior, lower expected coverage, remove negative checks, replace end-to-end checks with weaker
  smoke checks, or accept looser output matching unless the plan explicitly changes the product
  contract and adds an equal-or-stronger assertion for the new contract.
- Do not remove repository functionality to make tests pass. Checkpoint fixes must preserve the
  user-visible and build-system capabilities already present in the repo, unless this plan is
  explicitly amended to deprecate that functionality with rationale, migration notes, and
  replacement coverage.
- When a test fixture changes, keep the assertion at the same behavioral strength or replace it with
  a direct assertion of the same contract. Fixture drift should be fixed by making the fixture match
  the current intended workspace shape, not by dropping the behavior under test.
- From PR-7 onward, temporary repos used in tests should mirror the target workspace shape unless a
  test is explicitly about invalid legacy input: root-level product code under `projects/`, a
  root-level `viberoots/` source checkout or fixture, `.viberoots/current` pointing at
  `../viberoots` for local-mode temp repos where root layout matters, and generated Buck/provider
  state under `.viberoots/workspace/**`.
- After the extraction boundary, active project/root Buck loads must use
  `@viberoots//build-tools/...`; generated providers must live only under
  `.viberoots/workspace/providers` and be addressed as `workspace_providers//...`; generated Buck
  state under `.viberoots/workspace/buck` is part of the clean external workspace contract.
- Scope review for consumer workflows must distinguish required hidden workspace state from
  source-checkout pollution. Parent `.viberoots/` is required; `viberoots/.viberoots/`,
  `viberoots/buck-out/`, root `build-tools/`, and root `build-tools/tmp` created by a consumer
  `v`/`i`/`b` run are failures to investigate at the creation path, not artifacts to accept because
  a final cleanup step deletes them.
- Root `build-tools/`, root `third_party/providers/`, and root `prelude/` or `toolchains/`
  compatibility surfaces must not remain after the extraction boundary unless they are test-only
  fixtures explicitly modeling invalid legacy input.

De-risking checkpoints:

- **Checkpoint A after PR-1:** prove the proposed Buck and Nix mechanics in isolated fixtures before
  touching production root layout.
- **Checkpoint B after PR-4:** prove provider relocation and generated-state relocation still pass
  focused language/provider validation before broad Starlark load conversion.
- **Checkpoint C after PR-7:** prove the in-repo dogfood shape works with `.viberoots/current`,
  `workspace_providers`, and public `@viberoots//...` loads before extraction.
- **Checkpoint D after PR-9:** prove local submodule mode reflects live edits immediately and the
  root flake delegates to `./viberoots`.
- **Final checkpoint after PR-10:** prove remote viberoots consumption works from an external
  fixture, close the integration debt ledger, and run targeted final validation unless PR-10 changes
  shared Buck/Nix/build logic.

Turbo validation cadence:

- Each PR must run and pass the focused validation listed below, including any new or changed tests
  for that PR. If a full-suite run is deferred, the PR should still be treated as green only when the
  targeted evidence is clean and there are no known failures in affected areas.
- PR-1: focused fixture validation; no full validation unless probes touch production paths.
- PRs 2-3: focused validation plus nearby root-resolution, activation, and command-entrypoint
  tests.
- PR-4 / Checkpoint B: run focused provider/language validation, Buck graph/export validation, and
  prebuild guard validation. Record any deferred broad validation in the ledger.
- PRs 5-6: focused validation plus broad targeted Buck parse and Nix flake/devshell checks.
- PR-7 / Checkpoint C: run broad targeted validation over Buck, Nix, provider sync, scaffolding,
  and representative project builds, plus the first mandatory full `i && b && ALL_TESTS=1 v`.
  Review touched temp-repo fixtures for current workspace shape and assertion strength before
  closing the checkpoint.
- PR-8: focused root-flake and status validation.
- PR-9 / Checkpoint D: mandatory full `i && b && ALL_TESTS=1 v` because physical extraction,
  submodule setup, and hard legacy cleanup are high risk. Include a fixture-shape review proving
  temp repos use top-level `projects/`, top-level `viberoots/`, the same
  `.viberoots/current -> ../viberoots` local-mode contract expected from consuming workspaces, and
  no active old-layout root compatibility surfaces.
- PR-10 / Final checkpoint: targeted remote-fixture validation, targeted reruns for touched
  subsystems, integration debt review, and plan assessment. Run a third full suite only if PR-10
  changes shared Buck/Nix/build logic beyond the fixture/template surface.

Combined PR decisions:

- PR-2 combines root-resolution helpers, tool-provisioning enforcement, and status command basics
  because they all define the same two-root contract.
- PR-3 combines activation and `.viberoots/current` handling because Buck cell paths are not useful
  without a deterministic activation path.
- PR-4 combines provider relocation and generated Buck-state relocation because both are
  workspace-generated state moves. Any temporary dual-read behavior introduced before extraction is
  a PR-9 cleanup blocker, not a supported migration contract.
- PR-6 combines `mkWorkspace` and version metadata because remote/local version reporting depends on
  the flake API shape.
- PR-10 combines remote fixture, release pinning, and final reconciliation because the remote
  fixture is the final proof that the local split generalizes.

Work is intentionally not combined across PR-7, PR-8, and PR-9. Those are separate de-risking gates:
dogfood layout, root flake delegation, and physical extraction/submodule setup each can fail for
different reasons.

Integration debt ledger:

| PR     | Commit                                   | Focused validation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Deferred validation                                                                                                                                                                                                         | Notes                                                                                                                                                                                                                                                                                                                                              |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR-1   | f949c848938db2376f7f68a26941de57a030fa43 | `v //:viberoots_buck_cell_fixture //:viberoots_nix_split_flake_fixture //:viberoots_root_coupling_inventory` (`buck-out/tmp/codex-test-logs/pr1-focused-v-20260612-164154.log`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Full `i && b && ALL_TESTS=1 v` deferred by Checkpoint A because PR-1 is fixture-only and does not touch production build paths                                                                                              | Baseline root-coupling counts recorded below                                                                                                                                                                                                                                                                                                       |
| PR-2   | 71c88a11a427e5189a1c1eddee37db4943b49a96 | `v //:lib_repo_find_repo_root_workspace_env //:lib_tool_paths_prefers_nix //:tools_export_inline_flags_wiring //:scaffolding_export_graph_noop //:node_providers_node_activation_by_pnpm_lock_detect_enabled //:python_providers_python_activation_by_uv_lock_detect_enabled //:buck_sync_providers_wrapper_entrypoints_removed //:dev_runnable_commands_selected_fast_path //:nix_remote_worker_tools //:lang_nix_action_runner_cmd_snippets_cquery //:lang_nix_calling_rules_command_assembly_enforcement //:cpp_cpp_filtered_flake_build_path_integration //:nix_viberoots_devshell_command` (`buck-out/tmp/codex-test-logs/pr2-thirdfix-focused-v-20260612-174030.log`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Full `i && b && ALL_TESTS=1 v` deferred by turbo cadence for PR-2; Checkpoint B after PR-4 is the next broad validation gate                                                                                                | High-risk root/tool-entrypoint scope covered by broader targeted validation                                                                                                                                                                                                                                                                        |
| PR-3   | 902a1c70a78e776a51e52c85cccc7db862ecccc4 | `v //:lib_workspace_activation //:dev_startup_check_viberoots_activation //:dev_startup_check_buck_prelude //:nix_viberoots_devshell_command //:lib_repo_find_repo_root_workspace_env //:lib_tool_paths_prefers_nix` (`buck-out/tmp/codex-test-logs/pr3-narrow-focused-v-20260612-181431.log`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Full `i && b && ALL_TESTS=1 v` deferred by turbo cadence for PR-3; Checkpoint B after PR-4 is the next broad validation gate                                                                                                | Activation, shell-entry refresh, local/remote current symlink, stale cell-path, root/status, startup-check, and tool-path coverage                                                                                                                                                                                                                 |
| PR-4   | accadc3a4ff92c71a4c89f6079f48430b77865fa | `v` Checkpoint B focused provider/language, graph/export, source-snapshot, and prebuild selectors (`buck-out/tmp/codex-test-logs/pr4-recovered-focused-checkpoint-b-20260612-212235.log`); export/cquery/prebuild smoke (`buck-out/tmp/codex-test-logs/pr4-recovered-graph-export-cquery-smoke-20260612-212556.log`); scope-fix affected tests (`buck-out/tmp/codex-test-logs/pr4-scopefix-affected-tests-rerun-20260612-213345.log`, `buck-out/tmp/codex-test-logs/pr4-scopefix2-affected-tests-20260612-213947.log`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Full `i && b && ALL_TESTS=1 v` deferred by turbo cadence; Checkpoint B focused provider/language, Buck graph/export, source-snapshot, prebuild guard, and full recursive `b` passed                                         | Generated provider and Buck state relocation verified through `.viberoots/workspace/**`, `workspace_providers` cquery/deps evidence, and dual-read migration tests                                                                                                                                                                                 |
| PR-5   | 7f07e7e0f1407dab3b1b56a24078f8e15f361b55 | Buck parse checks: `buck2 targets viberoots//build-tools/...` (`buck-out/tmp/codex-test-logs/pr5-buck-targets-viberoots-build-tools-20260612.log`) and `buck2 targets //projects/...` (`buck-out/tmp/codex-test-logs/pr5-buck-targets-projects-20260612.log`); gates after scaffold scope fix: `pnpm -s run lint` (`buck-out/tmp/codex-test-logs/pr5-provider-contract-lint-20260612.log`), `pnpm -s run fmt:check` (`buck-out/tmp/codex-test-logs/pr5-provider-contract-fmt-check-20260612.log`), `zx-wrapper build-tools/tools/dev/file-size-lint.ts --scope=source --fail=true` (`buck-out/tmp/codex-test-logs/pr5-scopefix-file-size-20260612.log`); provider contract affected tests (`buck-out/tmp/codex-test-logs/pr5-provider-contract-affected-v-20260612.log`, `buck-out/tmp/codex-test-logs/pr5-provider-contract-extra-affected-v-20260612.log`); final focused `v` selectors with provider-contract tests listed in PR-5 evidence log (`buck-out/tmp/codex-test-logs/pr5-provider-contract-final-focused-v-rerun-20260612.log`)                                                                                                                                                                                                                                                                                                                                                                                               | Full `i && b && ALL_TESTS=1 v` deferred by turbo cadence for PR-5; Checkpoint C after PR-7 is the next full-suite gate                                                                                                      | Buck load conversion is high-risk parsing scope; focused validation covered public viberoots loads, direct workspace provider-map contract, scaffold templates, project parsing, templates, load-style guards, and nix-gaps doc parser compatibility                                                                                               |
| PR-6   | 948d9c4737f7072eee6b9078206114840d4a17c3 | `pnpm -s run lint` (`buck-out/tmp/codex-test-logs/pr6-recovered-lint-rerun-20260612.log`), `pnpm -s run fmt:check` (`buck-out/tmp/codex-test-logs/pr6-scopefix-source-root-fmt-check-rerun-20260612.log`), `zx-wrapper build-tools/tools/dev/file-size-lint.ts --scope=source --fail=true` (`buck-out/tmp/codex-test-logs/pr6-file-size-20260612.log`); Nix eval metadata/API smoke (`buck-out/tmp/codex-test-logs/pr6-nix-eval-lib-20260612.log`); direct new test smoke (`buck-out/tmp/codex-test-logs/pr6-direct-new-tests-20260612.log`); Nix build smoke for `.#viberoots`, `.#zx-wrapper`, and `.#buck2-prelude` (`buck-out/tmp/codex-test-logs/pr6-nix-build-smoke-20260612.log`); Buck parse checks `buck2 targets viberoots//build-tools/...` and `buck2 targets //projects/...` (`buck-out/tmp/codex-test-logs/pr6-buck-targets-viberoots-build-tools-20260612.log`, `buck-out/tmp/codex-test-logs/pr6-buck-targets-projects-20260612.log`); focused `v //:nix_flake_version_metadata //:viberoots_nix_split_flake_fixture //:nix_viberoots_devshell_command //:nix_devshell_tools_path_smoke` (`buck-out/tmp/codex-test-logs/pr6-recovered-focused-v-20260612.log`); source-root scope-fix affected tests (`buck-out/tmp/codex-test-logs/pr6-scopefix-source-root-affected-v-rerun-20260612.log`) and output-shape eval (`buck-out/tmp/codex-test-logs/pr6-scopefix-source-root-output-shape-20260612.log`)                     | Full `i && b && ALL_TESTS=1 v` deferred by turbo cadence for PR-6; Checkpoint C after PR-7 is the next full-suite gate                                                                                                      | High-risk Nix flake API and split-root source handling covered by focused Nix eval/build/devshell tests, direct Buck parse checks, generated Buck test selectors, and source-root app/devshell scope-fix checks                                                                                                                                    |
| PR-7   | _pending_                                | Gates: `pnpm -s run lint` (`buck-out/tmp/codex-test-logs/pr7-lint-rerun-20260612.log`), `pnpm -s run fmt:check` (`buck-out/tmp/codex-test-logs/pr7-fmt-check-rerun-20260612.log`), `zx-wrapper build-tools/tools/dev/file-size-lint.ts --scope=source --fail=true` (`buck-out/tmp/codex-test-logs/pr7-file-size-rerun-20260612.log`); Nix devshell dogfood tool smoke (`buck-out/tmp/codex-test-logs/pr7-nix-develop-dogfood-tools-20260612.log`); provider/glue refresh `i --glue-only` (`buck-out/tmp/codex-test-logs/pr7-provider-glue-only-20260612.log`); Buck project/provider/root-shim parse and provider cquery (`buck-out/tmp/codex-test-logs/pr7-buck-parse-provider-cquery-20260612.log`); representative project builds with `--target-platforms prelude//platforms:default` (`buck-out/tmp/codex-test-logs/pr7-project-builds-target-platform-20260612.log`); focused `v //:dev_dogfood_current_layout //:lib_repo_find_repo_root_workspace_env //:lib_workspace_activation //:nix_viberoots_devshell_command //:nix_devshell_tools_path_smoke //:regression_provider_wiring_e2e //:e2e_provider_wiring //:scaffolding_gen_auto_map_scaffold_smoke //:scaffolding_sync_providers_node_importer_local_visibility //:scaffolding_scaf_live_repo_guard` (`buck-out/tmp/codex-test-logs/pr7-focused-v-rerun-20260612.log`)                                                                                                       | Mandatory full `i && b && ALL_TESTS=1 v` not run yet; deferred until the separate PR-7 scope review authorizes final validation                                                                                             | Checkpoint C targeted evidence passed for `.viberoots/current -> ..`, local `VIBEROOTS_ROOT`, active `workspace_providers`, live-edit visibility through `.viberoots/current`, provider generation/consumption, scaffolding coverage, and representative `projects/` builds                                                                        |
| PR-7.5 | _planned_                                | Planned after PR-7 commit: separate pnpm provisioning policy cleanup that keeps `v` temp-repo provisioning behavior as-is for now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Required before PR-8 because root flake delegation should not inherit consumer/build paths that repair pnpm state or fall through to the live npm registry                                                                  | Separates `i` provisioning responsibility from `b` consumer/build responsibility without weakening tests, removing functionality, or moving tooling out of Nix                                                                                                                                                                                     |
| PR-10  | _pending scope review and commit_        | Post-scope-fix focused validation from the parent workspace: `i` (`.codex-logs/pr10/focused-expanded-parent-i-20260619-1529.log`), `b` (`.codex-logs/pr10/focused-expanded-parent-b-20260619-1529.log`), and `v viberoots//:viberoots_remote_consumer_fixture viberoots//:viberoots_nix_split_flake_fixture viberoots//:lib_workspace_activation viberoots//:dev_nix_build_filtered_flake_cpp_selected_scope` (`.codex-logs/pr10/focused-expanded-parent-v-rerun-20260619.log`; verify log `/Users/kiltyj/Code/viberoots/.viberoots/buck/verify-logs/verify-2026-06-19T19-39-10-003Z-25643-d725326f3ec4e.log`); direct expanded remote-consumer fixture passed after lock-refresh in `.codex-logs/pr10/direct-remote-consumer-after-lock-refresh-20260619.log`; optional real GitHub flake import smoke is gated by `VIBEROOTS_REAL_REMOTE_REF=github:OWNER/viberoots/REF` on `viberoots//:viberoots_remote_consumer_fixture`; focused target rerun passed in `.codex-logs/pr10/focused-remote-consumer-after-lock-refresh-v-20260619.log` (verify log `/Users/kiltyj/Code/viberoots/.viberoots/buck/verify-logs/verify-2026-06-19T20-15-59-742Z-81148-948243af1f189.log`); scoped PR-local lint/prettier/file-size gates passed in `.codex-logs/pr10/scoped-eslint-after-lock-refresh-20260619.log`, `.codex-logs/pr10/scoped-prettier-after-lock-refresh-20260619.log`, and `.codex-logs/pr10/file-size-after-lock-refresh-20260619.log` | Final validation and plan assessment deferred until the required `$prs` scope review passes; because PR-10 touched shared filtered-flake build snapshot logic, final validation must include full `i && b && ALL_TESTS=1 v` | Remote fixture, activation, status, split-flake source metadata, selected C++ snapshot coverage, two-consumer ownership boundary checks, root plus `projects/` bare-command smoke coverage, and opt-in published-ref smoke coverage prove the remote source-store path and hidden workspace Buck graph contract before final checkpoint validation |

## PR-1: Architecture probes and migration inventory

### 1. Intent

Add low-cost probes and inventory checks that validate the split mechanics before production code
depends on them.

### 2. Scope of changes

- Add a disposable Buck fixture proving:
  - `.buckconfig` can resolve `viberoots = ./.viberoots/current`.
  - `.buckconfig` can resolve `workspace_providers = ./.viberoots/workspace/providers`.
  - root project `TARGETS` can load viberoots macros with `@viberoots//...`.
  - viberoots-owned `.bzl` files can load generated provider maps with
    `@workspace_providers//:auto_map.bzl`.
  - Buck target labels use `viberoots//...` and `workspace_providers//...`, not `@cell//...`.
- Add a disposable Nix fixture proving:
  - a root flake can consume a local viberoots checkout;
  - `inputs.viberoots.lib.mkWorkspace { workspaceSrc = ./.; ... }` can receive a workspace source
    outside the viberoots source;
  - the viberoots flake can still access its own source through `viberootsInput.outPath`.
- Add an inventory script or check that counts current references to:
  - `//build-tools`
  - `$WORKSPACE_ROOT/build-tools`
  - `$FLK_ROOT/build-tools`
  - `//third_party/providers`
  - hard-coded `third_party/providers` filesystem paths
- Add an initial integration debt ledger entry template for later turbo-mode PRs.

Baseline inventory from `build-tools/tools/dev/viberoots-root-coupling-inventory.ts`:

| Pattern                                             | Count |
| --------------------------------------------------- | ----: |
| `//build-tools`                                     |  1408 |
| `$WORKSPACE_ROOT/build-tools`                       |    31 |
| `$FLK_ROOT/build-tools`                             |     9 |
| `//third_party/providers`                           |   324 |
| hard-coded `third_party/providers` filesystem paths |   467 |

### 3. External prerequisites

- None.

### 4. Tests to be added

- Unit or integration tests for the Buck fixture.
- Nix evaluation/build test for the nested flake fixture.
- Inventory test that reports counts and representative examples without failing the build yet.

### 5. Docs to be added or updated

- Update this plan with actual baseline counts from the inventory check.
- Update [`docs/viberoots-flake.md`](viberoots-flake.md) only if probes invalidate the design.

### 5.5. Expected regression scope

- `build-system-fixture-only`
- Focused validation is enough unless the probes require changing production build logic.

### 6. Acceptance criteria

- The Buck and Nix split mechanics are proved by automated fixtures.
- The repo has a repeatable inventory of root-coupled paths.
- No production build behavior changes.

### 7. Risks

- Fixture probes may pass while production code still has hidden assumptions.

### 8. Mitigations

- Keep the inventory broad and include representative examples in output.
- Use checkpoint A to decide whether to continue with the design or revise it.

### 9. Consequences of not implementing this PR

Later PRs would start changing production root layout before validating the basic mechanics.

### 10. Downsides for implementing this PR

It adds probe and inventory tooling before user-visible workflow changes.

## PR-2: Workspace/viberoots root API and Nix-provided tool contract

### 1. Intent

Introduce explicit root-resolution primitives and enforce that all user-facing tools come from Nix,
while viberoots source paths are used only for templates, Starlark, Nix helpers, and action input
sources.

### 2. Scope of changes

- Add shared root-resolution helpers for:
  - `WORKSPACE_ROOT`
  - `VIBEROOTS_ROOT`
  - `.viberoots/current`
  - `.viberoots/workspace`
- Update TypeScript entrypoints that currently infer repo root from `process.cwd()` when they mean
  workspace root.
- Update Starlark/Nix shell helpers to distinguish:
  - executable discovery on the Nix-provided `PATH`;
  - reusable source lookup under `VIBEROOTS_ROOT`.
- Add `viberoots version` or equivalent status command that reports:
  - local vs remote source mode;
  - `VIBEROOTS_ROOT`;
  - checked-out or locked revision;
  - dirty state in local source mode;
  - whether `.viberoots/current` points at the live `viberoots/` checkout in local mode.
- Do not move directories yet.

### 3. External prerequisites

- None.

### 4. Tests to be added

- Root-resolution unit tests for local path mode, missing symlink, remote/source-store mode, and
  overridden environment variables.
- Tests proving command discovery uses Nix `PATH` rather than walking Buck cell directories.
- `viberoots version` tests for local, dirty, missing, and remote-shaped fixtures.

### 5. Docs to be added or updated

- Update [`docs/viberoots-flake.md`](viberoots-flake.md) if the final status command shape changes.
- Add any command reference needed for `viberoots version`.

### 5.5. Expected regression scope

- `mixed-build-system`
- High risk because it touches shared root/tool invocation assumptions.

### 6. Acceptance criteria

- Tooling can resolve `WORKSPACE_ROOT` and `VIBEROOTS_ROOT` separately.
- User-facing executables still come from `nix develop`.
- Existing workflows still work when `VIBEROOTS_ROOT` points at the current repo root.

### 7. Risks

- Some tools may have relied on `process.cwd()` intentionally.
- Some Buck actions may still assume `$WORKSPACE_ROOT/build-tools`.

### 8. Mitigations

- Preserve compatibility defaults while adding explicit root helpers.
- Add targeted tests for the highest-use entrypoints before changing path layout.

### 9. Consequences of not implementing this PR

The later directory move would break tool discovery and script-source lookup.

### 10. Downsides for implementing this PR

It introduces two-root plumbing before the repository is physically split.

## PR-3: Workspace activation and `.viberoots/current`

### 1. Intent

Add the workspace activation layer that prepares static Buck cell paths for both local submodule mode
and future remote mode.

### 2. Scope of changes

- Implement `viberoots init-workspace` or equivalent activation command.
- Create or repair `.viberoots/current`.
- In local mode, ensure `.viberoots/current -> ../viberoots` and fail if the root flake points at
  the local viberoots checkout but the symlink points elsewhere.
- In remote-shaped fixtures, point `.viberoots/current` at a materialized flake source path.
- Create `.viberoots/workspace/` subdirectories needed by later provider and Buck state relocation.
- Add startup checks for missing `viberoots/flake.nix`, missing `.buckroot`, and stale/missing cell
  paths.
- Add `.gitignore` entries for `.viberoots/current` and `.viberoots/cache/`, without ignoring all of
  `.viberoots/`.

### 3. External prerequisites

- None.

### 4. Tests to be added

- Activation tests for fresh workspace, idempotent rerun, broken symlink, remote source path, and
  local live-edit path.
- Negative tests proving activation does not rewrite tracked product files during shell entry.
- Tests proving `.viberoots/current` is not used as a tool installation path.

### 5. Docs to be added or updated

- Update setup docs with activation behavior and `.gitignore` expectations.
- Update this plan's integration debt ledger for any deferred broad validation.

### 5.5. Expected regression scope

- `mixed-build-system`
- Medium to high risk because activation becomes a precondition for Buck cell resolution.

### 6. Acceptance criteria

- A workspace can prepare `.viberoots/current` deterministically.
- Local submodule mode preserves live edits to `viberoots/`.
- Activation failures are targeted and actionable.

### 7. Risks

- Shell hooks could surprise users by rewriting tracked files.
- Symlink behavior may differ between macOS, Linux, CI, and Nix store paths.

### 8. Mitigations

- Keep tracked bootstrap file creation behind explicit `init-workspace`.
- Make `nix develop` refresh only ignored symlinks/caches.
- Test on supported local and CI platforms.

### 9. Consequences of not implementing this PR

Buck would need direct hard-coded references to either `./viberoots` or Nix store paths, making
remote switching harder.

### 10. Downsides for implementing this PR

It adds a workspace initialization concept that users must understand.

## PR-4: Generated state relocation and `workspace_providers` cell

### 1. Intent

Move generated provider and Buck workspace state out of top-level `third_party/providers` and
`build-tools/tools/buck` into workspace-owned `.viberoots/workspace/**` locations.

### 2. Scope of changes

- Generate provider files under `.viberoots/workspace/providers`.
- Define the `workspace_providers` Buck cell in root `.buckconfig`.
- Update provider generation scripts to emit labels like:
  - `workspace_providers//:nix_pkgs_googletest`
  - `workspace_providers//:lf_<hash>_<importer>`
- Update provider edge helpers and graph utilities for the `workspace_providers` labels.
- Move workspace-generated Buck state such as graph exports, node lock indexes, invalidation
  reports, and workspace-root env files to `.viberoots/workspace/buck/` or another reviewed
  workspace-owned path.
- Do not add new provider generation that writes both old and new provider locations. Any remaining
  old-path reads are temporary implementation debt that PR-9 must delete or confine to invalid
  legacy-input tests.

### 3. External prerequisites

- PR-2 root helpers and PR-3 activation should be available.

### 4. Tests to be added

- Provider generation tests for Node, Python, C++, and any active generated provider families.
- Graph utility tests for `workspace_providers` labels.
- Prebuild guard tests using `.viberoots/workspace/providers`.
- Tests proving generated provider state never writes inside `viberoots/`.

### 5. Docs to be added or updated

- Update build-system docs that reference `third_party/providers`.
- Update scaffolding and language docs only where command examples would otherwise be wrong.

### 5.5. Expected regression scope

- `mixed-build-system`
- High risk because provider labels affect the Buck graph, invalidation, and language macros.

### 6. Acceptance criteria

- Generated providers are consumed through `workspace_providers`.
- Existing project builds/tests still resolve provider dependencies.
- No project-specific generated state is written into the viberoots source tree.

### 7. Risks

- Provider label changes can break graph invalidation, planner filtering, or macro wiring.
- Some docs/tests may still assert exact `//third_party/providers` labels.

### 8. Mitigations

- Track any remaining old label recognition as a PR-9 blocker, not a long-term migration path.
- Run checkpoint B after this PR with focused language/provider validation and one full validation
  milestone if the PR touches shared graph logic broadly.

### 9. Consequences of not implementing this PR

The parent workspace would keep a top-level generated `third_party/` tree and the split would remain
unclean.

### 10. Downsides for implementing this PR

It changes many generated paths and labels at once, increasing migration risk.

## PR-5: Buck cell load conversion and temporary root shims

### 1. Intent

Make viberoots-owned Starlark loadable from the `viberoots` cell while keeping project builds
working during the pre-extraction dogfood phase. Any root shims left after this PR are temporary
and must be removed by PR-9.

### 2. Scope of changes

- Update viberoots-owned `.bzl` self-loads from `//build-tools/...` to
  `@viberoots//build-tools/...`.
- Update viberoots-owned provider-map loads to use `@workspace_providers//:auto_map.bzl`.
- Add temporary root forwarding shims only where needed for project `TARGETS` or templates not yet
  converted, with explicit PR-9 deletion ownership.
- Update project targets and scaffolding templates that can safely switch to public
  `@viberoots//...` loads in this PR.
- Preserve named `prelude`, `toolchains`, `repo_toolchains`, `config`, `fbsource`, and `fbcode`
  cells.

### 3. External prerequisites

- PR-4 provider cell migration should be complete or dual-read compatible.

### 4. Tests to be added

- Buck parse/targets tests proving representative project `TARGETS` can load public viberoots
  macros.
- Tests proving viberoots-owned `.bzl` files no longer require root `//build-tools` labels.
- Template tests proving new scaffolds emit the chosen public load style.

### 5. Docs to be added or updated

- Update scaffolding docs with `@viberoots//...` examples.
- Update build-system docs where load examples are public API.

### 5.5. Expected regression scope

- `mixed-build-system`
- High risk because load paths affect all Buck parsing.

### 6. Acceptance criteria

- `buck2 targets viberoots//build-tools/...` works.
- `buck2 targets //projects/...` works.
- Root shims are documented as temporary and have PR-9 removal criteria.

### 7. Risks

- Starlark load syntax differs from target-label syntax.
- Root shims could become permanent.

### 8. Mitigations

- Add lint checks that distinguish `.bzl` `@cell//...` loads from target `cell//...` labels.
- Track shim references and remove them at the PR-9 extraction boundary.

### 9. Consequences of not implementing this PR

The viberoots source could not become a clean external Buck cell.

### 10. Downsides for implementing this PR

It touches many Starlark files and may cause broad Buck parse failures if done incorrectly.

## PR-6: Nix `mkWorkspace` split-root implementation

### 1. Intent

Make the viberoots flake expose `lib.mkWorkspace` with explicit `workspaceSrc` and
`viberootsInput`, while preserving current in-repo behavior.

### 2. Scope of changes

- Add `lib.mkWorkspace`.
- Parameterize Nix flake internals that currently hard-code repo-root relative paths.
- Ensure dev shells provide all command-line tools from Nix.
- Ensure generated package/app/check outputs operate on `workspaceSrc`.
- Ensure reusable source lookup uses `viberootsInput.outPath` or `VIBEROOTS_ROOT`.
- Add `lib.version` and `lib.releaseTag` or equivalent version metadata.
- Keep root `flake.nix` behavior compatible until PR-8 thins it.

### 3. External prerequisites

- PR-2 root helpers should exist.

### 4. Tests to be added

- Nix eval tests for `lib.mkWorkspace`.
- Nix build/devshell smoke tests proving tools are on `PATH`.
- Tests proving `workspaceSrc` may be outside the viberoots source.
- Version metadata tests.

### 5. Docs to be added or updated

- Update Nix/devshell docs with `workspaceSrc`.
- Update command docs for `viberoots version` if not already covered.

### 5.5. Expected regression scope

- `mixed-build-system`
- High risk because it touches flake outputs and tool provisioning.

### 6. Acceptance criteria

- Current root flake behavior still works.
- `lib.mkWorkspace { workspaceSrc = ./.; ... }` is available.
- Tools are still provided by `nix develop`.

### 7. Risks

- Existing Nix derivations may assume the flake root is the workspace root.
- Dynamic derivations may capture the wrong source tree.

### 8. Mitigations

- Add direct tests for both roots.
- Keep compatibility wrappers until PR-8.

### 9. Consequences of not implementing this PR

The root workspace could not delegate to viberoots as a flake input.

### 10. Downsides for implementing this PR

It requires broad Nix refactoring before the physical submodule extraction.

## PR-7: In-repo dogfood layout without extraction

### 1. Intent

Exercise the target cell and activation shape inside the current repository before splitting
viberoots into a separate repository.

### 2. Scope of changes

- Configure `.viberoots/current` to point at the current local viberoots source path used for
  dogfood.
- Update `.buckconfig` to use `.viberoots/current` for `viberoots`, `prelude`, `toolchains`,
  `repo_toolchains`, `config`, `fbsource`, and `fbcode`.
- Keep only the temporary root compatibility shims needed to finish the PR-7 dogfood checkpoint;
  remaining root `//build-tools` loads are blockers for PR-9, not supported migration debt.
- Verify `workspace_providers` is active.
- Ensure local viberoots edits are visible immediately to Buck/Nix workflows.

### 3. External prerequisites

- PRs 2 through 6.

### 4. Tests to be added

- End-to-end dogfood tests for:
  - `nix develop` tool availability;
  - Buck target parsing under `//projects/...`;
  - provider generation and consumption;
  - live-edit detection for local viberoots source.
- Focused validation for the primary app/library targets currently in `projects/`.

### 5. Docs to be added or updated

- Update setup docs to describe `.viberoots/current`.
- Update this plan's checkpoint C results.

Checkpoint C targeted results for PR-7:

- `.viberoots/current` is configured as the in-repo dogfood source (`..` from `.viberoots/`).
- Buck parses `//projects/...`, the active `workspace_providers` cell, and any temporary remaining
  root `//build-tools` compatibility packages through the `.viberoots/current` cell layout. Those
  packages are not part of the final split contract and must be gone by PR-9.
- Provider generation/consumption, local live-edit visibility through `.viberoots/current`, Nix
  devshell tool availability, scaffolding/provider tests, and representative `projects/` builds
  passed in the PR-7 targeted evidence listed in the integration debt ledger.
- Full `i && b && ALL_TESTS=1 v` remains the required Checkpoint C final gate and is intentionally
  held until the separate scope review authorizes final validation.

### 5.5. Expected regression scope

- `mixed-build-system`
- High risk because it changes the active workspace shape.
- First mandatory full-suite checkpoint.

### 6. Acceptance criteria

- The current repository works through `.viberoots/current`.
- Product targets still build/test through Buck.
- Nix-provided tools remain available.
- Full `i && b && ALL_TESTS=1 v` passes before continuing to root flake delegation and extraction.

### 7. Risks

- Hidden root-path assumptions may appear only in less-used commands.

### 8. Mitigations

- Run checkpoint C with broad targeted validation over Buck, Nix, provider sync, scaffolding, and at
  least one project build/test path.

### 9. Consequences of not implementing this PR

The extraction PR would combine layout changes with unknown behavior changes.

### 10. Downsides for implementing this PR

It creates a transitional layout that exists only to reduce extraction risk.

## PR-7.5: Separate pnpm provisioning from build consumption

### 1. Intent

Keep PR-7's dogfood layout intact while making pnpm dependency state ownership explicit: `i` is the
provisioning command, and `b` is a consumer/build command that only consumes already-provisioned,
fixed pnpm state.

### 2. Scope of changes

- Commit PR-7 as-is first once its full validation passes; do not fold these changes into PR-7.
- Make `i` responsible for dependency fetching, pnpm-store hash refreshes, exact-store builds,
  unified pnpm store assembly, and any bounded retry needed for explicit provisioning operations.
- Make `i`'s unified pnpm prewarm required in the normal non-dry-run path; it must not silently skip
  required provisioning and still report success.
- Ensure `b` does not repair pnpm hashes, generate lockfiles, invoke `update-pnpm-hash`, or fall
  through to the live npm registry.
- If `b` finds missing or stale `i`-warmed pnpm state, fail clearly with a diagnostic that tells the
  operator to run `i`.
- Ensure locked build paths consumed by `b` are offline-only and use exact/fixed stores already
  warmed by `i`.
- Remove pnpm retry helpers from non-provisioning paths. Any remaining retry behavior must live only
  in explicit `i` or provisioning code.
- Leave `v` behavior as-is for this PR. Temp-repo test provisioning is more complicated and must not
  be overfit into PR-7.5.
- Preserve all repository functionality and test strength; do not weaken assertions, delete tests, or
  remove behavior to satisfy the split.
- Keep all tooling Nix-provided.

### 3. External prerequisites

- PR-7 committed after passing its full Checkpoint C validation.

### 4. Tests to be added

- Contract tests proving `b` and `node-modules-build.ts` do not invoke `update-pnpm-hash`.
- Contract tests proving stale or missing pnpm-store verified state in `b` fails with a clear
  "run `i`" diagnostic.
- Contract tests proving locked Nix pnpm install paths used by `b` include `--offline`.
- Contract tests proving pnpm retry behavior, if present, is scoped to `i` or explicit provisioning
  code only.
- Focused validation over the affected `i`, `b`, and Node locked-build selectors before continuing
  to PR-8.

### 5. Docs to be added or updated

- Update command or developer workflow docs that describe the `i`/`b` boundary.
- Update this plan's integration debt ledger with PR-7.5 validation evidence.
- Update PR-8 notes only if the final PR-7.5 implementation changes the assumptions for root flake
  delegation or local version/status enforcement.

### 5.5. Expected regression scope

- `mixed-build-system`
- High risk because it changes dependency provisioning responsibilities on the main local workflow.
- Does not intentionally change `v` temp-repo provisioning behavior.

### 6. Acceptance criteria

- `i` performs required pnpm provisioning and fails if required prewarm cannot complete.
- `b` consumes provisioned pnpm state offline and fails with a clear "run `i`" diagnostic when state
  is missing or stale.
- No non-provisioning path uses pnpm retry helpers or live registry fallback.
- Tests remain strict and repository functionality is preserved.
- All changed tooling remains Nix-provided.

### 7. Risks

- Some existing tests or scaffolding paths may rely on implicit repair behavior from build commands.
- Temp-repo test provisioning may look similar to production provisioning but has different setup
  constraints.

### 8. Mitigations

- Keep `v` temp-repo provisioning unchanged in this PR and add only contracts for the production
  `i`/`b` boundary.
- Use precise contract tests rather than broad string weakening so regressions remain visible.
- Re-run the affected failure set before broad validation.

### 9. Consequences of not implementing this PR

Root flake delegation could inherit build paths that repair dependency state during `b`, making
offline reproducibility and provisioning failures harder to reason about.

### 10. Downsides for implementing this PR

It adds a boundary PR before root flake delegation and may require operators to run `i` in cases
where `b` previously performed implicit repair.

## PR-8: Thin root flake and local version/status enforcement

### 1. Intent

Make the root flake delegate to viberoots through `inputs.viberoots.lib.mkWorkspace` while still
using the local source.

### 2. Scope of changes

- Replace root flake internals with:
  - `inputs.viberoots.url = "git+file:./viberoots"` for local dogfood mode;
  - `inputs.viberoots.lib.mkWorkspace { workspaceSrc = ./.; ... }`.
- Ensure `nix develop` runs activation or validates activation state.
- Ensure `viberoots version` reports local source mode, live checkout path, revision, and dirty
  state.
- Add CI validation that local dogfood mode uses the local path input and live `.viberoots/current`.
- Add strict startup/status checks that report old-layout paths as PR-9 blockers before extraction:
  - root `build-tools/`;
  - root `third_party/providers/`;
  - root `prelude/`;
  - root `toolchains/`;
  - active `//build-tools` loads;
  - active `//third_party/providers` labels.
- Ensure root flake delegation to the local viberoots source does not introduce compatibility shims.

### 3. External prerequisites

- PR-6 `mkWorkspace`.
- PR-7 dogfood layout.
- PR-7.5 pnpm provisioning/build-consumption boundary.

### 4. Tests to be added

- Nix eval/build tests for root flake delegation.
- `nix develop` smoke test or equivalent devshell evaluation.
- Version/status tests for local mode.
- Status/startup tests proving old-layout root paths, `//build-tools` loads, and
  `//third_party/providers` labels are reported as PR-9 blockers before extraction.
- Tests proving root flake delegation uses the local `git+file:./viberoots` viberoots source without
  creating root-cell compatibility shims.

### 5. Docs to be added or updated

- Update root setup docs and troubleshooting docs.

### 5.5. Expected regression scope

- `mixed-build-system`
- High risk because it changes the root flake entrypoint.

### 6. Acceptance criteria

- Root `nix develop` still provides all tools.
- Root flake delegates to viberoots.
- Local source mode uses live local source.
- Startup/status checks are strict for the unsupported pre-split monorepo layout.
- Root flake delegation uses local `viberoots/` and leaves no new compatibility shim surface.

### 7. Risks

- Nix lock behavior for local submodule inputs may differ across local and CI contexts.

### 8. Mitigations

- Add explicit status checks and CI checks.
- Keep checkout/submodule validation targeted and early.

### 9. Consequences of not implementing this PR

The repository would have Buck-cell separation but not flake separation.

### 10. Downsides for implementing this PR

It changes a high-traffic entrypoint and may temporarily increase local setup friction.

## PR-9: Extract viberoots repository and add submodule

### 1. Intent

Physically separate reusable viberoots source into its own repository and consume it from the parent
workspace as a submodule.

### 2. Scope of changes

- Create the standalone viberoots repository from viberoots-owned paths.
- Preserve useful history where practical.
- Add `.gitmodules`.
- Add `viberoots/` as a submodule.
- Enforce the visible parent-root contract after extraction:
  - allowed visible root entries are only `README.md`, `viberoots/`, and `projects/`;
  - hidden/transient workspace state may remain only when required, such as `.git/`, `.envrc`,
    `.direnv/`, `.viberoots/`, `.buckconfig`, `.buckroot`, and generated hidden tool state;
  - visible root `flake.nix` and `flake.lock` must not remain; the tiny delegating workspace flake,
    when needed to load the viberoots devshell, lives under hidden `.viberoots/workspace/`.
- Move reusable paths into the submodule:
  - `build-tools/**`
  - `toolchains/**`
  - `prelude/**`
  - `vendor/uv2nix/**`
  - reusable tool package metadata
  - viberoots docs/tests
  - `AI-PREFERENCES.XML`, `METHODOLOGY.XML`, `TESTING.md`, viberoots-owned `docs/**`,
    `config/**`, `patches/**`, `plugins/**`, `types/**`, viberoots pnpm package metadata,
    lockfiles, and pnpm hashes
- Keep parent-owned paths in the parent workspace:
  - `projects/**`
  - project-owned package manager hashes such as `projects/node-modules.hashes.json`
  - root `README.md`
  - root `.envrc`, `.buckconfig`, `.buckroot`, and other justified hidden workspace state
  - `.viberoots/workspace/**`
  - project docs/config
- Keep parent-repo-specific files out of `viberoots/`. The viberoots repository is reusable
  tooling consumed as a submodule or remote flake by many parent repositories, so it must not
  commit state for a particular parent repo's `projects/` tree. This includes project lockfile
  hashes, generated workspace maps, generated provider state, family-specific bootstrap targets,
  project docs, and other artifacts whose meaning depends on the consumer repository. Tool-owned
  defaults may live in `viberoots/`; consumer/project state belongs under `projects/` or hidden
  parent workspace state such as `.viberoots/workspace/`.
- Add the canonical local-consumer bootstrap entrypoint `./viberoots/init`. It must be
  idempotent, detect the consumer root as the parent of `./viberoots`, create `projects/` when
  missing, create or repair `.viberoots/current -> ../viberoots`, create `.viberoots/workspace/`,
  write or update a minimal root `.envrc` that loads the viberoots devshell and exposes bare
  commands, create light root and `projects/README.md` files when missing, run `direnv allow` when
  available, and print exact next steps when `direnv` is missing or cannot allow the workspace.
  It must preserve existing `projects/` content and avoid overwriting edited files unless the
  behavior is explicitly safe.
- Ensure `.viberoots/current -> ../viberoots`.
- Ensure bare commands such as `s`, `v`, `i`, and `b` work from the parent root and from
  `projects/` through devshell/PATH/tool activation, without recreating top-level `build-tools/`.
- Delete or prove nonexistence of root compatibility surfaces:
  - root `build-tools/`;
  - root `third_party/providers/`;
  - root `prelude/`;
  - root `toolchains/`;
  - root `docs/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
    `AI-PREFERENCES.XML`, `METHODOLOGY.XML`, `TESTING.md`, `TARGETS`, `config/`, `patches/`,
    `plugins/`, and `types/`;
  - forwarding packages for `//build-tools` loads;
  - forwarding packages or generated outputs for `//third_party/providers`.
- Enforce that active Buck files, templates, and generated outputs do not use
  `load("//build-tools...")` or `//third_party/providers`.
- Replace any root `prelude` validation with `.viberoots/current/prelude` validation.
- Add startup/status diagnostics for missing `viberoots/` submodule, uninitialized submodule, dirty
  submodule, checked-out submodule not matching the parent gitlink, root `flake.lock` not aligned
  with the local viberoots input, and stale or wrong `.viberoots/current`.

### 3. External prerequisites

- A destination viberoots repository.
- Agreement on whether history is preserved by subtree/filter-repo or starts from a clean initial
  import.

### 4. Tests to be added

- Submodule initialization test or CI bootstrap test.
- `./viberoots/init` idempotence tests for a bare consumer root and for an existing root with
  populated `projects/`.
- Strict visible-root enforcement test proving the parent root contains no old combined-repo
  source/config entries after PR-9, while justified hidden workspace state remains valid.
- Bare-command smoke tests proving `s`, `v`, `i`, and `b` are discoverable from the root and from
  `projects/` through the devshell, with no root `build-tools/`.
- Live-edit test proving a change inside `viberoots/` affects project workflows immediately after
  normal Buck/Nix cache invalidation.
- Root `nix develop` and representative Buck/project validation.
- Enforcement tests proving active Buck files, templates, and generated outputs do not contain
  `load("//build-tools...")` or `//third_party/providers`.
- Startup/status diagnostic tests for missing, uninitialized, dirty, or gitlink-mismatched
  submodules; misaligned root `flake.lock`; and stale or wrong `.viberoots/current`.
- Tests proving root prelude/toolchain paths are reached through `.viberoots/current`, not root
  `prelude/` or `toolchains/` compatibility directories.
- Tests proving root compatibility surfaces are absent except for test fixtures that explicitly
  model invalid legacy input.

### 5. Docs to be added or updated

- Update contributor docs with submodule workflow.
- Update troubleshooting docs for missing or stale submodule state.
- Document the canonical bootstrap flow:
  `git submodule add git@github.com:viberoots/viberoots.git viberoots` followed by
  `./viberoots/init`.
- Keep root `README.md` intentionally light, pointing to `viberoots/README.md` and
  `projects/README.md`.

### 5.5. Expected regression scope

- `mixed-build-system`
- Very high risk. This is a mandatory full-validation checkpoint.
- Second mandatory full-suite checkpoint.

### 6. Acceptance criteria

- Parent workspace no longer tracks viberoots-owned implementation files outside the submodule.
- Parent workspace visible root is limited to `README.md`, `viberoots/`, and `projects/`; the
  delegating Nix workspace flake lives under hidden `.viberoots/workspace/`.
- CI initializes submodules before validation.
- Root workflows still pass.
- `./viberoots/init` is the reproducible bootstrap for a bare consumer checkout and is idempotent.
- Bare `s`, `v`, `i`, and `b` work from the parent root and `projects/` through devshell/PATH/tool
  activation, without root `build-tools/`.
- Active project/root Buck loads use `@viberoots//build-tools/...`.
- Generated providers live only under `.viberoots/workspace/providers` and are addressed as
  `workspace_providers//...`.
- Generated Buck state lives under `.viberoots/workspace/buck`.
- Project-specific hashes and generated consumer state are not committed under `viberoots/`; for
  example, parent project pnpm hashes live in `projects/node-modules.hashes.json`, while
  `viberoots/build-tools/tools/nix/node-modules.hashes.json` contains only viberoots/tool-owned
  defaults.
- Root `build-tools/`, root `third_party/providers/`, and root `prelude/` or `toolchains/`
  compatibility surfaces do not remain, except test-only fixtures explicitly modeling invalid
  legacy input.
- Full `i && b && ALL_TESTS=1 v` passes after extraction.

### 7. Risks

- Large file moves can obscure regressions.
- Submodule setup may be unfamiliar to contributors.
- Dirty submodule state can be missed during parent commits.
- Remaining active `//build-tools` or `//third_party/providers` references are blockers for PR-9,
  not migration debt.
- Root `prelude/` or `toolchains/` assumptions are blockers for PR-9.
- Any old combined-repo visible root entry other than `README.md`, `viberoots/`, and `projects/` is
  a PR-9 blocker.
- Any parent-repo-specific file committed under `viberoots/` is a PR-9 blocker unless it is an
  explicitly named reusable fixture; project-specific runtime defaults, generated maps, project
  lockfile hashes, and family-specific bootstrap state must be moved to `projects/`, hidden
  workspace state, or a generic viberoots template API.
- Missing or non-idempotent `./viberoots/init` is a PR-9 blocker because external consumers need a
  reproducible bootstrap before PR-10.

### 8. Mitigations

- Keep this PR mostly mechanical after earlier behavior changes land.
- Run checkpoint D with full validation and scope review.
- Add startup checks for missing `viberoots/flake.nix`.
- Add hard failure diagnostics for old-layout root paths and stale split state before running broad
  build work.

### 9. Consequences of not implementing this PR

Viberoots would remain logically separated but not independently versioned or contributed to.

### 10. Downsides for implementing this PR

Submodules add operational complexity and require CI/bootstrap updates.

## PR-10: Remote consumer fixture, release pinning, and final reconciliation

### 1. Intent

Prove that an external project can consume viberoots from an explicit remote version without
vendoring viberoots source.

### 2. Scope of changes

- Add an external-consumer fixture or template with:
  - the same strict visible-root contract as PR-9: `README.md`, `viberoots/` only when testing
    local/submodule mode, and `projects/`; for remote mode, no vendored `viberoots/` source is
    allowed unless the fixture is explicitly modeling local bootstrap;
  - no visible root `flake.nix` or `flake.lock`; any tiny delegating workspace flake lives under
    hidden `.viberoots/workspace/`;
  - explicit remote viberoots version reference such as `github:OWNER/viberoots/v1.4.2`;
  - committed `flake.lock`;
  - `.buckconfig` using `.viberoots/current`;
  - root `projects/`;
  - `.viberoots/workspace/providers`;
  - `.viberoots/workspace/buck`;
  - per-cell `.buckconfig` files where Buck needs them;
  - provider targets with public visibility;
  - minimal `projects/apps/*` or `projects/libs/*` target.
- Make activation materialize `.viberoots/current` from the locked flake source.
- Ensure remote-consumer bootstrap has a canonical path equivalent to the local
  `./viberoots/init` flow. If remote mode cannot use `./viberoots/init` because no local
  `viberoots/` checkout exists, PR-10 must document and test the exact alternate command and keep
  it idempotent.
- Add `viberoots version` output for remote mode: requested ref, locked revision, effective source
  path, and whether `.viberoots/current` matches the locked source.
- Define the remote activation contract: either refresh `.viberoots/current` on every
  `nix develop`/`init-workspace`, or create an explicit GC root and refresh when `flake.lock`
  changes.
- Reject hidden copies of viberoots, dual provider layouts, and root-cell legacy shims in the
  external fixture.
- Prove that consumer workflows do not depend on writable viberoots source paths. Remote mode must
  run with `VIBEROOTS_ROOT` resolved to a source path that is treated as read-only, and local
  submodule mode must use the same ownership model even though the checkout is physically writable.
  Generated workspace state must be created directly under the consumer workspace, not created under
  `viberoots/` and removed later.
- Prove the parent-repo ownership boundary from PR-9 with a second consumer: viberoots must not
  contain artifacts that are specific to this repository's `projects/` tree. Consumer lockfile
  hashes, workspace maps, generated providers, project docs, and family-specific deployment
  bootstrap state must be generated or committed in the consumer workspace, not in the reusable
  viberoots source.
- Close the integration debt ledger.

### 3. External prerequisites

- A versioned viberoots repository reference available to the fixture.

### 4. Tests to be added

- External fixture `nix develop`/evaluation test.
- External fixture Nix eval or `nix develop` smoke test.
- External fixture Buck parse/cquery/build test for one representative `projects/` target.
- External fixture strict-root test proving remote consumption does not introduce root
  `build-tools/`, root `docs/`, root package manager metadata, root `config/`, root `patches/`,
  root `plugins/`, root `types/`, or root-cell legacy shims.
- External fixture bare-command smoke test proving `s`, `v`, `i`, and `b` work from root and
  `projects/` through the chosen activation/devshell path.
- Remote-mode activation and status tests.
- Remote activation tests proving the chosen refresh or GC-root strategy keeps `.viberoots/current`
  aligned with `flake.lock`.
- Tests proving generated providers exist only under `.viberoots/workspace/providers`, generated
  Buck state uses `.viberoots/workspace/buck`, and provider targets have public visibility.
- Tests or instrumentation proving normal consumer `v`/`i`/`b` runs do not create
  `viberoots/.viberoots/`, `viberoots/buck-out/`, root `build-tools/`, or root `build-tools/tmp`.
  The check must observe filesystem state before any final cleanup phase or otherwise prove the
  creation path cannot target the reusable source checkout.
- Tests proving project-owned hash state is read from the consumer workspace, such as
  `projects/node-modules.hashes.json`, and is not written into the viberoots source tree.
- Tests or review checks proving viberoots runtime/tooling does not contain project-family
  constants from this repository except in explicitly named reusable fixtures.
- Targeted provider, Buck, Nix, and scaffolding selectors touched by the plan.
- Full `i && b && ALL_TESTS=1 v` only if this PR changes shared Buck/Nix/build logic beyond the
  fixture/template surface.

### 5. Docs to be added or updated

- Add or update external project setup docs.
- Document the remote bootstrap command if it differs from local `./viberoots/init`, and explain
  the PR-9 decision to keep the delegating flake hidden under `.viberoots/workspace/`.
- Update [`docs/viberoots-flake.md`](viberoots-flake.md) if any remote-mode behavior changed.
- Update this plan with final validation evidence.

### 5.5. Expected regression scope

- `mixed-build-system`
- Final reconciliation; turbo mode ends after this PR. Targeted validation is expected by default.

### 6. Acceptance criteria

- External fixture consumes remote viberoots without vendoring `build-tools`, `prelude`, or
  `toolchains`.
- External fixture preserves the strict visible-root contract and has no old combined-repo visible
  root files.
- Consumer workflows pass with `VIBEROOTS_ROOT` treated as read-only source and without creating
  generated workspace state inside that source.
- External fixture has root `projects/`, `.viberoots/current`, `.viberoots/workspace/providers`,
  `.viberoots/workspace/buck`, required per-cell Buck config, public provider targets, and one
  representative `projects/` target that parses, cqueries, and builds.
- Bare `s`, `v`, `i`, and `b` work from the external fixture root and from `projects/` through the
  chosen activation/devshell path.
- Remote status output shows requested ref, locked revision, effective source path, and whether
  `.viberoots/current` matches the locked source.
- Remote activation has an explicit refresh or GC-root contract.
- The remote fixture demonstrates that viberoots contains reusable tooling only: no hashes,
  generated maps, provider state, project docs, or project-family bootstrap defaults from this
  parent repository are required inside the viberoots checkout.
- Targeted remote fixture validation and plan assessment pass.
- The integration debt ledger is closed. If PR-10 touched shared build logic, a final full
  `i && b && ALL_TESTS=1 v` also passes.

### 7. Risks

- Remote flake source materialization may interact poorly with Nix GC.
- A fixture may still miss real-project behavior.
- Missing `.viberoots/workspace/buck` in the external fixture is a PR-10 blocker.
- Remaining active `//build-tools` or `//third_party/providers` references are blockers for PR-10,
  not migration debt.
- Any remote fixture that passes by vendoring viberoots source, recreating root `build-tools/`, or
  keeping old combined-repo visible root files is a PR-10 blocker.
- Any PR-10 implementation that requires committing consumer-specific project state under
  `viberoots/` is a design failure, not an acceptable fixture shortcut.

### 8. Mitigations

- Keep remote Nix GC/source refresh as the highest PR-10 operational risk and use an explicit
  GC-root or refresh strategy for `.viberoots/current`.
- Keep the fixture representative enough to exercise Nix, Buck, providers, and one project target.

### 9. Consequences of not implementing this PR

The design would only prove local submodule dogfooding, not the intended external consumption model.

### 10. Downsides for implementing this PR

It adds ongoing fixture/template maintenance.

## PR-11: Consumer-owned generated maps and hash state

### 1. Intent

Remove any remaining generated workspace maps and parent-project hash state from the reusable
viberoots source tree.

### 2. Scope of changes

- Move generated workspace maps out of `viberoots/` and into hidden parent workspace state such as
  `.viberoots/workspace/**`, or into `projects/**` when the data is project-owned.
- Keep parent project lockfile hashes in `projects/node-modules.hashes.json` or another
  parent-owned location.
- Keep `viberoots/build-tools/tools/nix/node-modules.hashes.json` limited to reusable
  viberoots/tooling-owned hashes.
- Add checks that normal `i`, `b`, `v`, provider generation, and hash update flows do not write
  parent-repo-specific generated state into `viberoots/`.
- Audit workspace-root resolution in those flows so generated state is created directly under the
  consumer `WORKSPACE_ROOT`. Fix call sites that accidentally run activation, Buck, graph export, or
  hash generation with `VIBEROOTS_ROOT` as the workspace root. Do not satisfy this by adding a
  cleanup pass that removes `viberoots/.viberoots/`, `viberoots/buck-out/`, root `build-tools/`, or
  other misplaced state after the fact.

### 3. Acceptance criteria

- No generated workspace map or parent project lockfile hash is committed under `viberoots/`.
- Local project workflows still read the parent-owned state.
- Normal consumer workflows create generated state in the consumer workspace and do not create
  misplaced workspace state under the reusable viberoots source checkout.

## PR-12: Remove Pleomino-specific runtime/bootstrap assumptions from viberoots

### 1. Intent

Make viberoots runtime and bootstrap tooling reusable across multiple parent repositories by
removing assumptions tied to this repository's Pleomino project.

### 2. Scope of changes

- Move Pleomino-specific deployment target defaults, family-specific bootstrap state, and project
  runtime configuration out of `viberoots/`.
- Replace project-family constants in reusable tooling with generic extension points, templates, or
  parent-owned configuration.
- Keep Pleomino docs/config under `projects/` unless they are intentionally generic viberoots
  examples.

### 3. Acceptance criteria

- A parent repository without Pleomino can consume viberoots without editing viberoots source.
- Pleomino workflows still work from parent-owned project configuration.

## PR-13: Ownership-boundary enforcement

### 1. Intent

Turn the viberoots/parent ownership boundary into durable tests and review checks.

### 2. Scope of changes

- Add tests or lint checks that reject parent-repo-specific hashes, generated maps, provider state,
  project docs, deployment target state, and project-family bootstrap defaults under `viberoots/`.
- Add a consumer-workflow root pollution check that fails if `v`, `i`, `b`, provider generation,
  graph export, or hash update creates generated workspace state under `viberoots/` or recreates
  visible root compatibility paths such as `build-tools/`.
- Add a remote or second-consumer fixture that proves viberoots works without this repository's
  parent-specific files.
- Document allowed reusable fixtures so test examples do not become hidden runtime coupling.

### 3. Acceptance criteria

- Ownership-boundary checks fail on representative misplaced parent/project state.
- Root-pollution checks fail on representative source-root writes and cannot pass merely because a
  final cleanup phase deletes the misplaced state.
- Remote or second-consumer validation passes without parent-specific files inside `viberoots/`.
