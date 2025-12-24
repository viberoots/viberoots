## Getting Started on a PR — Practical Guide for This Repository

This guide helps a new contributor land any PR in this plan successfully, following our rules, methodology, and build-system design.

### 1. Environment setup (direnv + dev shell)

- Ensure direnv is active in your shell and permitted for the repo:
  - `direnv allow` (once per clone), verify it loads automatically in new shells
- Quick checks (must succeed):
  - `nix --version`, `buck2 --version`, `go version`, `node --version`, `pnpm --version`
  - `python3 --version`, `uv --version` ← required for Python enablement
  - `nix show-config` includes experimental features (flakes, dynamic-derivations, recursive-nix)
- Optional: run our startup check if present (prints clear hints):
  - `node tools/dev/startup-check.ts`

Note on Python lockfiles: The initial Python rollout is uv‑only. Poetry/pip‑tools are out of scope unless/until a future PR adds them. See `lang-design-docs/python-design.md` (PR‑17) for details.
Python provider sync activation in sparse/partial clones is lockfile‑driven: the presence of an `uv.lock` under `apps/*` or `libs/*` enables Python providers.

### 2. Project rules you must follow

- Follow `@METHODOLOGY.XML` and `@build-system-design.md` at all times.
- Never commit without verifying that all tests are wired and passing (full suite with coverage):
  - `buck2 test //... -- --env COVERAGE=1`
- Use Conventional Commits and real newlines in commit messages.
- Keep files small and focused (≤ 250 lines ideally); split modules when needed.
- Maintain determinism and low cyclomatic complexity; prefer small, well-named functions.
- Follow the tooling rules in `docs/handbook/tooling.md`:
  - Use `tools/lib/cli.ts` for CLI parsing (no bespoke `process.argv` parsing).
  - Use `tools/lib/node-run.ts` (`runNodeWithZx`) when one tool invokes another zx script.
- Nix attr alias source of truth: `tools/lib/nix-attr-aliases.json`. Starlark mirror is generated (dev/test-time) via:
  - `node tools/dev/gen-nix-attr-aliases-bzl.ts` → writes `lang/nix_attr_aliases.bzl`. A stub exists and runtime does not depend on generation; behavior is unchanged for current aliases.

### 3. Commands cheat sheet

- Build/test:
  - Full test with coverage: `buck2 test //... -- --env COVERAGE=1`
  - Single target build/test: `buck2 build //<pkg>:<name>`, `buck2 test //<pkg>:<name>`
- Glue generation (when working on providers/labels mappings):
  - Run full glue pipeline (preferred): `node tools/buck/glue-pipeline.ts`
  - Export graph: `node tools/buck/export-graph.ts`
  - Sync providers: `node tools/buck/sync-providers.ts`
  - Sync Node providers only (no graph/auto_map): `node tools/buck/sync-providers.ts --lang node --no-glue`
  - Sync Python providers only (no graph/auto_map): `node tools/buck/sync-providers.ts --lang python --no-glue`
  - Sync specific language: `node tools/buck/sync-providers.ts --lang node`
  - Generate auto_map (building block; prefer the pipeline): `node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`
  - Prebuild guard (freshness/presence): `node tools/buck/prebuild-guard.ts [--verbose|--json]`
  - Note: touching any `pnpm-lock.yaml` requires re-running provider sync + auto_map; the guard will fail in CI if importer entries are missing and auto-fix locally unless `PREBUILD_GUARD_NO_FIX=1`.
- Nix builds (planner outputs):
  - `nix build .#graph-generator`
- Repo wrappers (preferred; thin shims that delegate into TypeScript and ensure the dev shell is loaded):
  - `i` (install deps), `b` (build), `v` (verify / full test suite)
