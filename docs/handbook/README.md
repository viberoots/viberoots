# Contributor Handbook

Use this index for day-to-day repo work. Build-system design references live under
[`../../build-tools/docs/README.md`](../../build-tools/docs/README.md).

## Start Here

- [`getting-started-on-a-pr.md`](getting-started-on-a-pr.md): PR workflow and validation habits.
- [`conventions.md`](conventions.md): repository conventions.
- [`tooling.md`](tooling.md): local tooling reference.
- [`testing.md`](testing.md): validation commands and expectations.
- [`ci.md`](ci.md): CI stage responsibilities.
- [`troubleshooting.md`](troubleshooting.md): common failures and fixes.

## Build-System Work

- [`patching.md`](patching.md): patch placement, scopes, and invalidation.
- [`provider-sync-cookbook.md`](provider-sync-cookbook.md): provider glue generation.
- [`macro-stamping-cookbook.md`](macro-stamping-cookbook.md): macro labels and exporter behavior.
- [`exporter-adapter-cookbook.md`](exporter-adapter-cookbook.md): exporter adapter expectations.
- [`adding-language.md`](adding-language.md): planner and provider integration patterns.
- [`starlark-api.md`](starlark-api.md): Starlark API reference.
- [`language-interop.md`](language-interop.md): language interop notes.

## Language Work

- [`new-language-walkthrough.md`](new-language-walkthrough.md): fast path for adding a language.
- [`adding-language.md`](adding-language.md): deeper reference for language integration.
- [`node-macros.md`](node-macros.md) and [`node-tests.md`](node-tests.md): Node-specific behavior.
- [`../../build-tools/docs/cpp-provider-sync-migration.md`](../../build-tools/docs/cpp-provider-sync-migration.md):
  C++ provider-sync status.

## History Archive

Historical plans, baselines, and gap ledgers live under
[`../history/`](../history/README.md). Current policy inventory remains in
[`nix-gaps.md`](nix-gaps.md).
