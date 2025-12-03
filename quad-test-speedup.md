## Quad Alignment Plan — Test Suite Speedups (Buck2 / Nix / Node / Go / C++) — Part TS

This installment focuses on reducing end-to-end test runtime without sacrificing determinism or correctness. The plan introduces opt‑in reuse for common devDeps, best‑effort prewarm steps, and orchestration fixes that remove unnecessary daemon restarts and redundant graph exports. All changes preserve hermetic test behavior for unchanged inputs. When prewarm is present, it only accelerates; when absent, tests still pass deterministically.

### Baseline and Constraints

- Already landed improvements (baseline this plan builds on):
  - Verify defaults: auto `NIX_MAX_JOBS`/`NIX_CORES` from CPU count; single‑batch by default; unified PNPM store prewarm once at start
  - `node_nix_test`: reuses repo‑root unified PNPM store; honors `NIX_MAX_JOBS`/`NIX_CORES`
  - Harness: Node test timeout sourced from `VERIFY_TIMEOUT_SECS`; tests avoid `fs-extra` in pre‑nm contexts
  - Node invalidation tests: deterministic content checks via explicit declared inputs (no `$SRCDIR` scans)
- Non‑negotiable constraints (design philosophy):
  - Opt‑in reuse only; default remains “nearest importer”
  - Determinism and explicit declared inputs over ambient context
  - Prewarm is best‑effort and must not affect correctness

### Environment Toggles (Operator Controls)

- `ZX_TEST_NODE_MODULES_IMPORTER=libs/test-deps[-lint|-bundle|-all]` (opt‑in)
- `VERIFY_PREWARM=1` (default on): prewarm heavy toolchains in verify (best‑effort)
- `TEST_RSYNC_ROOTS="apps/demo,cpp,tools"`: limit repo copy for temp workspaces

### Global Targets & Metrics

- Warm runs: reduce median end‑to‑end runtime to ≤ 9–10 minutes on a 8–10 core macOS dev machine
- Cold runs: reduce initial setup by ≥ 20% vs baseline through prewarm + rsync reductions
- Zero correctness deltas: identical pass set; no masked missing‑deps in templates

---

## PR‑1: Tiered shared importers for Node devDependencies (opt‑in)

### Description

Extend the existing `libs/test-deps` base importer into a small tier of opt‑in shared importers to reduce repeated `node_modules` builds across zx tests:

- `libs/test-deps` (base): `zx`, `typescript`, `vitest`, `esbuild`, `vite`, `c8` (existing)
- `libs/test-deps-lint` (new): base + `eslint`, `@typescript-eslint/*`, plugins/configs
- `libs/test-deps-bundle` (new): base + `rollup` and relevant plugins
- Optional `libs/test-deps-all` (new, CI-only): superset for maximal reuse in CI

Tests opt in with `ZX_TEST_NODE_MODULES_IMPORTER=libs/test-deps-*`. Default remains “nearest importer” to avoid masking template‑local missing devDeps.

### Scope & Changes

- `libs/test-deps-lint/` and `libs/test-deps-bundle/` (new): `package.json`, `pnpm-lock.yaml`
- `flake.nix`: expose `pnpm-store(.unfixed).test_deps_*` and `node-modules.test_deps_*`
- `tools/dev/node-modules-build.ts`: already honors `ZX_TEST_NODE_MODULES_IMPORTER` (no default change)
- Docs: mention tiered importers and opt‑in guidance

### Tests (in this PR)

- Verify all four importers build via `nix build .#node-modules.<name>` on a cold cache
- Representative zx tests opt in to `*-lint` and `*-bundle`; time deltas recorded across two runs
- Ensure default (nearest importer) still works and catches missing devDeps

### Docs (in this PR)

- TESTING.md: “Tiered shared importers” section with examples and caveats

### Acceptance Criteria

- Opt‑in tests reuse node_modules across runs with measurable time reduction
- No tests fail due to missing deps when not opted in

### Risks

- “All” importer can become a kitchen sink; keep CI-only and optional

### Consequence of Not Implementing

- Repeated node_modules builds remain a major cost in cold/warm transitions

### Downsides for Implementing

- Additional lockfiles to maintain

### Recommendation

Implement.

---

## PR‑2: Best‑effort prewarm for heavy Nix toolchains in `verify`

### Description

Add a best‑effort prewarm step for large toolchains that frequently dominate cold runs:

- Go toolchain + bootstrap
- C++/clang, binutils, SDK stubs
- WASM toolchains (emscripten, tinygo) used by tests

This prewarm never affects correctness; tests must remain hermetic if prewarm is skipped.

### Scope & Changes

- `tools/bin/verify`: optional prewarm block guarded by `VERIFY_PREWARM=1` (default on)
- Use `nix build` of stable flake outputs (e.g., `.#toolchains.go`, `.#toolchains.cxx`, `.#toolchains.emscripten`, `.#toolchains.tinygo`) if exposed; otherwise skip silently

### Tests (in this PR)

- Cold-cache run: measure verify prewarm time and subsequent suite speedup
- Warm-cache run: verify negligible overhead

### Docs (in this PR)

- TESTING.md: document `VERIFY_PREWARM` behavior and its best‑effort nature

### Acceptance Criteria

- Demonstrable reduction in cold‑cache E2E time without functional differences

### Risks

- None functionally; only time/IO cost in cold runs

### Consequence of Not Implementing

- Large cold starts remain frequent sources of >10m variance

### Downsides for Implementing

- Slight verify script complexity

### Recommendation

Implement.

---

## PR‑3: Eliminate per‑test buckd restarts; rely on explicit inputs for invalidation

### Description

Remove buckd kills in zx tests except where we bootstrap a brand‑new temp workspace that genuinely requires a fresh daemon. Ensure tests drive invalidation by declared inputs (labels `srcs`, `deps`, stamps), not by daemon restarts or directory scanning.

### Scope & Changes

- `tools/tests/**/*.test.ts`: strip unconditional `buck2 kill` calls in scaffolding/exporter tests
- Keep targeted one‑time kill when switching to a brand‑new temp repo (guarded)
- Convert any `$SRCDIR` scans to explicit declared inputs where they impact invalidation

### Tests (in this PR)

- A/B on representative scaffolding suites: same pass set; improved throughput; fewer restarts logged

### Docs (in this PR)

- TESTING.md: “Don’t depend on buckd restart for invalidation” guideline

### Acceptance Criteria

- Same functional outcomes with fewer buckd restarts; reduced orchestration overhead

### Risks

- Latent assumptions on buckd kill may need explicit inputs to be added (as we did for node invalidation)

### Consequence of Not Implementing

- Overuse of restarts inflates times and introduces flakiness under load

### Downsides for Implementing

- Minor test code churn to wire explicit inputs

### Recommendation

Implement.

---

## PR‑4: Shrink temp rsync footprint and add `TEST_RSYNC_ROOTS`

### Description

Speed up `runInTemp` by syncing only what a test needs:

- Exclude `test-logs/` and other large, irrelevant trees by default
- Support `TEST_RSYNC_ROOTS` to copy only specific roots (e.g., `apps/demo,cpp,tools/nix`)

### Scope & Changes

- `tools/tests/lib/test-helpers.ts:rsyncRepoTo(...)`: already excludes many heavy dirs; extend with `test-logs/` and document `TEST_RSYNC_ROOTS`

### Tests (in this PR)

- Measure rsync duration before/after on local machine with realistic workspace size

### Docs (in this PR)

- TESTING.md: “Faster temp workspaces” with `TEST_RSYNC_ROOTS` examples

### Acceptance Criteria

- Reduced temp setup time without breaking any tests

### Risks

- Over‑excluding roots; mitigated by targeted include mechanism

### Consequence of Not Implementing

- Test setup time remains higher than needed

### Downsides for Implementing

- None significant

### Recommendation

Implement.

---

## PR‑5: Prebuild/prewarm node_modules for tiered importers (opt‑in)

### Description

When a test opts in to a tiered importer, prebuild its `node-modules.<name>` once per run in `verify`. The opt‑in test then only links/uses the prebuilt output. Default behavior remains unchanged.

### Scope & Changes

- `tools/bin/verify`: after PNPM store prewarm, `nix build` `.#node-modules.test_deps_*` if present
- No changes to test harness defaults; only an optional speedup path

### Tests (in this PR)

- Select a few zx tests to opt in and measure repeated run improvements (warm suite)

### Docs (in this PR)

- TESTING.md: “Opt‑in prebuilt node_modules” with caveats

### Acceptance Criteria

- Measurable reduction for opted‑in tests; no global behavior change

### Risks

- Overreliance on shared importers; enforce template tests to keep nearest importer defaults

### Consequence of Not Implementing

- Node builds remain duplicated across tests

### Downsides for Implementing

- Small verify complexity

### Recommendation

Implement.

---

## PR‑6: Reuse a single exported Buck graph across zx tests

### Description

Export the Buck graph once per repo state and reuse it across zx tests run in the same run. If inputs change (hash of config files, TARGETS, prelude), export again.

### Scope & Changes

- `tools/buck/export-graph.ts` and/or `tools/buck/exporter/main.ts`:
  - Add a content hash guard (e.g., files affecting config: `.buckconfig`, `TARGETS`, `prelude/**`, `third_party/providers/**`, `flake.lock`)
  - Write `tools/buck/graph.json` only when hash changes; otherwise reuse
- `tools/buck/zx_test.bzl`: favor reuse by default; tests retain the ability to force re‑export when required

### Tests (in this PR)

- Run exporter batch; confirm only first test exports graph; subsequent tests reuse
- Change inputs (e.g., touch `flake.lock`); next test triggers re‑export

### Docs (in this PR)

- Build-system design doc: “Composite Graph API reuse contract”

### Acceptance Criteria

- Reduction in exporter overhead with identical test outcomes

### Risks

- Incorrect hashing scope could produce stale graphs; mitigate by conservative include set and integration test

### Consequence of Not Implementing

- Redundant graph export across zx tests increases latency

### Downsides for Implementing

- Slight complexity in change detection

### Recommendation

Implement.

---

## Rollout & Sequencing

1. PR‑3 (buckd restarts removal) — quick wins; removes orchestration overhead
2. PR‑4 (rsync footprint + roots) — reduces temp setup time; no behavior change
3. PR‑1 (tiered importers) — enables opt‑in reuse without global risk
4. PR‑5 (prebuild node_modules for tiered importers) — capitalizes on PR‑1
5. PR‑6 (graph export reuse) — system‑wide export reduction
6. PR‑2 (toolchain prewarm) — last, as pure best‑effort optimization

---

## Verification & Backout Strategy

- PR‑3
  - Verify: identical pass set; fewer buckd restarts in logs; improved median runtime
  - Backout: revert test changes; no data migration
- PR‑4
  - Verify: rsync timing drops; zero test failures
  - Backout: restore previous rsync excludes; keep `TEST_RSYNC_ROOTS`
- PR‑1/5
  - Verify: opted‑in tests run faster on warm runs; defaults unchanged and still catch missing deps
  - Backout: remove tiered importers; tests fall back to nearest importer
- PR‑6
  - Verify: only initial export occurs; re‑export on config hash changes; suite results unchanged
  - Backout: disable reuse; always export
- PR‑2
  - Verify: cold‑cache improvement; no effect on correctness
  - Backout: remove prewarm block in verify

---

## Summary of Expected Impact

- **Lower orchestration overhead**: fewer buckd restarts; single graph export per run
- **Reduced rebuild duplication**: optional reuse of node_modules and prewarmed toolchains
- **Predictable correctness**: explicit inputs, deterministic content checks, opt‑in reuse only
- **Faster iterations**: improved cold and warm runtimes without masking template issues
