## Getting Started on a PR — Practical Guide for This Repository

This guide helps a new contributor land any PR in this plan successfully, following our rules, methodology, and build-system design.

### 1. Environment setup (direnv + dev shell)

- Ensure direnv is active in your shell and permitted for the repo:
  - `direnv allow` (once per clone), verify it loads automatically in new shells
- Quick checks (must succeed):
  - `nix --version`, `buck2 --version`, `go version`, `node --version`, `pnpm --version`
  - `nix show-config` includes experimental features (flakes, dynamic-derivations, recursive-nix)
- Optional: run our startup check if present (prints clear hints):
  - `node tools/dev/startup-check.ts`

### 2. Project rules you must follow

- Follow `@METHODOLOGY.XML` and `@build-system-design.md` at all times.
- Never commit without verifying that all tests are wired and passing (full suite with coverage):
  - `buck2 test //... -- --env COVERAGE=1`
- Use Conventional Commits and real newlines in commit messages.
- Keep files small and focused (≤ 250 lines ideally); split modules when needed.
- Maintain determinism and low cyclomatic complexity; prefer small, well-named functions.

### 3. Commands cheat sheet

- Build/test:
  - Full test with coverage: `buck2 test //... -- --env COVERAGE=1`
  - Single target build/test: `buck2 build //<pkg>:<name>`, `buck2 test //<pkg>:<name>`
- Glue generation (when working on providers/labels mappings):
  - Export graph: `node tools/buck/export-graph.ts`
  - Sync providers: `node tools/buck/sync-providers.ts`
  - Sync Node providers: `node tools/buck/sync-providers-node.ts`
  - Sync specific language: `node tools/buck/sync-providers.ts --lang node`
  - Generate auto_map: `node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`
  - Prebuild guard (freshness/presence): `node tools/buck/prebuild-guard.ts [--verbose|--json]`
- Nix builds (planner outputs):
  - `nix build .#graph-generator`
- Diagnostics:
  - `node tools/dev/langs-diagnose.ts [--json] [--lang=<id>]`

### 4. Sparse checkout and partial clone

- Languages are enabled by presence (files on disk), not by central registration.
- If a language’s files are missing, operations should skip gracefully; use diagnostics to confirm disablement.
- Planner discovery is manifest-first (`tools/nix/langs.json`), with fallback to on-disk plugin existence.
- Exporter adapters are glob-loaded; missing files simply mean no adapter.

### 5. Toolchain alignment (Go cgo + C/C++)

- Policy: build Go (cgo) and C/C++ using the repo’s Nix toolchain for consistent ABI.
- Verify pkg-config:
  - `which pkg-config`, and ensure `PKG_CONFIG_PATH` includes nixpkgs `<pkg>/lib/pkgconfig`
- If pkg-config files are missing, set `CGO_CFLAGS`/`CGO_LDFLAGS` deterministically (templates support this).

### 6. Providers, overlays, and invalidation

- Providers must include all inputs that affect outputs:
  - Patch files (e.g., `patches/<lang>/*.patch`)
  - Overlay files (e.g., `tools/nix/overlays/*.nix`) when applicable
  - `flake.lock` or equivalent nix pin
- Use a tiny content-addressed stamp rule so Buck invalidates dependents when any input changes.
- Prebuild guard should treat overlays and `flake.lock` as inputs and warn on staleness.

### 7. Definition of Done (per PR)

- Determinism: sorted lists, no ambient FS reads, pure Nix evaluation for planners/templates.
- Partial-clone grace: delete the language’s files to verify graceful skips and clear diagnostics.
- Tests: one-test-per-file; run the full suite with coverage and confirm green.
- Lints pass; file size constraints respected or split.
- Docs updated (handbook/cookbooks/plan cross-links as needed).
- Commit with Conventional Commits message after all green.

### 8. Common failure modes and fixes

- direnv not loaded → missing `buck2`/`timeout`: reload shell or run `direnv allow`.
- pkg-config not finding libs → ensure `PKG_CONFIG_PATH`, or use synthesized `CGO_CFLAGS`/`CGO_LDFLAGS` in templates.
- Overlay not taking effect → wire overlay in `flake.nix`, ensure provider stamp includes overlay files and `flake.lock`.
- Auto-map stale → re-run export-graph → sync-providers → gen-auto-map → prebuild-guard.
- Sparse checkout crash → confirm manifest fallback and adapter discovery handle missing files; use `langs-diagnose`.

### 9. Scaffolding expectations

- Templates live under `tools/scaffolding/templates/<lang>`; provide minimal, runnable examples and TARGETS.
- Use macros to stamp `lang:<id>` + `kind:*`; avoid direct provider deps unless documented.
- Validate with `scaf validate` tests when available.

### 10. CI notes

- Stage ordering typically: export-graph → sync-providers → gen-auto-map → prebuild-guard → build/test.
- Understand what each stage proves and how cache keys are derived (graph, patches/lockfiles, glue outputs).

### 11. Example walkthroughs

- C++ v1 lib/bin sample:
  - Create template files, run `export-graph`, `gen-auto-map` (if needed), build via Nix planner, run tests.
- Go cgo with nixpkgs (zlib):
  - Add `nix_cgo_deps = ["pkgs.zlib"]`, build and test; verify `cgo:enabled` and `nixpkg:*` labels.
- Go↔C interop samples:
  - Go→C: add `repo_cgo_deps` to a Go target using a local `cxx_library` and test.
  - C→Go: build a c-archive from Go and link in a `cxx_*` target.
