## Python uv2nix Enablement — Gap-Closure Plan

### Goals and Philosophy Alignment

- Close the remaining Python gaps while staying aligned with our methodology:
  - Implement a real, pinned uv2nix-backed backend for `pyApp`/`pyLib` (deterministic, no network, importer‑scoped).
  - Fix `python/defs.bzl` macro loads so WASM convenience macros parse reliably.
  - Keep glue minimal and idempotent; tests and docs ship with each PR.

### Scope and Non‑Goals

- Scope
  - Replace the stub uv backend with uv2nix-backed realization (apps/libs).
  - Macro correctness fix in `python/defs.bzl` (missing loads).
  - Optional: enable uv “groups” (dev/test) as first‑class parameters.
- Non‑Goals
  - Poetry/pip‑tools support (out of scope).
  - New lockfile ecosystems; Python remains uv‑only.

### Path Invariants and Naming

- Unchanged from Python design:
  - Importer‑local patches at `<importer>/patches/python/*.patch` with `<dist>@<ver>.patch` naming.
  - Importer‑scoped lockfile `uv.lock` at importer root.
  - Dev overrides via `NIX_PY_DEV_OVERRIDE_JSON` (warn local, fail CI).

### Labels and Invalidation Model

- Keep importer‑scoped lockfile label: `lockfile:<rel/uv.lock>#<importer>`.
- Patches remain included in target `srcs` via macros for precise invalidation.

### Nix Templates (uv2nix realization)

- Replace the current minimal `tools/nix/templates/python/backends/uv.nix` with a uv2nix‑backed builder:
  - Inputs:
    - `lockfile` (repo‑relative), `subdir`, `patchesMap`, `devOverrides`, optional `groups`.
  - Behavior:
    - Materialize site-packages from uv2nix (pure‑Python and wheels/sdists in a pinned, offline fashion).
    - Apply patches per `<dist>@<ver>` (order-deterministic).
    - Honor `NIX_PY_DEV_OVERRIDE_JSON` (reject in CI, warn locally).
    - Emit runnable app wrapper for `pyApp` and reusable overlay/site for `pyLib`.
  - Determinism:
    - No network; all fetchers pinned via flake inputs.
    - Stable output tree (`BUILD-INFO.json` with lockfile path, groups, trim mode).
  - Optional “groups”:
    - Respect a `groups = [ "dev", "test" ]` param affecting the realized environment and cache keys.

### Planner Integration

- Keep current Python planner (`tools/nix/planner/python.nix`):
  - Detect `uv.lock` by walking up from package path.
  - Route `kind:bin|lib|test|wasm` consistently.
  - Optionally expose per‑importer flake outputs (e.g., `.#py-<importer>`, and variants with groups) if we add a manifest entry later.

### Exporter

- No changes: Python adapter already attaches importer‑scoped `lockfile:` labels and enforces warn-only classification locally (CI severity via exporter policy).

### Provider Sync

- No changes: `tools/buck/providers/python.ts` is importer‑scoped and idempotent; it lists only patch_paths that match the importer’s `uv.lock` effective set.

### Provider Rule

- No changes: `//third_party/providers:defs_python.bzl` is metadata-only; invalidation is handled via macros pulling importer‑local patches into `srcs`.

### Buck Macros (macro fix)

- Fix `python/defs.bzl`:
  - Add missing `load("@prelude//:rules.bzl", "genrule")`.
  - Add missing `dedupe_preserve` import from `//lang:defs_common.bzl`.
  - Acceptance: macros parse and WASM stamp rules (`nix_python_wasm_app/lib`) instantiate in Buck without load errors.

### Patching Workflow

- No changes: `patch-pkg python` remains the UX for start/apply/reset/session; apply writes canonical patch and refreshes glue. Patch verification remains as today.

### CI and Glue

- No changes to stage order:
  - Export Graph → Sync Providers → Generate auto_map → Pre‑build guard → Build & Test.
  - Prebuild guard already includes `uv.lock` in freshness inputs and checks Python providers presence; coverage fallback scans all `TARGETS.*.auto`.

### Monorepo‑Friendly Patterns and Isolation

- Unchanged: per‑importer environments; no global virtualenv; no PATH tweaks in tests; importer‑scoped invalidation only.

### WASM Targets

- Unchanged: WASI/Pyodide paths remain as-is (optional later synergy). uv2nix is for native CPython envs (non‑WASM).

### Scaffolding

- Update Python scaffolds so generated apps/libs include `pyproject.toml`, `uv.lock`, and `TARGETS` stubs using `nix_python_*` macros with importer‑scoped lockfile labels.

### Tests

- No separate test-only PRs. Each PR below ships its own concise zx tests:
  - Macro fix PR: parse/build smoke tests for macros (including WASM stamps).
  - uv2nix PR: runtime tests that build and run a tiny app, then verify patch changes behavior and idempotency.
  - Scaffolding PR: scaffold → build → run quick path (tiny example).

### Assumptions to Validate

- uv2nix is available and pinned in the flake; builds are offline and reproducible across target platforms.

### Risks and Mitigations

- uv2nix availability/closure size: pin versions; keep test importers minimal.
- Native extensions: ensure toolchains are present via nixpkgs; document a small example under tests.

### Areas of Concern

- Platform parity (Darwin/Linux) for uv2nix; ensure CI builders match matrix we already run.

### Phased Implementation with Acceptance Criteria

#### PR‑P1: Macro correctness (python/defs.bzl) — tiny fix, with tests/docs

- Changes:
  - Add `load("@prelude//:rules.bzl", "genrule")`.
  - Add `dedupe_preserve` to the `//lang:defs_common.bzl` load.
  - Keep all macro semantics identical.
- Tests (zx, one‑test‑per‑file):
  - “python.macros.parse-and-stamp.test.ts”: load a minimal `TARGETS` with `nix_python_wasm_app/lib` and confirm graph export succeeds.
  - “python.macros.providers-wired.test.ts”: minimal macro target wires providers without error when auto_map exists.
- Docs:
  - Short note in Python design docs clarifying macro loads and WASM stamps.
- Acceptance:
  - Buck parses macros; exporter/guard runs; no load errors; tests pass on Darwin/Linux.

#### PR‑P2: uv2nix-backed backend for pyApp/pyLib (groups optional) — with tests/docs

- Changes:
  - Implement uv2nix in `tools/nix/templates/python/backends/uv.nix`.
  - Wire `tools/nix/templates/python.nix` to call uv2nix backend (replacing the stub).
  - Preserve `patchesMap` and `devOverrides` behavior and CI guardrails.
  - Optional: `groups` parameter with deterministic effect on outputs and `BUILD-INFO.json`.
  - Ensure `pyApp` emits a runnable wrapper; `pyLib` emits a reusable overlay/site.
- Pinning and inputs (required):
  - Add a pinned `uv2nix` input to `flake.nix` (e.g., `inputs.uv2nix.url = "github:<org>/uv2nix/<rev>"`; follow the repo’s pinning conventions).
  - Route the backend through a tiny adapter module (e.g., `tools/nix/uv2nix-adapter.nix`) that:
    - Imports `uv2nix` from flake inputs.
    - Exposes a pure function to realize environments from `uv.lock` using only Nix store paths (no network).
    - Accepts `groups = []` and makes them part of the derivation key.
  - Store-backed realization (pnpm-like):
    - For each dist in `uv.lock`, generate fixed-output derivations (e.g., fetchurl/fetchgit with sha256) or embed vendored sources via `builtins.path`.
    - Build a shared “wheelhouse” derivation keyed by `(lockfile + patches + groups)`.
    - Compose the final `site/` overlay strictly from store paths; no workspace fallbacks.
  - Ensure all fetchers (sdists/wheels/index snapshots) are pinned via flake inputs or fixed-output derivations; no implicit network.
- Backend integration (replacement of the stub):
  - Replace the current shell-based `uv.nix` realization with an implementation that invokes `uv2nix` to materialize site‑packages.
  - Apply importer‑local patches during source preparation (sdist or unpacked wheel) in a stable, order‑deterministic manner (sorted by `<dist>@<ver>` → patch filename).
  - Keep `NIX_PY_DEV_OVERRIDE_JSON` semantics identical:
    - Local warn (print once per evaluation via shared helper); CI = hard fail.
    - Overrides participate in the derivation key only when set; never allowed in CI.
  - Keep the public API of `pyApp`/`pyLib` unchanged (name, lockfile, subdir, groups).
- Determinism and offline behavior:
  - Prove “no network access” during evaluation and build by:
    - Running with `--option restrict-eval true` in CI integration tests (where applicable) and `nix build --offline`.
    - Explicitly pinning any metadata snapshots `uv2nix` requires (e.g., index metadata) as fixed-output inputs.
  - Store hydration and reuse:
    - Expose a wheelhouse preload attribute (e.g., `.#py-wheelhouse-<importer>`) that realizes all locked dists.
    - CI publishes the wheelhouse closure to the binary cache; developers can `nix copy` to hydrate locally.
    - Multiple importers reuse identical store paths when lockfiles match.
  - No adapter fallbacks:
    - The uv2nix path is authoritative; the adapter must not synthesize `site/` from workspace state or test-only env.
    - If realization yields an empty `site/` or required inputs are missing, fail the build loudly.
  - Output stability:
    - Emit `BUILD-INFO.json` including `{"lockfile": "<rel>", "groups": [...], "uv2nix": {"rev": "<rev>", "version": "<semver or rev>"}}`.
    - Wrapper paths for apps remain stable (`bin/py-<sanitized-name>`).
- Observability and ergonomics:
  - Log a concise message on evaluation that includes importer, lockfile path, and groups (behind `PLANNER_TRACE` or similar).
  - When `groups` is non‑empty, ensure the value is visible in derivation names and `BUILD-INFO.json`.
  - Preserve WASM convenience macros behavior (out of scope for uv2nix; unchanged).
- Migration/backout:
  - Keep the legacy shell fallback behind a hidden flag during the transition: `NIX_PY_USE_STUB_BACKEND=1` forces the previous stubbed builder (for quick backouts).
  - Default is uv2nix; removal of the stub follows after one PR cycle if no regressions are found.
- Tests (zx, one‑test‑per‑file):
  - “python.runtime.build-and-run.test.ts”: build a tiny importer app; run; assert output.
  - “python.runtime.patch-affects-execution.test.ts”: apply a patch to a locked dist; rebuild; assert output change; re‑apply same patch → no‑op.
  - “python.runtime.groups.variants.test.ts” (if groups): base vs dev/test variants produce distinct derivations and remain idempotent.
  - “python.runtime.offline-no-network.test.ts”: hydrate the wheelhouse; prove builds succeed with `--offline` using only store paths.
  - “python.runtime.uv2nix-pinned.test.ts”: assert `BUILD-INFO.json` contains the pinned uv2nix rev/version.
  - “python.runtime.deterministic-patches-order.test.ts”: multiple patches apply in sorted, deterministic order (derivation key stable across evaluations).
- Docs:
  - Add a concise uv2nix usage note (how `pyApp`/`pyLib` realize environments; pure/offline guarantees; groups).
- Acceptance:
  - Deterministic uv2nix builds (Darwin/Linux); wrapper runs pass; patches change behavior; re‑apply is no‑op; tests pass.
  - `flake.nix` contains a pinned `uv2nix` input and the backend references it (no hidden fetchers).
  - Offline: CI proves no network access is required for evaluation or build; empty site or missing lock artifacts fails the build (no fallbacks).
  - Observability: `BUILD-INFO.json` records lockfile, groups, and uv2nix identity.

#### PR‑P3: Scaffolding polish (pyproject + uv.lock + TARGETS) — with tests/docs

- Changes:
  - Ensure scaffolds include `pyproject.toml`, `uv.lock`, and correct `TARGETS` using macros with importer‑scoped labels.
  - Keep path invariants; no new glue.
- Tests (zx, one‑test‑per‑file):
  - “scaffolding.python.app.smoke.test.ts”: scaffold → build → run; assert output.
  - “scaffolding.python.lib.smoke.test.ts”: scaffold → build lib; assert overlay exists.
- Docs:
  - Brief scaffolding usage snippet (commands + expected files).
- Acceptance:
  - Scaffolds build/run as-is; tests pass on Darwin/Linux.

### Completion Criteria

- `python/defs.bzl` macros load cleanly (including WASM stamps).
- uv2nix-backed `pyApp`/`pyLib` produce deterministic, runnable outputs; patches affect behavior; re‑apply is a no‑op.
- Scaffolds create working importers that build and run under Buck/Nix without manual steps.

### Pull Request Plan

1. PR‑P1: Macro correctness (tiny, safe; ships its tests/docs).
2. PR‑P2: uv2nix backend realization for `pyApp`/`pyLib` (+ optional groups), with runtime tests and short docs.
3. PR‑P3: Scaffolding polish (pyproject/uv.lock/TARGETS), with scaffold smoke tests and short docs.

### Rollout & Sequencing

- Land PR‑P1 first to unblock any consumer of WASM macros.
- Land PR‑P2 to switch `pyApp`/`pyLib` onto uv2nix.
- Land PR‑P3 to finalize the developer workflow for new Python importers.

### Verification & Backout Strategy

- Each PR ships self-contained tests; backout is a scoped revert of the changed files.
- Runtime tests keep inputs pinned and offline to ensure stability and quick diagnosis.

### Parity Checklist (post‑merge)

- Importer‑scoped lockfile labels mapped in auto_map (unchanged).
- Dev overrides guarded (warn local; CI fail) across Python like Go/C++.
- Provider sync remains deterministic and importer‑scoped.
- Macros stamp labels and wire providers; WASM stamps parse.
- uv2nix realization provides runnable outputs; scaffolds work out‑of‑the‑box.
