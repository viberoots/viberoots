# Buck2 + Nix + Go Patching

This repo uses Buck2 for orchestration, Nix for hermetic builds, and zx TypeScript scripts for glue.

## Quick start

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

## CI

Jenkins runs zx-backed stages: export-graph → sync-providers → gen-auto-map → prebuild-guard → build & test → stale check. See `tools/ci/run-stage.ts`.

## Further reading

See `docs/handbook/` for patching, CI, adding languages, testing, troubleshooting, and conventions.
