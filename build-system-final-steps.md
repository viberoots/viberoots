## Build System – Final Steps PR Plan

This document proposes a focused sequence of PRs to close remaining gaps and fully align implementation with our design, AI preferences, and methodology. Each PR is small, self-contained, and includes acceptance criteria.

References:

- Design guide: `build-system-design.md`
- Go template plan: `go-templates-dev-plan.md`
- Remaining Go build plan: `remaining-go-build-dev-plan.md`
- Key code:
  - Exporter: `tools/buck/export-graph.ts`
  - Provider sync: `tools/buck/sync-providers.ts`, `tools/buck/sync-providers-node.ts`
  - Auto-map: `tools/buck/gen-auto-map.ts`
  - Prebuild guard: `tools/buck/prebuild-guard.ts`
  - Patching: `tools/patch/patch-pkg.ts`, `tools/patch/patch-go.ts`
  - Nix templates: `tools/nix/lang-templates.nix`
  - Nix planner: `tools/nix/graph-generator.nix`
  - Buck macros: `go/defs.bzl`

---

### PR 1 — Refactor exporter into modules (≤250 lines per file)

Goal: Improve separation of concerns and file-size compliance for `tools/buck/export-graph.ts` while retaining behavior and cache semantics.

Design:

- Split into modules under `tools/buck/exporter/`:
  - `types.ts`: shared types (`Node`, `Tuple`, `GoPkg`, `Metrics`)
  - `env.ts`: parse labels/GOFLAGS → `Tuple`, toolchain hash
  - `batch.ts`: group nodes by `(tuple, moduleRoot)`, compute roots and cwd
  - `golist.ts`: cache key building, `go list -deps -json -test` invocation, JSON-stream parse, build indexes
  - `labeler.ts`: attach `module:<path>@<version>` labels; test-only deps remain on test targets only
  - `io.ts`: cquery wrapper, `writeIfChangedJSON`, CLI arg parsing
  - `main.ts`: orchestrate: read nodes (cquery or simulate), build batches, run go-list in parallel, label, sort/dedupe labels, emit JSON; expose `--metrics-out`
- Preserve JSON output format and metrics options; keep `--scope`, `--cache-dir`, `--max-parallel`, `--simulate`, `--metrics-out` flags.
- No changes to semantics: identical labels, caching, and metrics.

Acceptance criteria:

- Files under `tools/buck/exporter/*` each ≤250 lines.
- `node tools/buck/export-graph.ts` produces identical `tools/buck/graph.json` (content hash) on the same repo state as before.
- All existing tests that consume `graph.json` continue to pass.
- Coverage remains stable; no new side effects introduced.

Notes:

- Keep top-level `tools/buck/export-graph.ts` as a thin wrapper delegating to `./exporter/main.ts`.
- See design: “Exporter (authoritative, batched `go list`)” in `build-system-design.md`.

Detailed design (PR 1):

- Directory and files
  - `tools/buck/exporter/types.ts`
  - `tools/buck/exporter/env.ts`
  - `tools/buck/exporter/batch.ts`
  - `tools/buck/exporter/golist.ts`
  - `tools/buck/exporter/labeler.ts`
  - `tools/buck/exporter/io.ts`
  - `tools/buck/exporter/main.ts`

- Public interfaces
  - `types.ts`
    - `export type Node = { name: string; rule_type: string; labels?: string[]; srcs?: string[] }`
    - `export type Tuple = { goos: string; goarch: string; cgo: string; tagsKey: string; goflagsKey: string; toolchain: string }`
    - `export type GoPkg = { ImportPath?: string; Dir?: string; Deps?: string[]; Imports?: string[]; ForTest?: string | null; Module?: { Path?: string; Version?: string; Replace?: { Path?: string; Version?: string } | null } | null }`
    - `export type Metrics = { totalBatches: number; cacheHits: number; cacheMisses: number; durationMs: number; tupleKeys: string[] }`
  - `env.ts`
    - `deriveTupleForNode(n: Node): Promise<Tuple>` (uses GOFLAGS/labels, computes toolchain hash)
    - `parseTagsFromLabels(labels?: string[]): string[]`
    - `normalizeGOFLAGS(s?: string): string`
  - `batch.ts`
    - `dirsForTarget(n: Node): string[]`
    - `findModuleRootForDirs(dirs: string[]): Promise<string | null>`
    - `buildBatches(nodes: Node[]): Promise<Array<{ tuple: Tuple; members: Node[]; roots: string[]; cwd: string }>>`
  - `golist.ts`
    - `runGoList(tuple: Tuple, roots: string[], cwd: string, cacheDir: string): Promise<GoPkg[]>`
    - `parseGoListStream(s: string): GoPkg[]`
    - `buildPkgIndexes(pkgs: GoPkg[]): { byImport: Map<string, GoPkg>; byDir: Map<string, GoPkg>; testByDir: Map<string, GoPkg[]> }`
    - `reachableImports(from: GoPkg, byImport: Map<string, GoPkg>): Set<string>`
  - `labeler.ts`
    - `effectiveModuleKey(p: GoPkg): string | null` (handles Replace and pseudo-versions)
    - `attachGoModuleLabels(nodes: Node[], batches: ReturnType<buildBatches>, cacheDir: string): Promise<Node[]>`
  - `io.ts`
    - `cqueryNodes(scope: string, attrList: string[]): Promise<Node[]>`
    - `readSimulatedNodes(path: string): Promise<Node[]>`
    - `writeIfChangedJSON(file: string, data: any): Promise<void>`
    - `parseArgs(argv: any): { out: string; scope: string; simulate: string; maxParallel: number; cacheDir: string; metricsOut: string }`
  - `main.ts`
    - `export async function run(): Promise<void>` (glues modules; writes metrics when requested)

- Behavioral invariants (must remain identical)
  - Label computation uses per-target reachable imports seeded by the package dir and, for tests, test packages; standard library excluded.
  - Module key format: `module:<importPath>@<version>` with lowercase normalization; unknown version → `unknown`.
  - Sorting/dedup of labels; stable target ordering by `name`.
  - Caching keyed by `(tuple, moduleRoot, roots)` plus lockfile hash (`gomod2nix.toml` preferred; falls back to `go.mod`/`go.sum`).
  - Path normalization for macOS `/private/var` remains.
  - Metrics fields and meanings unchanged.

- Error handling and constraints
  - No repo mutations or side-effects; read-only except emitting outputs requested by flags.
  - Fail with clear messages when `buck2` is not available or cquery fails.
  - Don’t introduce new runtime deps beyond Node built-ins and existing helpers (`../lib/fs-helpers`).
  - Keep concurrency cap via `--max-parallel`.

- CLI and flags (unchanged)
  - `--out`, `--scope`, `--simulate`, `--max-parallel`, `--cache-dir`, `--metrics-out`.
  - `--scope` accepts label filters like `label:go`.

- Tests to add (zx/node:test)
  - `tools/tests/exporter/exporter.golden-equivalence.test.ts`
    - Use `--simulate` with a fixed nodes JSON; assert output equals saved golden JSON (stable sort and labels).
  - `tools/tests/exporter/exporter.test-only-labeling.test.ts`
    - Simulate a test target that pulls in a test-only dep; assert only the test target gets the module label.
  - `tools/tests/exporter/exporter.cache-keys.test.ts`
    - Verify cache hit/miss behavior for identical tuples and roots; assert `cacheHits` increments and content is identical.
  - `tools/tests/exporter/exporter.toolchain-hash.test.ts`
    - Stub `go env`/`go version` via environment or simulate; assert `Tuple.toolchain` formatting and inclusion in tuple keys list.

- Migration plan
  - Keep `tools/buck/export-graph.ts` with a small body: import and call `./exporter/main.ts`.
  - Move existing helpers into modules without changing internal logic; adopt intent-revealing names.
  - Update imports to use `../lib/fs-helpers` for write-if-changed.

- File-size compliance
  - Each module ≤250 lines. Prefer short functions, early returns, no deep nesting.
  - Use meaningful names to avoid explanatory comments. Move rationale to `build-system-design.md`.

- Performance
  - Preserve current batching and concurrency; no algorithmic changes.
  - Ensure JSON parsing remains streaming-based (`parseGoListStream`).

- Acceptance verification (in addition to global acceptance above)
  - Re-run the existing provider-wiring tests (e.g., `tools/tests/e2e-provider-wiring.ts`) to ensure labels still map to the same providers.
  - Compare `tools/buck/export-graph.ts --metrics-out` output fields before/after refactor.

---

### PR 2 — Extract Buck/prelude setup from exporter; fail fast if missing

Goal: Make the exporter minimal and deterministic by removing implicit `.buckconfig`/prelude setup from `export-graph.ts`.

Design:

- Remove `ensurePreludeBuckConfig()` from exporter.
- Add or reuse `tools/dev/startup-check.ts` to validate Buck prelude/cells and emit guidance (do not rewrite repo files in exporter).
- Dev shell (`flake.nix` shellHook) continues to best-effort align `.buckconfig`. Exporter only reads Buck graph and fails fast with a clear error when Buck cannot be queried.

Acceptance criteria:

- Exporter does not write or symlink configuration files.
- Running exporter with a misconfigured Buck setup fails with an actionable error message.
- `tools/buck/prebuild-guard.ts` can still auto-fix glue locally by calling the ZX scripts; no behavioral regression.

Notes:

- Aligns with “Exporting the Buck Graph (ZX)” minimalism in `build-system-design.md`.

---

### PR 3 — Modularize `flake.nix` into imported modules (≤250 lines per file)

Goal: Improve maintainability and meet file-size guidelines without changing outputs.

Design:

- Move complex shellHook content and node/pnpm derivations into `tools/nix/*.nix` modules:
  - `tools/nix/devshell.nix` (shellHook and PATH setup)
  - `tools/nix/node-modules.nix` (pnpm-store and node-modules derivations)
  - `tools/nix/buck-prelude.nix` (buck2-prelude package)
- `flake.nix` imports these modules and exposes the same `devShells`, `packages`, and `checks`.

Acceptance criteria:

- `flake.nix` ≤250 lines.
- `nix build .#graph-generator` and `nix develop` behavior unchanged.
- `tools/dev/install-deps.ts` continues to work end-to-end.

Notes:

- See “Nix with Dynamic Derivations” and planner details in `build-system-design.md`.

---

### PR 4 — Remove legacy vendoring scripts and references

Goal: Eliminate drift and reinforce the Nix+gomod2nix source of truth.

Design:

- Delete `tools/buck/vendor-go-mods.ts` and any README/doc links that suggest vendoring.
- Confirm `tools/buck/sync-go-mods.ts` remains deprecated/no-op and remove any callers.
- Audit docs to ensure they steer users to `tools/dev/install-deps.ts` and patching UX only.

Acceptance criteria:

- No references to vendoring remain; search for `vendor-go-mods` and `sync-go-mods` callers is empty.
- Builds and tests pass (no consumer relied on vendored sources).

Notes:

- Matches “Remove non-authoritative vendoring” in `remaining-go-build-dev-plan.md` (PR 3).

---

### PR 5 — Enforce `patches/go` invariants in CI (strict mode)

Goal: Guarantee flat `patches/go` structure and single patch per `module@version` across the repo.

Design:

- Add a CI step to run `node tools/buck/sync-providers.ts --strict`.
- Keep non-strict mode for local convenience, but CI must fail on:
  - Subdirectories under `patches/go`.
  - Non-`.patch` files present.
  - Duplicate patches for the same `module@version`.
- Ensure `tools/dev/patches-lint.ts` still runs in `install-deps` (advisory/non-blocking locally).

Acceptance criteria:

- CI fails when any invariant is violated.
- With a clean repo, CI step is a no-op (no diffs, no warnings).

Notes:

- See “Phase 1 — Repo Scaffolding & Invariants” and “Phase 9 — Regression Tests & Monitors” in `build-system-design.md`.

---

### PR 6 — Comments-to-docs pass; enforce file-size caps prospectively

Goal: Align with AI preferences: self-explanatory code, minimal comments, rationale in docs; respect ≤250 line guideline going forward.

Design:

- Reduce narrative comments in hot paths (exporter modules, prebuild guard, planner). Keep intent-revealing names.
- Move rationale/long explanations into `build-system-design.md` and/or this document; link from headers.
- Add a light script (optional) to report files >250 lines during CI as warnings, focusing on new/changed files. Treat the exporter split and flake modularization as the primary fixes for existing large files.

Acceptance criteria:

- Key refactored files have significantly fewer inline comments and rely on clear naming.
- Documentation gains short sections for the rationale previously in code comments.
- CI shows no warnings for the exporter and flake after PRs 1–3.

Notes:

- Ties to preferences in `AI-PREFERENCES.XML` and discipline in `METHODOLOGY.XML`.

---

### PR 7 — Tighten prebuild guard freshness diagnostics (optional)

Goal: Improve observability without changing behavior.

Design:

- Keep current auto-fix and CI fail-fast semantics in `tools/buck/prebuild-guard.ts`.
- Add optional verbose lists (top N newest inputs/oldest outputs) gated by `PREBUILD_GUARD_VERBOSE=1` (already present), document usage.

Acceptance criteria:

- No behavior change by default.
- With `PREBUILD_GUARD_VERBOSE=1`, logs include the top offenders aiding debugging.

Notes:

- Complements the “Pre-build guard” section in `build-system-design.md`.

---

## Execution order and risk

Recommended order: PR 4 (safe cleanup) → PR 2 (exporter no side-effects) → PR 1 (split exporter) → PR 3 (modularize flake) → PR 5 (CI invariants) → PR 6 (comments/docs) → PR 7 (optional diagnostics).

- PR 4 is low-risk cleanup.
- PR 2 reduces coupling; ensures exporter’s scope is clear before splitting.
- PR 1 and 3 are refactors; verify outputs and behavior remain stable.
- PR 5 introduces CI strictness; run after structure is stabilized.
- PR 6 and 7 are polish passes improving maintainability and operability.

## Verification

- Run focused tests first, then full suite:
  - Focused: exporter batching/unit tests; provider wiring (`tools/tests/e2e-provider-wiring.ts`).
  - Full: `buck2 test //...` with coverage as configured.
- Validate Nix outputs: `nix build .#graph-generator` and confirm manifest/symlinks are present.
- Validate glue regeneration paths: `node tools/buck/export-graph.ts`, `node tools/buck/sync-providers.ts --strict`, `node tools/buck/gen-auto-map.ts`.

## Done state

- Exporter and flake split into modules; no side effects in exporter.
- Legacy vendoring removed.
- CI enforces patch directory invariants.
- Comments minimized in hot paths; rationale captured in docs.
- All tests pass; coverage stable; behavior consistent with `build-system-design.md`.
