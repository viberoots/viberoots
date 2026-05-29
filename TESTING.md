# Testing

## Coverage policy (canonical)

Coverage is opt-in.

- Default local and pre-merge verification runs use coverage-off commands:
  - `i && b && v`
  - `buck2 test //...`
- Enable coverage only when a PR, task, or CI job explicitly requires it:
  - `v --coverage`
  - `buck2 test //... -- --env COVERAGE=1`

## Fast runs (default)

Coverage is disabled by default for speed.

- Run all tests:

```
buck2 test //...
```

## Runs with coverage

Enable coverage explicitly by passing `COVERAGE=1` through Buck2's test executor arguments.

- Run all tests with coverage and generate reports in `coverage/`:

```
buck2 test //... -- --env COVERAGE=1
```

- Print a summary to the console (after a covered run):

```
pnpm coverage:summary
```

- Open the HTML report (after a covered run):

```
open coverage/lcov-report/index.html  # macOS
# or use the coverage:summary script with --open-browser
pnpm coverage:summary --open-browser
```

Notes:

- Coverage uses raw V8 output from test processes and aggregates via `c8`.
- Reports land in `coverage/` and are Git-ignored.
- For CI, prefer enabling coverage in specific jobs rather than always-on.

## Running subsets and multiple targets

- Run a single Buck target:

```
buck2 test //:scaffolding_smoke
```

- Run several specific targets:

```
buck2 test //:scaffolding_smoke //:scaffolding_help
```

- Filter at the shell level (only scaffolding targets):

```
buck2 test $(buck2 targets //:scaffolding_* | tr '\n' ' ')
```

- Enable coverage for those runs as needed:

```
buck2 test //:scaffolding_help -- --env COVERAGE=1
```

## Dev Build Modes (Pure vs Impure)

- Pure (CI-equivalent, default):
  - Uses a store-pinned Buck graph built via Nix (`nix build .#buck-graph`).
  - Example: `build-tools/tools/dev/dev-build.ts build //...`

- Impure (fast local loop):
  - Regenerates `build-tools/tools/buck/graph.json` from the live workspace and evaluates with `--impure`.
  - Example: `build-tools/tools/dev/dev-build.ts --impure build //...`

CI should always use the pure path. Local development can opt into `--impure` for fast iteration.

```

## Runnable target commands

Use runnable contracts for developer execution instead of assuming `bin/*` exists for every app target.

- Production-style run:
  - `r //<pkg>:<target>`
- Development-mode run (when `run.dev` exists):
  - `d //<pkg>:<target>`

If a target does not publish `run.dev`, `d` fails with a deterministic error.

## Verify prewarm (toolchains)

`build-tools/tools/bin/verify` supports an optional, best-effort prewarm step for heavy Nix toolchains to reduce cold-start time. It never affects correctness and is skipped silently if a flake attribute is missing.

`v` also runs a required policy preflight that executes:

`node build-tools/tools/dev/nix-gaps-inventory-check.ts --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions docs/handbook/nix-gaps-exceptions.json`

The verify run fails fast if inventory, exception policy, or allowlist state drifts.

- Enabled by default: `VERIFY_PREWARM=1` (set `VERIFY_PREWARM=0` to disable)
- Prewarms by attempting to build these flake attrs when available:
  - `.#toolchains.go`
  - `.#toolchains.cxx`
  - `.#toolchains.emscripten`
  - `.#toolchains.tinygo`
- Heavy toolchains (`toolchains.go`, `toolchains.python`) are skipped unless `PREWARM_HEAVY=1`.

Notes:

- Missing attributes are ignored without failing the run.
- You can customize the attribute list for local experiments by running the script directly:

```

PREWARM_ATTRS="toolchains.go,toolchains.cxx" node build-tools/tools/dev/prewarm-toolchains.ts

```

## Verify remote execution policy

`v` is local by default. Remote execution is opt-in and validated before local-only setup such as housekeeping, seed preparation, prewarm, and coverage directories.

Set:

- `VBR_REMOTE_EXEC_MODE=local|hybrid|remote|remote-only-conformance`
- `VBR_REMOTE_BUCK_CONFIG=<absolute generated .buckconfig path>`
- `VBR_REMOTE_EXEC_SYSTEM=x86_64-linux|aarch64-linux|aarch64-darwin`
- `VBR_REMOTE_ARTIFACT_DIR=<absolute artifact directory>`
- `VBR_REMOTE_TEST_PROFILE_<PASS_NAME>=<profile>` for optional pass-specific profiles

System names map to profile prefixes: `x86_64-linux` to `linux-x86_64`, `aarch64-linux` to `linux-aarch64`, and `aarch64-darwin` to `darwin-aarch64`. Remote mode rejects `--coverage` until declared coverage artifacts are implemented.

Local verify keeps the full local Buck process and test environment so existing tests continue to see seed-store paths, nested Buck daemon controls, local Nix daemon settings, local coverage output, and developer diagnostics. Remote verify uses separate Buck process and test child environment allowlists. It forwards only timeouts, `COVERAGE=0`, the nested Buck isolation name, generated remote-safe Nix/Pnpm inputs, pinned tool paths, and known certificate paths. It does not forward repo-root `buck-out`, `.direnv`, root `node_modules`, local seed pin directories, `NODE_V8_COVERAGE`, Nix daemon sockets, `TEST_RSYNC_ROOTS`, or developer override env vars.

When adding a Nix `allowed-impure-env-vars` value in `flake.nix` or `build-tools/tools/nix/flake/nix-config.nix`, classify it in `build-tools/tools/dev/verify/buck2-test-env-policy.ts` as remote-safe or local-only. Remote-safe values must be represented by declared source snapshots, graph artifacts, materialization manifests, Nix-store paths, or per-target policy fields. Local-only values must not be forwarded to remote test actions.

## Faster temp workspaces (seed store)

Many zx tests run in a temporary copy of the workspace created via rsync. To speed this up without affecting correctness, the helper already excludes heavy or irrelevant directories. Notably, `test-logs/` is now excluded by default to avoid copying large artifacts from prior runs.

During `v`, verify prepares a single Nix-store seed and exports it to all tests:

- `VBR_TEST_SEED_STORE_PATH` points at the seed store path.
- `VBR_TEST_SEED_KEY` is exported for diagnostics.
- `VBR_TEST_SEED_PIN_DIR` is a GC root pinned for the verify run.

`runInTemp` requires `VBR_TEST_SEED_STORE_PATH` in verify mode and fails fast if it is missing or invalid. Outside verify, you can still set `VBR_TEST_SEED_STORE_PATH` explicitly.

- Inside `runInTemp`, prefer plain `buck2 ...`; the helper shim injects the registered temp Buck isolation automatically.
- Use `inheritedBuckIsolation(...)` only when a test must pass `--isolation-dir` explicitly.
- Do not compute ad hoc nested Buck isolation names inside `runInTemp` unless an adjacent `lint: allow-hardcoded-buck-isolation: <why>` comment explains why the registered isolation cannot be reused.
- After a full `v` run, scan for leftover verify/temp Buck processes with `ps -axo pid=,ppid=,command= | awk '/buck2d\\[|\\(buck2-forkserver\\)/ && /viberoots-verify|viberoots-run-in-temp|verify-nested|zxtest-shared/ { print }'`. A clean scan prints no rows.

- By default, the temp copy excludes common heavy paths (e.g., `buck-out`, `.git`, `node_modules`, `coverage`, `.direnv`, `test-logs/`), while keeping essentials like `flake.nix`.
- When you only need specific roots for a test, you can limit what is copied using `TEST_RSYNC_ROOTS` (comma or space separated).

Examples:

```

# Only copy the tools tree (plus flake.nix if present)

TEST_RSYNC_ROOTS=tools buck2 test //build-tools/tools/tests/rsync:rsync_roots_only_tools_test_ts

# Multiple roots:

TEST_RSYNC_ROOTS="apps/demo,cpp,build-tools/tools/nix" buck2 test //<target>

```

This optimization is best-effort and opt-in; tests remain deterministic regardless of whether `TEST_RSYNC_ROOTS` is set.
```
