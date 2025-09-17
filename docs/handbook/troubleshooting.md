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
