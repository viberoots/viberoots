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

### 4. When `v` is slow (performance regression workflow)

`v` is expected to complete in a predictable window locally. If a run regresses substantially (for example jumping from ~20 minutes to ~30+ minutes), treat it like a failing test: identify the root cause and fix it.

Practical workflow:

- **Find slow targets**: `v` writes a full log at `buck-out/tmp/verify-logs/latest.log`.
  - The verify runner also appends a “slowest targets” list at the end of that log.
- **Get structured timing** (optional but recommended): run with timing summaries enabled and then aggregate:

```bash
TEST_TIMING=summary v
node tools/dev/analyze-verify-timing.ts --log buck-out/tmp/verify-logs/latest.log
```

Common causes we’ve seen:

- **Accidentally added “heavy” tests** (tests that do full scaffolds, Nix builds, or large temp-repo operations without a good reason).
- **Tests doing extra work by default** (for example, creating expensive environments even when the feature isn’t used). Prefer making heavyweight inputs opt-in and keyed narrowly.
- **Too many nested Buck/Nix invocations at once** causing resource contention (adjust `VERIFY_BUCK2_THREADS` if needed, but fix avoidable work first).

### 5. Performance guardrails for new PRs

I want performance regressions treated as correctness issues. Use these guardrails while you implement:

These guardrails assume test tooling stays aligned with the dev shell and global Nix configuration so we avoid accidental slow paths and hidden network errors.

- **Honor `XDG_CONFIG_HOME` for Nix**: if temp test environments hide or bypass it, Nix can ignore configured substituters and keys, forcing slow source builds and spurious failures.

- **Avoid `--impure` cache busts**: untracked files can force impure mode and invalidate flake snapshots. Track new tests early (for example, `git add` new files before `i`, `b`, or `v`) or exclude them intentionally from the flake source snapshot.
- **Use the planner path**: prefer `graph-generator-selected` and avoid building larger outputs when a derivation path is enough, for example `nix eval ... .drvPath`.
- **Minimize temp-repo copy cost**: seed repo cloning can dominate runtime. Prefer tar or CoW copies, and keep rsync excludes conservative.
- **Invalidate clean seeds on new commits**: seed repos must vary with the current `HEAD` to avoid stale code and hidden regressions. If a clean checkout uses an old seed, refresh the seed or include commit identity in the seed key.
- **Keep test HOME stable**: per-test HOME isolation wipes tool caches (Nix/pnpm) and can multiply runtime. Only set `TEST_HOME_PER_TEST=1` for tests that truly require a fresh HOME.
- **Prevent env leakage between tests**: restore `TEST_*` env vars in `finally` blocks or shared helpers.
- **Do not remove required files**: excluding `tools/tests`, `*.md`, or patch session files causes missing inputs and expensive retries.
- **Target invalidation explicitly**: include patch files in graph-visible inputs so Nix can track them without extra runtime work.
- **Measure before optimizing**: identify the dominant cost first, then optimize only that path.
- **Stage updated pnpm-store hashes in temp repos**: when a test updates `tools/nix/node-modules.hashes.json`, `git add` it before any Nix builds so the flake snapshot sees the new hash instead of the placeholder. If a test generates a new `pnpm-lock.yaml`, always regenerate its hash even if an older entry exists in the map.
