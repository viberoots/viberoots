# Update Command Implementation Plan

This plan implements the command model in
[`update-command-design.md`](update-command-design.md). The goal is to separate read-only
materialization from intentional mutation while giving developers one clear maintenance command for
ordinary dependency edits.

The plan assumes the starting point is the current repository state, including the uncommitted
hardening work already present in this checkout. That means PR-1 should consolidate, finish, and
validate the existing read-only install, pnpm exact-store, source-mode, and scaffold fixes rather
than rediscovering them from the previous upstream commit.

The plan uses three larger PRs instead of six smaller ones so the work can share validation
checkpoints. The PR labels in this document are planning labels only.

## Reviewed Context

- [`update-command-design.md`](update-command-design.md)
- [`README.md`](README.md)
- [`build-system-design.md`](build-system-design.md)
- [`pnpm/hermetic-node-modules.md`](pnpm/hermetic-node-modules.md)
- [`../../docs/README.md`](../../docs/README.md)
- [`../../docs/handbook/getting-started-on-a-pr.md`](../../docs/handbook/getting-started-on-a-pr.md)
- [`../../docs/handbook/testing.md`](../../docs/handbook/testing.md)
- [`../../docs/handbook/tooling.md`](../../docs/handbook/tooling.md)
- [`../../docs/history/process/turbo-mode.md`](../../docs/history/process/turbo-mode.md)
- [`../../AGENTS.md`](../../AGENTS.md)
- [`nixpkgs-source-selection-plan.md`](nixpkgs-source-selection-plan.md)
- [`../../docs/viberoots-flake-plan.md`](../../docs/viberoots-flake-plan.md)

The root consumer checkout did not contain `AGENTS.md`; the reviewed guide is the viberoots source
copy at `viberoots/AGENTS.md`, linked above as `../../AGENTS.md` from this plan.

## Starting Baseline

PR-1 starts from the current dirty checkout, not from a clean upstream baseline. The current
uncommitted work already includes pieces of the desired foundation:

- ordinary install and post-clone read-only hardening;
- pnpm hash metadata and exact-store prewarm changes;
- Go `go.mod` / `go.sum` / `gomod2nix.toml` install-time refresh behavior that still needs to be
  audited under the read-only `i` contract;
- Python `uv.lock` install-time refresh behavior that still needs to be audited under the read-only
  `i` contract;
- C++ Nix dependency/provider/source-selection metadata paths that do not have a package-manager
  lockfile but can still be affected by glue, provider sync, filtered flake, or Nix metadata repair;
- source-mode and viberoots pin consistency checks;
- scaffold prewarm/materialization fixes;
- test and docs updates for the above;
- the initial `u` shim and update-command design docs.

The first PR should inventory those changes, keep the pieces that match this plan, revise pieces
that still encode the older `u deps` model, and remove any accidental behavior that conflicts with
the final command authority. It should not assume the repo is starting from the last pushed commit.

### Current Dirty Worktree Handoff

As of this plan update, the parent consumer repo is on `main` with local uncommitted site/docs
changes plus a modified `viberoots` submodule. A fresh agent should inspect the current status before
editing, but should expect this shape:

```text
README.md
flake.nix
projects/apps/viberoots-site/docs/design.md
projects/apps/viberoots-site/docs/plan.md
projects/apps/viberoots-site/src/copy.ts
projects/apps/viberoots-site/src/hero-use-case.ts
projects/apps/viberoots-site/src/sections.ts
projects/apps/viberoots-site/test/visual-detail-contract.test.ts
viberoots
```

Those parent-repo site and marketing/docs edits are not the implementation surface for this plan.
Do not revert them while working on the update-command PRs. When committing, preserve the normal
submodule ordering: commit and push viberoots source changes first, then commit the parent pointer
and any parent-owned docs/site changes that are intentionally part of the release.

Inside the `viberoots` submodule, the dirty set currently includes:

```text
build-tools/docs/README.md
build-tools/docs/update-command-design.md
build-tools/docs/update-command-plan.md
build-tools/tools/bin/u
build-tools/tools/buck/exporter/cquery/retry.ts
build-tools/tools/buck/exporter/cquery/runner.ts
build-tools/tools/dev/build-selected.ts
build-tools/tools/dev/filtered-flake.ts
build-tools/tools/dev/install/glue.ts
build-tools/tools/dev/install/link-node.ts
build-tools/tools/dev/update-pnpm-hash.ts
build-tools/tools/dev/update-pnpm-hash/exact-store-fetch.ts
build-tools/tools/dev/update-pnpm-hash/exact-store.ts
build-tools/tools/dev/update-pnpm-hash/heartbeat.ts
build-tools/tools/dev/update-pnpm-hash/realized-store.ts
build-tools/tools/dev/verify/lint-preflight.ts
build-tools/tools/lib/consumer-bootstrap.ts
build-tools/tools/lib/consumer-source-mode.ts
build-tools/tools/lib/pnpm-node-modules-guard.ts
build-tools/tools/lib/repo-node-bin.ts
build-tools/tools/nix/flake/packages/default.nix
build-tools/tools/nix/packages/viberoots-command.nix
build-tools/tools/nix/pnpm-11.nix
build-tools/tools/patch/glue.ts
docs/viberoots-source-modes.md
```

The dirty test surface currently includes:

```text
build-tools/tools/tests/deployments/cloud-control-setup.test.ts
build-tools/tools/tests/dev/cpp.langs-validate.present.test.ts
build-tools/tools/tests/dev/exact-pnpm-store.local-prefetch.contract.test.ts
build-tools/tools/tests/dev/filtered-flake-snapshot.excludes-large-artifacts.integration.test.ts
build-tools/tools/tests/dev/link-node.nondefault-importer.filtered-flake.integration.test.ts
build-tools/tools/tests/dev/pnpm-fixed-store.exact-prefetch.contract.test.ts
build-tools/tools/tests/dev/update-pnpm-hash.realized-fixed-store-fastpath.integration.test.ts
build-tools/tools/tests/dev/verify.lint-preflight.tool-path-fallback.test.ts
build-tools/tools/tests/lib/pnpm-node-modules-guard.test.ts
build-tools/tools/tests/lib/repo-node-bin.test.ts
build-tools/tools/tests/lib/test-helpers/rsync.ts
build-tools/tools/tests/lib/test-helpers/run-in-temp.ts
build-tools/tools/tests/linting/langs-validate.invalid.test.ts
build-tools/tools/tests/linting/langs-validate.valid.test.ts
build-tools/tools/tests/nix/viberoots-devshell-command.test.ts
build-tools/tools/tests/rsync/rsync.excludes-test-logs.test.ts
build-tools/tools/tests/scaffolding/node-lib.nix-node-test.no-tests-pass.test.ts
build-tools/tools/tests/scaffolding/scaf-format-writable.test.ts
build-tools/tools/tests/scaffolding/webapp.scaffold-and-build.test.ts
build-tools/tools/tests/viberoots/buck-cell-fixture.test.ts
build-tools/tools/tests/viberoots/init.consumer.test.ts
build-tools/tools/tests/viberoots/maintenance-commands.test.ts
build-tools/tools/tests/viberoots/source-mode.test.ts
```

Treat these as in-flight evidence, not automatically accepted scope. PR-1 should make a short local
inventory before editing and sort the changes into:

- keep as PR-1 foundation work;
- revise to match this final `u` / `u --upgrade` / `viberoots update` authority model;
- move to PR-2 or PR-3 if already implemented but better owned there;
- leave untouched because it is parent-site work or unrelated user work;
- remove only if it is demonstrably an abandoned experiment from this update-command effort.

Known focused validation evidence from the current thread:

- `viberoots//:dev_exact_pnpm_store_local_prefetch_contract` passed.
- `viberoots//:node_node_wasm_inline_module_instantiate` passed.
- `viberoots//:scaffolding_webapp_scaffold_and_build` passed.
- `viberoots//:scaffolding_node_lib_nix_node_test_no_tests_pass` passed.
- `viberoots//:viberoots_maintenance_commands` passed.
- `viberoots//:viberoots_source_mode` passed.
- A remaining shared-target log review showed all previously remaining shared targets passed
  (`all=1499`, `passedMatching=1499`, `remaining=[]`, `failedWithoutLaterPass=[]`).
- `git diff --check` passed for the docs touched by this plan/design update.
- Parent site unit validation for `//projects/apps/viberoots-site:unit` passed after visual-detail
  contract updates.

Do not treat that evidence as a substitute for PR-1 validation. It is handoff context for choosing
focused reruns and avoiding unnecessary full-suite restarts.

## Non-Goals

- Do not make `i` repair tracked metadata.
- Do not make `u` update the viberoots pin, submodule, or flake input.
- Do not make `u --upgrade` update viberoots itself.
- Do not introduce `u deps` as the preferred public model.
- Do not require users to remember language-specific dependency commands for normal maintenance.
- Do not silently turn conservative lock repair into a broad package upgrade.
- Do not add fallbacks that hide stale metadata, missing exact stores, unsupported lock repair, or
  source-mode drift.
- Do not include Rust dependency/update behavior in this plan. Rust may use viberoots toolchains or
  fixtures, but Rust dependency management is not part of this update-command design.

## Supported Language Surfaces

This plan covers every currently supported non-Rust language/dependency surface:

- Node and TypeScript through pnpm importer lockfiles, pnpm hash metadata, exact pnpm store
  metadata, `node_modules` materialization, Node patches, and generated Node providers.
- Go through `go.mod`, `go.sum`, `gomod2nix.toml`, Go patch metadata, and Go provider/glue state.
- Python through uv manifests and `uv.lock`, Python patch metadata, and Python provider/glue state.
- C++ through Nix package/provider/source-selection metadata, C++ patch metadata, and generated
  provider/glue state.

Rust is intentionally excluded. If Rust gains first-class dependency metadata later, it should get a
separate design update rather than being inferred into this command split.

Command responsibility by language:

| Language surface | `i`                                                                                                                                                        | `u`                                                                                                                                           | `u --upgrade`                                                                                | `viberoots update`                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Node/TypeScript  | Read `package.json`, `pnpm-lock.yaml`, pnpm hash metadata, exact-store metadata, and generated provider metadata; materialize ignored local state only.    | Conservatively refresh pnpm locks from manifests and refresh pnpm hash, exact-store, provider, and glue metadata.                             | Run intentional pnpm upgrade behavior and then reconcile metadata.                           | Update viberoots only; refresh Node metadata only if required by the new viberoots pin. |
| Go               | Read `go.mod`, `go.sum`, `gomod2nix.toml`, and Go provider/glue metadata; fail if tracked state is stale.                                                  | Run conservative Go repair such as `go mod tidy` only when needed, then regenerate deterministic `gomod2nix.toml` and provider/glue metadata. | Upgrade only if an explicit bounded Go upgrade policy is implemented; otherwise fail closed. | Update viberoots only; do not upgrade Go dependencies.                                  |
| Python/uv        | Read Python manifests, `uv.lock`, and Python provider/glue metadata; fail if tracked state is stale.                                                       | Run conservative uv lock repair where supported and refresh deterministic provider/glue metadata.                                             | Upgrade only if an explicit bounded uv upgrade policy is implemented; otherwise fail closed. | Update viberoots only; do not upgrade Python dependencies.                              |
| C++              | Read BUILD inputs, Nix provider/source-selection metadata, C++ patch metadata, and generated provider/glue metadata; materialize ignored local state only. | Repair deterministic provider/source-selection/glue metadata required by current checked-in inputs.                                           | Fail closed unless a reviewed C++ source-selection or package-version upgrade policy exists. | Update viberoots only; do not upgrade C++ dependencies or source selections.            |

## Implementation Guardrails

- `i` and post-clone are read-only for tracked files. They can create ignored local state only.
- `u` is the ordinary mutation path for dependency and materialization consistency after developer
  edits. It may change lockfiles conservatively and derived metadata, but it must not update
  viberoots.
- `u --upgrade` is the only `u` mode allowed to intentionally move project dependency versions.
- `viberoots update` is the only public command allowed to update the viberoots pin or submodule.
- Use existing TypeScript zx tooling patterns and shared CLI parsing helpers. New thin bin wrappers
  may delegate only; substantive behavior belongs in TypeScript.
- Share reconciliation logic across `u`, `u --upgrade`, and `viberoots update` instead of
  duplicating pnpm hash, exact-store, glue, or source-mode checks.
- Commands must fail closed when inputs are ambiguous or unsupported. For example, if an ecosystem
  cannot conservatively repair locks without upgrade behavior, `u` should stop and explain the
  supported intentional command.
- The command split is language-wide, not Node-specific. Every tracked dependency or generated
  metadata mutation currently reachable from `i` must be audited and either proven local/ignored or
  moved behind `u`, `u --upgrade`, or an existing intentional mutation command that then instructs
  users to run `u`.
- Language-specific repair paths must share the same authority model:
  - `i` checks/materializes from checked-in state only;
  - `u` repairs lockfiles and deterministic metadata conservatively from current manifests;
  - `u --upgrade` intentionally moves dependency versions;
  - `viberoots update` updates viberoots only.
- Keep generated state out of reviewed source. Tests may inspect generated output, but source-owned
  inputs, schemas, and generators remain authoritative.
- Keep diagnostics user-actionable: stale-state failures should name the stale files and the exact
  repair command.
- Do not add documentation-only or testing-only PRs. Each PR implements behavior, tests it, and
  documents that behavior.

## Validation Policy

- Each PR must run focused tests for changed command paths before broader validation.
- Each PR that changes command routing or CLI help must include help/output assertions.
- Each PR that changes read-only materialization must prove `git diff --exit-code` remains clean
  after `i` or post-clone on a representative fixture.
- Each PR that changes pnpm metadata or exact-store behavior must include stale-metadata and
  missing-exact-store negative tests.
- Each PR that changes Node/TypeScript, Go, Python, or C++ dependency handling must include a
  read-only `i` negative test for stale tracked dependency metadata and an intentional `u` repair
  test for the same state when that surface has tracked repairable metadata. For C++ paths without
  lockfiles, the test should prove `i` does not write tracked provider/source-selection metadata and
  that required regeneration is behind `u` or the existing intentional provider-sync path.
- Each PR that changes source-mode or viberoots pin behavior must cover both submodule mode and
  flake mode where practical.
- Run the mandatory full `i && b && ALL_TESTS=1 v` after PR-3, once the final command split,
  fresh-clone smoke, and commit guardrails are all in place.
- Add an earlier full-suite checkpoint only if implementation changes shared verify scheduling,
  global Nix/Buck action behavior, or broad source filtering beyond the current uncommitted
  baseline.
- If focused validation fails, investigate the root cause before continuing. Do not weaken tests,
  loosen assertions, or add hidden recovery paths.

## Turbo Mode Policy

This plan explicitly adopts the reduced-validation cadence described in
[`../../docs/history/process/turbo-mode.md`](../../docs/history/process/turbo-mode.md). That file is
historical and not the default repo policy, so this section is the plan-specific authorization to
use the pattern here. Current command syntax and verification mechanics still come from
[`../../docs/handbook/testing.md`](../../docs/handbook/testing.md) and the active PR instructions.

Turbo mode for this plan means:

- focused validation is still required before every PR commit;
- scope review is still required before every PR commit;
- full `i && b && ALL_TESTS=1 v` is deferred, not skipped;
- deferred broad validation must be recorded in the integration debt ledger;
- any focused failure must be investigated to root cause before continuing;
- no fallback behavior may be added to hide a primary-path bug;
- no later PR may depend on an unresolved failure from an earlier PR.

Focused validation should be conservative:

- run formatting, linting, and changed-file preflight checks that apply to the touched files;
- run the smallest meaningful `v` selector for the changed command path;
- rerun any target that failed earlier in the same subsystem;
- broaden to neighboring tests when a helper, fixture, or command path has plausible impact there;
- use broad targeted validation for high-risk slices such as source-mode updates, pnpm hashing,
  exact-store generation, Go dependency metadata, Python/uv lock handling, C++ provider or
  source-selection metadata, bootstrap/post-clone, or repo-skill guardrails.

Full-suite cadence for this plan:

- PR-1: no full suite by default. Run focused install/post-clone/pnpm/scaffold validation and record
  any deferred broad validation. Include focused Go, Python/uv, and C++ read-only audit tests if
  their install-time mutation paths are changed or classified.
- PR-2: no full suite by default. Run focused `u`, `u --upgrade`, command-help, pnpm repair, and
  upgrade-path validation. Include focused Go and Python/uv repair coverage for any language path
  implemented in this PR, and C++ provider/source-selection repair coverage if that path is moved
  behind `u`. Broaden only if shared reconciliation behavior changes beyond PR-1.
- PR-3: mandatory full `i && b && ALL_TESTS=1 v`, because this PR locks source-mode update
  behavior, fresh-clone/post-clone smoke, `cc` guardrails, command docs, and final help contracts.

Add an earlier full-suite checkpoint only if implementation changes shared verify scheduling,
global Nix/Buck action behavior, or broad source filtering beyond the current uncommitted baseline.
After any passing full-suite checkpoint is committed, use that commit as the scoped-verify base for
later focused `v` invocations in this plan range.

## De-Risking Checkpoints

### Checkpoint A: Current Hardening Baseline Is Coherent

After PR-1, the current in-flight read-only install, post-clone, pnpm metadata, exact-store,
scaffold, Go, Python/uv, C++ provider/source-selection, and stale-state fixes should be coherent as
one foundation. Continue only if focused tests prove tracked-file mutation is blocked and stale
tracked metadata is reported without mutation across every language surface currently touched by
`i`.

### Checkpoint B: `u` Owns Project Dependency Repair And Upgrade

After PR-2, plain `u` should handle ordinary dependency edits without updating viberoots, and
`u --upgrade` should intentionally upgrade project dependencies without updating viberoots.
Continue only if language-focused tests prove manifest edits, lockfile edits, dependency upgrades,
hash metadata, exact-store metadata, help text, and docs all follow the same authority boundary for
pnpm plus any Go/Python/C++ paths implemented in the PR.

### Checkpoint C: Fresh Clone And Release Guardrails

After PR-3, `viberoots update` should update only viberoots pins plus required reconciliation, and
fresh clone/post-clone should leave tracked files clean when committed metadata is current. This is
the mandatory full-validation checkpoint.

## Integration Debt Ledger

Use this ledger for deliberate follow-up discovered during implementation. Do not use it to hide
failing tests, weakened assertions, missing docs, or behavior regressions.

| Area                   | Introduced by | Owner PR | Status    | Notes                                                                                 |
| ---------------------- | ------------- | -------- | --------- | ------------------------------------------------------------------------------------- |
| Full integration suite | PR-1          | PR-1     | Scheduled | Broad live-worktree source filtering triggers `i && b && ALL_TESTS=1 v` after review. |

## PR-1: Consolidate Read-Only Materialization And Reconciliation Foundation

### 1. Intent

Turn the current uncommitted hardening work into a coherent foundation: `i` and post-clone are
read-only for tracked files, stale metadata failures are deterministic, and pnpm/exact-store
reconciliation has a shared implementation boundary ready for `u`.

### 2. Scope of changes

- Inventory the current uncommitted install, post-clone, pnpm exact-store, source-mode, scaffold,
  test, and docs changes.
- Keep and normalize the existing hardening that matches this plan.
- Remove or revise any current in-flight text or behavior that still treats `u deps` as the
  preferred public model.
- Centralize the read-only materialization mode used by `i`, post-clone, and devshell entry.
- Move any tracked metadata writes out of ordinary install paths and behind explicit mutation modes.
- Centralize stale-state classification:
  - dependency/materialization metadata stale: `repair: run u`
  - intentional dependency upgrade required: `repair: run u --upgrade`
  - viberoots pin or source-mode drift: `repair: run viberoots update`
- Ensure stale-state errors name the stale file and state that no tracked files were modified.
- Consolidate pnpm hash metadata refresh, exact-store preparation, and verification behind a shared
  reconciliation module or existing helper surface that can support read-only, conservative repair,
  upgrade, and viberoots-update modes.
- Audit every tracked-file mutation currently reachable from ordinary `i`, including:
  - `go mod tidy` and `go.sum` repair;
  - `gomod2nix.toml` generation or refresh;
  - Python `uv.lock` refresh;
  - C++ provider, nixpkg/source-selection, or generated glue metadata;
  - provider/glue outputs that are tracked rather than ignored local state;
  - workspace lock or flake lock repair;
  - patch workflows that currently rely on a later install to repair tracked metadata.
- For each audited path, classify the write as:
  - ignored local materialization that may stay in `i`;
  - deterministic tracked repair that belongs in `u`;
  - dependency version movement that belongs in `u --upgrade`;
  - viberoots source pin movement that belongs in `viberoots update`;
  - an existing intentional mutation command that should finish by telling users to run `u`.
- Preserve hermetic pnpm metadata generation:
  - isolated HOME and XDG dirs;
  - pinned Node/PNPM from Nix;
  - controlled pnpm store/cache/home paths;
  - normalized timestamps, permissions, and raw pnpm store state before store import;
  - explicit Nix binary selection.
- Keep scaffold paths explicit: a generated importer that needs lock/hash/exact-store metadata must
  run an intentional prewarm/reconciliation path before read-only materialization.
- Define read-only stale checks for Go and Python:
  - Go: detect `go.mod` / `go.sum` / `gomod2nix.toml` states where ordinary install would
    currently run `go mod tidy` or regenerate `gomod2nix.toml`; report `repair: run u` instead.
  - Python/uv: detect manifest/`uv.lock` states where ordinary install would currently refresh the
    lock; report `repair: run u` instead.
- Define C++ read-only checks for tracked generated or source-selection metadata:
  - C++ does not usually need a package-manager lock repair path.
  - If glue/provider/source-selection metadata is stale and tracked, ordinary `i` must fail with
    `repair: run u` instead of rewriting it.
  - If the stale state is purely ignored local generated workspace state, `i` may materialize it.
- Update the install, post-clone, pnpm, and scaffold docs for the foundation behavior.

### 3. External prerequisites

- None.

### 4. Tests to be added

- `i` succeeds without tracked file changes when metadata is current.
- `i` fails without tracked file changes when pnpm hash metadata is stale.
- Post-clone fails without tracked file changes when committed metadata is stale.
- Missing exact-store metadata produces a fail-closed diagnostic that points to `u`.
- Source-mode or viberoots pin mismatch points to `viberoots update`.
- Conservative reconciliation repairs pnpm hash metadata and exact-store metadata from an existing
  lockfile.
- Reconciliation is deterministic across two temp workspaces with different HOME/XDG paths.
- Scaffolded importers prewarm required pnpm metadata before locked/offline materialization.
- Ordinary materialization still fails clearly when exact prefetch is missing.
- Go stale dependency metadata causes `i` to fail without tracked mutation and with `repair: run u`.
- Python/uv stale dependency metadata causes `i` to fail without tracked mutation and with
  `repair: run u`.
- C++ tracked provider/source-selection metadata stale state causes `i` to fail without tracked
  mutation and with `repair: run u`, or is documented and tested as ignored local materialization if
  no tracked state is involved.
- Tracked provider/glue/workspace-lock changes are not produced by ordinary `i`; any required repair
  path is classified and tested.

### 5. Docs to be added or updated

- Update command/help docs that describe `i` and post-clone.
- Update `pnpm/hermetic-node-modules.md` for the shared reconciliation boundary.
- Update scaffold docs where generated dependency inputs require an intentional update/prewarm step
  before read-only materialization.
- Update troubleshooting text that currently instructs users to run `i` to repair tracked metadata.

### 5.5. Expected regression scope

- Install/materialization command surface.
- Post-clone bootstrap.
- pnpm hash and exact-store stale diagnostics.
- Go `go.mod` / `go.sum` / `gomod2nix.toml` readiness.
- Python/uv lock readiness.
- C++ provider/source-selection readiness.
- Scaffold importer materialization.
- Tracked provider/glue/workspace-lock repair paths.
- Consumer source-mode diagnostics.

### 6. Acceptance criteria

- `i` and post-clone do not change tracked files.
- Stale tracked metadata produces a deterministic error with an exact repair command.
- No ordinary install path recomputes or writes pnpm hash metadata.
- No ordinary install path mutates Go, Python/uv, provider, glue, workspace lock, flake lock, or
  other tracked dependency/materialization metadata, including C++ provider/source-selection
  metadata.
- Existing in-flight exact-store and scaffold fixes are captured as intentional behavior with tests.

### 7. Risks

- Existing tests may rely on `i` implicitly repairing metadata.
- Some scaffold or temp-repo flows may need an explicit reconciliation step before materialization.
- Consolidating already-in-flight changes can mask unrelated edits if the starting inventory is not
  careful.

### 8. Mitigations

- Start PR-1 with a status inventory of parent and submodule changes and group them by ownership.
- Update affected tests to call the intentional mutation path where they create stale metadata.
- Add negative tests before removing implicit repair so the new fail-closed behavior is locked in.

### 9. Consequences of not implementing this PR

The later `u` command cannot be trusted because ordinary install paths can still mutate tracked
state or because the current in-flight hardening remains only partially integrated.

### 10. Downsides for implementing this PR

This PR is broader than a greenfield foundation PR because it intentionally absorbs current
uncommitted work.

## PR-2: Implement `u` And `u --upgrade`

### 1. Intent

Implement the developer-facing update command surface for project dependency and materialization
state: plain `u` for ordinary edits and `u --upgrade` for intentional project dependency upgrades.

### 2. Scope of changes

- Replace the current `u` shim behavior with a TypeScript-backed command path.
- Make the bin wrapper delegate only to the TypeScript command.
- Implement plain `u` as:
  - discover affected dependency importers;
  - conservatively refresh lockfiles from manifests where needed;
  - refresh derived metadata through the shared reconciliation engine;
  - refresh generated glue only when required by the reconciled state.
- For pnpm, use conservative lock refresh behavior rather than broad `pnpm update`.
- For Go, run the conservative repair path that ordinary `i` is no longer allowed to run:
  `go mod tidy` only when needed, followed by deterministic `gomod2nix.toml` refresh.
- For Python/uv, run the conservative lock refresh path that ordinary `i` is no longer allowed to
  run, preserving existing lock choices where uv supports that.
- For C++, run only deterministic provider/source-selection/glue repair required by current BUILD
  and Nix metadata. Do not invent a package upgrade concept for C++ unless a future design adds one.
- For tracked provider/glue/workspace metadata, refresh only deterministic outputs required by the
  current source and lock state.
- Preserve existing locked versions where pnpm can do so.
- Refuse unsupported conservative repair paths instead of running upgrade-like commands.
- Implement `u --upgrade` as the intentional dependency-version upgrade mode.
- For pnpm, route `u --upgrade` to package-manager upgrade behavior appropriate for the importer and
  then run shared reconciliation.
- For Go and Python/uv, implement upgrade behavior only where the ecosystem command is explicit and
  bounded enough to document. If the upgrade policy is not ready, fail closed for that language with
  a diagnostic that says upgrades are unsupported rather than silently doing conservative repair.
- For C++, `u --upgrade` should not change nixpkgs packages or provider selections unless a
  reviewed source-selection upgrade policy exists. Without that policy, C++ upgrade requests should
  fail closed with an unsupported-upgrade diagnostic.
- Ensure neither `u` nor `u --upgrade` calls `viberoots update`, moves submodules, updates flake
  pins, or mutates viberoots source-mode metadata except through deterministic reconciliation.
- Update command help and completion for `u` and `u --upgrade`.
- Update docs to teach:
  - after editing `package.json`: `u`
  - after intentional dependency upgrade: `u --upgrade`
  - then `i && b && v`

### 3. External prerequisites

- PR-1 foundation is complete.

### 4. Tests to be added

- Editing `package.json` and running `u` refreshes `pnpm-lock.yaml` and derived metadata.
- Editing only `pnpm-lock.yaml` and running `u` refreshes derived metadata without broad package
  upgrades.
- `u --upgrade` can move pnpm dependency versions and then refresh derived metadata.
- `u` repairs a Go manifest/sum state and refreshes `gomod2nix.toml` without needing `i` to mutate
  tracked files.
- `u` repairs a Python/uv manifest/lock state without needing `i` to mutate tracked files.
- `u --upgrade` behavior for Go and Python/uv is either implemented with focused coverage or fails
  closed with documented unsupported-upgrade diagnostics.
- `u` repairs deterministic C++ provider/source-selection metadata when such metadata is tracked,
  or the C++ path is documented and tested as ignored local materialization only.
- `u --upgrade` for C++ fails closed unless a reviewed source-selection upgrade policy exists.
- `u` and `u --upgrade` leave viberoots submodule pointers and flake pins unchanged.
- `u --help` documents the normal edit workflow and does not advertise `u deps` as the preferred
  path.
- Completion/help tests include `u --upgrade`.

### 5. Docs to be added or updated

- Update `README.md`, contributor docs, and command cheat sheets that list `i`, `b`, and `v` so
  they also explain `u` as the intentional update step after dependency edits.
- Update dependency maintenance docs for `u --upgrade`.
- Update scaffold docs where generated dependency inputs require `u` before read-only
  materialization.
- Avoid teaching `u && i && b && v` as the default happy path for every checkout.

### 5.5. Expected regression scope

- Local command wrappers.
- pnpm importer discovery, conservative lock repair, and upgrade paths.
- Go conservative repair and optional upgrade diagnostics.
- Python/uv conservative repair and optional upgrade diagnostics.
- C++ provider/source-selection repair and unsupported-upgrade diagnostics.
- Generated glue freshness after dependency edits.
- Source-mode guardrails that ensure `u` and `u --upgrade` do not update viberoots.
- CLI help and completion.

### 6. Acceptance criteria

- Plain `u` handles the common `package.json` edit workflow.
- `u --upgrade` upgrades project dependencies only.
- Neither command updates viberoots pins.
- `i` succeeds read-only after `u` repairs dependency and materialization state.

### 7. Risks

- Users may expect `u` to upgrade package versions because the word "update" is broad.
- Conservative lock repair semantics may vary across ecosystems.
- Combining `u` and `u --upgrade` in one PR makes the command-surface PR larger.

### 8. Mitigations

- Use help text that says "make repo dependency/materialization state consistent" rather than
  "upgrade".
- Keep `u --upgrade` as the explicit version-moving path.
- Fail closed for ecosystems without conservative repair support.
- Validate non-upgrade and upgrade paths separately before running the combined focused selector.

### 9. Consequences of not implementing this PR

Users remain forced to know low-level package-manager and viberoots metadata commands.

### 10. Downsides for implementing this PR

The command name becomes broader than "derived metadata only"; tests and docs must keep the
non-upgrade boundary clear.

## PR-3: Isolate `viberoots update`, Add Fresh-Clone Guardrails, And Lock Docs

### 1. Intent

Make `viberoots update` the only viberoots tooling updater, add fresh-clone and commit guardrails
that prevent pin/hash drift from landing, and lock the final command model into docs and help.

### 2. Scope of changes

- Refactor `viberoots update` so it:
  - updates viberoots pins only;
  - handles submodule mode and flake mode coherently;
  - runs required reconciliation after the pin move;
  - does not perform project dependency upgrades.
- Make submodule mode update the submodule pointer and parent metadata in one coherent pass.
- Make flake mode update the flake pin without touching submodule state.
- Add a fresh recursive clone/post-clone smoke fixture that verifies:
  - bootstrap succeeds when committed metadata is current;
  - `git diff --exit-code` passes afterward;
  - `git status --short` is clean;
  - post-clone does not mutate tracked metadata.
- Include submodule mode and flake mode coverage where practical.
- Add a read-only post-clone stale-metadata fixture that proves deterministic failure without
  mutation.
- Update the `cc` skill guardrails for viberoots consumer repos to stop before commit when:
  - source mode and check-in mode disagree;
  - submodule pointer and `flake.lock` disagree in submodule mode;
  - tracked dependency metadata is stale;
  - post-clone would dirty tracked files.
- Make guardrail output name the exact repair command:
  - `u`
  - `u --upgrade`
  - `viberoots update`
- Update command help, completion, and docs for the final model.
- Remove or revise docs that imply `i` repairs tracked metadata.
- Add command-surface contract tests that keep docs/help snippets aligned with behavior.
- Close or update the integration debt ledger.

### 3. External prerequisites

- PR-1 and PR-2 are complete.
- Repo-skill changes may require plugin cache refresh or reinstall according to the repo-skills
  workflow.

### 4. Tests to be added

- `viberoots update` updates submodule mode pins coherently and does not run dependency upgrades.
- `viberoots update` updates flake mode pins coherently and does not touch submodule state.
- Mismatched submodule pointer and flake lock diagnostics point to `viberoots update`.
- Fresh clone smoke passes and leaves tracked files clean.
- Stale pnpm metadata causes post-clone failure with no tracked mutation.
- Submodule/flake pin mismatch is rejected with `viberoots update` guidance.
- `cc` skill guard rejects a consumer repo with stale dependency metadata.
- `cc` skill guard rejects a consumer repo where post-clone would dirty tracked files.
- Help text includes `u`, `u --upgrade`, and `viberoots update` with the correct authority
  boundaries.
- Docs command-contract tests cover `i`, `u`, `u --upgrade`, and `viberoots update` examples.
- Run full `i && b && ALL_TESTS=1 v`.

### 5. Docs to be added or updated

- Update maintenance command docs so `viberoots update` is documented as viberoots-only.
- Update source-mode docs for coherent submodule and flake update behavior.
- Update repo-skill `cc` docs or skill text for viberoots guardrails.
- Update release/post-clone docs with the fresh-clone smoke expectation.
- Update `README.md`, `docs/handbook/getting-started-on-a-pr.md`, `docs/handbook/testing.md`,
  `docs/viberoots-maintenance-commands.md`, `docs/viberoots-source-modes.md`, and relevant
  build-tools docs.
- Keep `update-command-design.md` and this plan aligned with any final naming decisions.

### 5.5. Expected regression scope

- viberoots bootstrap/update launcher.
- source-mode detection and status.
- submodule and flake pin management.
- fresh-clone bootstrap.
- post-clone read-only behavior.
- repo-skills commit workflow.
- public command documentation, help, and completion.

### 6. Acceptance criteria

- `viberoots update` updates viberoots only, plus required deterministic reconciliation.
- Submodule mode and flake mode do not chase each other's pins.
- Known stale pin/hash states fail before commit.
- Fresh-clone smoke proves current committed metadata is sufficient.
- User-facing docs teach one coherent model.
- CLI help matches implemented behavior.
- Full validation passes.
- The integration debt ledger has no open unapproved items.

### 7. Risks

- Existing `viberoots update` behavior may currently refresh project dependency metadata as a side
  effect.
- Fresh-clone smoke can be expensive if it copies too much source or builds broad dependency state.
- Skill guardrails may block commits for states that are valid but not yet modeled.
- This PR touches docs, source-mode behavior, and repo-skills guardrails at once.

### 8. Mitigations

- Run reconciliation after viberoots pin updates, but keep dependency upgrades out of that path.
- Surface stale project dependency metadata as `repair: run u`, not as implicit upgrade behavior.
- Keep smoke fixtures minimal and focused on bootstrap/materialization invariants.
- Add fixture coverage for both accepted and rejected states before enforcing skill guards.
- Run focused source-mode and fresh-clone tests before the final full suite.

### 9. Consequences of not implementing this PR

Pin drift and project dependency drift remain coupled, and the repo can continue landing commits
that pass local validation but fail fresh-clone bootstrap or post-clone cleanliness.

### 10. Downsides for implementing this PR

This is the largest PR in the plan and requires the mandatory full-suite checkpoint, but combining
the source-mode split, fresh-clone smoke, commit guardrails, and final docs avoids multiple separate
full validation iterations over the same bootstrap/update surface.

## Rollout And Sequencing

Implement PRs in order:

1. PR-1 consolidates the current uncommitted hardening baseline and establishes the read-only
   materialization and reconciliation foundation.
2. PR-2 adds the project dependency command surface: `u` and `u --upgrade`.
3. PR-3 isolates `viberoots update`, adds fresh-clone and commit guardrails, locks docs/help, and
   runs the mandatory full validation.

Do not land PR-2 before PR-1 proves ordinary install is read-only. Do not enable strict `cc` skill
guardrails before PR-3 fixtures prove accepted and rejected states. Do not add a second full-suite
checkpoint unless the implementation crosses broader build-system boundaries than the current
in-flight hardening already touches.

## Verification And Backout Strategy

Each PR should be revertible independently until PR-3 tightens commit guardrails. If a command split
causes unexpected workflow failures, prefer reverting the smallest PR that introduced the behavior
while preserving read-only install diagnostics from PR-1.

Backout rules:

- Reverting `u` behavior must not restore tracked-file mutation in `i`.
- Reverting `u --upgrade` must leave `viberoots update` isolated from dependency upgrades.
- Reverting `cc` guardrails must preserve tests and docs that describe the intended incoherent
  states, so the guard can be re-enabled after repair.

Final verification requires:

```bash
i && b && ALL_TESTS=1 v
```

plus a fresh-clone/post-clone smoke run that proves tracked files remain clean.
