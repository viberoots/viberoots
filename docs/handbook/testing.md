# Testing Handbook

## Conventions

- One test per file.
- Prefer bounded commands for focused debugging. Full verify owns its own Buck, Nix, and test
  budgets and usually takes longer than a single external `timeout` wrapper.
- Use zx `#!/usr/bin/env zx-wrapper` for tests.
- Do not modify PATH inside tests; rely on the dev shell to supply tools.
- Source-inspection tests must resolve checked-out viberoots files with
  `viberootsSourcePath(...)` from
  `build-tools/tools/tests/lib/test-helpers/source-paths.ts`, not by reading
  `viberoots/...` relative to the process CWD. Tests may run from either the
  consumer workspace root, the viberoots checkout, or a copied temp checkout.
  Keep paths that intentionally address files inside `runInTemp(...)` workspaces
  relative to that temp root; use the helper only for reading checked-out source.

## Temp repos (`runInTemp`)

Many zx tests use `runInTemp(...)` (in `build-tools/tools/tests/lib/test-helpers.ts`) to execute in an isolated copy of the repo. During `v`, the verify runner prepares a **single** Nix-store seed and exports it to all tests:

- `VBR_TEST_SEED_STORE_PATH` points at the seed store path.
- `VBR_TEST_SEED_KEY` is exported for diagnostics.
- `VBR_TEST_SEED_PIN_DIR` is a GC root pinned for the verify run.

In verify mode, `runInTemp` requires `VBR_TEST_SEED_STORE_PATH` and fails fast if it is missing or invalid. Outside verify, you can still set `VBR_TEST_SEED_STORE_PATH` explicitly to reuse a seed.

`runInTemp` also verifies zx initialization using a `node --import <zx-init>` probe, but it does so **once per test worker** (not per temp repo). For debugging, you can force re-probing with:

- `TEST_FORCE_ZX_INIT_PROBE=1`

### Buck isolation in temp repos

Inside `runInTemp`, call plain `buck2 ...` by default. The temp-repo helper places a `buck2` shim first on `PATH`; the shim injects the registered temp Buck isolation automatically, so ordinary tests get verify registration, reaping, and final cleanup without per-test setup.

Use `inheritedBuckIsolation(...)` only when a test must spell `--isolation-dir` explicitly, for example when passing the isolation through a helper that cannot rely on `PATH`. Do not compute ad hoc isolation names from `tmp`, `process.pid`, `Date.now()`, or helper-generated suffixes inside `runInTemp`.

Independent nested Buck daemons are allowed only with a narrow `lint: allow-hardcoded-buck-isolation: <why this cannot reuse the registered isolation>` comment next to the command. The explanation must state why the registered temp isolation is not sufficient.

After a full `v` run, scan the live process table for leftover verify/temp Buck daemons and forkservers. A clean scan prints no rows:

```bash
ps -axo pid=,ppid=,command= |
  awk '/buck2d\[|\(buck2-forkserver\)/ && /viberoots-verify|viberoots-run-in-temp|verify-nested|zxtest-shared/ { print }'
```

The verify log should also include both final cleanup summaries, including
`final registered buck cleanup`, so the scan and cleanup accounting can be reviewed together.

## Coverage

- Enable: `COVERAGE=1` via Buck test executor `-- --env COVERAGE=1`.
- Preferred verify path: `ALL_TESTS=1 v --coverage`.
- Open report: `pnpm coverage:open` after a covered run.

## Timing analysis (`TEST_TIMING=summary`)

When you run `v` with `TEST_TIMING=summary`, zx tests that use `runInTemp(...)` will emit `[timing]` bucket summaries. At the end of the verify run, `v` appends an **aggregated** report into the verify log (comment-prefixed) by running:

- `viberoots/build-tools/tools/dev/analyze-verify-timing.ts`

This report includes:

- Total wall clock for the `buck2 test` phase (from verify’s `start_s` / `end_s` markers).
- Sum of per-test durations parsed from Buck completion lines (for an effective parallelism estimate).
- Aggregated `[timing]` bucket totals across the suite and estimated wall-clock impact per bucket.

## Verify status

Use `l --status`, `s`, or `tail-log --status` while `v` is running or after the
latest run completes. The text view reports elapsed/projected time, pass/fail/fatal/skip/build
failure counts, remaining tests, and GC detection. For multi-pass verify plans it can show both the
active pass group count and total test count in the `Tests:` row, plus `Pass group: <name>
(<index>/<total>)`.

Use `--json` when a script needs stable fields. The JSON line includes `pass_index`, `pass_total`,
`group_completed`, and `group_total` when pass-group data is available.

### Verify helper

- Default scoped verify:
  - `v`
- Force verify to run every Buck test, even when scope selection would narrow it:
  - `ALL_TESTS=1 v`
  - `ALL_TESTS=true v`
- Full suite with coverage (single merged report):
  - `ALL_TESTS=1 v --coverage`
- Focused target(s):
  - `v //<target>`
  - `v --coverage //<target>`

## Running

- Default PR loop: `i && b && v`
- Full suite: `i && b && ALL_TESTS=1 v`
- Specific: `buck2 test //<target>`
- Single-test external timeout (preferred): `timeout -k 10s 300s buck2 test //<target>`

Command ownership is part of the test contract:

- `i` and post-clone must not modify tracked metadata. They fail closed with `repair: run u` when
  committed dependency metadata is stale.
- `u` repairs dependency locks and derived metadata without intentionally moving versions;
  `u --upgrade` is the explicit project dependency upgrade path.
- `viberoots update` moves only viberoots submodule or flake pins plus required deterministic
  reconciliation. It must not upgrade project dependencies.
- A fresh recursive clone followed by post-clone must leave `git diff --exit-code` and
  `git status --short` clean when committed metadata is current.

Documentation-only changes are scoped separately from code changes. Markdown and reStructuredText
files do not count as build-system changes by themselves, including files below `build-tools/**`.
Active deployment/operator docs are still guarded: changes to those reviewed docs run the
deployment documentation contract bucket, not the full deployment domain.

Default scope selection reads committed changes from a merge-base diff and then unions in the dirty
worktree from `git status --porcelain=v1`. Merge-base candidates are `GITHUB_BASE_REF` when present,
then `github/main`, `origin/main`, and `main`; if none exist, verify falls back to `HEAD~1...HEAD`.

## Optional Nix caches

The local wrappers and Buck Nix actions use `VBR_NIX_CACHE_POLICY=auto` by default. They probe
configured HTTP(S) substituters, disable unreachable configured caches for the current process, keep
Nix fallback enabled, and continue locally. Use `VBR_NIX_CACHE_POLICY=strict` only when cache
availability is itself under test; use `VBR_NIX_CACHE_POLICY=off` to skip the dynamic probe.

## Nix GC preflight

Before Buck starts, `v` checks for active `nix store gc` / `nix-store --gc` processes. If GC is
active, verify writes a `nix gc preflight warning`, waits briefly, and fails before the test phase if
GC remains active. A status view with `GC detected: yes` means that run saw GC contention and should
not be used as clean timing evidence without a rerun.

## Development-shell closure guardrail

Development-shell and packaged `viberoots` closures must not retain the exact pnpm `node-modules`
output or export it through `NODE_PATH`. Keep the exact output available only through explicit
dependency attributes. Shell entry may probe and relink an already realized output, but it must not
build or reconcile one.

When this boundary changes, compare cold and immediate warm runs. Record elapsed time, filesystem
growth, new store paths, and the count of named large outputs before and after. The regression that
established this guardrail retained 5,278,293,400 bytes through an eager shell/command closure edge;
after removal, a cold exact development-shell build took 2 seconds, added 7,660 KiB, and kept the
named-output count at 12, while the warm repeat took 0 seconds and added no store paths.

## External runner helper (C++)

- For C++ tests and binaries built via the Nix planner, use the centralized helper:
  - `node viberoots/build-tools/tools/dev/build-selected.ts`
- It ensures `.viberoots/workspace/buck/graph.json` exists for the current workspace and runs:
  - `nix build .#graph-generator-selected` with `BUCK_TARGET` and `--accept-flake-config`
- Output: prints only the Nix out path on stdout; logs go to stderr. Buck macros call this helper under the hood.

Parity with Node:

- C++ ExternalRunner tests now reuse `nix_bootstrap_env_core()` and the external timeout wrapper from `//build-tools/lang:nix_shell.bzl` (default 10 minutes), matching Node test behavior.

## Nix-executing runner boilerplate (shared)

Rules and macros that execute `nix build` or `nix run` inside Buck actions must assemble their shell via shared helpers:

- `//build-tools/lang:nix_shell.bzl`: workspace and flake root bootstrap, timeout wrapper primitives.
- `//build-tools/lang:nix_action_runner.bzl`: common “runner” snippets (graph export, build-selected out path parsing, optional workspace-root injection).

Do not copy/paste shell fragments between languages. If you need to change the bootstrap or the build-selected invocation contract, update the shared helper and add or extend a cquery probe test under `build-tools/tools/tests/lang/`.

## zx tests overview

- Exporter tuple and cache:
  - `//:exporter_tuple_includes_goflags` — GOFLAGS become part of the tuple.
  - `//:exporter_tuple_includes_toolchain` — toolchain identity is included.
  - `//:exporter_tuple_cache_key_shifts_on_goflags` — cache key varies with GOFLAGS.
  - `//:exporter_cache_content_reuse` — identical batches reuse the cached go-list JSON without rewriting.

- Per-target configuration and wiring:
  - `//:exporter_per_target_platform_splits_batches` — GOOS/GOARCH split batches.
  - `//:exporter_test_only_deps_only_on_tests` — test-only deps label only test targets.
  - `//:e2e_provider_wiring` — provider mapping places module providers only on affected targets.

## Go dependencies (gomod2nix)

- After editing `go.mod` or `go.sum`, run:
  - `u` (regenerates `gomod2nix.toml` deterministically), then `i`
- Preview without changes:
  - `node viberoots/build-tools/tools/dev/install-deps.ts --dry-run`

## Nix-first runtime validation (Go)

- Build Go projects/apps/libs via `nix build .#graph-generator` (strict glue required; no planner fallback).
- Locate binaries via `buck-go/manifest.json` (preferred) or `$out/bin` symlinks.
- Tests should prefer manifest-based discovery instead of Buck-only `go_library` resolution for third-party deps.

## Buck prelude alias

- Entering the dev shell (`nix develop`) writes `.buckconfig` with `[repositories] prelude = <nix-store>/prelude`, so loads like `@prelude//build-tools/go:def.bzl` resolve automatically.
- If you run Buck outside the dev shell, ensure the alias exists (use the committed `.buckconfig` or configure the alias yourself).

## Prelude-gated tests

- Some integration/unit zx tests probe prelude availability with a `buck2 cquery` call.
- If the probe fails, they `SKIP` with a message instructing you to run in the dev shell.

## On-demand vs prebuild (what to do locally vs CI)

- **Local**: `u` refreshes dependency locks and derived metadata after edits; `i` validates committed
  metadata and materializes dependencies without changing tracked files. `b` runs the recursive Buck
  build, and `v` runs verify preflights plus the selected Buck test passes. Direct `buck2 test` and
  `buck2 build` still build on demand and can be useful for focused debugging.
- **CI**: We keep a separate Nix build stage to warm caches and isolate template/patch errors. Later Buck stages mostly hit cache and provide clean graph-level diagnostics.
