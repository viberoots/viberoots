# PR 3.5 – Gaps & Closure Plan for `nix_node_test`

This document captures the remaining gaps between our current implementation and the intent of `nix_node_test` as specified in `nix-node-test.md`, and describes concrete changes and tests to fully close them.

## 1) Context & Current State

What’s already implemented and validated:

- A hermetic, per‑importer `node-test` Nix derivation that:
  - Links the importer's `node_modules` from `mkNodeModules`.
  - Resolves `vitest` strictly from the importer’s `node_modules` (no PATH fallbacks).
  - Uses default test patterns and supports `COVERAGE=1` to pass `--coverage`.
  - Emits a JUnit report via `--reporter=junit` and `--outputFile=report/junit.xml`.
  - Copies the `report/` directory into `$out/report`.
- Deterministic pnpm-store hashing without log scraping:
  - `mkPnpmStoreUnfixed` builds a normalized, reproducible pnpm store tree.
  - `build-tools/tools/dev/update-pnpm-hash.ts` builds `.#pnpm-store-unfixed.<importer>` and computes the digest via `nix hash path --sri`, updating `build-tools/tools/nix/node-modules.hashes.json`.
- `nix_node_test` + `node_nix_test` external runner:
  - Enforces `lockfile:<path>#<importer>`, sets timeout, supports passing extra `env` and `patterns`.
  - Smoke-tested with zx + Buck (including a “no tests present” path).
- Scaffolding templates for Node lib/cli/webapp include `nix_node_test` by default, with “with tests” zx tests passing end‑to‑end under Buck.

## 2) Remaining Gaps

1. (Coverage Artifacts) The design calls for emitting coverage artifacts (LCOV and JSON summary) into the Nix derivation output when running with `COVERAGE=1`. The current `node-test` derivation only ensures a JUnit report under `$out/report` and doesn’t guarantee `$out/coverage` contents.
2. (Coverage E2E Tests) We don’t yet have explicit zx/Buck tests that run with `--env COVERAGE=1` and assert that coverage artifacts are written under `$out` by the `node-test` derivation.
3. (Documentation) The handbook should document how to run `nix_node_test` with coverage under Buck and where to find artifacts in `$out` for CI ingestion.
4. (Optional ergonomics) Consider a `coverage = True` parameter on `nix_node_test` that sets `COVERAGE=1` in the runner environment automatically. Today we rely on `buck2 test … -- --env COVERAGE=1`, which is fine but can be made more ergonomic.

> Note: The deprecation of `nix hash-path` is already addressed by switching to `nix hash path --sri`.

## 3) Detailed Changes

### A. Emit Coverage Artifacts from the Nix `node-test` Derivation

In `flake.nix`, within `makeNodeTest`:

- Continue honoring `COVERAGE=1` based on `coverageEnv`.
- When `coverageEnv == "1"`, add explicit coverage reporters and a deterministic output directory:
  - `--coverage --coverage.reporter=lcov --coverage.reporter=json-summary --coverage.reporter=html --coverage.reportsDirectory=coverage`
  - Keep `--reporter=junit --outputFile=report/junit.xml`.
- In `installPhase`, copy `coverage/` into `$out/coverage` if present.

Illustrative patch (abridged; adapt to current function body):

```nix
# Inside buildPhase, before invoking vitest:
COVERAGE_ARGS=""
if [ "${age ( coverageEnv )}" = "1" ]; then
  COVERAGE_ARGS="--coverage --coverage.reporter=lcov --coverage.reporter=json-summary --coverage.reporter=html --coverage.reportsDirectory=coverage"
fi

# When calling vitest:
CMD="node \"$VITEST_BIN\" run --reporter=junit --outputFile=report/junit.xml $COVERAGE_ARGS $ARGS"
```

```nix
# Inside installPhase, after copying report/:
if [ -d coverage ]; then
  mkdir -p "$out/coverage"
  cp -R coverage/* "$out/coverage/"
fi
```

Rationale:

- Ensures CI and downstream tooling can rely on a consistent location for JUnit (`$out/report`) and coverage (`$out/coverage`).
- Using explicit reporters avoids relying on defaults that may change across `vitest`/`c8` versions.

### B. Add End‑to‑End Coverage Tests

Introduce two zx tests that validate coverage under `buck2 test` with `--env COVERAGE=1`:

1. `build-tools/tools/tests/scaffolding/node-lib.nix-node-test.coverage-pass.test.ts`
   - Scaffold `libs/demo` with a minimal test (e.g., `expect(true).toBe(true)`).
   - Create/commit `pnpm-lock.yaml`, run `update-pnpm-hash`, warm pnpm-store and node-modules, reconcile FOD.
   - Execute: `buck2 test //libs/demo:unit -- --env COVERAGE=1`.
   - `nix build path:$TMP#node-test.libs-demo --no-link --print-out-paths`, then assert:
     - `$out/report/journal.xml` (or configured JUnit file) exists and non-empty.
     - `$out/coverage/lcov.info` exists and non-empty.
     - `$out/coverage/coverage-summary.json` (or `coverage-final.json`) exists.

2. `build-tools/tools/tests/scaffolding/node-cli.nix-node-test.coverage-pass.test.ts`
   - Mirror the above for `apps/demo` with a simple CLI test.

Additionally:

- Extend existing “no‑tests‑pass” variants to run with coverage enabled (optional):
  - `buck2 test //... -- --env COVERAGE=1` should still pass and either produce an empty or minimal coverage directory (depending on `vitest` behavior). Tests should not require non-empty coverage for the empty-test case but can assert that the build and JUnit output exist.

### C. Update Documentation

In `docs/handbook/node-tests.md`:

- Add a “Coverage” section showing:
  - How to run with Buck:
    ```bash
    direnv exec . buck2 test //path/to:unit -- --env COVERAGE=1
    ```
  - Where to find artifacts:
    - JUnit: `$OUT/report/junit.xml`
    - Coverage (when `COVERAGE=1`): `$OUT/coverage/` including `lcov.info` and JSON summary.
  - Note that `nix_node_test` writes reports inside its Nix output; use `buck2 uquery` or `nix build ... --print-out-paths` in CI/scripts to locate them for publishing.
- Document that `vitest` is resolved strictly from the importer's `node_modules`, and missing devDependencies will fail the run early.
- Document the `--env COVERAGE=1` mechanism and the optional `nix_node_test(…, env = {"COVERAGE": "1"})` override, if used.

### D. (Optional) Ergonomics: `coverage = True` on `nix_node_test`

Add an optional parameter to the Starlark macro:

```python
def nix_node_test(
    name,
    ...,
    coverage = False,
    **kwargs
):
    env = dict(env or {})
    if coverage:
        env["C"] = "1"
    node_nix_test(..., env = env, ...)
```

This allows:

```python
nix_node_test(
    name = "unit",
    lockfile_label = "lockfile:libs/demo/pnpm-lock.yaml#libs/demo",
    coverage = True,
)
```

Backward compatibility:

- Existing invocations unchanged.
- Users may continue to rely on `-- --env COVERAGE=1` for CI or ad‑hoc runs.

## 4) Acceptance Criteria

1. For a freshly scaffolded Node lib and CLI with default tests:
   - `direnv exec . buck2 test //...` passes; `report/junit.xml` is present under the `node-test`’s `$out`.
   - `direnv exec . buck2 test //... -- --env COVERAGE=1` passes and produces `$out/coverage/lcov.info` and `$out/coverage/coverage-summary.json` (or `coverage-final.json`) with non‑zero content.
2. Missing `vitest` while tests match patterns fails fast with a clear error (already implemented).
3. `build-tools/tools/dev/update-pnpm-hash.ts` uses `nix hash path --sri` (already implemented).
4. New coverage tests pass under local `v -- --env COVERAGE=1` and in CI; handbook updated with clear instructions.

## 5) Rollout Plan

1. Update `flake.nix` to add explicit coverage reporters and copy coverage artifacts to `$out/coverage`.
2. Implement the two coverage zx tests (`node-lib` and `node-cli`). Integrate them into existing `//:scaffolding_*` test groups.
3. Update `docs/handbook/node-tests.md` to document coverage usage and artifact locations.
4. (Optional) Add `coverage = True` parameter to `nix_node_test` and update templates/examples to demonstrate its use.
5. Run full suite locally (`direnv exec . v -- --env COVERAGE=1`) and in CI; ensure all pass and publish coverage if desired.

## 6) Notes & Non‑Goals

- We intentionally do not reintroduce PATH‑based fallbacks for test runners or devDependencies.
- We keep CI and clean working trees pure; local developer workflows may leverage `WORKSPACE_ROOT` for lockfile iteration as already implemented.
- The JUnit file is explicitly written to `report/junit.xml` regardless of whether tests matched; when no tests match, `--passWithNoTests` should still lead to a successful build. The presence or emptiness of `coverage/` in that case is not enforced.
