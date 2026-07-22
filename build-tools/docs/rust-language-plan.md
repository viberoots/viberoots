# Rust Language Implementation Plan

This plan implements [`lang/rust-design.md`](lang/rust-design.md). It replaces the current
Nix-routed placeholder with real Cargo builds and then adds the applicable viberoots language
contracts without preserving placeholder artifact behavior.

## Reviewed Context

- [`lang/rust-design.md`](lang/rust-design.md)
- [`build-system-design.md`](build-system-design.md)
- [`lang/README.md`](lang/README.md)
- [`../rust/defs.bzl`](../rust/defs.bzl)
- [`../rust/private/nix_build.bzl`](../rust/private/nix_build.bzl)
- [`../tools/nix/planner/rust.nix`](../tools/nix/planner/rust.nix)
- [`../tools/nix/templates/rust.nix`](../tools/nix/templates/rust.nix)
- [`../tools/buck/providers/rust.ts`](../tools/buck/providers/rust.ts)
- [`../../docs/handbook/adding-language.md`](../../docs/handbook/adding-language.md)
- [`../../docs/handbook/getting-started-on-a-pr.md`](../../docs/handbook/getting-started-on-a-pr.md)
- [`../../docs/handbook/testing.md`](../../docs/handbook/testing.md)
- [`../../docs/history/process/turbo-mode.md`](../../docs/history/process/turbo-mode.md)
- [`../../AGENTS.md`](../../AGENTS.md)

## Non-goals

- Repository-vendored Cargo registry or crate source.
- Host rustup, Cargo, rustc, linker, or target components.
- Compatibility with the placeholder shell script or text `.rlib` output.
- Automatic C link intent inferred from ordinary `deps`.
- Supporting unreviewed Cargo plugins, arbitrary build-script host access, or ambient registry
  credentials.
- Per-crate provider rules before importer-level patch invalidation is shown insufficient.

## Implementation Guardrails

- Preserve `u` as the only tracked Rust metadata repair owner. Keep `i`, post-clone, devshell
  entry, and `b` read-only.
- Resolve every executable from a reviewed Nix store path. Nix remains the bootstrap exception.
- Reuse `prepare_language_wiring`, source-selection, link-closure, managed-command, runnable,
  external-runner, patch-workspace, and generated-language-registry helpers.
- Keep Cargo metadata and patches package-local. Cross-root composition must preserve each reviewed
  Cargo root and validate Buck edges against Cargo path dependencies rather than synthesizing an
  undeclared dependency graph.
- Export artifact-affecting Cargo fields explicitly. Labels remain routing and inspection metadata.
- Fail closed on unsupported Cargo sources, target triples, link inputs, lock drift, or remote policy.
- Delete placeholder and TODO behavior when its real authority lands. Do not add a fallback route.
- Update source inputs and generators rather than generated workspace outputs.
- Keep implementation and test source files at or below 250 lines or add an owner-local reviewed
  methodology exception. This plan may exceed that documentation limit.

## Validation Policy

- Each PR owns focused positive and negative tests plus documentation for its behavior.
- Run exact failing targets first and preserve first-failure evidence. Do not weaken assertions or
  clean state before the failure is understood.
- Macro work must cover cquery fields, unknown-argument rejection, graph export, patch inputs, and
  default behavior.
- Cargo/update work must use a bounded production launcher fixture and prove timeout, process-group
  shutdown, byte-exact rollback, and unchanged viberoots source authority.
- Planner work must cover selected and full paths, filtered bundles, hostile environment selectors,
  and same-system artifact identity.
- Remote and WASM work must exercise produced artifacts, not only labels or successful derivation
  evaluation.
- Run focused `v` selectors for every PR. The table below is authoritative for whether a PR requires
  a full-scope suite or the explicitly accepted risk-based Turbo Mode process. Coverage remains
  opt-in unless separately required.
- Record elapsed time and bounded disk/Nix path evidence under the contributor handbook rules. Do
  not make performance claims without comparable evidence.

### Per-PR Validation Mode

`Full scope` means running `i && b && ALL_TESTS=1 v` from the parent workspace root, in addition to
the PR's focused, platform, external-evidence, and independent-review gates. `Turbo risk-based`
means following [`turbo-mode.md`](../../docs/history/process/turbo-mode.md): use the current committed
checkpoint as `GITHUB_BASE_REF`, run formatting/lint, exact and previously failing selectors, a
meaningful affected-target union, and independent scope review, while recording the deferred full
suite in the integration debt ledger. A Turbo PR escalates to full scope before commit whenever its
affected consumers cannot be bounded or validation exposes a cross-cutting regression.

| PR    | Required validation mode | Required minimum beyond the common focused gate                         |
| ----- | ------------------------ | ----------------------------------------------------------------------- |
| PR-1  | Turbo risk-based         | Native build/failure and Rust macro/planner affected union              |
| PR-2  | Full scope               | First native lifecycle baseline and supported configuration evidence    |
| PR-3  | Turbo risk-based         | Install/update mutation, rollback, timeout, and process-lifecycle union |
| PR-4  | Turbo risk-based         | Conservative patch/provider/dependency affected union                   |
| PR-5  | Full scope               | Initial interop, WASM, scaffolding, remote, and platform checkpoint     |
| PR-6  | Turbo risk-based         | Cross-root, crate-kind, proc-macro, and host/target affected union      |
| PR-7  | Turbo risk-based         | Conservative Python/Node extension and packaging affected union         |
| PR-8  | Turbo risk-based         | Bidirectional ABI, generated binding, and link-closure affected union   |
| PR-9  | Full scope               | Cross-language/browser/component WASM checkpoint                        |
| PR-10 | Turbo risk-based         | Developer, dependency-source, watcher, and tooling affected union       |
| PR-11 | Turbo risk-based         | Conservative Tauri/scaffolding/cross-language/platform affected union   |
| PR-12 | Full scope               | Final Rust and Tauri hermeticity, publication, builders, and assessment |

## Turbo Mode Policy

The historical process note supplies the risk-based method, not this plan's milestone numbering.
Its PR-3-through-PR-18 example cadence is reference history only; the table above defines the active
Rust-flow cadence.

- Record the viberoots base commit before PR-1. Every scoped `v` invocation must set
  `GITHUB_BASE_REF` to the current Rust-flow Turbo base rather than inheriting a prior range's base.
- Each PR still requires formatting/lint, exact failing targets, a meaningful affected-target union,
  previously failing subsystem tests, and an independent scope review before commit.
- After a full checkpoint passes and is committed, promote that commit to the Turbo base for the
  next scoped run. Record the commit, commands, logs, disk evidence, skipped coverage, and remaining
  assumptions in the integration debt ledger.
- Do not prepare a later PR against an unresolved failure. Parallel work is limited to
  non-overlapping ownership while validation is active.
- Toolchain, dependency, remote-execution, cross-language ABI, shared test-harness, and publication
  changes remain high risk. Use broader targeted validation immediately and run the full suite early
  when their blast radius cannot be proven smaller.
- PR-11 records its deferred full suite and Tauri-specific assumptions in the integration debt
  ledger after its conservative affected union. PR-12 closes every Rust and Tauri ledger item with
  `i && b && ALL_TESTS=1 v`, high-risk selector reruns, plan/design assessments, and same-system
  independent-builder evidence.

## De-Risking Checkpoints

1. After PR-1, a real native binary and library compile from locked Cargo inputs on one supported
   system, and invalid Rust fails the build.
2. After PR-2, tests, runnable manifests, source selection, and filtered builds share the native
   Rust contract on `aarch64-darwin`; the fail-closed three-system configuration is present, while
   reviewed native Linux execution remains external evidence debt owned by PR-12.
3. After PR-3, `i`, `u`, and `u --upgrade` have a complete Rust mutation and rollback boundary.
4. After PR-4, package-local dependency patches and Cargo metadata inspection are deterministic and
   no TODO provider output remains.
5. After PR-5, the initial C ABI, freestanding WASM, WASI, remote policy, and scaffolding baseline is
   stable enough for the remaining parity work.
6. After PR-6, cross-root crates, explicit artifact kinds, proc macros, and build scripts compose
   without injecting compiler-private artifacts into Cargo.
7. After PR-7, native and WASM Python extensions plus Node-API addons are packaged and exercised by
   their owning language runtimes.
8. After PR-8, C and C++ consumers work in both directions through reviewed generated bindings and
   explicit ABI policy.
9. After PR-9, Rust covers static-linkable WASM, browser packages, cross-language WASM linking, and
   component-model output.
10. After PR-10, Rust has the same developer, lint, documentation, coverage, dependency-source, and
    local-development lifecycle expected of other enabled languages.
11. After PR-11, a scaffolded Tauri desktop application consumes supported repository Rust, C/C++,
    and WASM libraries through declared graph and artifact authorities without host-tool or runtime
    path discovery.
12. After PR-12, sandbox, network, publication, provenance, and independent-builder evidence close
    the Rust and Tauri hermeticity and first-class parity claims.

## Integration Debt Ledger

| Area                                 | Introduced by    | Owner PR | Status | Closure evidence                                               |
| ------------------------------------ | ---------------- | -------- | ------ | -------------------------------------------------------------- |
| Placeholder artifact removal         | Current baseline | PR-1     | Closed | Real source-sensitive Cargo outputs and invalid-source failure |
| Cross-system and runnable parity     | Current baseline | PR-12    | Open   | Native tests and full-suite checkpoint on supported systems    |
| Cargo mutation ownership             | Current baseline | PR-3     | Open   | Production launcher, rollback, and pin-isolation fixtures      |
| Patch/provider ambiguity             | Current baseline | PR-4     | Open   | Applied dependency patch and explicit no-provider contract     |
| Initial interop, WASM, and remote    | Current baseline | PR-5     | Open   | Native/WASM execution and remote-policy checkpoint             |
| Cross-root composition and outputs   | Parity review    | PR-6     | Open   | Multi-root build plus explicit crate-type and proc-macro tests |
| Python and Node extensions           | Parity review    | PR-7     | Open   | Runtime import/load tests for native and WASM artifacts        |
| Complete C and C++ interoperability  | Parity review    | PR-8     | Open   | Bidirectional ABI and generated-binding tests                  |
| WASM ecosystem breadth               | Parity review    | PR-9     | Open   | Static, browser, cross-language, and component execution       |
| Developer and dependency lifecycle   | Parity review    | PR-10    | Open   | Tooling, coverage, dev, and dependency-source fixtures         |
| Hermetic release proof               | Parity review    | PR-12    | Open   | Independent builders, protected publication, and final suite   |
| Tauri repository-library composition | Product template | PR-11    | Open   | Scaffold, cross-language build/run tests, and platform proof   |

## PR-1: Replace Placeholder Outputs With Locked Native Cargo Builds

### 1. Intent

Establish the smallest real Rust build path for libraries and binaries and remove every successful
placeholder artifact route.

### 2. Scope of changes

- Add a pinned Nix Rust toolchain containing Cargo, rustc, rustdoc, rustfmt, and clippy for
  `aarch64-darwin`, `aarch64-linux`, and `x86_64-linux`.
- Define package-local `Cargo.toml` and `Cargo.lock` discovery and require exactly one Cargo root.
- Replace `rustApp` and `rustLib` with one lock-driven `buildRustPackage` implementation.
- Treat Buck `deps` as impact/ordering edges and Cargo manifests as Rust source dependency
  authority. Support same-workspace crates and reject unimplemented cross-root Rust injection.
- Export explicit Cargo manifest, lock, crate, features, default-features, profile, and target fields
  through the Rust macro, Buck rule, graph, planner, and template.
- Make source, manifest, lock, package-local patches, dependency edges, and global Nix inputs real
  action inputs.
- Reject unknown macro arguments and delete the placeholder stdout/text-output behavior.
- Correct or remove `rust.config.ts` so no Rust registry surface points at Go builders.

### 3. External prerequisites

The locked nixpkgs source must provide the selected Rust toolchain and Cargo builder on all supported
systems. PR-1 may prove execution on the available local system; PR-2 owns the complete platform
matrix.

### 4. Tests to be added

- Build a real library and two binaries that consume it; execute the binary and assert Rust output.
- Change library source and prove the consumer output changes.
- Assert invalid Rust, missing/ambiguous Cargo roots, stale locks, unsupported sources, and unknown
  macro attrs fail with actionable diagnostics.
- Assert Cargo, rustc, and linker resolution ignores hostile `PATH`, `RUSTC`, `RUSTFLAGS`, and
  `RUSTUP_HOME`.
- Cover rule type, exported Cargo fields, declared inputs, deterministic deps, and patch input stamps.

### 5. Docs to be added or updated

Update the Rust design baseline, Starlark API, nix-gaps inventory, build-system language status, and
native Rust usage examples with real supported behavior.

### 5.5. Expected regression scope

Rust macros, global language wiring, graph export, selected Nix builds, artifact-policy actions,
filtered source inputs, and source-file scope selection.

### 6. Acceptance criteria

`rust_library` and `rust_binary` compile source with the Nix-store toolchain and checked-in lock.
Invalid source cannot produce an artifact, and no placeholder fallback remains.

### 7. Risks

Nix Cargo vendoring may not match the repository's filtered-source layout, or library outputs may
not have a stable public artifact shape.

### 8. Mitigations

Use one package-local fixture through selected and full builds, inspect the actual derivation output,
and define only the minimal stable library outcome required by downstream Rust builds.

### 9. Consequences of not implementing this PR

Rust remains advertised through public macros that do not compile Rust.

### 10. Downsides for implementing this PR

Real Cargo closures increase build and cache inputs, and existing placeholder-only fixtures must be
rewritten.

## PR-2: Add Tests, Runnable Metadata, Source Selection, And Platform Parity

### 1. Intent

Complete the native Rust target lifecycle after real compilation exists.

### 2. Scope of changes

- Add `rust_test` with the shared project-relative external-runner contract and bounded execution.
- Publish native binary `run.prod` entries and keep libraries out of runnable summaries.
- Add `nixpkg_deps`, `nixpkgs_profile`, and `nixpkg_pins` to Rust macro, graph, planner, and Nix
  build-script inputs.
- Preserve Cargo and source-plan identity through selected and full canonical filtered bundles and
  declared source snapshots, and prove a dry-run remote-preparation handoff for the selected
  artifact. Protected cache manifests never duplicate checkout source-plan fields; Rust-specific
  signed-aggregate cache binding, worker materialization, and admission remain PR-5 scope.
- Add native Rust examples to the language registry prerequisites without enabling scaffolding yet.
- Prove the contract natively on `aarch64-darwin` and configure the two Linux systems fail closed;
  PR-12 owns reviewed native Linux execution before the supported-system claim closes.

### 3. External prerequisites

CI or reviewed builders must provide each supported system. Cross-compilation alone does not prove
native test execution.

### 4. Tests to be added

- Passing, failing, filtered, ignored, and no-test Rust cases through Buck external-runner metadata.
- `r` executes the built binary; `d` rejects the absent dev contract clearly; libraries are not
  listed as runnable.
- Default and non-default nixpkgs profiles plus pinned and unpinned native deps reach Cargo build
  scripts without host pkg-config or linker inputs.
- Selected/full canonical filtered-bundle and declared source-snapshot inspections agree for Cargo
  and source-plan fields; a dry-run materialization manifest binds the immutable selected bundle
  and output. Existing cache-manifest policy continues to reject checkout source-plan fields.
- Run the first plan full-suite checkpoint.

### 5. Docs to be added or updated

Document `rust_test`, runnable behavior, source selection, supported systems, and remote-test limits
in Rust, Starlark, runnable, and remote-build references.

### 5.5. Expected regression scope

External test runners, runnable manifests and commands, nixpkgs source selection, filtered bundles,
remote snapshots, cache manifests, and generated planner registry data.

### 6. Acceptance criteria

Native Rust libraries, binaries, and tests work on `aarch64-darwin` with the same explicit Cargo
and source-plan contract, and the Linux matrix configuration fails closed. Runnables and tests use
only reviewed tools and artifacts. PR-12 must close native Linux execution evidence before Rust is
claimed on every supported system.

### 7. Risks

Platform-specific linker or Cargo behavior may create hidden divergence, and adding Rust to shared
manifests may affect non-Rust runnable selection.

### 8. Mitigations

Use the same fixture and inspection schema on all systems, keep system-specific values explicit,
and add negative assertions that non-Rust manifest entries remain unchanged.

### 9. Consequences of not implementing this PR

Rust could compile locally but would lack test orchestration, runnable UX, native dependencies, and
supported-platform evidence.

### 10. Downsides for implementing this PR

The platform matrix and filtered/remote parity tests add validation cost and require builder access.

## PR-3: Integrate Cargo With Read-Only Install And Transactional Update

### 1. Intent

Give Cargo metadata the same explicit command ownership and failure recovery as other dependency
ecosystems.

### 2. Scope of changes

- Register Rust in the canonical project-language consistency registry.
- Add an exhaustive typed update handler using Nix-store Cargo and the shared managed-command
  timeout and process-group shutdown boundary.
- Make `i`, post-clone, and devshell entry validate `Cargo.lock` and Rust generated metadata without
  mutation; stale state reports `repair: run u`.
- Make `u` run ordinary offline Cargo metadata resolution in a temporary workspace copy without
  invoking `cargo update`, then verify the result with `--locked --offline`.
- Make `u --upgrade` run bounded offline `cargo update`, then the same locked verification.
- Snapshot and byte-exactly restore every lockfile the operation can create, delete, or modify.
- Prove neither mode changes viberoots gitlinks, flake pins, or source-mode metadata.

### 3. External prerequisites

The pinned Cargo version must support offline metadata resolution, locked verification, and update
against a fixture registry/cache. Its exact argv and lock effects must be testable noninteractively.

### 4. Tests to be added

- Read-only `i`, post-clone, devshell, and `b` reject stale Cargo metadata without changing bytes.
- `u` repairs current constraints without a broad version move.
- `u --upgrade` invokes the exact reviewed argv and observably advances the intended dependency.
- Failure, timeout, interruption, prior lock absence, and multi-project partial failure restore all
  tracked bytes and await owned processes.
- A bounded production `u` launcher fixture proves hostile-`PATH` isolation and unchanged viberoots
  source authority.

### 5. Docs to be added or updated

Update update-command design/plan status, build-tools index, troubleshooting, Rust dependency usage,
and command help or diagnostics affected by Rust registration.

### 5.5. Expected regression scope

Install/update orchestration, project-language consistency checks, devshell startup, post-clone,
generated glue validation, managed processes, and dependency fixtures.

### 6. Acceptance criteria

Rust has one tracked mutation authority, explicit conservative and upgrade semantics, bounded
execution, byte-exact rollback, and no host-tool or source-pin mutation path.

### 7. Risks

Cargo's resolver may rewrite more workspace locks than expected, or offline upgrade fixtures may not
represent Git and registry sources accurately.

### 8. Mitigations

Inventory affected paths before execution, fail on paths outside the Cargo root set, use controlled
registry and Git fixtures, and restore the complete pre-operation path/presence map on any failure.

### 9. Consequences of not implementing this PR

Users would need ad hoc host Cargo commands, violating viberoots mutation and tool-authority rules.

### 10. Downsides for implementing this PR

Transactional multi-root handling adds code and fixture complexity to the shared update path.

## PR-4: Complete Package-Local Patching And Cargo Metadata Inspection

### 1. Intent

Make dependency customization real and remove the misleading TODO provider surface.

### 2. Scope of changes

- Add a Rust `patch-pkg` handler through the shared workspace workflow with `start`, `apply`,
  `reset`, `session`, `remove`, and `sync-required` support. Preserve the shared Ctrl-D apply and
  Ctrl-C reset semantics.
- Support the shared `--target`, `--importer`, `--patch-dir`, `--force`, and `--echo-snippet`
  behavior where applicable. Resolve a target/importer to exactly one Cargo root and reject
  conflicting or out-of-root destinations.
- Register the Rust dev-override name in `dev-override-envs.json`, use the shared session store and
  editor handling, reuse an active matching session, and clear override/session state on no-op
  apply, reset, remove, failure, or interruption according to the existing language contracts.
- Define collision-free patch keys using crate name, version, and source identity.
- Resolve crates.io, Git revision, renamed, alternate/private registry, and multiple-version package
  identities from the selected target's checked-in `Cargo.lock`. Require an explicit disambiguator
  when a request does not identify one locked source uniquely.
- Materialize the writable workspace from the exact fixed Cargo source used by Nix, generate a
  canonical `-p1` patch, dry-run it against a clean copy of that origin, and write atomically only
  after verification. Re-applying identical content is a byte-preserving no-op.
- Apply package-local patches to the exact locked Cargo dependency source used by Nix.
- Make `remove` select the same canonical patch key, remove only the resolved package-local file,
  avoid glue for the package-local model, and prove the next build uses the unpatched locked source.
- Make `sync-required` compare the selected Cargo dependency closure with applicable Rust patch
  inventory, report missing/stale/ambiguous entries deterministically, and support an explicit
  write mode only for reviewed placeholder metadata when the shared command contract allows it.
- Export per-target Cargo package/source/version metadata for diagnostics and inspection while
  keeping package-local patches as the invalidation authority.
- Remove Rust provider sync or implement it as an explicit deterministic no-provider adapter; remove
  TODO generated output and sparse-clone ambiguity.
- Add local crate overrides through explicit development-bundle inputs, protected-job rejection,
  visible diagnostics, the centralized override-name registry, and no ambient evaluation state.
- Keep patch, provider, auto-map, and language contract documentation consistent.

### 3. External prerequisites

The Nix Cargo builder must expose a stable patch application boundary for crates.io and Git sources.
Local path dependencies remain reviewed source rather than third-party patch targets.

### 4. Tests to be added

- Start, apply, reset, no-op apply, interrupted session, ambiguous version, renamed dependency, and
  source-collision patch workflows.
- Cover remove, sync-required check/write modes, `--target`, `--importer`, `--patch-dir`, `--force`,
  `--echo-snippet`, active-session reuse, editor failure, missing session, malformed lock entries,
  path traversal, symlink escape, and out-of-root destination rejection.
- Assert exact session-store and dev-override cleanup after success, no-op, reset, remove, failure,
  timeout, Ctrl-C, Ctrl-D, and hard owner death without deleting an inspectable workspace that the
  shared contract intentionally preserves.
- Verify crates.io, Git, alternate/private registry, renamed, duplicate-version, and source-replaced
  crates use collision-free filenames and the exact locked origin.
- A patched dependency changes real compiled behavior; an unrelated Cargo root remains unchanged.
- Patch removal restores behavior without provider glue, and repeated generation is byte-stable.
- Protected jobs reject local overrides, while local development bundles consume the explicit
  override identity and report it visibly.
- Run a conservative broader patch/provider/dependency affected-target union. Escalate to the full
  suite before commit if indirect consumers cannot be bounded.

### 5. Docs to be added or updated

Update patching, provider-sync cookbook, Rust design/usage, language contracts, and generated-glue
descriptions to state the exact no-provider invalidation model. Add a complete Rust walkthrough and
command/flag matrix beside the Go, C++, Node, and Python workflows.

### 5.5. Expected regression scope

Patch CLI helpers, package-local patch discovery, provider orchestration, graph inspection, selected
Cargo dependencies, dev bundles, and CI prebuild guards.

### 6. Acceptance criteria

Rust dependency patches affect the compiled dependency deterministically, invalidation is bounded to
the owning Cargo root, every shared `patch-pkg` lifecycle operation and applicable flag has direct
coverage, and no generated file claims unimplemented Rust providers.

### 7. Risks

Cargo source layouts differ by source type, or patch creation could compare against a different
source snapshot than Nix builds.

### 8. Mitigations

Derive patch workspaces from the locked source identity used by the Nix builder, verify every patch
against that source before writing, and fail unsupported sources explicitly.

### 9. Consequences of not implementing this PR

The shared patch-input labels would imply behavior that artifacts do not honor, and TODO provider
files would remain part of glue orchestration.

### 10. Downsides for implementing this PR

Source-aware patch keys are less concise than crate/version names and require migration tooling if
experimental patch filenames already exist.

## PR-5: Add Initial C Interop, WASM, Scaffolding, And Remote Proof

### 1. Intent

Establish the initial C ABI, executable WASM, scaffold, and remote-execution baseline needed by the
remaining parity work.

### 2. Scope of changes

- Add explicit `link_deps`, `header_deps`, closure, override, native library, and Cargo build-script
  wiring through the shared link-intent planner contract.
- Add `rust_wasm_library` for `wasm32-unknown-unknown` and `rust_wasi_binary` for `wasm32-wasip1`.
- Package target components in the Nix toolchain and reuse existing WebAssembly and WASI harnesses.
- Add Rust project templates and enable Rust in `langs.json` only when every required path exists.
- Add Rust build and test actions to remote readiness, materialization, cache, and hostile-worker
  conformance coverage.
- Synchronize the Starlark API, nix-gaps inventory, route checker, docs index, examples, verify/CI
  selection, and completion criteria.
- Remove current references that call the placeholder rollout complete. Describe the remaining
  parity work as planned rather than shipped.

### 3. External prerequisites

Supported Nix toolchains must contain native and WASM targets. Remote builders and Buck workers must
materialize the declared Rust tool closure on the systems where conformance is claimed.

### 4. Tests to be added

- Rust calls a C library through direct and transitive link intent; invalid overrides and unsupported
  deps fail clearly. Add a C consumer of a Rust static library if that output is included.
- Instantiate freestanding WASM and run WASI output, asserting behavior from compiled Rust source.
- Scaffold a Rust app in a fresh consumer, run `u`, `i`, `b`, tests, and the runnable command.
- Remote-policy static and integration tests cover Rust action inputs, store materialization,
  project-relative test execution, environment filtering, cache/source identity, and cleanup.
- Inventory drift tests cover every public Rust macro and both positive and negative route cases.
- Run the PR-5 `i && b && ALL_TESTS=1 v` checkpoint and the supported-system Rust matrix.

### 5. Docs to be added or updated

Finalize Rust usage, interop, WASM/WASI, scaffolding, remote build, patching, Starlark API,
build-system status, language rollout, and contributor validation references.

### 5.5. Expected regression scope

Shared linking, C++ provider inputs, WASM staging and harnesses, language scaffolding and registry,
remote execution policy, cache manifests, full macro inventory, verify selection, and docs indexes.

### 6. Acceptance criteria

The initial C ABI, freestanding WASM, WASI, scaffolding, and remote-policy paths have direct artifact
evidence. Rust may be enabled as an experimental scaffolded language, but it is not described as
feature-parity or release-hermetic until PR-12 passes.

### 7. Risks

Combining link closure, cross targets, remote workers, and scaffolding can expose shared-system
assumptions outside Rust.

### 8. Mitigations

Land only after PR-1 through PR-4 checkpoints are closed, validate each artifact family separately
before the final union, and back out individual macros or registry enablement without restoring
placeholder behavior.

### 9. Consequences of not implementing this PR

Rust would remain native-only and could not begin the managed-runtime, C++, and broader WASM parity
work on stable shared contracts.

### 10. Downsides for implementing this PR

This checkpoint has broad validation cost and introduces additional toolchain closures and consumer
templates.

## PR-6: Add Cross-Root Crate Composition And Complete Rust Artifact Kinds

### 1. Intent

Make Rust libraries composable across Buck packages and Cargo roots while exposing the artifact
kinds required by Rust, native consumers, proc macros, and later extension work.

### 2. Scope of changes

- Define a source-based Rust crate contract carrying Cargo root, package id, member manifest, lock
  identity, declared sources, features, target/profile constraints, and public crate name.
- Require each cross-root Buck dependency to match a reviewed Cargo path dependency. Preserve the
  repository-relative path relationship in filtered bundles and fail on missing, extra, ambiguous,
  cyclic, or version-incompatible edges.
- Extend filtered source, graph closure, selected/full builds, source snapshots, cache manifests,
  and remote materialization to include the complete transitive Cargo-root source closure.
- Keep Cargo responsible for compiling dependency source. Do not inject `.rlib` files across roots
  or treat rustc-private metadata as a stable interchange format.
- Add explicit `rlib`, `staticlib`, `cdylib`, and `proc-macro` outcomes with deterministic filenames,
  runtime closures, target constraints, and public macro names.
- Support host-built proc macros and build scripts in cross-compilation with separate host/target
  toolchains, declared inputs, bounded execution, and no network or undeclared host filesystem.
- Export crate types, host/target roles, generated outputs, and composition diagnostics as explicit
  graph/manifest fields.

### 3. External prerequisites

The pinned Cargo and Nix builder must preserve repository-relative path dependencies in immutable
filtered bundles and support separate host and target compilation without host rustup state.

### 4. Tests to be added

- Build a binary through libraries in three Cargo roots and prove source changes invalidate only the
  transitive consumers.
- Patch a dependency in one root through the public `patch-pkg` flow and prove every transitive
  cross-root consumer sees it while unrelated roots remain unchanged; remove it and prove reversal.
- Reject undeclared Buck/Cargo edge mismatches, ambiguous package names, incompatible versions,
  cycles, external paths, and missing filtered roots with target-specific diagnostics.
- Build and inspect each crate type. Load `cdylib`, link `staticlib`, consume `rlib` only within the
  compatible Cargo build, and execute a proc macro that changes generated program behavior.
- Exercise build scripts and proc macros under cross-compilation, hostile environment, denied
  network, bounded timeout, interruption, and cleanup.
- Prove selected, full, filtered, and remote-prepared composition manifests are identical.

### 5. Docs to be added or updated

Update the Rust design, Starlark API, Cargo workspace guidance, graph schema, filtering and remote
references, linking docs, and examples for every supported crate type and cross-root layout.

### 5.5. Expected regression scope

Graph closure, filtered bundles, source snapshots, planner dispatch, Cargo root discovery, remote
materialization, native artifact mapping, proc-macro host tools, and file-impact selection.

### 6. Acceptance criteria

Reviewed Cargo path dependencies compose across Buck packages without compiler-private artifact
injection. All declared crate types build from explicit source/lock/tool inputs and have tested,
stable artifact contracts.

### 7. Risks

Cargo path resolution may escape filtered roots, host/target proc-macro builds may share the wrong
toolchain, or broad source closure could weaken incremental selection.

### 8. Mitigations

Validate canonical repository-relative roots before evaluation, model host and target roles
separately, compare closure identities across build modes, and retain importer-local patch and
source invalidation within each Cargo root.

### 9. Consequences of not implementing this PR

Rust would remain confined to single Cargo roots and could not match C++ cross-package composition
or provide stable native artifacts for managed-runtime and C++ consumers.

### 10. Downsides for implementing this PR

Source-based multi-root composition expands graph and bundle metadata and requires strict agreement
between Buck and Cargo declarations.

## PR-7: Add Rust Python Extensions And Node-API Addons

### 1. Intent

Give Rust the managed-runtime extension surfaces currently available to C/C++ and integrate their
artifacts with the existing Python, Node, staging, test, and runnable contracts.

### 2. Scope of changes

- Add a native CPython extension macro backed by PyO3/maturin-compatible Cargo metadata, producing
  the interpreter-specific extension suffix and import path expected by the selected Python runtime.
- Add Rust Python WASM extension variants for the repository's supported WASI and Pyodide backends
  when the pinned toolchains can produce an importable module; fail unsupported ABI combinations
  rather than emitting a placeholder.
- Carry Python interpreter/ABI, module name, extension artifact, runtime deps, `build_py_deps`,
  source-selection plan, and link intent through graph, planner, manifest, and staging contracts.
- Add a Rust Node-API addon macro using a pinned napi-rs-compatible toolchain, producing a `.node`
  artifact with explicit Node-API version, platform identity, and stable addon name.
- Integrate Rust addons with Node asset staging, CLI/service/webapp packaging, module surfaces,
  importer providers, runnable manifests, and native artifact paths used by current C++ addons.
- Keep Python/uv and Node/pnpm dependency mutation owned by their existing registries. Cargo update
  ownership remains Rust-specific, and a combined failure rolls back every involved tracked file.
- Include extension artifacts in remote materialization, cache manifests, deployment packaging, and
  supply-chain evidence without embedding secrets or machine paths.

### 3. External prerequisites

Pinned PyO3/maturin, Python headers/runtimes, napi-rs tooling, Node headers, and supported WASM Python
toolchains must exist in Nix for each claimed system and ABI.

### 4. Tests to be added

- Import a native Rust extension from the selected CPython interpreter on every supported system and
  assert behavior, exception translation, module naming, and runtime dependency closure.
- Patch a locked Rust dependency through `patch-pkg` and prove native Python, Python WASM, and Node
  addon outputs all consume the patched source and revert after `remove`.
- Build/import the supported Rust Python WASM variants and reject unsupported interpreter/backend
  combinations with actionable diagnostics.
- Load a Rust `.node` addon from Node, package it through CLI, service, and webapp staging, and assert
  Node-API behavior and stable runtime paths.
- Exercise Python calling Rust calling C, Node calling Rust calling C, extension test selection,
  lock/update rollback across combined projects, and remote-prepared execution.
- Compare Rust and C++ extension packaging contracts so downstream Python/Node staging does not need
  language-specific fallback branches.

### 5. Docs to be added or updated

Document Rust CPython, Python WASM, PyO3/maturin, Node-API/napi-rs, packaging, ABI selection,
troubleshooting, Starlark APIs, examples, and deployment/runtime implications.

### 5.5. Expected regression scope

Python extension planning, uv/Cargo update transactions, Node addon staging, pnpm/Cargo project
registration, module surfaces, native runtime closures, remote tests, and deployment packaging.

### 6. Acceptance criteria

Python and Node consumers load Rust-produced extensions through the same stable staging and runtime
contracts used for C/C++ artifacts, with tested ABI, update, remote, and failure behavior.

### 7. Risks

Python and Node ABI matrices may multiply artifacts, Pyodide support may lag the pinned Rust/PyO3
versions, and framework-specific packaging may copy native files inconsistently.

### 8. Mitigations

Declare supported ABI matrices centrally, gate each backend on an executable conformance test, reuse
existing extension/addon staging authorities, and reject unavailable combinations at analysis time.

### 9. Consequences of not implementing this PR

Rust could not replace or complement C++ in Python and Node extension workloads and would not reach
managed-runtime interop parity.

### 10. Downsides for implementing this PR

The extension matrix adds large toolchain closures, multi-ecosystem fixtures, and platform-specific
artifact naming that must remain synchronized.

## PR-8: Complete Bidirectional C And C++ Interoperability

### 1. Intent

Replace the initial one-way C example with production contracts for Rust/C and Rust/C++ calls in
both directions.

### 2. Scope of changes

- Add explicit Rust C FFI library and C++ bridge library macro surfaces using `staticlib` or
  `cdylib` outcomes rather than implicit crate-type inference.
- Generate deterministic C headers with a pinned cbindgen-compatible tool and C++ bridge sources and
  headers with a pinned cxx-compatible tool. Treat configuration and generated bindings as reviewed
  action inputs/outputs, never committed source authority.
- Wire generated headers, bridge sources, libraries, runtime closures, and nixpkg deps through
  `link_deps`, `header_deps`, direct/transitive closure, overrides, source profiles, and pins.
- Define ABI rules for symbol names, calling convention, layout-safe types, ownership, strings,
  allocators, thread safety, exceptions, Rust panics, C++ exceptions, unwinding, and destruction.
- Support Rust calling C and C++ through reviewed bridge crates/build scripts and C/C++ calling Rust
  through generated headers and stable library artifacts.
- Reject unsupported direct C++ ABI exposure, cross-language unwinding, toolchain/STL mismatch, and
  target/profile mismatch with actionable diagnostics.
- Extend native and WASM module-surface metadata so downstream link planning can distinguish C ABI,
  C++ bridge, headers-only, static, shared, and target-specific artifacts.

### 3. External prerequisites

Pinned binding generators and compatible C/C++ toolchains must be available for every supported
system. The design must select one supported cxx bridge/version contract rather than allowing
per-target generators.

### 4. Tests to be added

- Rust calls C and C++ libraries, and C and C++ binaries call Rust static/shared libraries.
- Patch a transitive Rust dependency used behind each bridge direction and prove link outputs and
  downstream invalidation follow the same package-local patch contract.
- Round-trip strings, owned values, callbacks, errors, and destruction across the bridge; verify
  panic and exception containment without crossing an unsupported unwind boundary.
- Exercise direct and transitive link closure, overrides, duplicate ordering, shared runtime
  packaging, non-default nixpkgs profiles, and mismatched ABI/toolchain rejection.
- Run bridge generation twice for byte stability and prove source/header edits invalidate only
  affected consumers.
- Cover filtered, remote-prepared, and hostile-worker execution on all supported systems.

### 5. Docs to be added or updated

Update Rust and C++ linking references, language-interop guidance, generated-binding ownership,
Starlark APIs, ABI safety rules, troubleshooting, and bidirectional examples.

### 5.5. Expected regression scope

Shared link closure, C++ templates/providers, generated sources, module surfaces, source selection,
runtime packaging, remote workers, and cross-language test selection.

### 6. Acceptance criteria

Every supported call direction uses explicit generated bindings and artifact types, shares the
canonical link graph, and contains panics/exceptions according to documented ABI rules.

### 7. Risks

Rust and C++ ABI/toolchain changes can silently invalidate generated bindings or runtime ownership,
and shared libraries may need platform-specific loader treatment.

### 8. Mitigations

Pin generator/toolchain identities, keep the supported type surface small, encode ABI evidence in
manifests, add ownership/destruction tests, and reuse existing platform runtime-closure logic.

### 9. Consequences of not implementing this PR

The plan would provide only C ABI demonstrations, not C++ interoperability comparable to the
repository's cross-language linking model.

### 10. Downsides for implementing this PR

Generated bridges add another reviewed toolchain and constrain the Rust/C++ type surface to what the
stable bridge can represent safely.

## PR-9: Reach WASM Linking, Browser, And Component-Model Parity

### 1. Intent

Expand executable Rust WASM support into the static-linking, browser packaging, Node staging,
cross-language, and component workflows expected of the repository's WASM ecosystem.

### 2. Scope of changes

- Add a Rust WASM static-library outcome for the reviewed bare and WASI ABIs, with explicit archive,
  header/module surface, target triple, and link-intent metadata.
- Permit ABI-compatible Rust, C++, and Go/TinyGo WASM link graphs through the canonical direct and
  transitive closure planner. Reject target, libc, allocator, exception, and runtime mismatches.
- Add a browser package macro using pinned wasm-bindgen-compatible tooling, producing deterministic
  JavaScript/TypeScript bindings, `.wasm`, export metadata, and package assets.
- Integrate browser packages and raw modules with `node_asset_stage`, `node_wasm_inline_module`,
  static/SSR webapps, CLI/service packages, and manifest-driven server/client WASM paths.
- Add a Rust WASM component macro using pinned WIT/component tooling, explicit world/interface
  inputs, deterministic adapter selection, component metadata, and a runtime conformance harness.
- Support exported-function/interface allowlists, optimization/debug profiles, source maps when
  explicitly requested, and stripping without changing semantic identity fields.
- Carry all WASM artifacts through filtered bundles, caches, remote materialization, deployment
  packaging, provenance, and module-surface inspection.

### 3. External prerequisites

Pinned wasm-bindgen, wasm-tools/component tooling, compatible WASI adapters, and a component-capable
runtime must exist in Nix. Cross-language static linking requires a documented common ABI/toolchain
matrix rather than assuming all wasm32 outputs are compatible.

### 4. Tests to be added

- Link Rust with C++ and TinyGo-compatible WASM static libraries in every supported direction and
  reject incompatible ABI/runtime combinations.
- Apply and remove a Rust dependency patch and prove raw, WASI, browser, static-linkable, and
  component artifacts all use the same locked patched source identity.
- Instantiate raw freestanding output, run WASI output, load the generated browser package in Node
  and a browser harness, and stage it through static and SSR webapps.
- Execute a component through the pinned runtime, validate WIT imports/exports, adapter identity,
  deterministic regeneration, and unsupported-world diagnostics.
- Verify exported-function allowlists, inline-module contracts, asset manifests, cache/source
  identity, remote execution, and package-local invalidation.
- Run the WASM parity full-suite checkpoint covering existing Go, C++, Python, and Node fixtures.

### 5. Docs to be added or updated

Update WASM linking, Node staging, webapp, component-model, Rust, Starlark API, deployment, and
troubleshooting docs with artifact matrices and end-to-end examples.

### 5.5. Expected regression scope

WASM link closure, C++ and TinyGo templates, Node staging and inline modules, webapp packaging,
module surfaces, WASI/Pyodide harnesses, deployment artifacts, caches, and remote workers.

### 6. Acceptance criteria

Rust supplies raw, WASI, static-linkable, browser-packaged, and component-model WASM artifacts that
execute through repository-owned harnesses and interoperate wherever the reviewed ABI matrix allows.

### 7. Risks

The WASM ecosystem has incompatible ABIs and rapidly changing component tooling, and generated JS
or adapters may embed paths or nondeterministic metadata.

### 8. Mitigations

Pin one toolchain matrix, test artifact bytes/metadata and runtime behavior, normalize generated
outputs, fail incompatible links at analysis time, and keep component support behind explicit macro
selection rather than fallback detection.

### 9. Consequences of not implementing this PR

Rust WASM would remain less composable and less deployable than C++/Go WASM and unavailable to the
repository's browser and component workflows.

### 10. Downsides for implementing this PR

Browser and component tooling add closure size, generated artifact types, and compatibility policy
that must be maintained as upstream standards evolve.

## PR-10: Complete Rust Developer And Dependency Lifecycle Parity

### 1. Intent

Make daily Rust development, quality checks, coverage, documentation, dependency sources, and local
workflows consistent with other enabled viberoots languages.

### 2. Scope of changes

- Add Nix-store rust-analyzer, rustfmt, clippy, rustdoc, cargo-llvm-cov-compatible coverage tooling,
  and any reviewed linker/debugger helpers to devshell, tool-path authority, and generated editor
  configuration without host fallbacks.
- Integrate format, lint, doc-test, unit/integration test, optional benchmark compile checks, and
  coverage collection with `v`, CI scopes, project closure, test result aggregation, and coverage
  publication.
- Add `run.dev` through a repository-owned bounded watcher/rebuilder that uses explicit
  development-bundle inputs and cleanup. Do not publish Cargo watch state or dev artifacts.
- Make local crate overrides a required supported workflow with explicit bundle identity, visible
  diagnostics, protected-job rejection, no ambient evaluation variables, and `patch-pkg` handoff.
- Support crates.io, Git, alternate/private registries, renamed dependencies, features, target cfg,
  build dependencies, dev dependencies, workspace inheritance, and source replacement through a
  reviewed Cargo source policy.
- Keep credentials outside derivations and logs. Materialize authenticated dependency sources
  through approved secret/reference and fixed-source boundaries before offline builds.
- Add Cargo dependency inventory, license/advisory inputs where repository policy consumes them,
  SBOM/provenance package metadata, cache keys, and update diagnostics without making network audit
  services part of ordinary builds.
- Extend scaffolding for library, binary, proc-macro, Python extension, Node addon, C++ bridge, and
  WASM project shapes with deterministic initial locks and read-only post-clone behavior.

### 3. External prerequisites

The pinned toolchain must provide compatible analyzer, formatter, linter, documentation, coverage,
and source-fetch tooling. Private-registry conformance requires a credential-safe fixture service or
local authenticated registry under test ownership.

### 4. Tests to be added

- Hostile-`PATH` tests for every developer/runtime executable and editor-generated command.
- Format, clippy, rustdoc/doc-test, coverage, benchmark-check, project-impact, and result-aggregation
  fixtures with positive and negative cases.
- `d` rebuild/restart, interruption, rapid edit, failed rebuild, owner death, and cleanup tests with
  bounded disk growth and no publishable dev artifacts.
- Local override identity, CI/protected rejection, patch handoff, source replacement, Git/private
  registry auth redaction, offline reuse, credential rotation, and failure cleanup tests.
- Scaffold every supported Rust shape in fresh flake and submodule consumers and run its documented
  `u`, `i`, `b`, `v`, `r`, or `d` workflow.

### 5. Docs to be added or updated

Add Rust daily-workflow, editor, formatting, linting, docs, testing, coverage, dev server, dependency
source, private registry, security, scaffolding, and troubleshooting references.

### 5.5. Expected regression scope

Devshell/tool paths, editor configuration, verify/CI selection, coverage aggregation, runnable/dev
processes, patch overrides, dependency fetch/materialization, secrets, scaffolding, and generated
consumer state.

### 6. Acceptance criteria

A fresh consumer can develop, lint, document, test, cover, run, watch, patch, update, and scaffold
every supported Rust shape using only viberoots-owned commands and Nix-store tools, including an
offline rebuild after reviewed dependency materialization.

### 7. Risks

Developer tooling may expand the default shell closure, watchers may leak processes/state, and
private dependency credentials may cross artifact or log boundaries.

### 8. Mitigations

Keep optional tools in explicit tool closures where possible, use existing owned-process/watch
infrastructure, enforce redaction and pre-build materialization boundaries, and measure closure/disk
effects without unverified performance claims.

### 9. Consequences of not implementing this PR

Rust could build in CI but would remain less usable, less observable, and less safely maintainable
than other supported languages during normal development.

### 10. Downsides for implementing this PR

The supported tool and dependency-source matrix increases maintenance work and the number of
version-compatibility relationships controlled by the Nix lock.

## PR-11: Add A Cross-Language Tauri Desktop Scaffold

### 1. Intent

Add one canonical Tauri desktop-application artifact and scaffold that can consume supported
repository libraries without introducing another build, dependency, or runtime-discovery authority.

### 2. Scope of changes

- Add a `tauri_app` Rust target and planner/template outcome using pinned Nix `cargo-tauri`, Rust,
  Node/pnpm, and platform WebView inputs. Consume a Buck-built frontend artifact as `frontendDist`
  and reject `beforeBuildCommand` and `beforeDevCommand` as duplicate build authorities.
- Add `scaf new rust tauri-app <name>` through the canonical template registry, generating checked-in
  Cargo and pnpm locks, least-privilege Tauri configuration/capabilities/CSP, resources, tests,
  TARGETS entries, and production/dev runnable metadata.
- Model repository libraries through typed authorities: matching Cargo path dependencies and Buck
  edges for Rust; `link_deps`, `header_deps`, and reviewed ABI bridges for C/C++; module surfaces and
  asset staging for browser-side WASM; and explicit runtime closures for reviewed sidecars.
- Keep ordinary `deps` as impact/ordering edges. Never infer native linking, WASM staging, sidecar
  packaging, or runtime mode, and never copy built repository artifacts into scaffold source.
- Make frontend outputs, locks, Tauri configuration, permissions, resources, sidecars, library
  edges, global Nix inputs, and platform inputs declared action inputs with source-sensitive
  invalidation.
- Provide bounded production and dev behavior through shared runnable/process authorities. Reject
  undeclared resources or sidecars, path escape, wildcard capabilities, ambient host tools, hidden
  network access, and config/frontend mismatches.
- Keep deterministic unsigned construction separate from signing and notarization. Protected release
  admission requires reviewed external attestations without passing signing credentials into Buck
  actions or Nix derivations.
- Exclude mobile, updater, arbitrary plugins, direct unstable C++ ABI, host/global `cargo-tauri`, and
  Windows until separate reviewed platform, runtime, toolchain, and signing contracts exist.

### 3. External prerequisites

Pinned nixpkgs inputs must provide Tauri, WebView, GUI, packaging, and system-library closures for
each claimed platform. Reviewed builders and signing/notarization lanes must provide native package
and launch evidence without sharing mutable Cargo, pnpm, GUI, or credential state.

### 4. Tests to be added

- In fresh temporary flake-input and submodule consumers, scaffold the default app and prove the
  `u` → read-only `i` → `b` → `v` → `r` lifecycle without modifying the real consumer repository.
- Prove the backend calls cross-root Rust and reviewed C/C++ libraries while the frontend loads
  staged Rust, C/C++, and another supported producer's WASM through module-surface contracts.
- Prove source-sensitive invalidation and reject missing Cargo/Buck agreement, undeclared native
  inputs, ambiguous module surfaces, copied artifacts, and undeclared sidecars.
- Prove the default scaffold builds with optional integrations empty and does not publish libraries,
  tests, or helper targets as desktop runnables.
- Exercise hostile tool/environment inputs, capability and CSP widening, traversal, config/frontend
  mismatch, denied network, interruption, timeout, and owner-death cleanup.
- Build, package, and launch on available `aarch64-darwin`; withhold Linux claims pending reviewed
  native WebView/package/launch evidence and reject protected publication without required
  provenance and signing attestation.
- Run a conservative Tauri/scaffolding/cross-language/platform affected-target union, cold and warm
  identity checks, and independent scope/design review. Record the deferred full suite in the Turbo
  ledger and escalate before commit if indirect consumers cannot be bounded.

### 5. Docs to be added or updated

Add the Tauri application-composition contract to the Rust design and document scaffold usage,
frontend ownership, Rust/C/C++/WASM integration, typed edges, runnable/dev behavior, capabilities,
platform prerequisites, packaging, external signing, publication, and troubleshooting.

### 5.5. Expected regression scope

Rust macro/planner/template behavior, cross-root Cargo, C/C++ link closure and bridges, WASM module
surfaces and staging, scaffolding, Node/pnpm frontend builds, runnable/dev ownership, platform
packaging, artifact policy, publication admission, and generated registries.

### 6. Acceptance criteria

A newly scaffolded Tauri application builds and runs through reviewed tools, consumes repository
Rust, C/C++, and WASM libraries through canonical typed authorities, and packages only declared
frontend, native, module, resource, and sidecar inputs. No copied-artifact, host-tool, hidden-hook,
ambient probing, network, or duplicate-dependency fallback exists. Full hermeticity and release
claims remain provisional until PR-12.

### 7. Risks

Tauri may encourage hidden frontend hooks, broad desktop permissions, platform-specific host
libraries, mutable sidecar discovery, or signing steps that contaminate deterministic construction.

### 8. Mitigations

Keep frontend building and every library mode as explicit typed inputs, generate least-privilege
configuration, fail closed on undeclared platform/runtime requirements, use owned process and
artifact-policy authorities, and separate unsigned construction from credentialed release admission.

### 9. Consequences of not implementing this PR

Desktop projects would need hand-written integration or copied library artifacts, bypassing the
repository's graph, scaffolding, interop, runtime, and hermetic build contracts.

### 10. Downsides for implementing this PR

GUI/WebView platform matrices, cross-language fixtures, packaging, and external signing evidence add
large tool closures and substantial validation and maintenance cost.

## PR-12: Prove Hermeticity, Publication Safety, And Final Language Parity

### 1. Intent

Close the Rust and Tauri rollout with the artifact environment, sandbox, network, cache,
publication, provenance, remote, and reproducibility evidence required of the repository's
strongest language and application paths.

### 2. Scope of changes

- Register every Rust and Tauri artifact, extension, bridge, WASM, test, codegen, build-script,
  proc-macro, sidecar, frontend, package, and developer entrypoint with canonical artifact, tool,
  environment, network, and runtime policy authorities.
- Expose only declared environment, immutable source/lock/tool/config inputs, isolated Cargo/pnpm
  homes, fixed dependency sources, deterministic locale/time settings, and reviewed sandbox and
  desktop capabilities.
- Deny network during every artifact-producing derivation and Buck action after dependency
  materialization. Prove build scripts, proc macros, binding generators, WASM tools, Tauri tooling,
  frontend packaging, and sidecars cannot reach undeclared host files, credentials, or sockets.
- Add every Rust and Tauri outcome to protected CI, cache publication, provenance, SBOM, deployment,
  external signing/notarization admission, artifact graph, and backout policies.
- Prove independent same-system builders produce the same Nix identity and semantic artifact
  manifest for every representative Rust artifact family and the unsigned Tauri application.
- Complete Buck RE and Nix remote-builder parity, materialization, source-snapshot equivalence,
  cache isolation, interruption/owner-death cleanup, and secret redaction.
- Run final plan/design assessments and close every Rust-flow and Tauri integration-debt entry before
  enabling first-class, hermetic, platform, publication, or signed-release claims.

### 3. External prerequisites

The repository's hermetic-build and publication gates must be available. Two independent builders
for each claimed system, plus reviewed signing/notarization lanes, must build from the same source
and lock identity without shared mutable Cargo, pnpm, GUI, cache, or credential state.

### 4. Tests to be added

- Add sandbox/network-denial and poisoned environment/home/config/credential tests for all Rust,
  WASM, extension, binding, packaging, Tauri, frontend, sidecar, and developer actions.
- Protected publication rejects overrides, dev bundles, untracked inputs, unresolved private
  sources, impure flags, missing provenance, unsupported platforms, unsigned-admission gaps, and
  ambiguous tool or runtime authority.
- Independent-builder tests compare identities and semantic manifests for native bin/lib/test,
  proc macro, Python extension, Node addon, C/C++ bridge, raw/WASI/browser/component WASM,
  cross-root composition, and the unsigned Tauri application package.
- Run the complete public Rust patch matrix on both builders and prove Tauri consumers receive the
  same patched or restored source identity.
- Remote/cache tests prove cold materialization, warm reuse, no credential persistence, bounded disk
  growth, cleanup, and local/remote agreement for Rust and Tauri outcomes.
- Prove native Tauri package/launch behavior and reviewed external signing/notarization admission on
  every claimed platform without placing signing secrets or nondeterministic signed bytes inside the
  deterministic artifact identity.
- Run the mandatory final `i && b && ALL_TESTS=1 v`, supported-system matrix, every Rust/Tauri
  integration example, high-risk selector reruns, debt reconciliation, and independent assessments.

### 5. Docs to be added or updated

Finalize Rust and Tauri design and usage status, hermetic artifact policy, remote/cache setup,
publication, provenance/SBOM, deployment, security, capabilities, platform support, external
signing/notarization, troubleshooting, and the backout runbook. Remove provisional wording only
after all evidence passes.

### 5.5. Expected regression scope

All artifact-policy authorities, environment filtering, sandbox/network policy, filtered source,
remote execution/builders, caches, publication/provenance, deployment and signing admission,
secrets, verify/CI, every Rust integration from PR-1 through PR-10, and Tauri from PR-11.

### 6. Acceptance criteria

Every Rust and Tauri artifact is built from declared immutable inputs with denied network and
reviewed tools, passes protected publication and independent-builder checks, works through local
and remote paths, and has direct tests and current documentation. Signed-release and platform claims
are enabled only where external native evidence passes.

### 7. Risks

An extension, code generator, frontend tool, platform package, sidecar, or signing lane may retain
timestamps, host paths, mutable state, or network behavior that prevents reproducibility or safe
publication.

### 8. Mitigations

Gate artifact families independently, normalize only understood nondeterminism, keep deterministic
unsigned construction separate from signing admission, preserve failures, explicitly withhold
unsupported claims, and never restore an impure fallback.

### 9. Consequences of not implementing this PR

Rust and Tauri could have broad feature surfaces without evidence that their artifacts are safe to
cache, publish, deploy, sign, or reproduce under the repository's hermetic contract.

### 10. Downsides for implementing this PR

Independent builders, GUI/WebView platform matrices, complete artifact families, and protected
publication/signing tests have substantial validation and infrastructure cost.

## Rollout And Sequencing

1. Land PR-1 before exposing new Rust examples. Existing placeholder fixtures must convert in the
   same PR because no fallback remains.
2. Land PR-2 and complete its full-suite checkpoint before relying on Rust native tests or runnable
   metadata.
3. Land PR-3 before documenting Cargo commands for general use.
4. Land PR-4 before accepting third-party Rust patch workflows.
5. Land PR-5 as the initial C/WASM/scaffolding/remote baseline. Keep any manifest enablement marked
   experimental.
6. Land PR-6 before any extension or bridge work so all consumers share stable cross-root and crate
   artifact contracts.
7. Land PR-7 before advertising Python or Node extension support.
8. Land PR-8 before documenting direct Rust/C++ interoperability beyond the C ABI baseline.
9. Land PR-9 before routing Rust WASM into general browser, component, or cross-language examples.
10. Land PR-10 before calling the Rust developer experience comparable to other enabled languages.
11. Land PR-11 after PR-6, PR-8, and PR-9 provide its cross-root, native ABI, and WASM authorities.
    Use the risk-based Tauri gate and keep platform, hermeticity, and signed-release claims
    provisional.
12. Land PR-12 last. Remove experimental Rust/Tauri status and enable platform or signed-release
    claims only after independent builders, native packaging/launch evidence, protected admission,
    debt reconciliation, assessments, and the final full-suite checkpoint pass.

Each PR may ship independently with current unsupported features documented as such. A failed
checkpoint blocks later rollout. Generated provider and graph files are regenerated only through
their owning tools.

## Verification And Backout Strategy

- Before implementation, capture the base revision, current Rust placeholder cquery/build evidence,
  focused selector set, and bounded Nix/workspace disk state.
- For each PR, run formatting and lint for touched source, focused Rust and shared-contract selectors,
  the smallest representative build, and an independent scope review.
- At checkpoints, run the commands in Validation Policy with no source edits, GC, or unrelated work
  during measured execution. Preserve complete logs under ignored viberoots test-log state.
- Back out at PR boundaries. Removing a new macro or registry entry is acceptable when its feature
  fails validation; restoring placeholder artifacts, host-tool fallbacks, ambient mutation, or TODO
  providers is not.
- If a Cargo schema or generated contract must roll back, roll back its consumers and producer in
  the same change, regenerate ignored outputs, and prove older checked-in Cargo projects receive an
  actionable unsupported-state diagnostic.
- The final reviews map every Rust and Tauri design requirement to implementation, direct tests, and
  current docs, and confirm every integration-debt row is closed.
