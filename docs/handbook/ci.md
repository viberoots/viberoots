# CI Handbook

CI runs zx-backed stages and does not commit generated glue.

## Stages (via viberoots/build-tools/tools/ci/run-stage.sh)

1. `export-graph`
2. `sync-providers` (unified orchestrator; per-language drivers run conditionally)
3. `gen-auto-map`
4. `prebuild-guard`
5. `nix-build-graph-generator` (optional)
6. `wheelhouse-preload` (Python; optional cache push)
7. `buck-test`
8. `cpp-addon-smoke`

Run locally with `CI=true viberoots/build-tools/tools/ci/run-stage.sh --stage <name>`.

CI and local wrappers use the same default Nix cache policy as developer commands:
`VBR_NIX_CACHE_POLICY=auto` probes configured HTTP(S) substituters, disables unreachable configured
caches for the current process, keeps Nix fallback enabled, and continues locally. Use
`VBR_NIX_CACHE_POLICY=strict` only for cache-readiness lanes where cache reachability is the tested
behavior; use `VBR_NIX_CACHE_POLICY=off` only to skip the dynamic probe.

## What each stage does (simple)

- **export-graph**: Freeze the configured Buck graph to `.viberoots/workspace/buck/graph.json` so other steps read a stable view.
- **sync-providers**: Unified orchestrator regenerates language providers and `.viberoots/workspace/providers/nix_attr_map.bzl` deterministically (Node is skipped when no PNPM lockfiles are present).
  - Provider naming is canonical and shared across languages via `build-tools/tools/lib/providers.ts`. Do not handcraft provider labels in docs or examples; prefer helpers: `providerNameForModuleKey`, `providerNameForImporter`.
- **gen-auto-map**: Map targets → providers based on labels in the exported graph; keeps invalidation tight.
- **prebuild-guard**: Ensure glue exists and is fresh. Locally it can auto‑fix; CI fails fast with clear errors.
  - Reference: `docs/handbook/troubleshooting.md#prebuild-guard-glue-presence--freshness`.
- **nix-build-graph-generator**: Build artifacts via Nix templates, warming the Nix store for the matrix.
- **wheelhouse-preload**: Builds Python wheelhouse outputs (`py-wheelhouse-*`) for any importers with `uv.lock`, and when `--to` is passed, pushes the closures to a binary cache via `nix copy`.
  - Declare the cache destination in CI with `--to=https://<cache-endpoint>`.
  - Safe no-op when no Python importers exist.
- **buck-test**: Resolves the same requested scope as local `v`, then runs the selected Buck tests through verify target-pass planning. Documentation-only changes are not treated as build-system changes just because they live under `build-tools/**`; reviewed deployment/operator docs use their compact documentation contract bucket. Coverage mode still flows through `COVERAGE=1`; CI defaults remain local unless a future lane explicitly provides remote verify policy env.
- **cpp-addon-smoke**: Explicitly local-only direct Buck smoke stage for the temporary scaffold workspace. It scrubs broad `VBR_REMOTE_*` policy env before invoking Buck because the temp workspace does not yet carry the remote execution policy contract.

## Why keep a Nix build stage separate from Buck

- **Isolation**: If Nix templates or patch maps break, the failure shows up here with focused logs.
- **Caching**: Warms Nix outputs per architecture; Buck jobs mostly hit cache instead of re‑discovering derivations.
- **Signal**: Clear blame lines—if Nix is green but Buck fails, look at provider wiring/macros or test logic.

Locally you can use Buck alone. CI splits stages for speed and diagnostics across architectures.
