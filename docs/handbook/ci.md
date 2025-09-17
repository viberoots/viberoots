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
