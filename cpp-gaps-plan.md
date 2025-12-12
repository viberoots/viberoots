## C++ Gaps Plan — Detailed Designs for PR 1, PR 2, and PR 8.1

This document complements `cpp-plan.md` by detailing the remaining work items identified as gaps: PR 1 (nixpkgs-backed C++ providers), PR 2 (Go cgo via nixpkgs), and PR 8.1 (exporter orchestration/metrics tests). The designs below follow our methodology and keep cyclomatic complexity low with small, clear helpers.

---

### PR 1: nixpkgs-backed C++ providers (generalized beyond googletest)

Intent/Impact

- Provide first-class nixpkgs-backed C/C++ providers for common libraries (e.g., `pkgs.zlib`, `pkgs.openssl`) so C++ targets can depend on deterministic, hermetic third-party libs.
- Keep v1 minimal: labels and identity only in Buck; actual include/lib paths are resolved by Nix templates using provided `nixCxxAttrs`.

Scope

- Extend `third_party/providers/defs_cpp.bzl` with a general `nix_cxx_library` (already present) and document usage.
- Add curated provider targets in `third_party/providers/TARGETS` for selected libs (zlib, openssl). Name scheme: `nix_pkgs_<attrPath with dots as underscores>`.
- Ensure auto-map wiring provides stable dependency edges when needed by macros.

Design

- Buck macros
  - Keep `nix_cxx_library(name, attr, ...)` as a thin identity wrapper with labels: `"lang:cpp"`, `"nixpkg:<attr>"`.
  - Do not attempt to encode include/lib paths in Buck; rely on Nix evaluation to resolve attr paths (consistent with `tools/nix/templates/cpp.nix`).

- Providers catalogue
  - Add entries to `third_party/providers/TARGETS`:
    - `nix_pkgs_zlib` => `attr = "pkgs.zlib"`
    - `nix_pkgs_openssl` => `attr = "pkgs.openssl"`
  - Convention: only create curated entries for libraries we test against. Avoid large catalog explosion.

- Labels and planner interoperability
  - The planner collects `nixpkg:*` labels by DFS (already implemented in `tools/nix/planner/cpp.nix`).
  - No changes needed to planner; ensure curated provider targets carry labels.

- Scaffolding/tests
  - Add tests under `tools/tests/cpp/`:
    - `include-from-nixpkg.zlib.providers.test.ts`: build a tiny `nix_cpp_test` that includes a zlib header and links (if needed) via `cppTest` template detection.
    - `include-from-nixpkg.openssl.providers.test.ts`: same for openssl with a simple include. Keep tests minimal and platform-neutral.
  - Extend scaffolding validation (optional): an example C++ lib template variant that depends on `nix_pkgs_zlib` to validate provider edge in planner.

- Auto-map
  - Continue using generated `third_party/providers/auto_map.bzl` for provider edges where necessary. For curated targets, explicit deps in consumer TARGETS are sufficient; auto-map remains in place for more complex graphs.

Acceptance criteria

- Adding `//third_party/providers:nix_pkgs_zlib` or `:nix_pkgs_openssl` as deps results in planner collecting `nixpkg:pkgs.zlib`/`nixpkg:pkgs.openssl`, and Nix templates resolve include paths without local shims.
- New provider tests pass locally and in CI.

Risks/Notes

- ABI/toolchain alignment: rely on LLVM toolchain from nixpkgs consistently; document policy in docs.
- Keep the provider surface stable; avoid hard-coding paths in Starlark.

---

### PR 2: Go cgo via nixpkgs providers

Intent/Impact

- Allow Go packages to depend on nixpkgs C/C++ libraries via cgo with deterministic builds.
- Reuse provider catalog from PR 1; centralize Nix-side resolution in Go templates.

Scope

- Go macros (`go/defs.bzl`):
  - Add optional attrs: `nixpkg_deps = ["pkgs.zlib", "pkgs.openssl"]`, `nix_cgo_pkgconfig = { "pkgs.openssl": "openssl" }`.
  - When `nixpkg_deps` non-empty, stamp label `"cgo:enabled"` and wire explicit deps to curated provider targets (e.g., `//third_party/providers:nix_pkgs_openssl`).

- Exporter
  - Ensure Go adapter adds `cgo:enabled` and `nixpkg:*` labels for diagnostics (additive only). No deletion.

- Nix Go template (`tools/nix/templates/go.nix`)
  - New params: `nixCgoPkgs = []`, `pkgConfigNames = {}`.
  - Behavior:
    - If `nixCgoPkgs != []`: set `nativeBuildInputs = nixCgoPkgs ++ [ pkgs.pkg-config ]`, export `CGO_ENABLED=1`.
    - Compose `PKG_CONFIG_PATH` from detected pkg-config dirs of `nixCgoPkgs`.
    - If pkg-config absent for a dep, synthesize `CGO_CFLAGS`/`CGO_LDFLAGS` using `${dep.dev or dep}/include` and `${dep}/lib`.
  - Keep flag ordering deterministic.

- Tests
  - Under `tools/tests/go/`:
    - `go.cgo.zlib.builds.test.ts`: minimal Go file with a cgo comment and a reference to zlib via pkg-config; expect successful build.
    - `go.cgo.openssl.builds.test.ts`: same for openssl; if platform variance is high, keep to include-only smoke.
  - Exporter label tests to verify `cgo:enabled` and `nixpkg:*` presence.

Acceptance criteria

- A Go target with `nixpkg_deps = ["pkgs.zlib"]` builds; exporter shows `cgo:enabled` and `nixpkg:pkgs.zlib` labels; planner paths remain deterministic.

Risks/Notes

- Toolchain/ABI alignment for cgo: prefer the same LLVM/libc toolchain stack.
- Minimize OS-specific logic; rely on nixpkgs to normalize.

---

### PR 8.1: Exporter multi-adapter orchestration and metrics tests

Intent/Impact

- Ensure exporter deterministically merges enrichments from multiple language adapters (Go + C++), and add metrics tests for observability.

Current state

- `tools/buck/exporter/main.ts` already discovers adapters, filters active, runs them in a deterministic order, and merges labels.

Design additions

- Metrics tests (optional but recommended):
  - Add `tools/tests/exporter/metrics.adapters.batches.test.ts`:
    - Simulate a mixed-language graph; enable metrics output via `--metrics-out` flag.
    - Assert adapter names (sorted), total batches, and tuple keys presence (for Go batches).
  - Add `tools/tests/exporter/adapters.inactive.skip.test.ts`:
    - Simulate missing `cpp` adapter file (by removing it in temp repo); ensure run succeeds and Go labels are still added.

- Determinism checks
  - Add a test that reorders input nodes and verifies identical output (labels and order) to assert stable merging and sorting.

Acceptance criteria

- Mixed-language export merges labels with set-union semantics; outputs are deterministic regardless of input order.
- Metrics file contains expected fields and stable ordering.

Risks/Notes

- Keep adapter contracts additive-only; no deletions to simplify merging.

---

### Implementation Notes and Sequencing

1. Land PR 1: add curated provider targets and tests; no changes to planner or templates beyond existing attr resolution.
2. Land PR 2: extend Go macros and Nix template; add cgo tests.
3. Land PR 8.1: add exporter metrics tests and determinism checks.

Each PR should run the full test suite with coverage, and new tests should follow the one-test-per-file convention.
