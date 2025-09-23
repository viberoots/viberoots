# Troubleshooting

## Missing auto_map or graph

- Run:
  - `tools/ci/run-stage.ts --stage export-graph`
  - `tools/ci/run-stage.ts --stage gen-auto-map`
  - `tools/ci/run-stage.ts --stage prebuild-guard`

## Overrides in CI

- Ensure `NIX_GO_DEV_OVERRIDE_JSON` is unset. Locally, use `tools/dev/clear-overrides.ts`.

## Duplicate/malformed patches

## Go import lookup errors (vendor mode)

- Symptom: `import lookup disabled by -mod=vendor` or `go.mod not found`.
- Cause: builder working directory not at module root, or vendor mode assumptions.
- Fix:
  - Ensure `tools/nix/lang-templates.nix` sets `pwd`/`modRoot` to the module root and `subPackages` as documented (apps: `cmd/<name>`, libs: `.`).
  - Regenerate glue and rebuild via Nix (`nix build .#graph-generator`).

## Manifest missing or empty

- Symptom: tests cannot find binaries or `manifest.json` is empty.
- Fix:
  - Run glue: `node tools/buck/export-graph.ts` → `node tools/buck/sync-providers.ts` → `node tools/buck/gen-auto-map.ts`.
  - Ensure `gomod2nix.toml` exists at repo root (copy from the authoritative module lock).
  - Inspect `$out/build.log` for target keys and bin discovery.

## No vendoring guard fails

- Symptom: CI test `linting_no_vendored_go` fails with `.go` files under `third_party/go`.
- Fix: remove vendored files; do not copy from `GOMODCACHE`. Third‑party is resolved by Nix and `gomod2nix.toml`.

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
  - `PREBUILD_GUARD_VERBOSE=1`: print top offenders for freshness (newer inputs and older outputs). Equivalent to `--verbose`.
  - `PREBUILD_GUARD_SKEW_MS=2000`: allowed mtime skew in milliseconds before glue is considered stale.
  - `PREBUILD_GUARD_LIST_LIMIT=5`: number of files listed when verbose; can be overridden by `--verbose-limit`.

- CLI diagnostics
  - Verbose: `node tools/buck/prebuild-guard.ts --verbose --verbose-limit 10`
  - JSON: `node tools/buck/prebuild-guard.ts --json > guard.json`

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

### Glue regeneration (quick reference)

- Local sequence (not committed): export-graph → sync-providers → gen-auto-map.
  - Run `node tools/buck/export-graph.ts --out tools/buck/graph.json`
  - Run `node tools/buck/sync-providers.ts`
  - Run `node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`
  - Or run `node tools/dev/install-deps.ts` (dev shell) which chains them for you.
- CI sequence: the same steps as separate stages before build/test.

### Prelude-gated tests (dev shell)

- Some zx tests probe `@prelude` availability using `buck2 cquery`.
- If unavailable, the test prints a SKIP message and exits early; enter the dev shell and re-run.
- See Testing handbook for external timeouts and coverage.

### Exporter metrics (optional)

- You can ask the exporter to write a small JSON metrics file for observability.
- Usage: `node tools/buck/export-graph.ts --out tools/buck/graph.json --metrics-out tools/buck/export-metrics.json`
- The metrics write is best-effort and does not change export behavior.
