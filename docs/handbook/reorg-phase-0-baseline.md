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
- Buck target labels if `//lang` moves
- Script paths in `package.json`, `tools/bin/*`, `Jenkinsfile`, and `toolchains`
- Nix paths in `flake.nix` and `tools/nix/**`
- Repo-relative paths embedded in zx scripts under `tools/**`

## Root-level items to move

### Build system sources to `/build-tools`

- `tools/`
- `go/`
- `cpp/`
- `node/`
- `python/`
- `rust/`
- `lang/`
- `lang-design-docs/`

### Build-system reference docs to `/build-tools/docs`

- `build-system-design.md`
- `build-system-final-steps.md`
- `mapping-design.md`
- `nix-node-test.md`
- `nix-rename.md`
- `pnpm-label.md`
- `pnpm-exporter-adapter-prs.md`
- `go-cpp-local-patching.md`
- `node-cpp-addon-plan.md`
- `python-extension-design.md`
- `python-wasm-design.md`
- `uv2nix-design.md`
- `patch-in-uv2nix.md`
- `wasm-linking.md`
- `ts-cpp-go-wasm-plan.md`
- `scaf-go-test-design.md`
- `scaffolding.md`
- `remote-build-setup.md`

### Build-history docs to `/docs/build-history`

- `quad-alignment-*.md`
- `trio-alignment-*.md`
- `linking-plan-*.md`
- `cpp-go-cleanup-*.md`
- `cpp-gaps-plan.md`
- `remaining-go-build-dev-plan.md`

### Move or split

- `lang-refactor-2.md`
- `lang-refactor-3.md`
