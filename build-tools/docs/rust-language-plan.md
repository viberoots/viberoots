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

| Area                                 | Introduced by    | Owner PR | Status                    | Closure evidence                                                                                                                                         |
| ------------------------------------ | ---------------- | -------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Placeholder artifact removal         | Current baseline | PR-1     | Closed                    | Real source-sensitive Cargo outputs and invalid-source failure                                                                                           |
| Cross-system and runnable parity     | Current baseline | PR-12    | External evidence pending | Repository matrix is wired; Linux native execution remains fail-closed until both reviewed builders execute every declared three-system Rust case        |
| Cargo mutation ownership             | Current baseline | PR-3     | Closed                    | Canonical Cargo lifecycle, rollback, process, and launcher proof                                                                                         |
| Patch/provider ambiguity             | Current baseline | PR-4     | Closed                    | Applied dependency patch and explicit no-provider contract                                                                                               |
| Initial interop, WASM, and remote    | Current baseline | PR-5     | Closed locally            | Native/WASM execution and remote-policy checkpoint; production worker evidence remains part of release administration                                    |
| Cross-root composition and outputs   | Parity review    | PR-6     | Closed                    | Multi-root build plus explicit crate-type and proc-macro tests                                                                                           |
| Python and Node extensions           | Parity review    | PR-7     | Closed                    | Runtime import/load tests for native and WASM artifacts                                                                                                  |
| Complete C and C++ interoperability  | Parity review    | PR-8     | Closed                    | Bidirectional ABI and generated-binding tests                                                                                                            |
| WASM ecosystem breadth               | Parity review    | PR-9     | Closed                    | Static, browser, cross-language, and component execution                                                                                                 |
| Developer and dependency lifecycle   | Parity review    | PR-10    | Closed                    | Tooling, coverage, dev, and dependency-source fixtures                                                                                                   |
| Hermetic release proof               | Parity review    | PR-12    | External evidence pending | Repository gates and matrix are wired; protected independent-builder aggregate, publication subjects, and release signing administration remain required |
| Tauri repository-library composition | Product template | PR-11    | Closed locally            | Scaffold and cross-language build/run route are implemented; Darwin independent-builder and external signing/notarization evidence remains required      |

### PR-12 Repository And External Evidence Boundary

PR-12 reuses the repository's canonical artifact environment, immutable evaluation bundles,
sandbox/network policy, remote-builder registry, signed reproducibility aggregate, protected cache
and deployment admission, provenance, and cleanup authorities. The Rust manifest records the
implemented sandbox/network boundary but withholds `remoteExecution` and `publicationAdmission`.
The protected lane fails closed, but its external independent-builder run remains required before
either claim can become true.

The protected matrix now includes Rust CLI, test, library, proc-macro, Python extension, Node addon,
separate public C FFI and C++ bridge cases, cross-root composition, raw/WASI modules, bare/WASI
static archives, browser packages, components, and a credential-free Tauri case with a reviewed
sidecar. Every Rust case contributes its installed semantic materialization manifest to the
independent-builder identity comparison. Native and WASM Rust families declare all three release
systems. Tauri declares only `aarch64-darwin`. Aggregation requires two independent reviewed
builders for every case/system pair and rejects a missing Linux Rust pair or missing Darwin Tauri
pair. The actual experimental manifest can retain a signed candidate qualification; only a later
immutable graduated manifest marks the language proof release-admitted.

The external acceptance owner is the protected Jenkins reproducibility lane in `Jenkinsfile`.
Release administration must set `VBR_PROTECTED_REPRODUCIBILITY=1`, provide two independently
administered reviewed builder slots for every declared system through the signed registry, and
provide the protected evidence-store and signing-key credentials referenced by that lane. The
matrix-cell stage runs `produce-artifact-reproducibility-matrix-cell.ts`; the aggregate stage runs
`aggregate-artifact-reproducibility-evidence.ts` and archives its signed readback paths. Repository
tests cannot supply those builders, credentials, protected publication authority, or external
Tauri signer/notary, so both ledger entries remain pending until that protected run and the reviewed
external signing/notarization admission are retained for the frozen revision.

Rust remains `experimental`, Linux and Linux Tauri support remain unclaimed, and deterministic
Tauri artifacts remain explicitly unsigned and unadmitted. The repository-owned Tauri release
admission schema binds a verified protected-store record, provenance, semantic manifest, SPDX SBOM,
reviewed signer, and reviewed notary to the qualified unsigned identity and fails closed on any
missing or mismatched field. The `admit-tauri-release.ts` entrypoint verifies each immutable store
record with the canonical verifier and hashes the exact semantic-manifest and SPDX bytes before
admission. Release administration must still run the protected matrix for the frozen revision,
retain the signed aggregate and readback evidence, and execute the reviewed external
signing/notarization lane. Contract fixtures are not external facts.

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
- Keep the required Apple Silicon linker-generated ad-hoc platform envelope credential-free and
  separate from credentialed signing and notarization. Protected release admission requires
  reviewed external attestations without passing signing credentials into Buck actions or Nix
  derivations.
- Exclude mobile, updater, arbitrary plugins, direct unstable C++ ABI, host/global `cargo-tauri`, and
  Windows until separate reviewed platform, runtime, toolchain, and signing contracts exist.

### 3. External prerequisites

Pinned nixpkgs inputs must provide Tauri, WebView, GUI, packaging, and system-library closures for
each claimed platform. Reviewed builders and signing/notarization lanes must provide native package
and launch evidence without sharing mutable Cargo, pnpm, GUI, or credential state.

### 4. Tests to be added

- In fresh temporary flake-input and submodule consumers, scaffold the default app and prove the
  `u` → read-only `i` → `b` → targeted `v` → production-run lifecycle without modifying the real
  consumer repository. The repository's production-run front door is `p`; `r` in older generic
  plan language does not name a supported command.
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
artifact-policy authorities, and keep credential-free platform-ad-hoc construction separate from
credentialed release signing and admission.

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
  manifest for every representative Rust artifact family and the credential-free, explicitly
  non-release-signed Tauri application.
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
  cross-root composition, and the credential-free ad-hoc Tauri application package.
- Run the complete public Rust patch matrix on both builders and prove Tauri consumers receive the
  same patched or restored source identity.
  The protected six-cell Jenkins job validates the signed registry, exact transport, active smoke,
  policy, system, and builder identity before scaffolding every real Rust reproducibility-matrix
  case through the production consumer producer. It applies a package-local source patch and runs
  the normal selected graph for baseline, patched, and restored states through the reviewed store.
  Each proof recomputes the graph contract and records derivation/output, semantic-manifest, and
  compiled-output behavior identities. Every output axis must change under the patch and restore
  exactly; the two builder slots must agree case by case before signing. The Darwin case's real
  dependency closure includes Tauri, Node webapp and asset staging, a WASM frontend artifact, and
  its C sidecar. The driver uses only the already validated exact remote `runNix`; local selectors
  remain non-authoritative regression coverage and cannot produce protected evidence.
  Protected execution remains external authority and must pass before claims can graduate.
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

### 5.6. Implementation And Engineer Handoff Status (2026-07-30)

PR-12 is still in progress on top of `1ea1ba92` (`feat(rust): add cross-language Tauri scaffold`).
Do not commit, deploy, enable Rust remote/publication claims, or treat protected fixtures as external
facts yet. The nested repository contains the staged PR-12 implementation, including
`protected-rust-patch-consumer.ts`, `protected-rust-patch-workflow.ts`, and
`rust-behavior-observer.nix`. Preserve all of that work and inspect `git status` before editing.

The current PR-12 timing fix gives every Rust WASM derivation a lean `out` runtime and a separate
`provenance` output. Buck keeps only the runtime in `DefaultInfo` and exposes provenance through a
typed provider and `[provenance]` subtarget; selected Nix builds request exactly one named output.
Node staging reads lineage from that explicit provenance input but copies only runtime bytes.
Reproducibility evidence records both output paths, NAR hashes, and closure identities from the same
derivation, while ordinary cache publication remains runtime-only. Runtime-reference enforcement
also removes the Rust toolchain source-path reference embedded in static archives and rejects any
unexpected direct reference; WASI launcher references to its pinned Node and shell remain explicit
runtime dependencies. The pre-fix focused run measured each static runtime closure at about 2.70 GB
because of that single non-runtime toolchain reference, which dominated local binary-cache copy
time even though the archives themselves were about 9 MB.

The active architecture now derives protected cases one-for-one from
`ARTIFACT_REPRODUCIBILITY_MATRIX` and reuses the production scaffold, bootstrap, graph export,
immutable evaluation bundle, and selected Nix build. Each temporary consumer adds a package-local
fixed-source registry dependency, invokes the production `patch-rust` start/apply/remove handlers,
commits distinct baseline/patched/restored Git trees, and reads behavior bytes from the realized
artifact or its production consumer. Phase evidence carries the consumer commit/tree, patch,
source-tree, evaluation-bundle, graph, matrix, graph-binding, reachable-node, derivation, output,
semantic, and behavior identities. The aggregate requires exact restoration and exact agreement
between independent builder slots. Consumer/release `sourceRevision` and embedded-tool
`toolSourceRevision` are independent exact authorities: Jenkins resolves both checkouts, the
`remote-ci-tools` closure authenticates only the tool revision and source-tree digest, and evidence,
cache, qualification, and admission records retain both without requiring equality.

Completed repository work includes:

- the protected Rust/Tauri reproducibility matrix, semantic manifests, signed aggregate and Tauri
  admission schemas, remote-store-safe manifest reads, separate C FFI and C++ bridge cases, Tauri
  sidecar evidence, raw-versus-WASM asset-manifest handling, and fail-closed experimental claims;
- Rust/Tauri planner, fixture, update, read-only-state, process-lifecycle, native-link, source
  selection, Cargo lock, Node asset, scaffold, and tail-log fixes discovered by the first full-suite
  investigation;
- outer-workspace `u`, `i`, and `b`, followed by a focused canonical pass of 12 shared selectors and
  all 5 project-enforcement selectors;
- a non-authoritative real production `rust-pr5` lifecycle before the latest package-local identity
  refactor, using production scaffold, bootstrap, graph export, evaluation-bundle, and
  selected-build paths. Run20 passed in 86.9 seconds and observed baseline/patched/restored behavior
  `42 -> 43 -> 42`; derivations, outputs, semantic digests, and behavior digests changed under the
  patch and restored exactly, while graph digest
  `sha256:14489461ef5c9d0684b1510477d7b2d6e7494111c5ea8be2ef1f54fb5b3246b6` stayed stable. Log:
  `test-logs/pr12-real-matrix-rust-pr5-20260730-run20.log`; and
- a non-authoritative real production `mkTauri` lifecycle that built the macOS application,
  frontend, Rust/WASM input, C sidecar, resources, and manifests and proved exact restoration. This
  remains useful planner evidence and is supplemented by the protected fail-closed evidence below.

The first complete `ALL_TESTS=1 v` attempt selected all 2,073 targets and exited 32 after 15,603
seconds: 2,011 passed and 62 failed. Its saved logs are:

- `viberoots/.viberoots/workspace/buck/agent-test-logs/pr12-final-all-tests-20260729-220004.log`
- `.viberoots/workspace/buck/verify-logs/verify-2026-07-30T05-00-29-401Z-77480-e3f994e5671de.log`

That run was intentionally allowed to exit so all failures could be classified. The deterministic,
outage, snapshot, and timeout roots it exposed were investigated and received focused passing
evidence, but extensive scope-review changes followed, so there is not yet a green final full-suite
run for the current staged fingerprint. The previous successful timing baseline is 10,684 seconds;
the significant-regression threshold is 13,355 seconds. Two genuine 1,800-second timeout bugs were
removed, but the final suite must still be timed and compared with that baseline.

The latest independent scope review, final7, reported seven repo-owned Critical/High/Medium gaps:
the driver edited first-party source instead of applying a real package-local dependency patch;
behavior was self-attested from an expected value; phases reused a stale source revision and lacked
patch/evaluation-bundle identities; `staticlib` and `cdylib` had no distinct matrix cases; Tauri
proved template text rather than desktop-to-webapp/asset/WASM/sidecar reachability; graph evidence
was not bound to the exact immutable evaluation bundle and matrix; and documentation overstated the
evidence. Their current structural disposition is: production package-local `patch-rust`
start/apply/remove workflow implemented; behavior assigned only from exact realized store bytes;
distinct Git/source/patch/bundle/graph/matrix/binding identities implemented; separate
`rust_static_library` and `rust_cdylib` cases added; Tauri language proofs added for `node_webapp`,
`node_asset_stage`, frontend Rust/WASM, and the C sidecar; exact cross-slot case agreement retained;
and this handoff corrected. The post-refactor real matrix and Tauri passes below provide local
positive evidence for those dispositions. A fresh final staged-scope review found two additional
Medium repo-owned issues: Tauri pnpm preparation removed the whole consumer `.nix-gcroots`
directory instead of its exact owned root, and exact canonical artifact URL inputs attempted
filesystem resolution before accepting string equality. Both were fixed with focused regressions;
the review found no remaining Critical, High, or Medium repo-owned gaps at that fingerprint.
Independent final8 review subsequently reopened one Critical and three High findings. The
`rust-test-pr12` matrix role did not generate a dependency-observing test harness; protected CI
still injected `NIX_RUST_TEST_RESOLVE_JSON` with a mutable temporary source; the remote CI tools
closure was not authenticated against the frozen checkout revision and tree; and the Tauri
observer executed a separately realized WASM input rather than bytes recovered from the packaged
desktop output. All four findings are now resolved: the declared `test` artifact executes an
injected dependency observer; protected CI rejects the test resolution seam and materializes an
exact NAR-verified store path on both local and reviewed stores for the production fixed-source
resolver; `remote-ci-tools` carries revision, source-tree digest, and source-store-path metadata
that protected producers and aggregation verify and bind; and the Tauri manifest binds the exact
`frontend.wasm` copied under the packaged `.app`, whose digest is recomputed before execution.
Wrong-store, forbidden-seam, stale-tool-closure, and packaged-WASM contract negatives cover the
failure paths. Final8 also found six files above the 250-line methodology limit; each was split
without an exception, and the resulting primary files are 210, 199, 242, 236, 250, and 187 lines.
Independent final9 review then found one Critical revision-domain conflation: the consumer/release
checkout revision had been treated as equal to the embedded `viberoots` tool checkout revision.
That finding is resolved by binding two independent fields throughout protected production:
`sourceRevision` is the consumer checkout `HEAD`, while `toolSourceRevision` is
`git -C viberoots rev-parse HEAD` and must match the revision embedded in `remote-ci-tools`.
Artifact, protected-patch, aggregate, cache-publication, Tauri qualification, external provenance,
and release-admission records retain both; cross-builder comparison binds both without requiring
them to be equal. A real temporary Git submodule-layout fixture proves differing revisions, and
independent stale-consumer and stale-tool negatives fail in their respective domains.
Independent final10 isolated scope review reported `Scope review passed`, but the newer final11
isolated review supersedes that disposition with two High and one Medium active findings. The Rust
qualification list omits the PR12 static-library and cdylib matrix cases; the lifecycle static
contract both claims publication admission contrary to the fail-closed experimental manifest and
duplicates the incomplete matrix list; and this section's former no-open-gap claim was stale.
Resolution is now active: make qualification enumerate the complete canonical Rust matrix, align
all policy tests with `publicationAdmission: false`, replace adjacent duplicate matrix literals
with a shared authority where practical, run focused graduation/lifecycle/qualification checks,
then record exact evidence here before the mandatory full-suite checkpoint.
The implementation now adds `rust-static-library-pr12` and `rust-cdylib-pr12` to the Rust
qualification manifest, keeps publication admission false, and derives both lifecycle and
graduation contract expectations from the shared canonical matrix helper
`reproducibilityMatrixIdsForArtifactFamily`. The lifecycle contract also uses the repository's
shared source-path resolver instead of duplicating an outer-root cwd assumption. The first combined
direct invocation is invalid evidence: lifecycle reported 0/3 because it ran from the nested source
root against that stale cwd assumption, while the wrapper incorrectly reported aggregate exit `0`
in 4 seconds after later tests passed; log
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/pr12-final11-direct-20260730T171100.log`.
After fixing the path authority and fail-fast wrapper, exact direct commands
`zx-wrapper build-tools/tools/tests/rust/rust.lifecycle.static-contracts.test.ts`,
`zx-wrapper build-tools/tools/tests/rust/rust.hermetic-graduation.contract.test.ts`, and
`zx-wrapper build-tools/tools/tests/ci/artifact-reproducibility-matrix.test.ts` passed 3/3, 4/4,
and 2/2 respectively at aggregate exit `0` in 3 seconds; log
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/pr12-final11-direct-rerun-20260730T171250.log`.
The standalone direct `langs-validate.valid.test.ts` then reported 1/1 at exit `0` in 13 seconds;
log
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/pr12-final11-qualification-direct-20260730T171430.log`.
That test mutated the real `build-tools/tools/nix/langs.json` to its 34-line Go-only fixture despite
using `runInTemp`. The intended full manifest remains preserved in the index, and the truncated
worktree file must not be staged. The subsequent four-target canonical run therefore failed at exit
`32` in 60 seconds: matrix and manifest validation passed 2/4 shared targets, lifecycle and
graduation failed because Rust was absent from the mutated manifest, and generated project
enforcement passed 5/5 in 10 seconds. Its supervising log is
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/v-final11-focused-20260730-171057.log`;
its verify log is
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/verify-logs/verify-2026-07-31T00-11-17-816Z-60978-fae4725670132.log`.
This is failed validation, not policy evidence. The mutation root cause was the valid-manifest
fixture using seeded `runInTemp` for a scratch-only test: its nominal temporary destination escaped
to the active source checkout. The fixture now uses `runInScratchTemp`, resolves the scratch root,
fixture directory, and source manifest before writing, rejects any path escape or same-source
destination, and compares source-manifest contents in `finally`. The full indexed manifest was
restored with the two missing Rust IDs. A post-fix exact direct sequence of manifest validation,
lifecycle, graduation, and matrix tests passed 1/1, 3/3, 4/4, and 2/2 at exit `0` in 7 seconds;
the manifest SHA-256 stayed
`b9541c12a39639489923ab8ed7b2d15bdfa74eccd11e8163832652bd4b18b1b6` before and after. Log:
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/pr12-final11-direct-post-cleanliness-20260730T172200.log`.
The single fully staged four-target canonical retry passed at exit `0` in 56 seconds. Lifecycle
static contracts passed in 1.6 seconds, artifact reproducibility matrix in 1.6 seconds, hermetic
graduation in 1.8 seconds, and valid-manifest/read-only validation in 4.6 seconds; shared summary
was 4/4 in 5 seconds and generated project enforcement was 5/5 in 7 seconds. The source manifest
digest remained the same before and after, registered cleanup candidates were zero, and the orphan
scan was empty. Its supervising log is
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/v-final11-focused-rerun-20260730-171615.log`;
its verify log is
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/verify-logs/verify-2026-07-31T00-16-35-196Z-66767-0c545bcf67cfc.log`.
Final11 findings are implemented and focused-green. Final12 isolated scope review then reported one
Medium finding: `behavior_probe` was accepted through `RUST_PUBLIC_ARGS` by every public Rust macro
and changed artifact execution/installation, while the public Starlark API and macro-contract
coverage did not define it. The implemented architecture keeps it as a narrow, supported,
opt-in artifact-observation API because PR-12 must observe patch behavior through the same public
macro, graph, planner, derivation, and realized-artifact path that production targets use. A
parallel private macro route would no longer prove that path. The API defaults false, accepts only
a boolean, changes artifact construction and output identity when enabled, exposes no command,
path, environment, or expected-value override, recognizes only the reserved
`viberoots_observed_behavior` contract and values `42` or `43`, and writes only
`share/viberoots-rust/observed-behavior`. The Starlark API, Rust development, Tauri development,
and Rust design documents now define native, test-harness, WASM, packaged-Tauri-WASM, library,
proc-macro, and extension observation semantics and keep ordinary targets disabled. Static
contract coverage checks every applicable public macro uses the shared observer-capable build
path; representative cquery coverage checks the boolean reaches all artifact families; and an
analysis negative rejects non-boolean values.

Two initial direct lifecycle attempts are failed validation rather than implementation evidence:
the new documentation assertions did not permit Markdown wrapping after `no` and `the`,
respectively. The first saved run exited `1` in 2 seconds; log
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/pr12-final12-behavior-probe-direct-20260730T173000.log`.
After making both contract assertions whitespace-aware, the exact fail-fast direct sequence of
`rust.lifecycle.static-contracts.test.ts`,
`rust.macros.nix-build.rule-types.cquery.test.ts`, and
`rust.macros.cargo-inputs.analysis-errors.test.ts` passed 4/4, 1/1, and 1/1 at aggregate exit `0`
in 40 seconds. Log:
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/pr12-final12-behavior-probe-direct-green-20260730T173100.log`.
The fully staged focused canonical verifier then passed the corresponding three targets at exit
`0` in 80 seconds. Lifecycle static contracts passed in 1.6 seconds, nix-build rule-types cquery in
13.8 seconds, and Cargo-input analysis errors in 21.4 seconds; shared summary was 3/3 in 22 seconds
and generated project enforcement was 5/5 in 10 seconds. Cleanup scanned eight isolations with zero
candidates or kills, the explicit orphan scan was empty, and Git remained fully staged with no
unstaged or untracked files. Its supervising log is
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/v-rust-lifecycle-cquery-errors-20260730-172837.log`;
its verify log is
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/verify-logs/verify-2026-07-31T00-28-56-898Z-78305-b4610f51405a3.log`.
Final12 is implemented and focused-green. A fresh isolated scope review is still required before
the final full-suite checkpoint.
Final13 isolated scope review supersedes that disposition with one active High finding.
`rust-behavior-observer.nix` currently observes `wasm_browser` and `wasm_component` through the raw
companion `$out/lib/${crate}.wasm`, even though their primary delivered artifacts are the
wasm-bindgen `${crate}_bg.wasm` plus ESM consumer contract and the postprocessed
`${crate}.component.wasm`, respectively. Protected cases can therefore pass while either final
transformation is broken, which violates PR-12's requirement to observe compiled behavior from
every real matrix artifact. Resolution is active: browser observation must exercise the final
wasm-bindgen package and its JavaScript/ESM consumer path, component observation must execute the
final embedded/adapted component artifact, and focused regressions must fail when those final
artifacts or transformations are broken while preserving the fixed observed-behavior contract and
the production public macro route. No full-suite attempt may begin before this primary-path fix is
implemented, focused-green, and independently reviewed.
The Final13 implementation now carries `behaviorProbe` into WASM postprocessing and export
controls. A probed browser package must retain the reserved core export, declare the generated JS
and `_bg.wasm` in its package manifest, import the final ESM module, initialize that final
wasm-bindgen binary, and invoke the reserved export from the initialized instance. A probed
component must include the reserved function in its selected WIT world and execute
`viberoots-observed-behavior()` from the final embedded/adapted `.component.wasm`. The raw companion
is no longer a browser or component observation route. Protected component consumer preparation
adds the bounded WIT/core export from the patched dependency, while ordinary non-probed artifacts
retain their existing export surface. A focused regression both rejects the former raw-path
observer shape and builds the final browser and component artifacts with the fixed `42`/`43`
output contract. Prettier, focused ESLint, Nix parse checks for all four changed templates,
file-size checks, and `git diff --check` pass. The first direct regression invocation from the
nested tooling repository failed before any build at exit `1` in 19 seconds because this seeded
consumer acceptance fixture requires the outer workspace root; log
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/pr12-final13-primary-wasm-direct-20260730T174000.log`.
The correctly rooted retry was intentionally interrupted during filtered source snapshot creation
to freeze this requested staged handoff checkpoint; it is not validation evidence. Its log is
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/pr12-final13-primary-wasm-direct-rerun-20260730T174100.log`.
The subsequent persistent correctly rooted direct regression passed 1/1 at exit `0` in 44 seconds.
It imported the final browser ESM package and observed `42` from
`/nix/store/g4vpplmw20i7jqkzgxqhk415j6k4grlh-rust-projects-apps-rust-wasm-browser-0.1.0/pkg/rust_wasm_fixture_bg.wasm`,
then invoked the final component and observed `42` from
`/nix/store/9g0dm2s0g1ic8k94dq68ax0a0fkizdih-rust-projects-apps-rust-wasm-component-0.1.0/lib/rust_wasm_fixture.component.wasm`.
Its log is
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/pr12-final13-primary-wasm-direct-evidence-20260730T174800.log`.
The direct run left no matching owned test process or retained acceptance directory, Git remained
fully staged apart from this evidence update, and free disk was 139,061,644 KiB. Canonical focused
validation then passed the new final-artifact regression in 45.2 seconds and lifecycle static
contracts in 0.9 seconds, with shared summary 2/2 in 46 seconds and generated project enforcement
5/5 in 6 seconds. The broader resource-limited `rust_rust_wasm_wasi_artifacts` target failed after
3:03.3 at `verifyNodeStages`: the first currently unidentified staged-asset manifest expected one
asset but contained zero. The complete verifier exited `32` in 241 seconds. This is an active
focused failure, not evidence against or for the observer path; investigation must identify the
exact Node stage and graph/source-selection cause before changing implementation. Cleanup scanned
11 isolations with zero candidates or kills, the orphan scan was empty, free disk was 131 GiB, and
Git remained fully staged with no unstaged or untracked files. Supervising log:
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/v-rust-wasm-acceptance-20260730-174414.log`;
verify log:
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/verify-logs/verify-2026-07-31T00-44-34-382Z-4778-1c1ff5601c993.log`.
The focused failure root is the CLI inline-JavaScript stage, not the new browser/component observer.
The file-versus-WASM staging split still copied `rust-inline.js`, so the destination assertion
passed, but the Rust acceptance helper still required every stage to append a raw-WASM manifest
entry. The CLI asset is correctly inferred as `kind = "file"`, and the dedicated mixed-producer
contract explicitly requires inline JavaScript not to be recorded as raw WASM. Its freshly
initialized `assets: []` manifest is therefore correct. The inline module instead embeds its
immutable WASM producer lineage directly in `wasmProducer`; the acceptance helper now keeps exact
one-entry manifest checks for the four actual WASM stages and independently requires the CLI
JavaScript consumer's embedded store path, output identity, source revision, and composition
digest. This reconciles the two existing contracts without weakening WASM manifest cardinality or
changing staging behavior. Focused direct and the exact canonical three-selector retry remain
required. An initial proposal to append every staged file to the raw-WASM manifest was rejected
before validation because it contradicted that explicit mixed-producer contract; no such production
change remains. The direct manifest-identity and mixed-producer tests then passed 1/1 and 1/1 at
aggregate exit `0` in 29 seconds; log
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/pr12-final13-node-stage-contract-direct-20260730T180000.log`.
The complete correctly rooted direct `rust.wasm-wasi.artifacts.test.ts` then passed 1/1 at exit `0`
in 957 seconds. It passed the formerly failing Node staging phase and continued through browser and
component runtime controls, remote-readiness, isolated binary-cache replay, and the complete
package-local patch/apply/remove restoration lifecycle. Its log is
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/pr12-final13-rust-wasm-acceptance-direct-20260730T180100.log`.
The run left no matching owned process or retained `rust-wasm-wasi` temporary directory; free disk
recovered to 134,283,856 KiB and Git remained fully staged. The exact canonical three-selector
retry then passed through cleanup at exit `0` in 912 seconds. Lifecycle static contracts passed in
1.3 seconds, the final browser/component artifact regression passed in 51.5 seconds, and the full
WASM/WASI acceptance target passed in 859.0 seconds. Shared summary was 2/2 in 52 seconds,
resource-limited summary was 1/1 in 859 seconds, generated project enforcement was 5/5 in 8
seconds, and the overall concurrent pass group completed in 860 seconds. Cleanup scanned 11
isolations with zero candidates or kills, the explicit orphan scan was empty, disk had 128 GiB
available, and Git remained fully staged with no unstaged or untracked files. Supervising log:
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/v-rust-wasm-acceptance-retry-20260730-180937.log`.
Verify log:
`/Users/kiltyj/Code/viberoots-site/.viberoots/buck/verify-logs/verify-2026-07-31T01-09-57-448Z-50775-b328b1168f036.log`.
The terminal checkpoint contains 220 staged paths, no unstaged or untracked files, and staged
binary-diff SHA-256 fingerprint
`aca9453253dd6cf4ff3f2ab6e5992b47b804d009edc144e96e921dda5b75aa5d`; free disk was
133,322,016 KiB.
Final13 is implemented and focused-green. Its former future-review disposition is superseded by
the current PR-12 handoff and validation evidence below.
The latest real debugging milestone proves that the package-local dependency is copied into the
immutable consumer evaluation bundle, selected as declared Rust source, NAR-hash validated,
vendored offline, and built under pure evaluation. That run then failed closed because
`behavior_probe` was present on the Buck rule but absent from the graph-export allowlist, so no
observed-behavior file was installed. After wiring the exporter attribute/type, the same real
`rust-pr5` lifecycle passed in 104.2 seconds: pure immutable vendoring; production `patch-rust`
start/apply/remove; artifact-observed `42 -> 43 -> 42`; distinct consumer commits and patched tree,
patch, source, bundle, graph, derivation, output, semantic, and behavior identities; and exact
baseline/restored tree and phase restoration. Its baseline/patched graph digests were
`sha256:0567f239489a527a67c21cc93a3b02c584a2a6496fdb5a1e46e7bd1536982510` and
`sha256:e7c0e0d72a22575339bcc6fbdf25d8c7e948331d1afc8de816de38a8ef8b49f7`;
graph binding stayed exactly
`sha256:8b4a9de249574b45a0417f0d9fb011798974e40e9e4cffa631dac80d2bd4b3b9`.
This is non-authoritative local-daemon evidence.
The separate static-library case subsequently passed its full lifecycle in 102.2 seconds by
compiling and executing a C consumer against the installed archive; the cdylib case passed in 93.3
seconds through a compiled dynamic C consumer. This required the production library scaffold to
declare `rlib`, `staticlib`, and `cdylib` Cargo crate types. The proc-macro case initially exposed
rustc's filename requirement for `--extern`; after copying the exact installed `.proc-macro` bytes
to a temporary platform shared-library suffix, its real macro consumer passed in 107.0 seconds.
Rlib passed in 92.6 seconds through a compiled rustc consumer. Core WASM passed in 118.6 seconds
through wasmtime with TMP-only home/cache state. Python extension passed in 147.8 seconds by
importing the installed module and calling the protected symbol from those same extension bytes
through `ctypes`; its hyphenated scaffold name also required normalized Python module and `PyInit_`
identifiers.
The real Tauri graph now validates the selected desktop's reachable Node webapp, Node asset stage,
frontend Rust/WASM, and C sidecar nodes. The explicit pnpm authority runs production hash update
and committed-store materialization before graph export, copies that exact fixed-output identity
from the local daemon to the active reviewed runner, verifies the path there, and removes the local
GC root. The real run exposed and fixed three production scaffold defects rather than bypassing
them: the importer-local lock now uses `.`, desktop Tauri runtime/build behavior is excluded from
the wasm target, and the shared library emits both `cdylib` and `rlib` artifacts.

With those fixes, the non-authoritative real Tauri lifecycle passed in 695.2 seconds. It realized
the frozen/offline pnpm store, Node modules, raw and staged frontend, protected Rust/WASM module, C
sidecar, and selected macOS desktop package; production `patch-rust` start/apply/remove then
produced packaged artifact-observed `42 -> 43 -> 42`. The patch changed the consumer tree, source,
bundle, graph, derivation, output, semantic, and behavior identities, while the matrix, graph
binding, and reachable-node set remained bound and stable. Baseline and restored derivation,
output, semantic, behavior, source tree, evaluation bundle, graph, graph binding, matrix, and
reachable-node identities restored exactly. Log:
`test-logs/pr12-real-matrix-rust-tauri-20260730-run8.log`.

Focused evidence for the current refactor:

- Direct Node contract command using `NODE_OPTIONS="--import
.../build-tools/tools/dev/zx-init.mjs" node --experimental-strip-types --test`, run individually
  over `ci_protected_rust_patch_case_driver`, matrix, matrix-scaffolds, aggregate-fixture, and
  aggregate-gates: 10 tests passed in approximately 1.18 seconds on 2026-07-30.
- ESLint over the protected consumer, driver, phase, and workflow: passed with exit 0.
- The current canonical focused selector set passed all 12 shared and all 5 project-enforcement
  targets in 20 and 7 seconds respectively; log
  `test-logs/pr12-outer-v-focused-run8-20260730.log`. The preceding isolated outer `u`, `i`, and
  `b` commands each passed with the current provider ordering; logs
  `test-logs/pr12-outer-u-provider-order-debug-20260730.log`,
  `test-logs/pr12-outer-i-provider-order-debug-20260730.log`, and
  `test-logs/pr12-outer-b-provider-order-debug-20260730.log`.
- After the final scope-review fixes, the protected driver plus closed artifact-command environment
  contracts passed all 3 shared and all 5 project-enforcement targets in 11 and 9 seconds
  respectively; log `test-logs/pr12-outer-v-final-scope-review-run2-20260730.log`.
- The final8 exact focused selector set passed all 11 shared and all 5 project-enforcement targets;
  log `test-logs/pr12-final8-focused-run5-20260730.log`.
- The final8 real `rust-test-pr12` lifecycle passed in 196.2 seconds and observed the declared test
  artifact at `42 -> 43 -> 42`; log
  `test-logs/pr12-final8-real-rust-test-run3-20260730.log`. The real packaged Tauri lifecycle
  passed in 709.3 seconds with the `.app`-embedded frontend WASM and its bound digest producing
  `42 -> 43 -> 42`; log `test-logs/pr12-final8-real-rust-tauri-20260730.log`.
- The final9 direct dual-revision, aggregation, cache, and Tauri admission set passed 21 tests; log
  `test-logs/pr12-final9-direct-run3-20260730.log`. Its canonical focused selector set passed all 9
  shared and all 5 project-enforcement targets; log
  `test-logs/pr12-final9-focused-run5-20260730.log`.
- The earlier canonical critical run did not start tests because required cache health for
  `https://cache.nixos.org/` failed closed; log
  `test-logs/pr12-critical-focused-run2-20260730.log`. The latest canonical run cleared cache
  health and formatting, reported the reviewed command-site change, and accepted the final policy
  count 564/digest `22c473283e88689da3d2080fa3ead2a93422606774b720ed82c43b4ac6a375cf`.
  An intermediate run then stopped before tests on stale outer generated glue: the configured site
  app referenced a missing `workspace_providers` lockfile target. Isolated outer `u`, `i`, and `b`
  regenerated and validated that state. A later focused failure came from a ten-hour-old Buck
  isolation daemon retaining the pre-`behavior_probe` rule schema; the source-rule queries now use
  their test-specific inherited isolation, and the canonical post-refresh retry above passed.
- The final10-reviewed implementation immediately before this prose-only handoff reconciliation
  contained 209 staged paths, no unstaged or untracked entries, and staged binary-diff SHA-256
  fingerprint `05f51b3b90ff444a0217d341f42f309366a2eae2b954f1b570bbc3d4a21420fd`.
- The independently verified pre-full-suite freeze contained 209 staged paths, no unstaged or
  untracked entries, 139 GiB free, and staged binary-diff SHA-256 fingerprint
  `e606339860b4e5b90b79a0a7b64ea8392c27f3b03bc77a2e0f8f7dcfd9645390` before this live prose
  update.

Active validation state:

- The first attempted outer preflight launch at `2026-07-30T23:47:52Z` (wrapper PID `12995`) is
  invalid and is not evidence: the process exited and its relocated log remained empty.
- Its replacement runs exactly `direnv exec . zsh -lc 'u && i && b'`, started
  `2026-07-30T23:50:04Z` with supervisor PID `19161`, command PID `19166`, and tee PID `19167`.
  It reached actual exit `0` in 224 seconds: `u` reported `project dependencies reconciled`, `i`
  reported `ok install complete`, and `b` reported `ok buck build complete`. The known startup-check
  parent-root `build-tools` extraction diagnostic was non-fatal. It came from an empty outer
  hierarchy ending `build-tools/tools/ci/fixtures/protected-rust-patch` (birth
  `2026-07-30 10:07`, deepest-directory modification `10:32`), not tracked content; after confirming
  every directory was empty, the exact hierarchy was removed with `rmdir`. Its producer is not yet
  proven, so this does not claim a root cause. The wrapper's zsh `PIPESTATUS[0]` text was blank
  because of zsh indexing, but the unified supervising execution returned `0` and every
  supervising/child process exited without an orphan. The full-suite wrapper must use bash
  `PIPESTATUS[0]` or zsh `pipestatus[1]` and independently verify actual process exit. Its canonical
  log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/pr12-preflight-u-i-b-20260730T235004Z.log`.
- With that preflight staged, the mandatory suite started exact
  `direnv exec . zsh -lc 'ALL_TESTS=1 v'` at `2026-07-30T23:55:25Z`. Its pre-suite staged
  fingerprint was `09a240da2ee1b5312ba05008ae117b23e1ac45c69d6dd7af349814b765488137`
  over 209 paths with no unstaged entries. Supervisor PID `26107`, command PID `26116`, tee PID
  `26117`, and persistent supervising session `78610` were verified live. The canonical full log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/pr12-full-suite-20260730T235525Z.log`.
  A genuine enforcement failure appeared within the first five minutes, so the tester followed the
  early-stop contract and sent SIGINT to the owned verify process. Supervised cleanup completed
  with exit `130` after 245 seconds and no orphan. Project enforcement completed with
  `Tests finished: Pass 5. Fail 0. Fatal 0. Skip 0. Build failure 0` in 13 seconds. Enforcement
  completed with `Tests finished: Pass 46. Fail 1. Fatal 0. Skip 0. Build failure 0` in 107 seconds
  (status 32). Isolated had 2 passes and no observed failure before interruption, then cleanup
  status 1, so it has no completed `Tests finished:` summary. The genuine failing target was
  `viberoots//:linting_process_inspection_commands_enforcement`: direct process-inspection command
  usage outside reviewed helpers at
  `build-tools/tools/dev/tail-log/process-liveness.ts:6` (`direct ps tool resolution`). The verify
  log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/verify-2026-07-30T23-55-55-527Z-26863-2b85627463888.log`.
  Available disk started at `144091504` KiB and ended at its minimum `143284152` KiB, a `807352`
  KiB decrease. The interrupted 245-second elapsed time is not comparable performance evidence
  against the 10,684-second baseline or 13,355-second regression threshold. This suite attempt is
  failed, not passed.
- Investigation of that saved verify log confirmed the root cause: the PR12 tail-log liveness
  module directly resolved and spawned `ps` instead of routing process inspection through the
  reviewed shared helper. `process-liveness.ts` now uses `processTableLines` for the process-state
  query and the shared `processStartSignature` for the start-time query. The change preserves the
  existing `kill(pid, 0)` check and the previous inspection-unavailable behavior; it does not add an
  allowlist entry or weaken the scanner. Prettier, ESLint, and `git diff --check` pass, and the file
  is 31 lines. The full-tree process-inspection enforcement test passes both scanner tests, proving
  the adjacent tree scan is clean, and the directly affected tail-log PID status-watch contract
  passes its single test. The first two delegated canonical attempts stopped before Buck tests
  because removing the duplicate executor correctly changed the production command-site inventory
  from count 564/digest `22c473283e88689da3d2080fa3ead2a93422606774b720ed82c43b4ac6a375cf`
  to count 563/digest `11e33fd9de5ae30cdb66f7d0e42a5dbbabe3ecf291392e4c8a65ec2bacecb94a`.
  The first attempt's wrapper then exited `1` because it used zsh's reserved `status` variable, so
  it is not exact exit evidence; log
  `/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/v-linting-process-inspection-20260730-170308.log`.
  The corrected attempt reached exact exit `2` in 20 seconds and emitted no verify log; log
  `/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/v-linting-process-inspection-20260730-170341.log`.
  The reviewed command-site policy now records the exact scanner count and digest after classifying
  the removed non-artifact orchestration executor; this updates the closed inventory rather than
  bypassing its gate. The single post-policy canonical retry of
  `viberoots//:linting_process_inspection_commands_enforcement` then passed at exit `0` in 60
  seconds: the selected enforcement target passed 1/1 in 2.3 seconds, and canonical `v`'s generated
  project-enforcement lane passed 5/5 in 7 seconds. Its supervising log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/buck/agent-test-logs/v-linting-process-inspection-rerun-20260730-170435.log`;
  its verify log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/buck/verify-logs/verify-2026-07-31T00-04-55-422Z-49623-e2b1aea28117c.log`.
- The post-investigation staged freeze contained 209 paths, no unstaged or untracked entries,
  `143247112` KiB free, and staged binary-diff SHA-256 fingerprint
  `344c28af74dee5a96ddf52ac5f8fb7d51e7bc709118b51ad7cfed4d9cec49847` before this live prose
  update.

The current full-suite checkpoint has since progressed through three saved investigations:

- The first exact outer `i && b && ALL_TESTS=1 v` attempt stopped in `i` because the C++ glue
  fingerprint was stale. The prescribed outer `u` repaired workspace-local freshness state without
  changing nested tracked bytes; a standalone `i` then passed. Its supervising log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/pr12-mandatory-full-20260731-005305.log`.
- The next attempt found two PR-owned enforcement defects and was stopped cleanly after 481
  seconds: the heavy-fanout scheduling integration omitted exact isolation cleanup, and the newly
  split process-inspection runner was absent from the narrow reviewed-helper allowlist. Their exact
  two-selector retry passed at exit `0` in 240 seconds; supervising log
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/pr12-focused-enforcement-two-20260731-011250.log`,
  verify log
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/verify-2026-07-31T08-15-28-964Z-49317-d6e58d841a7e1.log`.
- The guardrail-fixed full attempt passed enforcement 47/47 and project enforcement 5/5, then
  exposed a false native-pnpm disk failure: the fixture itself was 61,340 KiB, but Darwin's global
  APFS `CapacityInUse` changed by 808,500 KiB and exceeded the 512,000 KiB proxy bound. The run was
  stopped cleanly after 721 seconds. Supervising log
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/pr12-mandatory-full-guardrails-fixed-20260731-011741.log`,
  verify log
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/verify-2026-07-31T08-19-39-811Z-56766-83a3a6e2328ee.log`.
  The primary-path fix continuously bounds only the owned fixture, resolves the final output from
  the production marker derivation, requires an empty direct-reference set, binds
  marker/output/rematerialized identity, and accounts only paths newly registered inside the test
  window from the exact derivation and source authority. Exact-name owned paths outside that
  authority fail closed; aggregate newly registered NAR/closure bytes remain bounded without
  global store inventory or APFS deltas. Unit regressions prove unrelated container growth cannot
  fail the owned guard and genuinely oversized or unreferenced owned outputs do fail.
- The first cold owned-evidence retry passed in 600 seconds before the registration-window
  extension: unit guard coverage passed 6/6 and the real integration passed in 6:26.3. The final
  output and closure were both 65,312 bytes with no references, and marker derivation, queried
  output, and rematerialized identity matched. Supervising log
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/pr12-focused-pnpm-cold-owned-output-20260731-013609.log`,
  verify log
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/verify-2026-07-31T08-39-02-238Z-44076-0b4d654e1d038.log`.
  A later full attempt was intentionally stopped after 240 seconds for incremental review; it had
  no real failure, with enforcement 47/47, project enforcement 5/5, and three isolated passes.
- Incremental review then found that inherited isolation cleanup could kill a shared daemon. The
  scheduling fixture now allocates a unique registered test-owned isolation independent of
  `BUCK_NESTED_ISO`, cleans that exact isolation, and includes a live daemon-identity regression
  proving cleanup leaves the inherited probe daemon running. The corrected canonical focused run
  passed at exit `0` in 240 seconds: scheduling passed 2/2 subtests (inherited daemon identity
  unchanged after exact owned-isolation cleanup; heavy-heavy intervals serialized while ordinary
  work overlapped a heavy interval), isolation-lifetime enforcement passed 3/3, and project
  enforcement passed 5/5. Its supervising log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/pr12-corrected-scheduler-focused-20260731T090958Z.log`;
  its verify log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/verify-2026-07-31T09-12-29-878Z-22161-99877509c5b2.log`.
- The registration-window extension received a cold real integration pass inside the later
  five-target focused run: native reconciliation passed in 4:20.8, the owned-evidence unit target
  passed 2/2, the native-run unit target passed 6/6, isolation-lifetime enforcement passed, and
  project enforcement passed 5/5. The final exact lock-hash output had empty direct references,
  `nar_kib=64`, `closure_kib=64`, `exact_owned_nar_kib=64`,
  `created_closure_kib=64`, one registered authority path, and `peak_fixture_kib=61288`; the marker
  derivation still resolved exactly to the rematerialized output. The combined command's scheduler
  target failed only because its daemon probe addressed nonexistent outer-root `//:`; that separate
  fixture command is corrected and validated by the green scheduler run above. Supervising log:
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/pr12-incremental-review-focused-20260731T085832Z.log`;
  verify log:
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/verify-2026-07-31T09-00-55-655Z-3305-8fb366186521e.log`.
- Incremental re-review then required the owned path-info parser to reject malformed reference
  evidence rather than treating it as an empty set. It now fails closed when `references` is
  omitted, is not an array, or contains a non-string element. The canonical focused validation
  passed at exit `0` in 181 seconds: owned-evidence passed 3/3, native-run guards passed 6/6, and
  project enforcement passed 5/5. Its supervising log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/pr12-canonical-pnpm-owned-evidence-20260731T091903Z.log`;
  its verify log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/verify-2026-07-31T09-21-13-728Z-38395-ac51015e2b54f.log`.
- Incremental scope review passed with no remaining Critical, High, or Medium findings at the
  285-path staged fingerprint
  `01cce3ce031c2db41021cde6cc49631854bda00606658117b21133b1aacb3c9d`.
  The ensuing mandatory exact outer `i && b && ALL_TESTS=1 v` attempt passed project enforcement
  5/5 in 14 seconds, enforcement 47/47 in 105 seconds, isolated 15/15 in 1,325 seconds, and
  isolated-bounded 14/14 in 458 seconds. Resource-limited reached 270/275 before one genuine
  failure: `rust_rust_wasm_wasi_artifacts` used modern `nix path-info` syntax for the runtime
  reference-boundary query after the sanitized test environment disabled ambient `nix-command`.
  Browser, raw, and component builds had completed, but closure evidence had not yet been emitted.
  The owned verify process was stopped and cleaned up immediately; shared never started, so this
  7,984-second interrupted attempt is not green performance evidence. No ordinary Nix optimize or
  garbage-collection mutation ran. Its supervising log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/pr12-mandatory-full-suite-20260731T092420Z.log`;
  its verify log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/verify-2026-07-31T09-26-33-454Z-49781-c61d80d498719.log`.
- The primary-path fix replaces that experimental query with stable `nix-store --query` evidence:
  direct references, full requisites, and exact per-requisite NAR sizes are validated fail closed
  and summed for closure bytes. The query explicitly clears `NIX_CONFIG`, so its correctness does
  not inherit experimental-feature settings; it retains the empty-reference requirements and
  32-MiB static closure bounds. The canonical focused retry passed at exit `0` in 781 seconds:
  the new evidence/sanitized-environment unit target passed 2/2, project enforcement passed 5/5,
  and the full WASM/WASI acceptance target passed 1/1 in 9:22.0. Exact closure evidence was browser
  35,296 bytes/0 refs, component 2,976/0, raw 856/0, static 9,166,640/0, WASI static
  9,375,008/0, WASI component 3,072/0, WASI demo 241,378,096/3, and browser debug 35,544/0.
  Its supervising log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/pr12-rust-wasm-query-fix-20260731T114220Z.log`;
  its verify log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/verify-2026-07-31T11-44-43-971Z-57461-3c634851b1052.log`.
- A mandatory rerun from the reviewed 286-path snapshot was stopped intentionally after a
  validated systemic timing regression: 53 common targets were 28.9% slower than the passing
  baseline during sustained external CPU/disk contention, with no idle-slot, Nix, memory, or
  thermal root cause. Before the stop, project enforcement passed 5/5 in 13 seconds, enforcement
  passed 47/47 in 45 seconds, isolated passed 15/15 in 1,084 seconds, isolated-bounded passed 14/14
  in 390 seconds, and resource-limited passed 69/275 with zero genuine failures in 1,490 seconds.
  Direct SIGINT reached the owned verify process, cleanup completed, and all run-owned processes
  exited; the interrupted 3,151-second elapsed time is not green regression evidence. Shared did
  not start, so current-run heavy-overlap and final WASM closure evidence remained pending. The
  resource lane recorded 298 samples and peaked at load1 80.71; all three high-load process
  sampling attempts failed because Darwin's Nix-store `ps` rejects the entitlement-gated `%mem`
  field. No ordinary Nix optimize or garbage-collection mutation ran. Supervising log:
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/pr12-full-suite-fixed-20260731T115855Z.log`;
  verify log:
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/verify-2026-07-31T12-00-59-927Z-99875-d66508ce66d77.log`.
- The telemetry fix omits only `%mem` from the reviewed top-process `ps` projection while retaining
  PID, parent PID, state, CPU percentage, and command. Its fallback and parser use the same reduced
  schema. A direct Darwin-compatible regression asserts the exact command arguments and executes
  the real sampler, requiring successful bounded process lines with CPU evidence and no `pmem`
  field. Canonical focused validation passed at exit `0` in 180 seconds: the selected safety-rails
  target passed 1/1, its internal suite passed 14/14 including the live sampler regression, and
  project enforcement passed 5/5. The live command returned nonempty numeric `pcpu` lines without
  `pmem`. Its supervising log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/pr12-darwin-sampler-fix-20260731T125632Z.log`;
  its verify log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/verify-2026-07-31T12-58-50-229Z-3081-4398c3ca8da8.log`.
- After a 3/3 host-quiet gate, another mandatory run exposed a separate load-only telemetry gap:
  an external runner restarted at suite launch and sustained approximately 179 MB/s and 11,900
  transfers/s while load1 stayed below the existing threshold. The investigator measured the
  isolated lane at a projected 31% regression versus the July 24 passing baseline, so the frozen
  run was stopped under the significant-regression contract. Project enforcement passed 5/5,
  enforcement passed 47/47, and isolated reached 14/15 with 14 passes and zero genuine failures in
  1,006 seconds. The owned verify process stopped by SIGINT, all cleanup completed, and the
  supervisor exited `130` after 1,260 seconds. No high-load process sample was attempted because
  load1 peaked at only 34.04; no ordinary Nix optimize or garbage-collection mutation ran.
  Supervising log:
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/pr12-mandatory-full-suite-quiet-20260731T131204Z.log`;
  verify log:
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/verify-2026-07-31T13-15-10-802Z-29162-013f4b927de44.log`.
- The fail-soft Darwin disk telemetry fix starts one persistent, shell-free
  `iostat -dC -w 5 disk0` process per Buck pass. It discards the uptime-average row and parses
  subsequent direct interval `KB/t`, `tps`, `MB/s`, `us`, `sy`, and `id` columns without taking
  invalid row deltas. Existing bounded process capture now activates on load1 at least 75 or after
  two consecutive disk samples at either 50 MB/s, or 20 MB/s with at least 5,000 transfers/s, with
  a 60-second capture cooldown. The sampler is fail-soft, records success/unavailable/parse/exit/
  timeout counters and peak disk throughput, restarts at most once, and is awaited during pass
  cleanup. Unit and live regressions cover schema parsing, uptime-row discard, both pressure
  thresholds, two-sample gating, cooldown, disk-triggered process capture, one-restart lifetime,
  summary counters, and a real Darwin interval. The first canonical attempt correctly stopped at
  the closed command-site inventory because the new reviewed inspection executor changed its count
  from 566 to 567. After classifying that non-artifact inspection site, canonical execution exposed
  that sanitized Buck tests could not resolve the native Darwin tool from `PATH`; the sampler now
  binds `/usr/sbin/iostat` explicitly because its parser requires Darwin semantics. Independent
  incremental review then found one Medium fail-soft gap: an ENOSPC/EIO telemetry write could leave
  the serialized write chain rejected and make awaited cleanup fail. The queue now absorbs each
  diagnostic write failure, permits later writes, and always resolves its flush. An injected ENOSPC
  regression proves the first write can fail while the second succeeds and cleanup still resolves.
  The final direct safety-rails suite passed 20/20. Canonical validation then passed the safety-rails
  target 1/1, process-inspection command-site enforcement 1/1, and project enforcement 5/5. Its
  supervising log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/agent-test-logs/pr12-disk-telemetry-failsoft-policy-final-20260731.log`;
  its verify log is
  `/Users/kiltyj/Code/viberoots-site/.viberoots/workspace/buck/verify-logs/verify-2026-07-31T18-45-17-053Z-20478-04a9b4264a4ee.log`.
  Independent incremental re-review passed with no remaining Critical, High, or Medium repo-owned
  findings.
- Spotlight inspection isolated the remaining repo-local `mds` churn to generated Buck output:
  310 of 372 recently indexed workspace paths were under the outer `buck-out`, principally Buck
  logs, test logs, generated web assets, and SQLite/WAL state. A root `.metadata_never_index`
  marker, and then a marker created on the exact Buck isolation before Buck started, each still
  allowed seven generated assets to enter the index. Darwin isolation names now use a physical
  `.noindex` suffix for dev-build, exporter, artifact-cache, verify-pass, and nested-test Buck
  directories; suffix extension preserves `.noindex`, cleanup accepts old and new names, and
  non-Darwin names are unchanged. A reviewed migration also stops and removes the two exact legacy
  unsuffixed Darwin shared identities for the workspace, preventing old indexed trees and daemons
  from surviving an upgrade alongside their replacements. After a clean `b`, the live dev-build artifact-cache and exporter
  roots all ended in `.noindex`; `buck-out` contained 127 files while `mdfind -onlyin buck-out '\*'
  returned zero immediately and again after 55 seconds. Focused direct tests passed from their
  expected working directories, including exporter naming, cache isolation, metadata,
  nested isolation, pass scheduling, and orphan cleanup. The closed command-site inventory stayed
  at 567 sites and received its reviewed digest refresh after the exporter/glue source change.
  Canonical focused validation then passed all six selected targets 6/6 and project enforcement
  5/5. Incremental review then identified the legacy-isolation migration gap; its focused cleanup
  regression passed 4/4, and the additional reviewed cleanup executor advanced the closed
  command-site inventory to 568 sites.
- A follow-up audit used the stricter recent-change Spotlight query rather than relying only on the
  wildcard query. It found 944 recent records and 943 files under the marker-only artifact Node
  compile cache, plus 69 recent records across 23 marker-only `zx_shims` roots. The canonical
  artifact environment now owns `NODE_COMPILE_CACHE`: Darwin uses
  `node-compile-cache.noindex`, while other platforms retain `node-compile-cache`. Darwin `zx_test`
  shim roots likewise append `.noindex`; their parent and non-Darwin layout remain unchanged. The
  legacy cache and shim roots were moved recoverably before validation. Canonical focused verify
  passed the two affected targets 2/2 and project enforcement 5/5, creating 1,461 cache files and
  21 shim files only below physical `.noindex` roots. After 55 seconds, both the wildcard and
  recent-change Spotlight queries returned zero for every new cache and shim root; no legacy path
  was recreated.

Before this evidence prose update, the current implementation freeze contained 308 staged paths,
no nested unstaged entries, and staged binary-diff SHA-256 fingerprint
`b35f509fc141dc58dc6762f11b0834efda4c4b832f69c516dcd74b06849dc8c2`.

Next execution order:

1. After the external job finishes and the host quiet gate passes,
   freeze the staged snapshot and run exact logged outer
   `i && b && ALL_TESTS=1 v`. Record every phase summary, final exit, elapsed time, verify log,
   staged fingerprint, heavy-fanout overlap evidence, high-load telemetry, Rust/WASM closure-copy
   timing, and comparison with the 10,684-second baseline and 13,355-second regression threshold.
2. After a green non-regressed full suite, update this handoff with final evidence, run lightweight
   documentation guardrails, and commit through the repository commit workflow. Do not push.

The active/new files to preserve include `artifact-revision-domains.ts`,
`remote-ci-tools-source-identity.ts`, `protected-rust-dependency-authority.ts`,
`protected-rust-patch-consumer.ts`, `protected-rust-patch-workflow.ts`,
`protected-rust-patch-phase.ts`,
`protected-rust-patch-case-driver.ts`, `protected-rust-patch-evidence.ts`,
`artifact-reproducibility-matrix-binding.ts`, aggregate/evidence/admission schemas,
`rust-behavior-observer.nix`, `rust-tauri.nix`, the Rust matrix and Tauri/lib scaffold templates,
and their staged aggregate, cache-publication, protected-driver, dual-revision, matrix,
matrix-scaffold, semantic-manifest, Tauri-release, packaged-WASM, and local-daemon fixtures/tests.
The nested repository is fully staged at this handoff; do not discard or partially regenerate it.

The machine had 133,322,016 KiB free after the focused Final13 canonical retry completed.
Protected independent-builder execution, signed evidence publication, native platform launch,
external Tauri signing/notarization, and production admission still require externally administered
builders, signing/notary credentials, and publication credentials. They remain fail-closed and
cannot be simulated by repository tests.

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

Gate artifact families independently, normalize only understood nondeterminism, keep the local
platform-required ad-hoc envelope separate from credentialed release signing and admission, preserve failures, explicitly withhold
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
