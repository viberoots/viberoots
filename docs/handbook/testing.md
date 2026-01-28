# Testing Handbook

## Conventions

- One test per file.
- External timeouts: 300s per test, 300s for full suite.
- Use zx `#!/usr/bin/env zx-wrapper` for tests.
- Do not modify PATH inside tests; rely on the dev shell to supply tools.

## Temp repos (`runInTemp`)

Many zx tests use `runInTemp(...)` (in `tools/tests/lib/test-helpers.ts`) to execute in an isolated copy of the repo. During `v`, the verify runner prepares a **single** Nix-store seed and exports it to all tests:

- `BNX_TEST_SEED_STORE_PATH` points at the seed store path.
- `BNX_TEST_SEED_KEY` is exported for diagnostics.
- `BNX_TEST_SEED_PIN_DIR` is a GC root pinned for the verify run.

In verify mode, `runInTemp` requires `BNX_TEST_SEED_STORE_PATH` and fails fast if it is missing or invalid. Outside verify, you can still set `BNX_TEST_SEED_STORE_PATH` explicitly to reuse a seed.

`runInTemp` also verifies zx initialization using a `node --import <zx-init>` probe, but it does so **once per test worker** (not per temp repo). For debugging, you can force re-probing with:

- `TEST_FORCE_ZX_INIT_PROBE=1`

## Coverage

- Enable: `COVERAGE=1` via Buck test executor `-- --env COVERAGE=1`.
- Open report: `pnpm coverage:open` after full run.

## Timing analysis (`TEST_TIMING=summary`)

When you run `tools/bin/verify` with `TEST_TIMING=summary`, zx tests that use `runInTemp(...)` will emit `[timing]` bucket summaries. At the end of the verify run, `tools/bin/verify` appends an **aggregated** report into the verify log (comment-prefixed) by running:

- `tools/dev/analyze-verify-timing.ts`

This report includes:

- Total wall clock for the `buck2 test` phase (from verify’s `start_s` / `end_s` markers).
- Sum of per-test durations parsed from Buck completion lines (for an effective parallelism estimate).
- Aggregated `[timing]` bucket totals across the suite and estimated wall-clock impact per bucket.

### Verify helper

- Full suite without coverage:
  - `tools/bin/verify`
- Full suite with coverage (single merged report):
  - `tools/bin/verify --coverage`
- Focused target(s):
  - `tools/bin/verify //<target>` (40s external timeout per focused run)
  - `tools/bin/verify --coverage //<target>`

## Running

- Full: `timeout -k 10s 300s buck2 test //...`
- Specific: `buck2 test //<target>`
- Single-test external timeout (preferred): `timeout -k 10s 300s buck2 test //<target>`

## External runner helper (C++)

- For C++ tests and binaries built via the Nix planner, use the centralized helper:
  - `node tools/dev/build-selected.ts` (or `nix run .#zx-wrapper -- tools/dev/build-selected.ts`)
- It ensures `tools/buck/graph.json` exists for the current workspace and runs:
  - `nix build .#graph-generator-selected` with `BUCK_TARGET` and `--accept-flake-config`
- Output: prints only the Nix out path on stdout; logs go to stderr. Buck macros call this helper under the hood.

Parity with Node:

- C++ ExternalRunner tests now reuse `nix_bootstrap_env_core()` and the external timeout wrapper from `//lang:nix_shell.bzl` (default 10 minutes), matching Node test behavior.

## Nix-executing runner boilerplate (shared)

Rules and macros that execute `nix build` or `nix run` inside Buck actions must assemble their shell via shared helpers:

- `//lang:nix_shell.bzl`: workspace and flake root bootstrap, timeout wrapper primitives.
- `//lang:nix_action_runner.bzl`: common “runner” snippets (graph export, build-selected out path parsing, optional workspace-root injection).

Do not copy/paste shell fragments between languages. If you need to change the bootstrap or the build-selected invocation contract, update the shared helper and add or extend a cquery probe test under `tools/tests/lang/`.

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
  - `node tools/dev/install-deps.ts` (regenerates `gomod2nix.toml` deterministically)
- Preview without changes:
  - `node tools/dev/install-deps.ts --dry-run`

## Nix-first runtime validation (Go)

- Build Go apps/libs via `nix build .#graph-generator` (strict glue required; no planner fallback).
- Locate binaries via `buck-go/manifest.json` (preferred) or `$out/bin` symlinks.
- Tests should prefer manifest-based discovery instead of Buck-only `go_library` resolution for third-party deps.

## Buck prelude alias

- Entering the dev shell (`nix develop`) writes `.buckconfig` with `[repositories] prelude = <nix-store>/prelude`, so loads like `@prelude//go:def.bzl` resolve automatically.
- If you run Buck outside the dev shell, ensure the alias exists (use the committed `.buckconfig` or configure the alias yourself).

## Prelude-gated tests

- Some integration/unit zx tests probe prelude availability with a `buck2 cquery` call.
- If the probe fails, they `SKIP` with a message instructing you to run in the dev shell.

## On-demand vs prebuild (what to do locally vs CI)

- **Local**: Buck already builds on-demand. Run `buck2 test` or `buck2 build` and it will invoke Nix derivations as needed. You can skip the separate Nix stage if you prefer.
- **CI**: We keep a separate Nix build stage to warm caches and isolate template/patch errors. Later Buck stages mostly hit cache and provide clean graph-level diagnostics.
