# Troubleshooting

## Missing auto_map or graph

- Run:
  - `tools/ci/run-stage.ts --stage export-graph`
  - `tools/ci/run-stage.ts --stage gen-auto-map`
  - `tools/ci/run-stage.ts --stage prebuild-guard`

## Overrides in CI

- Ensure `NIX_GO_DEV_OVERRIDE_JSON` is unset. Locally, use `tools/dev/clear-overrides.ts`.

## Duplicate/malformed patches

- Ensure one patch per `module@version`; file name must be `<encodedImport>@<version>.patch`.

## Exporter simulate vs authoritative

- For hermetic tests, use `--simulate`. CI uses authoritative mode.

### Prebuild guard (glue presence & freshness)

The prebuild guard verifies that generated glue files exist and are fresh relative to their inputs.

- What it checks
  - Presence: `tools/buck/graph.json`, `third_party/providers/auto_map.bzl`, and any `third_party/providers/TARGETS*.auto` files (when patches or lockfiles exist).
  - Freshness: compares newest input (any `TARGETS`, `*.bzl`, `patches/**/*.patch`, or `**/pnpm-lock.yaml`) against the oldest glue output, with an allowed skew.

- Local behavior
  - Default: auto-fixes glue by running generation in order: export-graph → sync-providers → gen-auto-map.
  - Warnings only: set `PREBUILD_GUARD_NO_FIX=1` to disable auto-fix; guard will print WARN lines instead.

- CI behavior
  - Fails fast with `ERROR:` lines on missing or stale glue. Use the CI stages (Export Graph → Sync Providers → Generate auto_map) to refresh glue.

- Environment variables
  - `PREBUILD_GUARD_NO_FIX=1`: disable local auto-fix; print WARN lines instead (CI always fails).
  - `PREBUILD_GUARD_VERBOSE=1`: print top offenders for freshness (newer inputs and older outputs).
  - `PREBUILD_GUARD_SKEW_MS=2000`: allowed mtime skew in milliseconds before glue is considered stale.
  - `PREBUILD_GUARD_LIST_LIMIT=5`: number of files listed when verbose.

- Typical commands
  - Local auto-fix: `node tools/buck/prebuild-guard.ts`
  - CI sequencing: run the three glue steps explicitly before building or testing.

### Patches lint

Validate patch filenames and directory shape to prevent cache/key churn and misapplied patches.

- Rules (Go)
  - Files must be flat under `patches/go/` (no subdirectories).
  - Filenames must be `<importPath-encoded>@<version>.patch` with `/` encoded as `__`.
  - Exactly one patch per `module@version` (case-insensitive).
  - Non-`.patch` files under `patches/go/` are violations (e.g., `.gitkeep`).

- Usage
  - Advisory (default): `node tools/dev/patches-lint.ts`
  - Strict (CI/hooks): `node tools/dev/patches-lint.ts --strict`
  - JSON output: `node tools/dev/patches-lint.ts --format json`
  - Scope language: `node tools/dev/patches-lint.ts --lang go`

- Exit policy
  - Advisory: prints diagnostics and exits 0.
  - Strict: exits 1 if any violations.
