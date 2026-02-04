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

- `ZX_TEST_NODE_MODULES_IMPORTER=<relative importer dir in the temp workspace>` (optional; used by some scaffolded tests)
- `VERIFY_PREWARM=1` (default on): prewarm heavy toolchains in verify (best‑effort)
- `TEST_RSYNC_ROOTS="apps/demo,cpp,tools"`: limit repo copy for temp workspaces

### Global Targets & Metrics

- Warm runs: reduce median end‑to‑end runtime to ≤ 9–10 minutes on a 8–10 core macOS dev machine
- Cold runs: reduce initial setup by ≥ 20% vs baseline through prewarm + rsync reductions
- Zero correctness deltas: identical pass set; no masked missing‑deps in templates

---

## PR‑1: Best‑effort prewarm for heavy Nix toolchains in `verify`

### Description

Add a best‑effort prewarm step for large toolchains that frequently dominate cold runs:

- Go toolchain + bootstrap
- C++/clang, binutils, SDK stubs
- WASM toolchains (emscripten, tinygo) used by tests

This prewarm never affects correctness; tests must remain hermetic if prewarm is skipped.

### Scope & Changes

- `build-tools/tools/bin/verify`: optional prewarm block guarded by `VERIFY_PREWARM=1` (default on)
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

## PR‑2: Shrink temp rsync footprint and add `TEST_RSYNC_ROOTS`

### Description

Speed up `runInTemp` by syncing only what a test needs:

- Exclude `test-logs/` and other large, irrelevant trees by default
- Support `TEST_RSYNC_ROOTS` to copy only specific roots (e.g., `apps/demo,cpp,build-tools/tools/nix`)

### Scope & Changes

- `build-tools/tools/tests/lib/test-helpers.ts:rsyncRepoTo(...)`: already excludes many heavy dirs; extend with `test-logs/` and document `TEST_RSYNC_ROOTS`

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

## PR‑3: Prebuild/prewarm per‑importer node_modules in runInTemp (opt‑in)

### Description

Optionally prebuild per‑importer `node_modules` inside the temp workspace to avoid repeated builds during a run. Tests can enable this; default behavior remains unchanged.

### Scope & Changes

- `build-tools/tools/tests/lib/test-helpers.ts`: add an opt‑in hook `TEST_PREBUILD_NM=1` that, after a test scaffolds importers in the temp workspace, invokes `node build-tools/tools/dev/node-modules-build.ts --print-out-paths` to build/link the importer's `node_modules` once per run
- No changes to verify defaults; this is a per‑temp‑workspace optimization

### Tests (in this PR)

- Select a few zx tests to opt in and measure repeated run improvements (warm suite)

### Docs (in this PR)

- TESTING.md: “Opt‑in prebuilt node_modules” with caveats

### Acceptance Criteria

- Measurable reduction for opted‑in tests; no global behavior change

### Risks

- Overuse can add up-front work in cases where very few tests touch Node importers; keep opt‑in and scoped

### Consequence of Not Implementing

- Node builds remain duplicated across tests

### Downsides for Implementing

- Small verify complexity

### Recommendation

Implement.

---

## PR‑4: Reuse a single exported Buck graph across zx tests

### Description

Export the Buck graph once per repo state and reuse it across zx tests run in the same run. If inputs change (hash of config files, TARGETS, prelude), export again.

### Scope & Changes

- `build-tools/tools/buck/export-graph.ts` and/or `build-tools/tools/buck/exporter/main.ts`:
  - Add a content hash guard (e.g., files affecting config: `.buckconfig`, `TARGETS`, `prelude/**`, `third_party/providers/**`, `flake.lock`)
  - Write `build-tools/tools/buck/graph.json` only when hash changes; otherwise reuse
- `build-tools/tools/buck/zx_test.bzl`: favor reuse by default; tests retain the ability to force re‑export when required

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

1. PR‑1 (toolchain prewarm) — simple, isolated, best‑effort
2. PR‑2 (rsync footprint + roots) — reduces temp setup time; no behavior change
3. PR‑3 (prebuild per‑importer node_modules) — optional, guarded by env
4. PR‑4 (graph export reuse) — system‑wide exporter optimization

---

## Verification & Backout Strategy

- PR‑2
  - Verify: rsync timing drops; zero test failures
  - Backout: restore previous rsync excludes; keep `TEST_RSYNC_ROOTS`
- PR‑3
  - Verify: opted‑in tests run faster on warm runs; defaults unchanged and still catch missing deps
  - Backout: disable `TEST_PREBUILD_NM` hook
- PR‑4
  - Verify: only initial export occurs; re‑export on config hash changes; suite results unchanged
  - Backout: disable reuse; always export
- PR‑1
  - Verify: cold‑cache improvement; no effect on correctness
  - Backout: remove prewarm block in verify

---

## Summary of Expected Impact

- **Lower orchestration overhead**: single graph export per run
- **Reduced rebuild duplication**: optional reuse of node_modules and prewarmed toolchains
- **Predictable correctness**: explicit inputs, deterministic content checks, opt‑in reuse only
- **Faster iterations**: improved cold and warm runtimes without masking template issues
