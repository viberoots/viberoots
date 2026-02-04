# CI Handbook

CI runs zx-backed stages and does not commit generated glue.

## Stages (via build-tools/tools/ci/run-stage.ts)

1. `export-graph`
2. `sync-providers` (unified orchestrator; per-language drivers run conditionally)
3. `gen-auto-map`
4. `prebuild-guard`
5. `nix-build-graph-generator` (optional)
6. `wheelhouse-preload` (Python; optional cache push)
7. `buck-test`

Run locally with `CI=true build-tools/tools/ci/run-stage.ts --stage <name>`.

## What each stage does (simple)

- **export-graph**: Freeze the configured Buck graph to `build-tools/tools/buck/graph.json` so other steps read a stable view.
- **sync-providers**: Unified orchestrator regenerates language providers and `third_party/providers/nix_attr_map.bzl` deterministically (Node is skipped when no PNPM lockfiles are present).
  - Provider naming is canonical and shared across languages via `build-tools/tools/lib/providers.ts`. Do not handcraft provider labels in docs or examples; prefer helpers: `providerNameForModuleKey`, `providerNameForImporter`.
- **gen-auto-map**: Map targets → providers based on labels in the exported graph; keeps invalidation tight.
- **prebuild-guard**: Ensure glue exists and is fresh. Locally it can auto‑fix; CI fails fast with clear errors.
  - Reference: `docs/handbook/troubleshooting.md#prebuild-guard-glue-presence--freshness`.
- **nix-build-graph-generator**: Build artifacts via Nix templates, warming the Nix store for the matrix.
- **wheelhouse-preload**: Builds Python wheelhouse outputs (`py-wheelhouse-*`) for any importers with `uv.lock`, and if `NIX_CACHE_TO` is set (or `--to` is passed), pushes the closures to a binary cache via `nix copy`.
  - Configure cache destination in CI via environment: `NIX_CACHE_TO=https://<cache-endpoint>`.
  - Safe no-op when no Python importers exist.
- **buck-test**: Use Buck to decide what’s dirty, build on demand, and run impacted tests.

## Why keep a Nix build stage separate from Buck

- **Isolation**: If Nix templates or patch maps break, the failure shows up here with focused logs.
- **Caching**: Warms Nix outputs per architecture; Buck jobs mostly hit cache instead of re‑discovering derivations.
- **Signal**: Clear blame lines—if Nix is green but Buck fails, look at provider wiring/macros or test logic.

Locally you can use Buck alone. CI splits stages for speed and diagnostics across architectures.
