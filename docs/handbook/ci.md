# CI Handbook

CI runs zx-backed stages and does not commit generated glue.

## Stages (via tools/ci/run-stage.ts)

1. `export-graph`
2. `sync-providers-go`
3. `sync-providers-node` (optional)
4. `gen-auto-map`
5. `prebuild-guard`
6. `nix-build-graph-generator` (optional)
7. `buck-test`

Run locally with `CI=true tools/ci/run-stage.ts --stage <name>`.

## What each stage does (simple)

- **export-graph**: Freeze the configured Buck graph to `tools/buck/graph.json` so other steps read a stable view.
- **sync-providers-\***: Generate provider rules from patches (Go) or `pnpm-lock.yaml` (Node). Names are stable and deduped.
- **gen-auto-map**: Map targets → providers based on labels in the exported graph; keeps invalidation tight.
- **prebuild-guard**: Ensure glue exists and is fresh. Locally it can auto‑fix; CI fails fast with clear errors.
- **nix-build-graph-generator**: Build artifacts via Nix templates, warming the Nix store for the matrix.
- **buck-test**: Use Buck to decide what’s dirty, build on demand, and run impacted tests.

## Why keep a Nix build stage separate from Buck

- **Isolation**: If Nix templates or patch maps break, the failure shows up here with focused logs.
- **Caching**: Warms Nix outputs per architecture; Buck jobs mostly hit cache instead of re‑discovering derivations.
- **Signal**: Clear blame lines—if Nix is green but Buck fails, look at provider wiring/macros or test logic.

Locally you can use Buck alone. CI splits stages for speed and diagnostics across architectures.
