# Testing

## Coverage policy (canonical)

Coverage is opt-in.

- Default local verification is coverage-off and scope-aware:
  - `i && b && v`
- Full pre-merge verification is coverage-off unless coverage is explicitly requested:
  - `i && b && ALL_TESTS=1 v`
- Direct Buck runs are useful for focused debugging, but they bypass verify preflights, scope
  diagnostics, seed preparation, and final cleanup:
  - `buck2 test //...`
- Enable coverage only when a PR, task, or CI job explicitly requires it:
  - `v --coverage`
  - `ALL_TESTS=1 v --coverage`
  - `buck2 test //... -- --env COVERAGE=1`

## Fast runs (default)

Coverage is disabled by default for speed. Plain `v` lets verify choose the appropriate scope from
the current change set. Set `ALL_TESTS=1` (also accepts `true`, `yes`, or `on`) when you need to
force `//...`.

Documentation has its own scope. Markdown and reStructuredText files are not treated as
build-system changes just because they live under `build-tools/**`. Reviewed deployment/operator
docs select a compact deployment documentation contract bucket instead of the full deployment
matrix.

Verify chooses its default scope from NUL-delimited structural merge-base diff and dirty-worktree
records. Base refs are resolved from `GITHUB_BASE_REF` when present, then `github/main`,
`origin/main`, and `main`; dirty, untracked, renamed, and deleted paths from
`git status --porcelain=v1 -z --untracked-files=all` are unioned with committed
`git diff --name-status -z --find-renames` paths. Both rename sides and UTF-8 special path
characters are preserved. Malformed or failed discovery selects conservatively; only successful
empty output means no changes. If you need broad coverage regardless of that selection, set
`ALL_TESTS=1`.

- Default scoped verify:

```
i && b && v
```

- Full verify:

```
i && b && ALL_TESTS=1 v
```

## Runs with coverage

Enable coverage explicitly by passing `COVERAGE=1` through Buck2's test executor arguments.

- Run all tests with coverage and generate reports in `coverage/`:

```
ALL_TESTS=1 v --coverage
```

- Print a summary to the console (after a covered run):

```
pnpm coverage:summary
```

- Open the HTML report (after a covered run):

```
pnpm coverage:open
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

## Artifact And Diagnostic Build Modes

- Hermetic (default when relevant untracked source is absent):
  - Evaluates the immutable source, graph, selection, dependency, and classification bundle.
  - Example: `build-tools/tools/dev/dev-build.ts build //...`

- Local development (automatic when relevant untracked source exists):
  - Captures relevant source in a filtered, content-addressed bundle and still evaluates purely.
  - The result is labeled non-release and protected publication jobs reject it.

- Diagnostic impurity (explicit only):
  - Regenerates the graph from the live workspace and evaluates with `--impure` for investigation.
  - Example: `build-tools/tools/dev/dev-build.ts --impure build //...`

Track relevant source before CI or publication. Use `d`, not diagnostic impurity, for normal live
watcher and hot-reload work.

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

`node build-tools/tools/dev/nix-gaps-inventory-check.ts --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions docs/handbook/nix-gaps-exceptions.json --command-site-policy docs/handbook/nix-command-site-policy.json`

The verify run fails fast if inventory, exception policy, or allowlist state drifts.
Before Buck starts, verify also checks for active `nix store gc` / `nix-store --gc` processes. It
logs `nix gc preflight` status, waits briefly if GC is active, and fails before the test phase if GC
does not stop.

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

## Optional Nix cache fallback

`i`, `b`, `v`, and Buck Nix actions probe configured HTTP(S) substituters through
`nix store info --store <substituter>` before using them. With the default
`VBR_NIX_CACHE_POLICY=auto`, unreachable configured HTTP(S) caches are removed from the current
process, Nix fallback stays enabled, and local builds continue. Logs look like:

```
[env] nix cache health: disabled unreachable substituter(s): https://...
[env] nix cache health: using optional substituter(s): <none>
```

Use `VBR_NIX_CACHE_POLICY=strict` only when cache reachability is the behavior under test. Use
`VBR_NIX_CACHE_POLICY=off` to skip the dynamic cache probe entirely.

## Verify status output

Use `l --status`, `build-tools/tools/bin/tail-log --status`, or `s` to inspect the current or latest
verify run. Text status can show both the active pass group and total suite progress, for example
`Tests: [..] 12/40, 120/900`, plus `Pass group: resource-limited (2/3)`. JSON status exposes the
same fields as `pass_index`, `pass_total`, `group_completed`, and `group_total`. `GC detected: yes`
means the verify log included a GC preflight warning; treat that run as potentially contended before
using timing evidence.

## Verify remote execution policy

`v` is local by default. Remote execution is opt-in and validated before local-only setup such as housekeeping, seed preparation, prewarm, and coverage directories.

Set:

- `VBR_REMOTE_EXEC_MODE=local|hybrid|remote|remote-only-conformance`
- `VBR_REMOTE_BUCK_CONFIG=<absolute generated .buckconfig path>`
- `VBR_REMOTE_EXEC_SYSTEM=x86_64-linux|aarch64-linux|aarch64-darwin`
- `VBR_REMOTE_ARTIFACT_DIR=<absolute artifact directory>`
- `VBR_REMOTE_TEST_ACTIVATION_DIR=<absolute activation directory>`
- `VBR_REMOTE_CI_TOOLS=<immutable remote-ci-tools store path>`
- `VBR_REMOTE_BUILDER_TRANSPORT=<absolute mode-0600 nofollow SSH transport JSON path>`
- `VBR_REMOTE_PROBE_FLAKE=<immutable probe flake store path>`
- `VBR_REMOTE_BUILDER_IDENTITY=<reviewed builder identity>`
- `VBR_REMOTE_REVIEWED_BUILDERS=<immutable reviewed-builder registry path>`
- `VBR_REMOTE_TEST_PROFILE_<PASS_NAME>=<profile>` for optional pass-specific profiles

System names map to profile prefixes: `x86_64-linux` to `linux-x86_64`, `aarch64-linux` to `linux-aarch64`, and `aarch64-darwin` to `darwin-aarch64`. Remote mode rejects `--coverage` until raw coverage outputs are declared per test and verify can materialize them locally for `pnpm coverage:build`. Local `v --coverage` still writes raw V8 coverage under `buck-out/tmp/node-v8-coverage` and merged reports under `coverage/`.

Before admitting a target with a remote Nix builder policy, the same `v` invocation runs the canonical remote-builder smoke with these immutable inputs. Saved smoke reports are audit artifacts, not reusable admission capabilities.

The reviewed registry contains only a credential-free endpoint identity. SSH users, key paths, and
other runtime transport data belong only in `VBR_REMOTE_BUILDER_TRANSPORT`; verify rejects symlinks,
group/world permissions, and transports whose host or port differs from the reviewed endpoint.

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
