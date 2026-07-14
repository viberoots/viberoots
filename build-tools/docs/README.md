# Build Tools Documentation

This index points to current build-system references. Historical build-system plans, brainstorms,
roadmaps, and old implementation logs live under
[`../../docs/history/build-system/`](../../docs/history/build-system/).

Build-system-owned documentation lives here with the build tooling it describes. Repo-wide
contributor, deployment, control-plane, secrets, and ADR documentation lives under
[`../../docs/`](../../docs/README.md). App, library, and package-specific docs belong beside the
owning package under [`../../projects/`](../../projects/).

## Current References

Ordinary `i` and post-clone materialize from committed metadata without changing tracked files.
Stale pnpm, Go, uv, C++ provider/glue, or generated workspace-lock state fails closed, names the
stale file, and reports `repair: run u`. Source-mode or viberoots pin drift instead reports
`repair: run viberoots update`. A scaffold that creates dependency inputs must complete its
intentional prewarm/reconciliation step before read-only installation.

After an ordinary project dependency edit, run `u`, then `i && b && v`. Use `u --upgrade` only for
an intentional project dependency upgrade. Go, Python/uv, and C++ upgrades fail closed until those
ecosystems have a reviewed bounded upgrade policy; neither mode changes the viberoots pin.

- [`build-system-design.md`](build-system-design.md): main Buck2/Nix architecture reference.
- [`nixpkgs-source-selection-design.md`](nixpkgs-source-selection-design.md): design for
  target-scoped nixpkgs profiles and package-level nixpkgs pins.
- [`nixpkgs-source-selection-plan.md`](nixpkgs-source-selection-plan.md): implementation plan for
  target-scoped nixpkgs profiles and package-level nixpkgs pins.
- [`update-command-design.md`](update-command-design.md): design for `i`, `u`, `u --upgrade`, and
  `viberoots update` command authority.
- [`update-command-plan.md`](update-command-plan.md): implementation plan for the update command
  model.
- [`project-enforcement-pass-design.md`](project-enforcement-pass-design.md): design for early,
  consumer-scoped policy enforcement over `projects/`.
- [`project-enforcement-pass-plan.md`](project-enforcement-pass-plan.md): implementation plan for
  the project enforcement pass.
- [`scaffolding.md`](scaffolding.md): scaffolding behavior and supported generators.
- [`remote-build-setup.md`](remote-build-setup.md): remote-builder, cache, and Buck2 remote
  execution readiness guide.
- [`../../docs/aws-account-control-plane-and-remote-builds.md`](../../docs/aws-account-control-plane-and-remote-builds.md):
  fresh AWS account setup path that combines control-plane bootstrap with remote-build readiness.
- [`cpp-linking.md`](cpp-linking.md) and [`cpp-linking.examples.md`](cpp-linking.examples.md):
  C++ linking behavior.
- [`cpp/curated-providers.md`](cpp/curated-providers.md): C++ curated nixpkgs dependency usage.
- [`cpp/overlays.md`](cpp/overlays.md): C++ nixpkgs overlay and patch workflow.
- [`cpp-provider-sync-migration.md`](cpp-provider-sync-migration.md): current C++ provider-sync
  status.
- [`go-linking.md`](go-linking.md): Go linking behavior.
- [`pnpm/hermetic-node-modules.md`](pnpm/hermetic-node-modules.md): hermetic PNPM `node_modules`
  materialization.
- [`python-wasm-wasi.md`](python-wasm-wasi.md): Python WASM/WASI usage.
- [`wasm-linking.md`](wasm-linking.md) and [`wasm-node-linking.md`](wasm-node-linking.md): Wasm
  linking references.
- [`lang/README.md`](lang/README.md): language design enforcement requirements.

## Contributor Handbook

- [`../../docs/handbook/README.md`](../../docs/handbook/README.md): contributor workflow index.
- [`../../docs/handbook/provider-sync-cookbook.md`](../../docs/handbook/provider-sync-cookbook.md):
  provider-sync behavior.
- [`../../docs/handbook/patching.md`](../../docs/handbook/patching.md): patch placement and
  invalidation rules.
- [`../../docs/handbook/testing.md`](../../docs/handbook/testing.md): validation workflow.
- [`../../docs/handbook/starlark-api.md`](../../docs/handbook/starlark-api.md): Starlark API
  reference.

## Current Design References

These docs describe active contracts or implementation models:

- [`abstractions.md`](abstractions.md)
- [`mapping-design.md`](mapping-design.md)
- [`node-wasm-staging-contract-design.md`](node-wasm-staging-contract-design.md)

## History Archive

- [`../../docs/history/build-system/`](../../docs/history/build-system/): build-system plans,
  brainstorms, roadmaps, old language experiments, and implementation logs.
