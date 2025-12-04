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
