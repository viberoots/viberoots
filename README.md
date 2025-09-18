# Buck2 + Nix + Go Patching

This repo uses Buck2 for orchestration, Nix for hermetic builds, and zx TypeScript scripts for glue.

## Quick start

- Enter dev shell (recommended)
  - `nix develop`
  - Note: the dev shell writes `.buckconfig` with `[repositories] prelude = <nix-store>/prelude`, enabling loads like `@prelude//go:def.bzl`. If you run Buck outside the dev shell, ensure this alias exists (use the committed `.buckconfig` or set the alias yourself).
- Run tests
  - Full: `timeout -k 10s 180s buck2 test //...`
  - Targeted: `buck2 test //<target>`
- Regenerate glue locally
  - `tools/ci/run-stage.ts --stage export-graph`
  - `tools/ci/run-stage.ts --stage sync-providers-go`
  - `tools/ci/run-stage.ts --stage gen-auto-map`
  - `tools/ci/run-stage.ts --stage prebuild-guard`

## Go dependencies (gomod2nix)

- After editing `go.mod` or `go.sum`, run `node tools/dev/install-deps.ts` to regenerate `gomod2nix.toml`.
- Use `--dry-run` to preview the command without changes.

## Patching (Go)

- Start: `tools/bin/patch-pkg start go <importPath>`
- Apply: `tools/bin/patch-pkg apply go <importPath>`
- Reset: `tools/bin/patch-pkg reset go <importPath>`

Patches live at `patches/go/<encodedImport>@<version>.patch` (flat). One patch per `module@version`.

Dev overrides warn locally and fail in CI.

## Prebuild guard

Before Buck builds, the prebuild guard ensures required glue exists and is fresh. Locally it auto-fixes by default; in CI it fails fast if glue is missing or stale.

- Local: run `node tools/buck/prebuild-guard.ts` to generate glue in order: export-graph → sync-providers → gen-auto-map.
- Env toggles:
  - `PREBUILD_GUARD_NO_FIX=1` to warn without auto-fixing locally.
  - `PREBUILD_GUARD_VERBOSE=1` to print top newer inputs and older outputs.
  - `PREBUILD_GUARD_SKEW_MS` and `PREBUILD_GUARD_LIST_LIMIT` to adjust freshness sensitivity and listing size.

For details, see `docs/handbook/troubleshooting.md`.

## CI

Jenkins runs zx-backed stages: export-graph → sync-providers → gen-auto-map → prebuild-guard → build & test. See `tools/ci/run-stage.ts`.

## Further reading

See `docs/handbook/` for patching, CI, adding languages, testing, troubleshooting, and conventions.
