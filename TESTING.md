# Testing

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

## Dev Build Modes (Pure vs Impure)

- Pure (CI-equivalent, default):
  - Uses a store-pinned Buck graph built via Nix (`nix build .#buck-graph`).
  - Example: `tools/dev/dev-build.ts build //...`

- Impure (fast local loop):
  - Regenerates `tools/buck/graph.json` from the live workspace and evaluates with `--impure`.
  - Example: `tools/dev/dev-build.ts --impure build //...`

CI should always use the pure path. Local development can opt into `--impure` for fast iteration.
```

## Verify prewarm (toolchains)

`tools/bin/verify` supports an optional, best-effort prewarm step for heavy Nix toolchains to reduce cold-start time. It never affects correctness and is skipped silently if a flake attribute is missing.

- Enabled by default: `VERIFY_PREWARM=1` (set `VERIFY_PREWARM=0` to disable)
- Prewarms by attempting to build these flake attrs when available:
  - `.#toolchains.go`
  - `.#toolchains.cxx`
  - `.#toolchains.emscripten`
  - `.#toolchains.tinygo`

Notes:

- Missing attributes are ignored without failing the run.
- You can customize the attribute list for local experiments by running the script directly:

```
PREWARM_ATTRS="toolchains.go,toolchains.cxx" node tools/dev/prewarm-toolchains.ts
```

## Faster temp workspaces (seed store)

Many zx tests run in a temporary copy of the workspace created via rsync. To speed this up without affecting correctness, the helper already excludes heavy or irrelevant directories. Notably, `test-logs/` is now excluded by default to avoid copying large artifacts from prior runs.

During `v`, verify prepares a single Nix-store seed and exports it to all tests:

- `BNX_TEST_SEED_STORE_PATH` points at the seed store path.
- `BNX_TEST_SEED_KEY` is exported for diagnostics.
- `BNX_TEST_SEED_PIN_DIR` is a GC root pinned for the verify run.

`runInTemp` requires `BNX_TEST_SEED_STORE_PATH` in verify mode and fails fast if it is missing or invalid. Outside verify, you can still set `BNX_TEST_SEED_STORE_PATH` explicitly.

- By default, the temp copy excludes common heavy paths (e.g., `buck-out`, `.git`, `node_modules`, `coverage`, `.direnv`, `test-logs/`), while keeping essentials like `flake.nix`.
- When you only need specific roots for a test, you can limit what is copied using `TEST_RSYNC_ROOTS` (comma or space separated).

Examples:

```
# Only copy the tools tree (plus flake.nix if present)
TEST_RSYNC_ROOTS=tools buck2 test //tools/tests/rsync:rsync_roots_only_tools_test_ts

# Multiple roots:
TEST_RSYNC_ROOTS="apps/demo,cpp,tools/nix" buck2 test //<target>
```

This optimization is best-effort and opt-in; tests remain deterministic regardless of whether `TEST_RSYNC_ROOTS` is set.
