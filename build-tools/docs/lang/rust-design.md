# Rust Language Design

This document defines Rust support for the current Buck2 and Nix architecture. It separates the
implemented compatibility baseline from the first-class language contract. The implementation plan
is [`../rust-language-plan.md`](../rust-language-plan.md).

## Current Lifecycle

The current Rust route compiles composed Cargo libraries, binaries, tests, native bridges, and the
freestanding, WASI, static-linkable, browser-package, and component-model WASM families from
checked-in manifests and locks. PR-10 adds the managed developer and dependency lifecycle. Release,
publication, and independent three-system conformance remain later work.

| Surface              | Current behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Evidence                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Public macros        | Native and WASM macros accept canonical package-local Cargo metadata plus explicit source-selection intent. Reviewed native ABI edges are available only through `rust_c_ffi_library` and `rust_cxx_bridge_library`; ordinary Rust macros reject native link/header intent. Libraries expose explicit `rlib`, `staticlib`, `cdylib`, and `proc-macro` entrypoints. WASM includes raw, WASI, static-linkable, browser-package, and component outcomes. Alternate metadata paths and unknown fields fail. | `build-tools/rust/defs.bzl`, `docs/handbook/starlark-api.md`                                                                                  |
| Shared wiring        | Macros stamp `lang:rust`, `kind:*`, `patch_scope:package-local`, and remote-readiness labels. Package-local Rust and patch files become Buck inputs, and provider deps are merged deterministically.                                                                                                                                                                                                                                                                                                    | `build-tools/lang/internal/package_local_wiring.bzl`                                                                                          |
| Buck action          | `rust_nix_build` exports typed source-crate and WASM-family providers and declares the transitive Cargo-root source, manifest, lock, patch, WIT, header, and link closure without passing dependency `.rlib` outputs to Cargo. It materializes stable native outcomes plus raw, WASI, static-linkable, browser-package, and component-model WASM families with their manifests and public interface files.                                                                                              | `build-tools/rust/private/nix_build.bzl`, `build-tools/rust/private/crate_contract.bzl`, `build-tools/rust/private/wasm_contract.bzl`         |
| Planner              | `lang:rust` plus native, raw/WASI WASM, WASM static-library, browser-package, and component kinds dispatches to the Rust planner. The composition planner validates Cargo path dependencies against Buck edges and preserves every transitive repository-relative Cargo root; the WASM planner validates target, ABI, link, export, profile, adapter, WIT, and module-surface contracts.                                                                                                                | `build-tools/tools/nix/planner/rust.nix`, `build-tools/tools/nix/planner/rust-composition.nix`, `build-tools/tools/nix/planner/rust-wasm.nix` |
| Artifact             | One `buildRustPackage` authority uses the Nix-store Rust 1.88 closure with rust-analyzer, rustfmt, Clippy, rustdoc, llvm-cov, LLD, LLDB, and the reviewed native and WASM tools. Test construction applies formatting, lint, documentation, benchmark-compile, and optional coverage gates. It emits a stable dependency inventory next to materialization evidence.                                                                                                                                    | `build-tools/tools/nix/templates/rust.nix`, `build-tools/tools/nix/flake/packages/toolchains.nix`                                             |
| Providers            | Rust has an explicit deterministic no-provider adapter. Package-local patches are direct target inputs, so provider and auto-map glue are not patch invalidation authorities.                                                                                                                                                                                                                                                                                                                           | `build-tools/tools/buck/providers/rust.ts`, `build-tools/tools/lib/lang-contracts.ts`                                                         |
| Tests                | Cquery covers routing, exported Cargo fields, inputs, provider order, and unknown-field rejection. Native fixtures execute two binaries, prove source sensitivity, and cover fail-closed Cargo diagnostics.                                                                                                                                                                                                                                                                                             | `build-tools/tools/tests/rust/`, `build-tools/tools/tests/lang/rust.stub.provider-edges.deterministic.cquery.test.ts`                         |
| Language registry    | Rust is enabled experimentally with binary, library, proc-macro, Python-extension, Node-addon, C++-bridge, and WASM scaffolds.                                                                                                                                                                                                                                                                                                                                                                          | `build-tools/tools/nix/langs.json`, `build-tools/tools/scaffolding/templates/rust/`                                                           |
| Dependency ownership | Cargo participates in the shared language lifecycle: read-only consumers verify locked offline metadata, while explicit `u` and `u --upgrade` transactionally reconcile every affected `Cargo.lock`.                                                                                                                                                                                                                                                                                                    | `build-tools/docs/update-command-design.md`                                                                                                   |
| Runtime and tests    | `rust_test` executes compiled Cargo harnesses through a bounded project-relative external runner. Its remote-ready runner is designed to perform the same selected build and harness execution from a validated declared snapshot; current evidence exercises that route locally and does not claim a production remote worker. Native and WASI binaries publish `run.prod`; libraries, tests, and freestanding WASM stay out of runnable summaries.                                                    | Rust macro, runner, planner, template, and manifest implementations                                                                           |
| Source selection     | Native targets export `nixpkg_deps`, `nixpkgs_profile`, and `nixpkg_pins`. The shared source-plan resolver selects the Rust toolchain and declared build-script dependencies.                                                                                                                                                                                                                                                                                                                           | Rust macro, graph attrs, planner, and template                                                                                                |
| Dependency patches   | `patch-pkg rust` resolves exact locked identities, authors source-qualified package-local patches, and applies them to Cargo's vendored dependency closure. Local overrides are explicit bundle inputs and forbidden in protected jobs.                                                                                                                                                                                                                                                                 | Rust patch handler, lock resolver, and Nix patch plan                                                                                         |
| Interop and WASM     | Reviewed bridge macros carry explicit direct/transitive native link intent to Cargo build scripts. Nix cross Rust toolchains emit executable raw and WASI modules, deterministic static archives, wasm-bindgen browser packages, and WIT components through the reviewed Rust/C++/TinyGo compatibility matrix.                                                                                                                                                                                          | Rust planner, template, and artifact tests                                                                                                    |
| Remote policy        | Rust build and test actions validate declared snapshot manifests and replace ambient source authority before selected-build execution. Current PR-9 evidence builds immutable filtered bundles, executes all five WASM action families with declared tools under hostile host state, and replays a standalone snapshot while the live owner source is poisoned. This is local remote-readiness evidence, not production remote-worker execution.                                                        | Rust private rules, source-snapshot parity, and remote-action integration tests                                                               |

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

Each package must check in its canonical `Cargo.toml` and `Cargo.lock`; alternate metadata paths
fail closed. A cross-root Rust `deps` edge must have exactly one matching Cargo path dependency.
The canonical repository-relative path, package name, public crate name, and compatible version
must agree. Missing, extra, ambiguous, cyclic, escaping, or version-incompatible composition fails
before construction. Cargo compiles the preserved source closure; Buck artifacts are not injected
as compiler-private Rust metadata. PR-8 adds reviewed generated C11 FFI and C++17 bridge boundaries;
Developer tooling and dependency lifecycle parity are implemented by PR-10, while final release
hermeticity remains owned by PR-12.

Compatible versions use Cargo requirement semantics for bare/caret, tilde, wildcard, exact-prefix,
and comparator/range forms, including Cargo's special `0.x` caret behavior. A prerelease dependency
version is admitted only when the requirement explicitly names a compatible prerelease.

After editing a Cargo manifest, run `u` for conservative offline lock reconciliation or
`u --upgrade` for an intentional offline dependency update. Both commands use Nix-store Cargo in a
temporary copy and publish lock bytes only after locked verification succeeds. Ordinary `i`,
post-clone, devshell entry, and `b` are read-only and report `repair: run u` for stale Cargo state.

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
- `rust_static_library`: compiles a stable native `staticlib` outcome.
- `rust_cdylib`: compiles a stable native `cdylib` outcome.
- `rust_c_ffi_library`: compiles a C ABI static/shared library and generates its reviewed C header.
- `rust_cxx_bridge_library`: compiles a C ABI-backed C++ bridge and generates C/C++ bindings.
- `rust_proc_macro`: compiles a native host proc macro for Cargo source consumers.
- `rust_binary`: compiles a native executable and publishes `run.prod`.
- `rust_test`: compiles and runs Cargo test targets through the repo test wrapper.
- `rust_wasm_library`: compiles raw `wasm32-unknown-unknown` or WASI
  `wasm32-wasip1` output with an explicit runtime contract.
- `rust_wasm_static_library`: compiles a deterministic bare or WASI static archive for reviewed
  cross-language linking.
- `rust_wasm_browser_package`: compiles a raw module and emits deterministic wasm-bindgen browser
  bindings and package metadata.
- `rust_wasm_component`: compiles a bare or preview1-reactor component whose public exports equal
  the selected package-local WIT world.
- `rust_wasi_binary`: compiles `wasm32-wasip1` output and publishes a WASI runnable/test contract.

Native macros share these explicit inputs where applicable:

- `srcs`, `deps`, `labels`, `visibility`, and `extra_module_providers`.
- `cargo_manifest`, defaulting to the package-local `Cargo.toml`.
- `cargo_lock`, defaulting to the Cargo root `Cargo.lock`.
- `crate`, `features`, `default_features`, `profile`, and optional `target`.
- `cargo_package`, `public_crate`, `crate_type`, `host_role`, and `generated_outputs`.
- `local_patch_dirs`, defaulting to `patches/rust`.
- `nixpkg_deps`, `nixpkgs_profile`, and `nixpkg_pins` for build scripts and native libraries.
- `link_deps`, `header_deps`, `link_closure`, and `link_closure_overrides` for explicit native
  interop.

Macros reject unknown or inapplicable arguments. Configuration that changes Cargo resolution or
artifact identity must be exported as explicit graph fields, not encoded only in labels.

`deps` remains the Buck impact and ordering graph. Rust source dependencies remain declared in the
reviewed Cargo manifest. Same-root workspace members and cross-root path dependencies are compiled
by Cargo from the declared transitive source closure. The typed crate contract carries each Cargo
root, package and lock identity, member manifest, sources, features, target/profile constraints,
public crate, artifact kind, host role, and generated outputs. The planner fails instead of
injecting a Buck `.rlib` into Cargo dependency resolution.

## Cargo And Update Authority

`Cargo.toml` and `Cargo.lock` are tracked dependency authority. Cargo, rustc, rust-analyzer,
rustfmt, Clippy, rustdoc, llvm-cov, the reviewed native and WASM targets, and WASM
transformation/runtime tools come from Nix store paths. The devshell exports their exact discovery
paths, while `rust_test` owns formatting, lint, documentation, benchmark-compile, and opt-in LCOV
coverage checks.

- `i`, post-clone, and devshell entry validate the lock and generated Rust metadata without
  rewriting tracked files. Stale state reports `repair: run u`.
- `b` consumes checked-in Cargo metadata and never repairs it.
- `u` runs pinned Cargo's ordinary offline metadata resolution against a temporary workspace copy,
  without invoking `cargo update`, then verifies the result with `--locked --offline`. This permits
  only the lock movement Cargo requires for current manifest constraints.
- `u --upgrade` runs bounded offline `cargo update`, then the same locked verification.
- Both update modes restore every affected `Cargo.lock` byte-for-byte, including prior absence, on
  failure or timeout. They do not change viberoots pins or source-mode metadata.
- Temporary update workspaces contain only the selected Cargo root and the recursively reachable
  local path-dependency roots from normal, build, development, and target-specific dependency
  tables. Missing roots, repository escapes, and escaping symlinks in that reachable closure fail
  closed; unrelated Cargo roots are neither copied nor inspected.

Cargo resolution uses only `.viberoots/workspace/cargo-home` in the consumer workspace. The command
boundary removes inherited `CARGO_*`, `RUSTC`, `RUSTFLAGS`, and `RUSTUP_HOME` values and forces
offline mode, so an ambient user cache or network route cannot become dependency authority. The
workspace cache is ignored runtime state, not a tracked or portable input: required registry index
and crate bytes must already have been populated by a reviewed environment/fixture. PR-3 adds no
networked cache-population command. Missing cache entries fail closed. The copied Cargo root, its
temporary execution ancestors, and the workspace cache are checked for `config`/`config.toml`
files because Cargo source replacement can preserve a crates.io lock identity while reading an
alternate registry. Live ancestors outside the copied Cargo root cannot influence temporary Cargo
execution and are not rejected. The Nix builder rejects source-root Cargo config by the same
policy. Path dependencies and crates.io lock sources remain admitted. Git sources require their
source-qualified fixed-output hashes. Alternate registries require the verified pre-materialized
authority described below; incomplete authority fails before read-only success or transactional
publication.

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

When a target supplies a declared source snapshot, the Rust rule derives a new action-owned
snapshot by overlaying every transitive `RustCrateInfo` Cargo root at its normalized repository
path. The resulting manifest and digest therefore cover the same composed roots as selected/full
filtered builds; dependency roots cannot be recovered from an ambient checkout.

Libraries emit real compiled outputs. Binaries emit executable files under `bin/`. Tests compile
Cargo harnesses into the Nix output and expose a bounded `ExternalRunnerTestInfo` contract using
project-relative paths. A failed harness fails Buck verification. No path may succeed by generating
placeholder content.

`rust_library`, `rust_static_library`, `rust_cdylib`, and `rust_proc_macro` fix their artifact kind
and host/target role; explicitly passing an incompatible `crate_type` or `host_role` is an error.
The rlib output is named from `public_crate`. A `rust_static_library` also exports the shared native
link provider, including its runtime closure, so C/C++ `link_deps` can consume the archive without
rebuilding the Rust package through a C++-specific path. When composition is absent, a root Cargo
package is copied at the vendor source root rather than nested beneath an extra directory.

## Patches, Providers, And Invalidation

Rust keeps the current package-local patch scope. Patch files are direct action inputs for every
target in the owning Cargo root. This gives correct importer-level invalidation without requiring a
provider rule per crate.

`patch-pkg` has a Rust handler using the shared workspace workflow. A patch key includes crate
name, version, and source identity so crates.io, Git, and renamed dependencies cannot collide.
The filename source selector is the complete 64-hex SHA-256 of the Cargo.lock source string; it is
never truncated or treated as a prefix.
Applying or removing a patch does not require provider glue when the package-local source input is
authoritative.

Authoring resolves only an exact entry from the reviewed Nix fixed-source manifest under the
workspace Cargo home. The manifest key includes name, version, and the complete lock source; the
entry binds that source plus its registry checksum or Git revision. Cache-directory scanning and
first-match checksum selection are forbidden. Authoring reads only the manifest's immutable
`buildInput.storePath`, never its diagnostic cache `originPath`; deleting or mutating the cache after
publication cannot change workspace bytes. Nix patch application uses that same store/NAR authority.
For Git, `u` requires the complete locked revision and reconstructs a detached local clone of the
matching commit object rather than copying checkout bytes. Pinned Cargo validates the selected
package in its full committed workspace, then `cargo package --offline --no-verify` applies Cargo's
canonical file selection and manifest normalization. The normalized package is revalidated as a
self-contained exact locked name/version authority before being materialized once. This preserves
resolved workspace-inherited fields without ad hoc TOML rewriting. The builder constructs one
offline Cargo vendor closure from
those exact authorities and passes it to `buildRustPackage` through `cargoVendorDir`; unique and
same-name/version Git packages use this same path rather than a separate fetch or nixpkgs'
name/version-keyed `importCargoLock` API. Alternate registries cross the `u` boundary as
pre-materialized Nix store paths with reviewed NAR hashes, exact lock sources, and registry
checksums. Before any cache bytes reach `nix store add-path`, `u` validates the complete
`.cargo-checksum.json`: its strict schema and unique canonical relative paths, the package checksum
against the exact Cargo.lock source identity, the SHA-256 of every declared regular file, and the
absence of missing, unexpected, symlink, or non-regular entries. It materializes a temporary copy
made only from the verified bytes and preserves the validated checksum metadata. The update
manifest publishes a path-free `buildInput` projection, separate from its authoring-only Cargo cache
origin. Targets declare that projection plus the Cargo registry name through `cargo_fixed_sources`;
Nix admits them with hash-checked `builtins.path` and never receives registry credentials or ambient
Cargo cache paths. Missing or mismatched alternate-registry materialization fails closed. Crates.io
remains checksum-bound and may use the same reviewed materialization while retaining nixpkgs'
checksum fetch compatibility. Every patch record carries that source-qualified vendoring authority
into application and selects by canonical source-tree identity, comparing all source paths and bytes
while excluding only Cargo checksum, source-routing, publication metadata, and VCS administration.
Vendoring preserves verified registry checksum metadata; after an intentional patch or development
override, the patch boundary regenerates the complete file-hash map while retaining the locked
package checksum.
The authority selects the locked package name and version and fails on zero or multiple subtrees.
Same-name/version sources cannot collide, and application fails on absent, mismatched, or duplicate
identity without requiring publication-only `.cargo_vcs_info.json` metadata.

`sync-required` consumes source-qualified required-patch metadata from the selected package-local
patch directory. It deterministically reports missing, stale, and ambiguous identities and may
write only explicit placeholder files requested by the shared `--write-placeholders` mode.

Cargo metadata labels are diagnostic and inspection data. If exact per-crate provider mapping is
later proven to improve invalidation beyond the importer-level contract, it requires a separate
design change. The Rust provider adapter is an explicit no-provider implementation and emits no
TODO surface.

Local crate overrides are explicit development-bundle inputs, forbidden in protected jobs, visible
in diagnostics, and never read from ambient evaluation state. The graph generator passes the
bundle's captured language-override map into the Rust planner; the template accepts only that
explicit value and requires a `local-development` bundle when it is non-empty.
The bounded Rust watcher marks its artifact child ingress explicitly. That ingress admits only the
Rust override selector, while ordinary runnable production ingress and competing language override
selectors remain fail-closed.

The shared editor launch is bounded by `PATCH_EDITOR_TIMEOUT_SECS`, defaulting to 300 seconds.
Timeout and signal cleanup clear Rust override/session state while retaining an interrupted
workspace unless the operator chose reset.

## Managed Runtime Extensions

`rust_python_extension` builds a Cargo `cdylib` and stages it at
`site/<dotted-module><EXT_SUFFIX>`, where `EXT_SUFFIX` comes from the selected Nix CPython runtime.
Python applications, libraries, and tests consume this through the shared `kind:pyext` overlay
contract, so staging does not branch on the producer language. `build_py_deps` resolves only from
the target's importer-scoped `uv.lock` through the same uv2nix wheelhouse authority used by native
Python extensions. The lock label, Python patch inputs, and provider edges are declared inputs.
Runtime and native link dependencies remain explicit graph inputs.

`rust_node_addon` builds a Cargo `cdylib`, accepts Node-API 8, 9, or 10, compiles against the
selected version's pinned Node headers, requires the version-specific API floor, rejects every
higher-version pinned API symbol, and requires the loader-visible API-version export. The selected
Node 22 runtime then load-probes the installed artifact. The macro also validates the selected
platform identity and exposes a stable
`<addon_name>.node`. Addon names match `[A-Za-z_][A-Za-z0-9_-]*`; staging rejects duplicate names
instead of overwriting an earlier artifact. The Node planner collects transitive
`kind:addon` dependencies through `dependencyArtifactOf`, using the same route for Rust and C++.
Bundled CLIs stage under `bin/native`, services under `native`, and webapps under `dist/native`.
Cargo metadata remains the source authority; napi-rs and PyO3-compatible Cargo projects use their
checked-in locks and reviewed fixed-source manifests.

Each extension output includes its production Nix-store materialization manifest. Recursive
`runtime_deps` graph packages and their transitive dynamic-library references are copied beside the
extension and rewritten to output-relative loader paths. Python overlays and Node CLI, service,
webapp, and deployment staging carry that directory with the extension, and service identity is
calculated only after addons enter the deployable tree.

The pinned Rust/Python toolchains do not currently provide an importable Pyodide or WASI dynamic
extension ABI. `rust_python_wasm_extension` therefore fails at analysis with an actionable
diagnostic and does not emit a raw-WASM placeholder. PR-9 browser packages and WIT components are
separate first-class Rust WASM outcomes; they do not claim a Python extension ABI.

## Native Linking And C/C++ Interop

Rust bridge macros support C interop through explicit `link_deps` and `header_deps`. Ordinary
`deps` remain graph edges and do not imply linking. Ordinary public Rust macros reject native
link/header intent so handwritten `extern` declarations cannot become ABI authority. The
lower-level planner retains the mature native link/header closure implementation for bridge
construction; this is an internal production boundary, not a second public FFI route. The planner
uses the shared deterministic direct/transitive closure contract and validates every override key.

Nix provides compiler, linker, pkg-config, headers, and libraries from the selected source plan.
Cargo build scripts receive only declared paths and flags. Tests cover public bypass rejection,
real generated imports and exports, transitive closure, and unsupported dependency diagnostics.

C and C++ consumers use `rust_c_ffi_library` or `rust_cxx_bridge_library`, never an unlabelled
`rust_static_library` ABI. Each bridge owns a package-local `viberoots.rust-interop.v1` JSON
configuration. The pinned repo-owned `viberoots-rust-bindings-1` generator is a declared Nix input
and writes headers, C++ source, and a binding manifest into the derivation. Generated files are not
checked-in authority. Static and shared outcomes keep the same planner derivation, source profile,
pins, link closure, and runtime-package authorities used by mature C++ targets.

The supported boundary is C layout and calling convention only. Exported names are stable C
identifiers. Supported values are fixed-width integers, booleans, sizes, explicit pointers, and the
reviewed callback shape. Strings, owned objects, errors, and destruction cross as explicit
pointer/status/destructor functions. Rust panics use the enforced abort policy; C++ bridges are
generated `noexcept`. No Rust panic or C++ exception
may unwind across the ABI. Direct C++ ABI exposure, ambient allocators, undeclared thread transfer,
and target/profile/toolchain mismatches fail closed.

A C bridge import names `native_name` plus a reviewed C header; a C++ bridge import names
`cpp_name` plus a reviewed C++ header. The generator emits a genuine `.c` or `.cc` C-ABI shim and
the pinned Clang toolchain compiles it as C11 or C++17/libc++ into a crate-named shared library
supplied to Cargo and the downstream runtime closure. With
`exception_policy = "contained"`, the shim catches every C++ exception and returns the configured
typed error value. Exported callbacks use a generated `noexcept` trampoline with a separately
reviewed integer callback fallback. Only aborting Rust panics and send/sync boundaries are
accepted; unsupported containment and single-thread claims fail during analysis.

The repo-owned generator is intentional. The v1 schema is a smaller, audited C-layout subset than
either cbindgen or cxx and must generate both outbound import shims and inbound headers from one
authority. It also emits a Rust module: imports are called through its generated declarations and
exact function-pointer assignments compile-check every exported Rust signature. Handwritten
`extern` declarations are not bridge authority. The equivalence claim is deliberately about the
reviewed ABI subset, not byte-for-byte parity with either external tool: fixed-width C
declarations match cbindgen's C-layout outcome, C++ calls stay behind the same C ABI boundary used
by cxx, and the custom import shim adds functionality neither comparison alone supplies.
Equivalence is enforced through generated Rust signature checks, Clang-compiled C11/C++17
declarations, byte-stability tests, immutable selected-bundle hostile-`PATH` execution,
strict-schema rejection tests, real C11 and C++17 compiler/runtime consumers in both directions,
and a checked manifest. Replacing it requires preserving those outputs and tests, not merely
producing source-compatible declarations.

Every native bridge edge compares module surface, source profile, exact pins, compiler family and
identity, target triple, language standard, and STL identity. Both Rust-to-native planner edges
and native-to-Rust C/C++ consumer edges fail before building on any mismatch. Native macros stamp
the selected host's canonical Rust target triple into the exported graph while preserving Rust's
ordinary empty native `target` attribute; the planner resolves compiler identity from the selected
target source plan's pinned Nix LLVM package rather than the global/default package set or an
ambient or caller-invented compiler name.

## WASM And WASI

`rust_wasm_library` targets `wasm32-unknown-unknown` for the bare ABI or `wasm32-wasip1` for WASI
and produces a deterministic `.wasm` artifact that can be instantiated by a WebAssembly host. It
does not publish runnable metadata.
`rust_wasi_binary` targets `wasm32-wasip1`, materializes the selected `.wasm`, and installs an
executable wrapper that launches the module through the checked-in WASI runner with Nix-provided
Node. The wrapper causes the selected-build manifest to publish the same `runnable.kind =
"native-bin"` and `run.prod` shape as other executable artifacts. Target support is part of the Nix
toolchain closure.

`rust_wasm_static_library` publishes a static archive and reviewed header for either the bare or
WASI ABI. Rust, C++, and TinyGo static producers use the canonical direct/transitive link closure.
TinyGo producers publish deterministic archives through `nix_go_tiny_wasm_static_lib`; C++ static
consumers carry unresolved typed edges until a final Rust or TinyGo module resolves the closure.
Every edge compares ABI, target, libc, exception, allocator, and runtime authority before derivation
construction.

| Static producer | Rust consumer | TinyGo consumer | C++ consumer  |
| --------------- | ------------- | --------------- | ------------- |
| Rust            | bare + WASI   | bare + WASI     | bare + WASI   |
| C++             | bare + WASI   | bare + WASI     | typed closure |
| TinyGo          | bare only     | unsupported     | bare only     |

Every supported bare and WASI entry has positive planner evaluation plus a compiled
consumer/runtime fixture. The WASI fixtures build with the reviewed WASI cross toolchain and cover
Rust, C++, and TinyGo producers in each supported consumer direction. TinyGo-to-TinyGo archive
linking is rejected before derivation construction. TinyGo WASI static archives are also rejected:
TinyGo and the final WASI runtime both define allocator symbols, so that archive shape cannot be
linked without conflicting ownership.

`rust_wasm_browser_package` runs the pinned wasm-bindgen CLI and emits a deterministic directory
containing JavaScript, TypeScript declarations, the background `.wasm`, and `package.json`.
`rust_wasm_component` embeds an explicit WIT world, selects no adapter or the pinned Wasmtime
preview1 reactor adapter, and validates the resulting component with pinned wasm-tools. Optimization,
debug, source-map, stripping, export allowlists, tool paths, adapter identity, and the versioned
module surface are recorded in `share/viberoots-rust/wasm-manifest.json`.

| Macro                       | Primary artifact                   | Companion artifacts                                         | Runtime or consumer               |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------- | --------------------------------- |
| `rust_wasm_library`         | `<name>.wasm`                      | provenance and module surface                               | WebAssembly host                  |
| `rust_wasi_binary`          | `<name>.wasm`                      | WASI launcher, provenance, and module surface               | repository WASI runner            |
| `rust_wasm_static_library`  | `lib<crate>.a`                     | reviewed header, provenance, and module surface             | typed Rust/TinyGo/C++ closure     |
| `rust_wasm_browser_package` | `<crate>_bg.wasm` in a package dir | JavaScript, TypeScript, `package.json`, optional source map | web-target ESM or Node asset flow |
| `rust_wasm_component`       | `<name>.component.wasm`            | normalized WIT, provenance, and module surface              | pinned Wasmtime component runtime |

The WASM Cargo phase is repository-owned so Cargo receives the selected WASM target exactly once;
the native nixpkgs Cargo hook remains in use for native artifacts. Static archives are normalized
to deterministic GNU archive structure before publication, and WASM archives are not passed
through Darwin native fixups.

Browser directories and raw modules retain their Nix-store identity through filtered inputs, signed
local file-cache export/import, cold local-store materialization, and declared Node staging edges.
The acceptance path feeds the declared Buck-built service stage through the production Node service
artifact identity builder and Kubernetes component-artifact admission, then checks the admitted
blob still contains the staged Rust module. It also feeds the emitted materialization manifests and
exact store identities through the production Nix-store materializer into a cold local store and
executes the restored raw and browser artifacts. This is deployment-admission and remote-replay
authority coverage, but production deployment publication and a production remote worker remain
separate environment gates.

PR-9 also exercises the bare/WASI static, browser, and bare/WASI component families through their
real Buck remote-ready action categories under hostile host tool resolution, then replays the same
selected identities from an immutable execution snapshot while the ambient Rust owner source is
poisoned. This is local remote-readiness conformance evidence only; PR-12 remains responsible for
production remote-worker execution and external platform admission.

The browser manifest names a pinned Nix Firefox executable. PR-9 serves the generated package,
launches that engine headlessly, loads the emitted HTML harness, invokes a real wasm-bindgen export,
and requires the browser-reported value. Node also executes the ESM package, but is not presented as
browser evidence. Patch identity is package-local: applying a locked dependency patch changes every
Rust WASM family, and removing it restores the exact prior output paths. The operator workflow is
documented in `docs/handbook/rust-wasm-operations.md`.

## Runnable, Scaffolding, And Enforcement

Native and WASI binaries publish `runnable.kind = "native-bin"` and `run.prod`; Rust libraries,
tests, and freestanding WASM remain absent from runnable summaries. A dev command is published only
when an explicit stable contract exists.

Rust has an experimental enabled language-manifest entry backed by source-owned templates for CLI
binaries, libraries, proc macros, Python extensions, Node addons, C++ bridges, and raw/WASI WASM.
Every scaffold creates checked-in Cargo metadata and deterministic locks without invoking host Rust
tools. Shape-specific lifecycle checks compile or run the applicable binary, library and doc tests,
proc macro expansion, CPython import, Node addon load, C++ bridge consumer, or raw/WASI module;
non-runnable shapes reject `r` and `d` before attempting a selected build.

Native execution evidence must come from a builder matching `aarch64-darwin`, `aarch64-linux`, or
`x86_64-linux`; cross-evaluation is not native evidence. Rust tests remain local unless a reviewed
remote profile supplies the complete declared evidence contract.

PR-2 has native execution evidence only for `aarch64-darwin`. The canonical source registry admits
the two Linux systems, but that matrix is fail-closed configuration evidence rather than native
execution evidence. Linux support remains unclaimed until reviewed builders execute the native
binary, library, and test lifecycle there; PR-12 owns that external evidence gate.

PR-5 adds current-host `aarch64-darwin` evidence for its Rust artifact matrix and executes the
remote-policy fixture's real snapshot-backed build and Cargo test locally. This does not promote
either Linux system to native execution evidence and does not claim that the local conformance
action ran on a production remote worker.

PR-8 adds reviewed generated C/C++ bridge macros, generated Rust-side ABI checks, real C11 and
C++17 consumers in both directions, transitive patch invalidation, panic-abort child-process
evidence, and immutable filtered-bundle plus remote-prepared snapshot replay on the executing host.
The other configured systems remain structural fail-closed matrix evidence only.

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
  identities agree on the executing host; unavailable configured systems fail closed structurally,
  and remote worker admission is proven separately before first-class remote Rust execution is
  claimed.
- Native C interop, freestanding WASM, and WASI tests exercise produced artifacts.
- Runnable commands resolve only reviewed Nix-store tools and artifacts.
- Scaffolding, macro inventory, route policy, planner registry, docs, and verify selection remain in
  sync.

PR-7 adds native Python and Node managed-runtime extension contracts and explicitly rejects the
currently unavailable Python WASM ABI. PR-8 adds reviewed C/C++ interoperability without promoting
the language beyond experimental status. Current references
must still call Rust experimental rather than a complete first-class or release-hermetic toolchain.
