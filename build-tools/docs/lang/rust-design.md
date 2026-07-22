# Rust Language Design

This document defines Rust support for the current Buck2 and Nix architecture. It separates the
implemented compatibility baseline from the first-class language contract. The implementation plan
is [`../rust-language-plan.md`](../rust-language-plan.md).

## Current Native Lifecycle

The current Rust route compiles package-local Cargo libraries, binaries, and tests from checked-in
manifests and locks. It provides the native lifecycle through PR-2, but is not yet the complete
first-class Rust lifecycle.

| Surface              | Current behavior                                                                                                                                                                                                                              | Evidence                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Public macros        | `rust_library`, `rust_binary`, and `rust_test` accept shared graph inputs plus canonical package-local Cargo metadata, crate, feature, source-selection, profile, and native-target fields. Alternate metadata paths and unknown fields fail. | `build-tools/rust/defs.bzl`, `docs/handbook/starlark-api.md`                                                          |
| Shared wiring        | Macros stamp `lang:rust`, `kind:*`, `patch_scope:package-local`, and remote-readiness labels. Package-local Rust and patch files become Buck inputs, and provider deps are merged deterministically.                                          | `build-tools/lang/internal/package_local_wiring.bzl`                                                                  |
| Buck action          | `rust_nix_build` declares Cargo metadata, the package-local Rust source closure, explicit non-Rust sources, patches, dependencies, and global Nix inputs. Libraries materialize the compiled `.rlib`; binaries copy the selected executable.  | `build-tools/rust/private/nix_build.bzl`                                                                              |
| Planner              | `lang:rust` plus `kind:bin`, `kind:lib`, or `kind:test` dispatches to the Rust planner.                                                                                                                                                       | `build-tools/tools/nix/planner/rust.nix`                                                                              |
| Artifact             | One `buildRustPackage` authority uses Nix-store Cargo, rustc, rustdoc, rustfmt, and clippy. It emits real release executables and a stable compiled `.rlib` outcome.                                                                          | `build-tools/tools/nix/templates/rust.nix`, `build-tools/tools/nix/flake/packages/toolchains.nix`                     |
| Providers            | Generic provider edges work when `MODULE_PROVIDERS` already contains entries. Rust provider sync emits only an empty or TODO file, and the language contract declares `providerModel: "none"`.                                                | `build-tools/tools/buck/providers/rust.ts`, `build-tools/tools/lib/lang-contracts.ts`                                 |
| Tests                | Cquery covers routing, exported Cargo fields, inputs, provider order, and unknown-field rejection. Native fixtures execute two binaries, prove source sensitivity, and cover fail-closed Cargo diagnostics.                                   | `build-tools/tools/tests/rust/`, `build-tools/tools/tests/lang/rust.stub.provider-edges.deterministic.cquery.test.ts` |
| Language registry    | Rust is not enabled in `build-tools/tools/nix/langs.json`; a native example exists only as a disabled registry prerequisite.                                                                                                                  | `build-tools/tools/nix/langs.json`, `build-tools/tools/nix/examples/rust/`                                            |
| Dependency ownership | Cargo is deliberately excluded from the current `u`, `u --upgrade`, and read-only `i` contract.                                                                                                                                               | `build-tools/docs/update-command-design.md`                                                                           |
| Runtime and tests    | `rust_test` executes compiled Cargo harnesses through a bounded project-relative external runner. Native binaries publish `run.prod`; libraries and tests stay out of runnable summaries.                                                     | Rust macro, runner, planner, and manifest implementations                                                             |
| Source selection     | Native targets export `nixpkg_deps`, `nixpkgs_profile`, and `nixpkg_pins`. The shared source-plan resolver selects the Rust toolchain and declared build-script dependencies.                                                                 | Rust macro, graph attrs, planner, and template                                                                        |

The stale TypeScript planner config that pointed at Go builders has been removed. The Nix Rust
planner is the only language planner authority.

## Native Usage

Each target lives at one package-local Cargo root. Buck `deps` record impact and ordering; the
reviewed Cargo manifest remains source dependency authority. Every target declares the
package-local `**/*.rs` closure because Cargo may compile same-root library source while building a
binary; non-Rust assets read by Cargo or build scripts remain explicit `srcs`.

```starlark
load("@viberoots//build-tools/rust:defs.bzl", "rust_binary", "rust_library")

rust_library(name = "core", crate = "demo", srcs = ["src/lib.rs"])
rust_binary(name = "demo", crate = "demo", srcs = ["src/main.rs"], deps = [":core"])
```

The package must check in the canonical `Cargo.toml` and `Cargo.lock`; alternate or cross-root Cargo
metadata paths fail closed. Patch directories must be normalized package-relative paths without
traversal. Cross-root Rust `deps`, non-native targets, unsupported lock sources, and stale locks
also fail closed. Cargo update, patch application, C interop, WASM, remote admission, and public
scaffolding remain owned by later plan PRs.

## Goals

- Compile Rust libraries, binaries, and tests with a Nix-store Rust toolchain and Cargo dependency
  closure.
- Keep Buck as the dependency graph, impact, action-input, and test orchestration authority.
- Keep Nix as the artifact, compiler, Cargo, dependency, and target-platform authority.
- Give Rust the same applicable language lifecycle as current languages: read-only install,
  transactional update, selected build, runnable metadata, patching, source selection, remote
  policy, scaffolding, enforcement, and focused validation.
- Support native builds, explicit C interop, `wasm32-unknown-unknown`, and `wasm32-wasip1` without
  ambient host tools.

## Non-goals

- Vendoring Cargo registries or crate source into the repository.
- Supporting rustup, host `cargo`, host `rustc`, or ambient `RUSTFLAGS` as build inputs.
- Inferring C link intent from ordinary `deps`.
- Hiding unsupported Cargo sources, target triples, or workspace layouts behind fallback builds.
- Preserving the placeholder output format after real compilation lands.
- Adding compatibility aliases for unshipped Rust macro names.

## Ownership And Source Layout

Each Rust importer is a package-local Cargo root under `projects/apps/*` or `projects/libs/*`. It
owns `Cargo.toml`, `Cargo.lock`, Rust source, and `patches/rust/*.patch`. A Cargo workspace may span
members below that importer, but a target must resolve to exactly one nearest checked-in Cargo root.
Ambiguous or missing roots fail with the target label and expected files.

Reviewed source inputs are authoritative. Generated graph, provider, and manifest files remain under
`.viberoots/workspace/` and are never edited as source.

## Public Macro Contract

The public surface is:

- `rust_library`: compiles a reusable Rust library outcome.
- `rust_binary`: compiles a native executable and publishes `run.prod`.
- `rust_test`: compiles and runs Cargo test targets through the repo test wrapper.
- `rust_wasm_library`: compiles `wasm32-unknown-unknown` output.
- `rust_wasi_binary`: compiles `wasm32-wasip1` output and publishes a WASI runnable/test contract.

Native macros share these explicit inputs where applicable:

- `srcs`, `deps`, `labels`, `visibility`, and `extra_module_providers`.
- `cargo_manifest`, defaulting to the package-local `Cargo.toml`.
- `cargo_lock`, defaulting to the Cargo root `Cargo.lock`.
- `crate`, `features`, `default_features`, `profile`, and optional `target`.
- `local_patch_dirs`, defaulting to `patches/rust`.
- `nixpkg_deps`, `nixpkgs_profile`, and `nixpkg_pins` for build scripts and native libraries.
- `link_deps`, `header_deps`, `link_closure`, and `link_closure_overrides` for explicit native
  interop.

Macros reject unknown or inapplicable arguments. Configuration that changes Cargo resolution or
artifact identity must be exported as explicit graph fields, not encoded only in labels.

`deps` remains the Buck impact and ordering graph. Rust source dependencies remain declared in the
reviewed Cargo manifest. A dependency inside the same Cargo workspace is compiled by Cargo from the
workspace source closure; a Rust dependency outside that root must use an explicitly designed
source or artifact contract. The planner fails instead of assuming that a Buck `.rlib` can be
injected into Cargo dependency resolution.

## Cargo And Update Authority

`Cargo.toml` and `Cargo.lock` are tracked dependency authority. The canonical tool paths for Cargo,
rustc, rustdoc, clippy, rustfmt, and target support come from Nix store paths.

- `i`, post-clone, and devshell entry validate the lock and generated Rust metadata without
  rewriting tracked files. Stale state reports `repair: run u`.
- `b` consumes checked-in Cargo metadata and never repairs it.
- `u` runs pinned Cargo's ordinary offline metadata resolution against a temporary workspace copy,
  without invoking `cargo update`, then verifies the result with `--locked --offline`. This permits
  only the lock movement Cargo requires for current manifest constraints.
- `u --upgrade` runs bounded offline `cargo update`, then the same locked verification.
- Both update modes restore every affected `Cargo.lock` byte-for-byte, including prior absence, on
  failure or timeout. They do not change viberoots pins or source-mode metadata.

## Nix Build And Planner Contract

The planner resolves the Cargo root, target kind, source-selection plan, features, profile, target
triple, native link intent, and patch inputs from the exported graph. The Rust template uses
`pkgs.rustPlatform.buildRustPackage`. Replacing it requires an explicit design update. The builder
is one internal authority, not a per-target switch.

Cargo dependency fetching is lock-driven and network-free during artifact construction. The build
fails closed for a missing lock, unsupported source, lock/hash mismatch, undeclared build-script
dependency, or unsupported target. Selected and full canonical filtered bundles plus declared
source snapshots must preserve the same source and dependency identity. Protected cache manifests
bind admitted artifacts through signed aggregate evidence without copying checkout source-plan
fields. Dry-run remote preparation may prove the immutable bundle/output handoff, but Rust-specific
aggregate binding, worker materialization, and admission remain part of the remote lifecycle gate.

Libraries emit real compiled outputs. Binaries emit executable files under `bin/`. Tests compile
Cargo harnesses into the Nix output and expose a bounded `ExternalRunnerTestInfo` contract using
project-relative paths. A failed harness fails Buck verification. No path may succeed by generating
placeholder content.

## Patches, Providers, And Invalidation

Rust keeps the current package-local patch scope. Patch files are direct action inputs for every
target in the owning Cargo root. This gives correct importer-level invalidation without requiring a
provider rule per crate.

`patch-pkg` gains a Rust handler using the shared workspace workflow. A patch key includes crate
name, version, and source identity so crates.io, Git, and renamed dependencies cannot collide.
Applying or removing a patch does not require provider glue when the package-local source input is
authoritative.

Cargo metadata labels are diagnostic and inspection data. If exact per-crate provider mapping is
later proven to improve invalidation beyond the importer-level contract, it requires a separate
design change. The existing TODO Rust provider adapter must be removed or converted to the explicit
no-provider implementation so it cannot imply unsupported generation.

Local crate overrides are optional. If implemented, they are explicit development-bundle inputs,
forbidden in protected jobs, visible in diagnostics, and never read from ambient evaluation state.

## Native Linking And C Interop

Rust supports C interop through explicit `link_deps` and `header_deps`. Ordinary `deps` remain graph
edges and do not imply linking. The planner uses the shared deterministic direct/transitive closure
contract and validates every override key.

Nix provides compiler, linker, pkg-config, headers, and libraries from the selected source plan.
Cargo build scripts receive only declared paths and flags. Tests cover a Rust binary calling a C
library, a C consumer of a Rust static library when that output kind is supported, transitive
closure, duplicate ordering, and unsupported dependency diagnostics.

## WASM And WASI

`rust_wasm_library` targets `wasm32-unknown-unknown` and produces a deterministic `.wasm` artifact
that can be instantiated by the existing Node test harness. `rust_wasi_binary` targets
`wasm32-wasip1` and runs through the existing WASI harness. Target support is part of the Nix
toolchain closure. Browser bindings, wasm-bindgen packaging, and component-model output require
separate explicit contracts.

## Runnable, Scaffolding, And Enforcement

Native binaries publish `runnable.kind = "native-bin"` and `run.prod`; Rust libraries remain absent
from runnable summaries. A dev command is published only when an explicit stable contract exists.

Rust has a disabled language-manifest entry for its native macro, planner, template, and examples.
It remains absent from `enabled`, so no scaffold is exposed before PR-5 owns that lifecycle.

Native execution evidence must come from a builder matching `aarch64-darwin`, `aarch64-linux`, or
`x86_64-linux`; cross-evaluation is not native evidence. Rust tests remain local by default until
PR-5 proves remote worker materialization and policy admission.

PR-2 has native execution evidence only for `aarch64-darwin`. The canonical source registry admits
the two Linux systems, but that matrix is fail-closed configuration evidence rather than native
execution evidence. Linux support remains unclaimed until reviewed builders execute the native
binary, library, and test lifecycle there; PR-12 owns that external evidence gate.

Rust is enabled in the language manifest only after required planner, macro, toolchain, template,
and scaffold paths exist. Scaffolds create valid Cargo metadata, TARGETS entries, source, patch
directory, and a buildable test without using host tools.

The public macro inventory stays synchronized across `docs/handbook/starlark-api.md`,
`docs/handbook/nix-gaps.md`, route enforcement, and tests. Remote-readiness, artifact-environment,
hostile-`PATH`, file-size, command-site, and generated-state gates apply to Rust exactly as they do
to other artifact languages.

## Validation And Completion

Rust is first-class only when all of the following are demonstrated:

- Real library, binary, and test compilation changes when source changes and fails on invalid Rust.
- Cargo lock repair and upgrade obey mutation ownership, timeout, rollback, and source-pin isolation.
- Package-local patches affect the intended Cargo root and are applied to the compiled dependency.
- Selected and full canonical filtered-bundle, declared source-snapshot, and hostile-environment
  identities agree on each supported system; remote worker admission is proven separately before
  first-class remote Rust execution is claimed.
- Native C interop, freestanding WASM, and WASI tests exercise produced artifacts.
- Runnable commands resolve only reviewed Nix-store tools and artifacts.
- Scaffolding, macro inventory, route policy, planner registry, docs, and verify selection remain in
  sync.

Until these gates pass, current references must call Rust native support incomplete rather than a
complete first-class Rust toolchain.
