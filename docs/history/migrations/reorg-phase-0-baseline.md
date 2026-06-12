# Reorg Phase 0 Baseline Inventory

I am recording the baseline run list and a root-level inventory snapshot for the reorg work.

## Baseline run list

- `i`
- `b`
- `v`

## Baseline run outcomes

- `i`: pass
- `b`: pass
- `v`: pass

## Path-sensitive areas

- Buck `load()` paths in `**/*.bzl`
- Buck target labels if `//build-tools/lang` moves
- Script paths in `package.json`, `build-tools/tools/bin/*`, `Jenkinsfile`, and `toolchains`
- Nix paths in `flake.nix` and `build-tools/tools/nix/**`
- Repo-relative paths embedded in zx scripts under `build-tools/tools/**`

## Root-level items to move

### Build system sources to `/build-tools`

- `build-tools/tools/`
- `go/`
- `cpp/`
- `node/`
- `python/`
- `rust/`
- `build-tools/lang/`
- `build-tools/docs/lang/`

### Build-system reference docs to `/build-tools/docs`

- `build-tools/docs/build-system-design.md`
- `docs/history/designs/legacy/build-system-final-steps.md`
- `build-tools/docs/mapping-design.md`
- `docs/history/designs/legacy/nix-node-test.md`
- `docs/history/build-system/nix-rename.md`
- `docs/history/build-system/pnpm-label.md`
- `docs/history/designs/legacy/pnpm-exporter-adapter-prs.md`
- `docs/history/designs/legacy/go-cpp-local-patching.md`
- `build-tools/docs/node-cpp-addon-plan.md`
- `docs/history/designs/legacy/python-extension-design.md`
- `build-tools/docs/lang/python-wasm-design.md`
- `build-tools/docs/lang/uv2nix-design.md`
- `docs/history/designs/legacy/patch-in-uv2nix.md`
- `build-tools/docs/wasm-linking.md`
- `docs/history/build-system/ts-cpp-go-wasm-plan.md`
- `docs/history/designs/legacy/scaf-go-test-design.md`
- `build-tools/docs/scaffolding.md`
- `build-tools/docs/remote-build-setup.md`

### Build-history docs to `/docs/history/build-system/logs`

- `quad-alignment-*.md`
- `trio-alignment-*.md`
- `linking-plan-*.md`
- `cpp-go-cleanup-*.md`
- `cpp-gaps-plan.md`
- `remaining-go-build-dev-plan.md`

### Move or split

- `lang-refactor-2.md`
- `lang-refactor-3.md`
