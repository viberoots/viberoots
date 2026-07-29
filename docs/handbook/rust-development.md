# Rust development

Rust support is experimental. The repository owns the compiler, Cargo, `rust-analyzer`,
`rustfmt`, Clippy, rustdoc, `cargo-llvm-cov`, Clang, LLD, and LLDB through the selected Nix
closure. Do not install or select host copies of those tools.

## Daily workflow

Enter the repository shell before opening an editor. The shell exports `RUST_ANALYZER_PATH`,
`RUSTFMT`, `RUSTDOC`, `CARGO_LLVM_COV`, and `RUST_SRC_PATH`; it also writes the ignored
`.viberoots/workspace/editor/rust-tools.json` discovery record. Use `u` after changing
`Cargo.toml` or a dependency source, then use `i`, `b`, `v`, and `p` normally.

`rust_test` runs the repository Rust quality gate before compiling tests: `cargo fmt --check`,
Clippy with warnings denied, rustdoc tests, and compile-only benchmark targets. Set
`COVERAGE=1` on a selected test bundle to produce LCOV under `coverage/rust/<target>/lcov.info`.
The verification command merges those records with TypeScript coverage before publishing the
final `coverage/lcov.info`, `coverage/coverage-summary.json`, and `coverage/index.html`.
Coverage is opt-in so ordinary verification keeps its existing cost.

For a Rust binary, `run.dev` uses a bounded polling watcher from the Nix tool closure. It
rebuilds and restarts only the selected runnable, forwards remaining arguments, terminates
the previous process group before restart, and removes all timers and child processes on
exit. A target with an explicit development bundle still uses that bundle.
When `NIX_RUST_DEV_OVERRIDE_JSON` contains explicit local dependency roots, the watcher tracks
those roots too; repository-root and filesystem-root watches are rejected as too broad.
Only the watcher-owned child ingress admits and captures that Rust override. Ordinary `p`
ingress remains fail-closed, and unrelated override or ambient environment values are not forwarded.

## Dependencies and local overrides

Commit `Cargo.lock`. Supported sources are crates.io, declared alternate/private registries,
and exact Git revisions. Renamed dependencies, features, target `cfg` sections, build
dependencies, dev dependencies, and workspace inheritance remain Cargo metadata and are
resolved from the lock and manifests. Source replacement is generated in the isolated
vendor tree; do not commit credentials or credential-bearing Cargo configuration.

Private registry credentials may be used only during the explicit pre-materialization step
that creates fixed-output source inputs. They must not enter derivations, snapshots, logs, or
materialization manifests. Local source patches are opt-in through development bundles and
are traced as non-release inputs; release and CI bundles must omit them.

Every Rust artifact exports a deterministic dependency inventory containing package name,
version, source, checksum, and dependency edges. It is embedded in the materialization
manifest and is the input for repository license, advisory, SBOM, and provenance consumers.
Those consumers remain authoritative for their own policies; this layer does not publish
artifacts or claim independent sandbox certification.

## Starting a package

`scaf new rust` supports `cli`, `lib`, `proc-macro`, `python-extension`, `node-addon`,
`cxx-bridge`, and `wasm`. The CLI is the native binary starter; the WASM starter includes
bare-WASM and WASI targets. Extension and bridge templates are dependency-light, buildable ABI
starting points with smoke checks. Each generated README lists the supported lifecycle commands
and identifies library targets that cannot be run with `p` or `d`.

If a build unexpectedly reaches the network, first run `u` and inspect fixed-source inputs.
If an editor chooses a host tool, inspect the generated editor record. If coverage is absent,
confirm the selected test target received `COVERAGE=1`; coverage is not an ambient release
property.
