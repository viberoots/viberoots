## Getting Started on a PR — Practical Guide for This Repository

This guide helps a new contributor land any PR in this plan successfully, following our rules, methodology, and build-system design.

### 1. Environment setup (direnv + dev shell)

- Ensure direnv is active in your shell and permitted for the repo:
  - `direnv allow` (once per clone), verify it loads automatically in new shells
- Quick checks (must succeed):
  - `nix --version`, `buck2 --version`, `go version`, `node --version`, `pnpm --version`
  - `nix show-config` includes experimental features (flakes, dynamic-derivations, recursive-nix)
- Optional: run our startup check if present (prints clear hints):
  - `node tools/dev/startup-check.ts`

### 2. Project rules you must follow

- Follow `@METHODOLOGY.XML` and `@build-system-design.md` at all times.
- Never commit without verifying that all tests are wired and passing (full suite with coverage):
  - `buck2 test //... -- --env COVERAGE=1`
- Use Conventional Commits and real newlines in commit messages.
- Keep files small and focused (≤ 250 lines ideally); split modules when needed.
- Maintain determinism and low cyclomatic complexity; prefer small, well-named functions.
- Prefer shared CLI helpers when parsing flags in zx scripts:
  - Use `tools/lib/cli.ts` (`getFlagStr`, `getFlagBool`, `getFlagList`) instead of bespoke parsing.

### 3. Commands cheat sheet

- Build/test:
  - Full test with coverage: `buck2 test //... -- --env COVERAGE=1`
  - Single target build/test: `buck2 build //<pkg>:<name>`, `buck2 test //<pkg>:<name>`
- Glue generation (when working on providers/labels mappings):
  - Export graph: `node tools/buck/export-graph.ts`
  - Sync providers: `node tools/buck/sync-providers.ts`
  - Sync Node providers: `node tools/buck/sync-providers-node.ts`
  - Sync specific language: `node tools/buck/sync-providers.ts --lang node`
  - Generate auto_map: `node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`
  - Prebuild guard (freshness/presence): `node tools/buck/prebuild-guard.ts [--verbose|--json]`
  - Note: touching any `pnpm-lock.yaml` requires re-running provider sync + auto_map; the guard will fail in CI if importer entries are missing and auto-fix locally unless `PREBUILD_GUARD_NO_FIX=1`.
- Nix builds (planner outputs):
  - `
