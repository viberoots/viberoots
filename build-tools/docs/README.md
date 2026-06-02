# Build Tools Documentation

This index separates current build-system references from plans and exploratory designs. Use the
current references for implementation work.

## Current References

- [`build-system-design.md`](build-system-design.md): main Buck2/Nix architecture reference.
- [`scaffolding.md`](scaffolding.md): scaffolding behavior and supported generators.
- [`remote-build-setup.md`](remote-build-setup.md): remote-builder, cache, and Buck2 remote
  execution readiness guide.
- [`cpp-linking.md`](cpp-linking.md) and [`cpp-linking.examples.md`](cpp-linking.examples.md):
  C++ linking behavior.
- [`go-linking.md`](go-linking.md): Go linking behavior.
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

## Active Designs And Roadmaps

These docs are design context. Confirm current behavior in code or current references before using
them as operating instructions:

- [`abstractions.md`](abstractions.md)
- [`mapping-design.md`](mapping-design.md)
- [`python-freshness.md`](python-freshness.md)
- [`uv2nix-design.md`](uv2nix-design.md)
- [`node-wasm-staging-contract-design.md`](node-wasm-staging-contract-design.md)
- [`linking-roadmap.md`](linking-roadmap.md)

## Historical Plans And Brainstorms

These files are implementation history or exploratory planning:

- [`build-system-brainstorming.md`](build-system-brainstorming.md)
- [`go-templates-dev-plan.md`](go-templates-dev-plan.md)
- [`go-templates-phase-1-design.md`](go-templates-phase-1-design.md)
- [`node-cpp-addon-plan.md`](node-cpp-addon-plan.md)
- [`ts-cpp-go-wasm-plan.md`](ts-cpp-go-wasm-plan.md)
- [`ts-cpp-go-web-brainstorming.md`](ts-cpp-go-web-brainstorming.md)
- [`wasm-node-plan.md`](wasm-node-plan.md)
- [`nix-rename.md`](nix-rename.md)
