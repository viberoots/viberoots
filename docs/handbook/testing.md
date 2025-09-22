# Testing Handbook

## Conventions

- One test per file.
- External timeouts: 300s per test, 300s for full suite.
- Use zx `#!/usr/bin/env zx-wrapper` for tests.
- Do not modify PATH inside tests; rely on the dev shell to supply tools.

## Coverage

- Enable: `COVERAGE=1` via Buck test executor `-- --env COVERAGE=1`.
- Open report: `pnpm coverage:open` after full run.

## Running

- Full: `timeout -k 10s 300s buck2 test //...`
- Specific: `buck2 test //<target>`
- Single-test external timeout (preferred): `gtimeout -k 10s 300s buck2 test //<target>` (or `timeout` on Linux)

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

- Build Go apps/libs via `nix build .#graph-generator --impure`.
- Locate binaries via `buck-go/manifest.json` (preferred) or `$out/bin` symlinks.
- Tests should prefer manifest-based discovery instead of Buck-only `go_library` resolution for third-party deps.

## Buck prelude alias

- Entering the dev shell (`nix develop`) writes `.buckconfig` with `[repositories] prelude = <nix-store>/prelude`, so loads like `@prelude//go:def.bzl` resolve automatically.
- If you run Buck outside the dev shell, ensure the alias exists (use the committed `.buckconfig` or configure the alias yourself).

## Prelude-gated tests

- Some integration/unit zx tests probe prelude availability with a `buck2 cquery` call.
- If the probe fails, they `SKIP` with a message instructing you to run in the dev shell.
