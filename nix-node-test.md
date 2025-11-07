## Nix-backed Node tests (`nix_node_test`) — Design Document

### Problem statement

Node projects in this repo are already hermetic for builds (pnpm store as FOD; importer‑scoped `node-modules` derivations; macros that stamp `lang:node` and importer lockfile labels). What we do not yet have is a first‑class, hermetic test rule for Node that integrates cleanly with Buck2 test execution, mirrors our Go/C++ patterns, and works per‑importer without guessing each team’s runner/build chain.

### Goals

- Hermetic, reproducible tests for Node importers (apps/_, libs/_) with pinned toolchain and zero network
- Predictable invalidation keyed to the importer lockfile and per‑importer `node-modules`
- Simple Buck UX: `buck2 test //<pkg>:<rule>`
- External timeout and optional coverage, consistent with repo policy
- Works with TypeScript (transpile-free via runner), ESM where applicable, and common Node patterns

### Non-goals

- Auto‑discovering or auto‑wiring tests without clear conventions (runner, layout). We standardize a default but allow explicit overrides.
- Supporting every possible runner/config simultaneously. We pick one by default and permit overrides at call sites.

---

## Design overview

We introduce a Buck macro `nix_node_test(...)` that expands to an external runner test rule (similar in spirit to our C++ `cpp_nix_test`). The external runner invokes a hermetic Nix derivation which runs the chosen Node test runner inside a sandbox using the importer’s `node-modules` derivation and the pinned Node toolchain.

### Defaults and conventions

- **Runner**: Vitest (pinned in Nix)
- **Default test patterns**: `test/**/*.test.ts`, `test/**/*.test.js`, `__tests__/**/*.test.(ts|js)`, `src/**/*.test.(ts|js)`
- **Importer scoping**: Require exactly one `lockfile:<path>#<importer>` label on the test target
- **TypeScript/ESM**: Use Vitest’s native TS + ESM support (no separate build step) with pinned `esbuild` where needed
- **Coverage**: Off by default; enabled when `COVERAGE=1` is present in the environment; emits LCOV/JSON summary into the derivation output
- **Timeout**: The Buck external runner wraps the test run with the repo’s conventional external `timeout` (default 10 minutes unless overridden)

### Macro surface (proposed)

```
# node/defs.bzl
def nix_node_test(
    name,
    labels = [],                  # MUST include lockfile:<path>#<importer> (or pass lockfile_label)
    lockfile_label = None,        # Convenience: macro adds this to labels when set
    importer = None,              # Optional explicit importer; else derived from lockfile label
    patterns = None,              # Optional override: list of glob patterns
    env = {},                     # Optional test env (merged into runner env)
    timeout_sec = 600,            # External timeout guard (default 10m)
    deps = [],                    # Optional additional deps; provider deps auto‑appended
    **kwargs,
):
    ...
```

Key behaviors:

- Enforces exactly one importer lockfile label (reuses `_ensure_lockfile_label` from existing Node macros)
- Stamps `lang:node` + `kind:test`
- Includes importer‑local `patches/node/*.patch` in `srcs` so Buck invalidation is precise
- Appends provider deps via `auto_map.bzl`
- Expands to `node_nix_test` (new private rule) that supplies an `ExternalRunnerTestInfo` command:
  - Builds and runs the Nix derivation `.#node-test.<importer>` with explicit environment and pattern arguments
  - Wraps with external `timeout`
  - Exits non‑zero on test failure so Buck records the failure

### Nix derivation (flake) — `packages.<system>.node-test.<importer>`

- Inputs:
  - Importer directory path (e.g., `apps/web`)
  - Importer `node-modules` (from `nodeMods.mkNodeModules`) and `pnpm-store` (FOD)
  - Pinned Node toolchain and `vitest` (plus `esbuild` when runner needs it)
- Behavior:
  - `buildPhase`:
    - `cd ${importerDir}`
    - Link `node_modules` from the per‑importer derivation (`ln -s ${nm}/node_modules node_modules`)
    - Resolve `vitest` bin from the virtual store; export `NODE_PATH` to include that node_modules tree
    - Respect `COVERAGE=1` to configure vitest coverage (c8/istanbul) and write reports under `$out/report`
    - Run `vitest run` with default or provided patterns; `--reporter=junit --passWithNoTests`
  - `installPhase`:
    - Copy reports (junit, lcov, summary) into `$out/`
  - Failure: any test failure exits non‑zero causing `nix build` to fail (surface as Buck test failure)

Pseudo‑sketch:

```nix
makeNodeTest = importerDir: let
  nm = nodeMods.mkNodeModules { lockfilePath = importerDir + "/pnpm-lock.yaml"; inherit importerDir; };
  name = builtins.baseNameOf importerDir;
in pkgs.stdenvNoCC.mkDerivation {
  pname = "node-test";
  version = sanitize importerDir;
  src = builtins.path { path = ./.; name = "repo"; };
  nativeBuildInputs = [ pkgs.nodejs_22 pkgs.esbuild ];
  buildPhase = ''
    set -euo pipefail
    cd ${importerDir}
    export SOURCE_DATE_EPOCH=1
    ln -s ${nm}/node_modules node_modules
    VITEST_BIN=$(ls -d node_modules/.pnpm/vitest@*/node_modules/vitest/vitest.mjs 2>/dev/null | head -n1 || true)
    if [ -z "$VITEST_BIN" ]; then echo "[nix] vitest not found" >&2; exit 3; fi
    VITEST_NODE_MODULES=$(dirname "$VITEST_BIN")/..
    export NODE_PATH="$VITEST_NODE_MODULES${NODE_PATH:+:$NODE_PATH}"
    mkdir -p report
    PATTERNS_FILE="$TMPDIR/patterns.txt"
    # patterns passed via NIX_NODE_TEST_PATTERNS (newline‑sep) else defaults below
    if [ -n "${builtins.getEnv "NIX_NODE_TEST_PATTERNS"}" ]; then
      printf "%s" "${builtins.getEnv "NIX_NODE_TEST_PATTERNS"}" > "$PATTERNS_FILE"
    else
      printf "%s\n" \
        "test/**/*.test.ts" \
        "test/**/*.test.js" \
        "__tests__/**/*.test.ts" \
        "__tests__/**/*.test.js" \
        "src/**/*.test.ts" \
        "src/**/*.test.js" > "$PATTERNS_FILE"
    fi
    COVERAGE_FLAG=""
    if [ "${builtins.getEnv "COVERAGE"}" = "1" ]; then COVERAGE_FLAG="--coverage"; fi
    echo "[nix] running vitest..." >&2
    while IFS= read -r p; do
      test -n "$p" || continue
      node "$VITEST_BIN" run "$p" --reporter=junit $COVERAGE_FLAG || exit 1
    done < "$PATTERNS_FILE"
  '';
  installPhase = ''
    set -euo pipefail
    mkdir -p "$out"
    if [ -d report ]; then cp -R report "$out/"; fi
  '';
};
```

The flake will expose a per‑importer attribute:

```
packages.<system>.node-test = builtins.listToAttrs (map (imp: { name = sanitize imp; value = makeNodeTest imp; }) importerDirs);
```

### External runner command (Buck)

The `node_nix_test` rule’s `ExternalRunnerTestInfo` will:

- Derive/importer from the single lockfile label
- Build via: `nix build .#node-test.<importer> --accept-flake-config`
- Pass patterns/coverage via environment:
  - `NIX_NODE_TEST_PATTERNS` (newline‑separated)
  - `COVERAGE=1` honored when present
- Wrap with the repo’s external `timeout` (default 10m, configurable per target)
- On success: write a small stamp file for Buck’s output; on failure: non‑zero exit

---

## Buck rule and macro wiring

1. New private rule: `node/private/nix_test.bzl`
   - Implements `node_nix_test` returning `ExternalRunnerTestInfo` with the command described above
   - Accepts `importer`, `patterns`, `timeout_sec`, `env`
   - Emits a deterministic default output (e.g., `<name>.stamp`)

2. Public macro in `node/defs.bzl`:
   - `nix_node_test(...)`
   - Enforces lockfile label; stamps `lang:node`, `kind:test`; appends provider deps; expands to `node_nix_test` with computed args

3. Exporter validation (already present for Node):
   - Continues to enforce `kind:*` and exactly one importer label; no changes required

4. Auto‑map and providers: unchanged; tests will acquire provider deps via macro defaults

---

## CI and tooling

- CI continues to run glue stages (export graph → sync providers → gen auto_map) before tests
- `buck2 test //...` will execute Node tests alongside others via external runner
- Coverage: teams can opt‑in per invocation with `COVERAGE=1 buck2 test ...`; the runner writes reports under the derivation output. Aggregation remains a separate tooling concern (unchanged)
- Timeouts: default 600s per test target; override at macro call via `timeout_sec`

---

## PR plan

### PR1 — Flake: add per‑importer `node-test` derivation

- **Scope**
  - Extend `flake.nix` `packages.<system>` to include `node-test.<importer>`
  - Implement deterministic runner as a Nix derivation pinned to Node 22, Vitest, and `esbuild`
  - Honor `NIX_NODE_TEST_PATTERNS` and `COVERAGE=1`; write reports to `$out/report`
- **Acceptance criteria**
  - `nix build .#node-test.<importer>` passes when tests pass, fails when a test fails
  - Reports appear under the build output path on success
- **Rationale**
  - Keep execution hermetic/pinned and importer‑scoped; mirrors `node-webapp`/`node-cli` approach
- **Consequences of not implementing**
  - No hermetic test runner to integrate with the Buck external test rule; brittle env‑driven execution
- **Risks**
  - Vitest/ESM/TS flags or peer deps drift; mitigated by pinning versions and using importer `node-modules`

### PR2 — Buck rule and macro: `node_nix_test` + `nix_node_test`

- **Scope**
  - Add `node/private/nix_test.bzl` implementing an external runner test rule
  - Update `node/defs.bzl` to export `nix_node_test(...)` that:
    - stamps labels (`lang:node`, `kind:test`) and enforces one importer lockfile label
    - appends provider deps via `auto_map.bzl`
    - includes importer‑local `patches/node/*.patch` in `srcs`
    - forwards `patterns`, `env`, `timeout_sec` to the runner
- **Acceptance criteria**
  - `buck2 test //<pkg>:<rule>` runs tests via Nix; success/failure correctly reflected in Buck
  - `COVERAGE=1 buck2 test ...` includes coverage artifacts in the Nix out path
  - External timeout is honored (defaults to 600s; configurable)
- **Rationale**
  - Align Node tests with C++ `cpp_nix_test` pattern; simple Buck UX
- **Consequences of not implementing**
  - Teams continue ad‑hoc test execution; inconsistent behaviors and non‑hermetic runs
- **Risks**
  - Platform differences (Darwin/Linux) in PATH resolution for vitest bin; mitigated by explicit lookup in derivation and `NODE_PATH`

### PR3 — Scaffolding and docs

- **Scope**
  - Update Node scaffolding (`tools/scaffolding`) to optionally generate a sample `nix_node_test` target and `test/example.test.ts`
  - Add documentation snippets (usage, patterns, coverage, timeouts, troubleshooting)
- **Acceptance criteria**
  - Scaffolding produces a project where `buck2 test` passes out‑of‑the‑box
- **Rationale**
  - Reduce friction; codify conventions
- **Consequences of not implementing**
  - Inconsistent adoption; repeated questions and drift
- **Risks**
  - Template drift; mitigated by a small zx test validating scaffold and `buck2 test` behavior

### PR3.5 — Update Node templates to use auto‑discovery and auto‑wiring

- **Scope**
  - Refresh Node scaffolding templates (`tools/scaffolding/templates/node/*`) to rely on the
    new `nix_node_test` external runner’s default discovery and the repo’s provider auto‑wiring.
  - Remove legacy `cmd`/`out` shim usage in template `TARGETS` and instead declare a plain
    `nix_node_test(name="…", lockfile_label=…)` that lets the runner discover tests from the
    default patterns (`test/**/*.test.(ts|js)`, `__tests__/**/*.test.(ts|js)`, `src/**/*.test.(ts|js)`).
  - Update template test files to vitest style (import from `vitest`) and place them under
    `test/` to match runner defaults. Add `vitest` (and `@types/node` as needed) to devDeps.
  - Ensure template packages preserve importer‑scoped lockfile labels and do not hard‑code
    providers; rely on generated `auto_map.bzl` instead.
  - Keep webapp template unchanged for build rule (`node_webapp`) but add an optional
    `nix_node_test` example target when `test/` exists.

- **Acceptance criteria**
  - `scaf new node lib …` and `scaf new node cli …` produce projects where:
    - `buck2 test //<importer>:unit` (or equivalent) passes via the Nix runner without custom
      `cmd` shims, discovering tests from `test/*.test.ts`.
    - `COVERAGE=1 buck2 test //<importer>:unit` produces coverage artifacts in the derivation out.
  - The webapp template can optionally include a sample `nix_node_test` target and passes when a
    trivial vitest file is added under `test/`.
  - No explicit provider deps are present in template `TARGETS`; auto‑map wiring is effective.

- **Rationale**
  - Align templates with the new hermetic test runner and repository conventions: default test
    discovery, importer‑scoped invalidation, and generated provider mapping.

- **Consequences of not implementing**
  - New projects continue to rely on shell shims or Node’s built‑in runner; behavior differs from
    the standardized Nix runner and may fail to collect coverage or match defaults.

- **Risks**
  - Template consumers without `vitest` tests could see failures if files match patterns but the
    runner cannot locate vitest. Mitigate by including `vitest` in devDeps and documenting that the
    runner passes when no tests are present.

### PR4 — CI wiring and minimal tests

- **Scope**
  - Add zx tests under `tools/tests` that:
    - create a tiny importer with one passing and one failing test
    - assert that `nix build .#node-test.<importer>` and `buck2 test` reflect pass/fail
    - assert timeout governance (use a slow test behind a reduced timeout)
  - Ensure CI matrix includes these tests (no new stages beyond existing glue → test)
- **Acceptance criteria**
  - Tests pass in CI across supported architectures
- **Rationale**
  - Prevent regressions in runner behavior and flake exposure
- **Consequences of not implementing**
  - Breakages might slip in unnoticed (e.g., toolchain pin drift)
- **Risks**
  - Longer CI times if patterns are too broad; mitigated with minimal fixtures and external timeouts

---

## Edge cases and notes

- If teams choose a different runner (e.g., Jest/Mocha): call‑site can pass `patterns` and set runner‑specific flags via `env`. Future extensions could add a `runner = "jest"|"vitest"|...` param and a switching derivation.
- If no tests match patterns, Vitest runs with `--passWithNoTests`; the derivation still succeeds (useful for incremental adoption).
- Provider invalidation remains importer‑scoped via the lockfile label; importer‑local patch files are included in `srcs` so Buck recomputes only affected targets.

---

## Summary

This design adds a minimal, hermetic Node test runner that mirrors our existing Nix‑backed patterns (webapp/CLI, and C++ tests via external runner). It keeps policy centralized (flake + one private test rule), keeps Buck UX straightforward, and maintains importer scoping for precise invalidation. The PR sequence is small, low‑risk, and verifiable with focused zx tests.
