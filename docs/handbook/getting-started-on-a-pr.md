## Getting Started on a PR — Practical Guide for This Repository

This guide helps a new contributor land any PR in this plan successfully, following our rules, methodology, and build-system design.

### 1. Environment setup (direnv + dev shell)

- Ensure direnv is active in your shell and permitted for the repo:
  - `direnv allow` (once per clone), verify it loads automatically in new shells
- Quick checks (must succeed):
  - `nix --version`, `buck2 --version`, `go version`, `node --version`, `pnpm --version`
  - `python3 --version`, `uv --version` ← required for Python enablement
  - `nix show-config` includes experimental features (`nix-command`, `flakes`)
- Optional: run our startup check if present (prints clear hints):
  - `node build-tools/tools/dev/startup-check.ts`

Note on Python lockfiles: The initial Python rollout is uv‑only. Poetry/pip‑tools are out of scope unless/until a future PR adds them. See `build-tools/docs/lang/python-design.md` (PR‑17) for details.
Python provider sync activation in sparse/partial clones is lockfile‑driven: the presence of an `uv.lock` under `projects/apps/*` or `projects/libs/*` enables Python providers.

### 2. Project rules you must follow

- Follow `@METHODOLOGY.XML` and `@build-tools/docs/build-system-design.md` at all times.
- Never commit without verifying that all tests are wired and passing:
  - baseline pre-merge command: `i && b && v` (coverage-off by default)
  - coverage is opt-in; only run `v --coverage` or `buck2 test //... -- --env COVERAGE=1` when explicitly required by the PR/task/CI job
  - canonical policy location: `TESTING.md` section `Coverage policy (canonical)`
- Use Conventional Commits and real newlines in commit messages.
- Keep files small and focused (≤ 250 lines ideally); split modules when needed.
- Required CI stage wiring enforces the methodology file-size gate in strict mode (`file-size-lint` runs `--scope=source --fail=true` without `--allow-known` bypass flags).
- Maintain determinism and low cyclomatic complexity; prefer small, well-named functions.
- Follow the tooling rules in `docs/handbook/tooling.md`:
  - Use `build-tools/tools/lib/cli.ts` for CLI parsing (no bespoke `process.argv` parsing).
  - Use `build-tools/tools/lib/node-run.ts` (`runNodeWithZx`) when one tool invokes another zx script.
- Nix attr alias source of truth: `build-tools/tools/lib/nix-attr-aliases.json`. Starlark mirror is generated (dev/test-time) via:
  - `node build-tools/tools/dev/gen-nix-attr-aliases-bzl.ts` → writes `build-tools/lang/nix_attr_aliases.bzl`. A stub exists and runtime does not depend on generation; behavior is unchanged for current aliases.

### 3. Commands cheat sheet

- Build/test:
  - Default full verify run: `v`
  - Full verify run with coverage (opt-in): `v --coverage`
  - Buck direct full test with coverage (opt-in): `buck2 test //... -- --env COVERAGE=1`
  - Single target build/test: `buck2 build //<pkg>:<name>`, `buck2 test //<pkg>:<name>`
  - Policy gate (inventory + exceptions): `node build-tools/tools/dev/nix-gaps-inventory-check.ts --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions docs/handbook/nix-gaps-exceptions.json`
- Glue generation (when working on providers/labels mappings):
  - Run full glue pipeline (preferred): `node build-tools/tools/buck/glue-pipeline.ts`
  - Export graph: `node build-tools/tools/buck/export-graph.ts`
  - Sync providers: `node build-tools/tools/buck/sync-providers.ts`
  - Sync Node providers only (no graph/auto_map): `node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`
  - Sync Python providers only (no graph/auto_map): `node build-tools/tools/buck/sync-providers.ts --lang python --no-glue`
  - Sync specific language: `node build-tools/tools/buck/sync-providers.ts --lang node`
  - Generate auto_map (building block; prefer the pipeline): `node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`
  - Prebuild guard (freshness/presence): `node build-tools/tools/buck/prebuild-guard.ts [--verbose|--json]`
  - Note: touching any `pnpm-lock.yaml` requires re-running provider sync + auto_map; the guard will fail in CI if importer entries are missing and auto-fix locally unless `PREBUILD_GUARD_NO_FIX=1`.
- Nix builds (planner outputs):
  - `nix build .#graph-generator`
- Repo wrappers (preferred; thin shims that delegate into TypeScript and ensure the dev shell is loaded):
  - `i` (install deps), `b` (build), `v` (verify / full test suite)
  - `r` (run runnable target in `run.prod` mode), `d` (run runnable target in `run.dev` mode when available)
  - `v` includes a preflight run of the nix-gaps inventory/exception policy checker and fails fast on drift.

### 4. When `v` is slow (performance regression workflow)

`v` is expected to complete in a predictable window locally. If a run regresses substantially (for example jumping from ~20 minutes to ~30+ minutes), treat it like a failing test: identify the root cause and fix it.

Practical workflow:

- **Find slow targets**: `v` writes a full log at `buck-out/tmp/verify-logs/latest.log`.
  - The verify runner also appends a “slowest targets” list at the end of that log.
- **Get structured timing** (optional but recommended): run with timing summaries enabled and then aggregate:

```bash
TEST_TIMING=summary v
node build-tools/tools/dev/analyze-verify-timing.ts --log buck-out/tmp/verify-logs/latest.log
```

Common causes we’ve seen:

- **Accidentally added “heavy” tests** (tests that do full scaffolds, Nix builds, or large temp-repo operations without a good reason).
- **Tests doing extra work by default** (for example, creating expensive environments even when the feature isn’t used). Prefer making heavyweight inputs opt-in and keyed narrowly.
- **Always-on debug instrumentation in hot build phases** (for example, unconditional `ls` / `find` in Nix `buildPhase`) adds avoidable I/O across many tests. Keep deep diagnostics gated to failure paths or explicit debug flags.
- **Too many nested Buck/Nix invocations at once** causing resource contention (adjust `VERIFY_BUCK2_THREADS` if needed, but fix avoidable work first).

### 5. Performance guardrails for new PRs

I want performance regressions treated as correctness issues. Use these guardrails while you implement:

These guardrails assume test tooling stays aligned with the dev shell and global Nix configuration so we avoid accidental slow paths and hidden network errors.

- **Honor `XDG_CONFIG_HOME` for Nix**: if temp test environments hide or bypass it, Nix can ignore configured substituters and keys, forcing slow source builds and spurious failures.

- **Avoid `--impure` cache busts**: untracked files can force impure mode and invalidate flake snapshots. Track new tests early (for example, `git add` new files before `i`, `b`, or `v`) or exclude them intentionally from the flake source snapshot.
- **Use the planner path**: prefer `graph-generator-selected` and avoid building larger outputs when a derivation path is enough, for example `nix eval ... .drvPath`.
- **Minimize temp-repo copy cost**: seed repo cloning can dominate runtime. Prefer tar or CoW copies, and keep rsync excludes conservative.
- **Keep verify seed copies on the same filesystem**: stage verify seeds under repo-local `buck-out/tmp` before tests start. `runInTemp` copies are much faster when seed source and temp destination share the same filesystem.
- **Treat seed staging as a one-time verify step**: verify prepares one seed path before spawning parallel tests. Parallel test workers should only copy from that prepared seed, not re-stage it.
- **Avoid lock waits in single-verify staging**: verify already holds its own run lock. Do not introduce extra staging waits that can add multi-minute stalls when a prior run was interrupted.
- **Bound seed build time**: any `nix build .#test-seed` path must run with a timeout and a clear failure message. A bounded failure is easier to diagnose than an unbounded hang.
- **Avoid duplicate glue/setup passes inside one test**: if `deps-main --glue-only` (or glue-pipeline) already refreshed graph/providers/auto-map, do not run `export-graph` + `sync-providers` + `gen-auto-map` again in the same test flow.
- **Prefer seed filters to rsync**: if a test only needs a couple files missing, keep seed-store cloning and delete those files in the temp repo instead of forcing a full rsync.
- **Consolidate temp-repo tests**: if multiple assertions can share one `runInTemp` repo, do so to avoid repeated seed-store copies.
- **Use a lightweight smoke target for seed performance checks**: for quick validation, pick a small `runInTemp` test target that still emits `seedStoreCopy(...)` timing instead of heavy planner end-to-end tests.
- **Set an explicit smoke threshold**: for local guardrails, keep `seedStoreCopy(...)` under `15000ms` and investigate anything significantly above that before running full-suite verify.
- **Keep seed inputs complete**: when new tools or helpers are needed in temp repos, ensure they are included in seed/rsync allowlists or copied from `REPO_ROOT`; missing files cause ENOENT failures and slow retries.
- **Invalidate clean seeds on new commits**: seed repos must vary with the current `HEAD` to avoid stale code and hidden regressions. If a clean checkout uses an old seed, refresh the seed or include commit identity in the seed key.
- **Keep test HOME stable**: per-test HOME isolation wipes tool caches (Nix/pnpm) and can multiply runtime. Only set `TEST_HOME_PER_TEST=1` for tests that truly require a fresh HOME.
- **Prevent env leakage between tests**: restore `TEST_*` env vars in `finally` blocks or shared helpers.
- **Reset dev override envs**: tests that set `NIX_*_DEV_OVERRIDE_JSON` must restore it, or later tests will run with overrides and can force slow local builds.
- **Keep lint-staged scoped**: lint-staged commands should honor file arguments (avoid `eslint .` in hooks) so pre-commit and test runs do not lint the entire repo.
- **Do not remove required files**: excluding `build-tools/tools/tests`, `*.md`, or patch session files causes missing inputs and expensive retries.
- **Target invalidation explicitly**: include patch files in graph-visible inputs so Nix can track them without extra runtime work.
- **Measure before optimizing**: identify the dominant cost first, then optimize only that path.
- **Stage updated pnpm-store hashes in temp repos**: when a test updates `build-tools/tools/nix/node-modules.hashes.json`, `git add` it before any Nix builds so the flake snapshot sees the new hash instead of the placeholder. If a test generates a new `pnpm-lock.yaml`, always regenerate its hash even if an older entry exists in the map.
- **Watch pacing checkpoints, not just final duration**: if pass/min drops sharply between 5-minute and 10-minute checkpoints, treat that as a systemic contention signal and investigate immediately.
- **Compare like-for-like verify evidence**: use completed full-suite runs (`[verify] buck2 test exit ... status=0`) and timing summaries; partial/failed runs can under-report throughput and mislead regression analysis.
- **Re-profile top offenders in isolation before broad tuning**: run `TEST_TIMING=summary v //:slow_target` for the top entries from `latest.log` to separate true per-target cost from suite fan-out contention.
- **Keep `gomod2nix` incremental**: avoid shelling out to `gomod2nix` when `go.mod` has no `require/replace`; write/validate the minimal `gomod2nix.toml` directly, and skip project scans when `go.mod`/`go.sum` mtimes are older than `gomod2nix.toml`.
- **Prefer bounded-concurrency seed copies**: per-file copy loops in temp-repo setup can become global bottlenecks under verify fan-out; use bounded parallel file copies rather than fully serial recursion.
- **Avoid parallel `direnv exec` for profiling**: concurrent `direnv`/Nix eval can block on `.direnv/flake-profile` and distort timing; collect timing baselines with serialized runs.
- **Keep Nix GC idle during verify**: active `nix store gc`/`nix-store --gc` can contend on `/nix/var/nix/db/db.sqlite`, causing startup crawl, transient `SQLite ... is busy` warnings, and misleading strict-failure test output. The verify runner now fails fast on this preflight so stop GC jobs first.
- **Keep derivation build phases daemon-free**: avoid `nix-store`/`nix` introspection inside `runCommand` phases used by planner/test paths. Those calls can stall in sandboxed builds and create suite-wide timeout cascades.
