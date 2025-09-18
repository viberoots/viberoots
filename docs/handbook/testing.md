# Testing Handbook

## Conventions

- One test per file.
- External timeouts: 40s per test, 180s for full suite.
- Use zx `#!/usr/bin/env zx-wrapper` for tests.

## Coverage

- Enable: `COVERAGE=1` via Buck test executor `-- --env COVERAGE=1`.
- Open report: `pnpm coverage:open` after full run.

## Running

- Full: `timeout -k 10s 180s buck2 test //...`
- Specific: `buck2 test //<target>`

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

## Buck prelude alias

- Entering the dev shell (`nix develop`) writes `.buckconfig` with `[repositories] prelude = <nix-store>/prelude`, so loads like `@prelude//go:def.bzl` resolve automatically.
- If you run Buck outside the dev shell, ensure the alias exists (use the committed `.buckconfig` or configure the alias yourself).
