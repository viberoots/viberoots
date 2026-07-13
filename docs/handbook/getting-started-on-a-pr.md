## Getting Started on a PR — Practical Guide for This Repository

This guide helps a new contributor land any PR in this plan successfully, following our rules, methodology, and build-system design.

### 1. Environment setup (direnv + dev shell)

- Prepare or repair viberoots workspace state with the current bootstrap entrypoint:
  - default remote-flake consumer mode: `curl -fsSL https://viberoots.dev/bootstrap | bash`
  - submodule contributor mode: `curl -fsSL https://viberoots.dev/bootstrap | VBR_CONSUMER=submodule bash`
  - Always fetch bootstrap from `main`; use `VBR_REF=<branch-or-tag>` for named refs or `VBR_REV=<full-commit-sha>` for commit pins when choosing the viberoots source consumed by the workspace.
  - The bootstrap command is idempotent, runs `direnv allow` and `i` by default, and records crash-safe upgrade intent under `.viberoots/bootstrap/transactions/`.
- Ensure direnv loads automatically in new shells after bootstrap. If you intentionally skipped the default `VBR_DIRENV_ALLOW=1` path, run `direnv allow` once for the checkout.
- Ensure `nix-direnv` is installed (bootstrap installs it for normal local setup; install manually only when repairing outside bootstrap):
  - `nix profile install nixpkgs#nix-direnv`
- Quick checks (must succeed):
  - `nix --version`, `buck2 --version`, `go version`, `node --version`, `pnpm --version`
  - `python3 --version`, `uv --version` ← required for Python enablement
  - `nix show-config` includes experimental features (`nix-command`, `flakes`)
- Optional shell-cache health check:
  - `viberoots/build-tools/tools/bin/shell-cache-check`
- Cache recovery (only when cache state is stale or broken):
  - `rm -rf .direnv && direnv allow && direnv reload`
- Optional: run our startup check if present (prints clear hints):
  - `node --import ./viberoots/build-tools/tools/dev/zx-init.mjs --experimental-strip-types viberoots/build-tools/tools/dev/startup-check.ts`
- Bootstrap creates or repairs `.viberoots/current`, `.viberoots/workspace/`, `.envrc`,
  `.buckconfig`, `.buckroot`, and the light workspace README files without rewriting edited
  project files.
  - In submodule mode, `.viberoots/current` points at the local `viberoots/` submodule so Buck and
    Nix workflows observe local build-tool edits immediately.
  - In remote-flake mode, `.viberoots/current` points at the resolved viberoots source instead.

Note on Python lockfiles: The initial Python rollout is uv‑only. Poetry/pip‑tools are out of scope unless/until a future PR adds them. See `viberoots/build-tools/docs/lang/python-design.md` (PR‑17) for details.
Python provider sync activation in sparse/partial clones is lockfile‑driven: the presence of an `uv.lock` under `projects/apps/*` or `projects/libs/*` enables Python providers.

### 2. Project rules you must follow

- Follow `@AGENTS.md` and `@viberoots/build-tools/docs/build-system-design.md` at all times.
- Never commit without verifying that all tests are wired and passing:
  - default PR loop: `i && b && v` (coverage-off and scope-aware by default)
  - full pre-merge command: `i && b && ALL_TESTS=1 v` (coverage-off by default)
  - coverage is opt-in; only run `v --coverage`, `ALL_TESTS=1 v --coverage`, or `buck2 test //... -- --env COVERAGE=1` when explicitly required by the PR/task/CI job
  - canonical policy location: `TESTING.md` section `Coverage policy (canonical)`
- Use Conventional Commits and real newlines in commit messages.
- Keep files small and focused (≤ 250 lines ideally); split modules when needed.
- Required CI stage wiring enforces the methodology file-size gate in strict mode (`file-size-lint` runs `--scope=source --fail=true` without `--allow-known` bypass flags).
- If an intentionally kept oversized artifact needs a reviewed file-size exception, declare it in the nearest owning-subtree `methodology-exceptions.json`; repo-root manifests are forbidden.
- For SSR contract changes, add negative-path checks in the same PR: invalid/missing framework discriminator, missing `serverEntry`, missing `clientDir`, and SSR static-fallback prevention.
- Keep touched test modules decomposed and below the methodology limit by splitting helpers into focused files, and keep the strict repo-owned file-size gate (`--scope=source`) green.
- Maintain determinism and low cyclomatic complexity; prefer small, well-named functions.
- Follow the tooling rules in `docs/handbook/tooling.md`:
  - Use `viberoots/build-tools/tools/lib/cli.ts` for CLI parsing (no bespoke `process.argv` parsing).
  - Use `viberoots/build-tools/tools/lib/node-run.ts` (`runNodeWithZx`) when one tool invokes another zx script.
  - Keep zx bootstrap paths consistent: use `viberoots/build-tools/tools/dev/zx-init.mjs` for Node-invoked zx scripts, and only use `viberoots/build-tools/tools/lib/ensure-zx-globals.ts` inside shared modules that may be imported from temp repos or other workspaces where bare `import "zx/globals"` is not resolvable.
- Nix attr alias source of truth: `viberoots/build-tools/tools/lib/nix-attr-aliases.json`. Starlark mirror is generated (dev/test-time) via:
  - `node viberoots/build-tools/tools/dev/gen-nix-attr-aliases-bzl.ts` → writes `.viberoots/current/build-tools/lang/nix_attr_aliases.bzl`. A stub exists and runtime does not depend on generation; behavior is unchanged for current aliases.

### 2.1 Active-doc command contract scope (PR-6)

I maintain an explicit inventory for docs that contain scaffold command guidance:

- Inventory source: `viberoots/build-tools/tools/tests/scaffolding/doc-command-contract.inventory.ts`
- Classification is required for scaffold-command docs under these areas:
  - `docs/handbook`
  - `viberoots/build-tools/docs`
  - `docs/history/designs/legacy`
  - `docs/history/build-system/pnpm`
- Active docs are implementation guidance and must keep canonical TypeScript commands (`scaf new ts ...`) for canonical TypeScript templates.
- Archival docs are historical records and may keep legacy command examples when explicitly classified as archival.

When adding or materially editing scaffold command guidance:

- Update the active/archival classification inventory in the same PR.
- Keep active docs on canonical command paths.
- Run the PR-6 docs contract tests to ensure classification and command-path enforcement stay in sync.

### 3. Commands cheat sheet

- Dependency manifest edit: run `u`, then `i && b && v`.
- Intentional pnpm dependency upgrade: run `u --upgrade`, then `i && b && v`.
- `u` conservatively repairs pnpm, Go, Python/uv, and deterministic C++ provider/glue metadata.
  Neither update mode changes the viberoots submodule, flake pin, or source mode; use
  `viberoots update` for that separate operation.

- Build/test:
  - Install/update dependencies and generated glue: `i`
  - Recursive build: `b`
  - Default scoped verify run: `v`
  - Full verify run: `ALL_TESTS=1 v`
  - Full verify run with coverage (opt-in): `ALL_TESTS=1 v --coverage`
  - Buck direct full test with coverage (opt-in): `buck2 test //... -- --env COVERAGE=1`
  - Single target build/test: `buck2 build //<pkg>:<name>`, `buck2 test //<pkg>:<name>`
  - Policy gate (inventory + exceptions): `node viberoots/build-tools/tools/dev/nix-gaps-inventory-check.ts --starlark-api docs/handbook/starlark-api.md --nix-gaps docs/handbook/nix-gaps.md --exceptions docs/handbook/nix-gaps-exceptions.json`
- Glue generation (when working on providers/labels mappings):
  - Run full glue pipeline (preferred): `node viberoots/build-tools/tools/buck/glue-pipeline.ts`
  - Export graph: `node viberoots/build-tools/tools/buck/export-graph.ts`
  - Sync providers: `node viberoots/build-tools/tools/buck/sync-providers.ts`
  - Sync Node providers only (no graph/auto_map): `node viberoots/build-tools/tools/buck/sync-providers.ts --lang node --no-glue`
  - Sync Python providers only (no graph/auto_map): `node viberoots/build-tools/tools/buck/sync-providers.ts --lang python --no-glue`
  - Sync specific language: `node viberoots/build-tools/tools/buck/sync-providers.ts --lang node`
  - Generate auto_map (building block; prefer the pipeline): `node viberoots/build-tools/tools/buck/gen-auto-map.ts --graph .viberoots/workspace/buck/graph.json --out .viberoots/workspace/providers/auto_map.bzl`
  - Prebuild guard (freshness/presence): `node viberoots/build-tools/tools/buck/prebuild-guard.ts [--verbose|--json]`
  - Note: touching any `pnpm-lock.yaml` requires re-running provider sync + auto_map; the guard will fail in CI if importer entries are missing and auto-fix locally unless `PREBUILD_GUARD_NO_FIX=1`.
- Template test selection (PR-2):
  - Auto-detect from git changes: `node viberoots/build-tools/tools/dev/select-template-tests.ts`
  - Provide explicit changed paths: `node viberoots/build-tools/tools/dev/select-template-tests.ts --changed viberoots/build-tools/tools/scaffolding/templates/go/lib/copier.yaml`
  - Targets-only output: `node viberoots/build-tools/tools/dev/select-template-tests.ts --targets-only`
- Verify template-scope controls (PR-3):
  - `VBR_TEMPLATE_TEST_SCOPE=auto|always|never v`
  - `auto`: when changes are template-only, `v` runs only label-selected template tests + safety floor
  - `always`: force selector mode; fails fast when the change-set is not template-only
  - `never`: bypass selector mode and use existing build-system test scope behavior
- Runtime prefix migration:
  - update old runtime environment variables to `VBR_*`
  - see `docs/history/migrations/runtime-prefix-migration.md`
- Verify project-impact default (PR-1.5):
  - default `v` behavior for non-build-system app/lib edits is dependency-aware project selection
  - selected test scope = changed projects + full recursive downstream dependents
  - project-local methodology exception edits (for example `projects/apps/<name>/methodology-exceptions.json`) stay on this project-impact path
  - build-system code/tooling edits keep the broad build-system scope; Markdown and reStructuredText
    docs do not count as build-system edits just because they live under `viberoots/build-tools/**`
  - default change detection uses merge-base refs (`GITHUB_BASE_REF`, then `github/main`,
    `origin/main`, `main`) plus dirty worktree status
- Verify deployment-aware build-system scope (PR-4.5.3):
  - `VBR_DEPLOYMENT_TEST_SCOPE=auto|always|never v`
  - `auto`: safe deployment-owned build-system edits run the reviewed deployment suite plus safety floor
  - `auto`: `projects/deployments/**` changes run the union of deployment coverage and project-impact coverage
  - `auto`: shared or ambiguous build-system paths still broaden to the existing full build-system scope
  - `always`: require a safe `deployment-only` change-set and fail fast otherwise
  - `never`: bypass deployment-aware narrowing and keep the prior selector behavior
- Verify project-closure opt-in (PR-1.6):
  - use this only for compliance/release-gate runs that must verify one or more projects plus their full recursive dependency closure
  - invocation: `v --selector project-closure --project projects/apps/example-app`
  - multiple projects: `v --selector project-closure --projects projects/apps/example-app,projects/libs/shared-ui`
  - preview only: `v --selector project-closure --project projects/apps/example-app --explain-selection`
  - `VERIFY_SELECTOR=project-closure` and `VERIFY_PROJECTS=<csv>` are equivalent to the CLI flags; CLI flags win when both are set
  - this mode is intentionally slower than default project-impact because it walks full dependency closure instead of changed-project downstreams
- Nix builds (planner outputs):
  - `nix build .#graph-generator`
- Repo wrappers (preferred; thin shims that delegate into TypeScript and ensure the dev shell is loaded):
  - `i` (install deps and generated glue), `b` (recursive build), `v` (verify with scope
    selection; use `ALL_TESTS=1 v` for the full suite)
  - `v` lint/prettier preflight is changed-file scoped by default; `VERIFY_SKIP_LINT=1` still skips
    the preflight when explicitly requested
  - status helpers (`l --status`, `s`, or `tail-log --status`) can show both
    active pass-group counts and total suite counts; JSON status exposes `pass_index`,
    `pass_total`, `group_completed`, and `group_total`
- `runInTemp` Buck isolation contract:
  - use plain `buck2 ...` inside `runInTemp`; the temp-repo shim injects the registered isolation
  - explicit `buck2 --isolation-dir ...` is linted across multiline strings, template-built commands,
    arrays, and shared helper files imported by `runInTemp` tests
  - use `inheritedBuckIsolation(...)` or `BUCK_NESTED_ISO` only when an explicit inherited isolation
    is required; those forms approve only the command that contains them, not neighboring commands
  - rare independent nested daemons need `lint: allow-hardcoded-buck-isolation: <specific reason>`
  - helper files outside `viberoots/build-tools/tools/tests` are part of this lint when a `runInTemp` test
    imports them into the Buck command-generation graph; unrelated helpers stay outside the scan
- `p` (run runnable target in `run.prod` mode), `d` (run runnable target in `run.dev` mode when available)
  - `v` includes a preflight run of the nix-gaps inventory/exception policy checker and fails fast on drift.
- TypeScript scaffolding command surface (ts-only):
  - `scaf new ts lib demo-lib --yes --dry-run`
  - `scaf new ts cli demo-cli --yes --dry-run`
  - `scaf new ts webapp-static demo-web --yes --dry-run`
  - `scaf new ts webapp-ssr-vite demo-vite-ssr --yes --dry-run`
  - `scaf help ts webapp-ssr-vite`

### 3.1 Vite SSR troubleshooting signatures (PR-5 lock-in)

When this PR touches `ts/webapp-ssr-vite` paths, validate these deterministic failure signatures before merge:

- Invalid/missing framework label for SSR target shape:
  - `missing/invalid framework label`
- Malformed or missing runnable SSR artifacts:
  - `missing artifacts.serverEntry`
  - `missing artifacts.clientDir`
- Static-host fallback accidentally used for SSR:
  - `SSR prod command must not use static host fallback`
- Broken dev SSR entry wiring:
  - `SSR contract error: failed to load /src/entry-server.ts:`
  - `SSR contract error: /src/entry-server.ts must export a render(url) function`

### 3.2 Reusable viberoots fixture boundaries

Reusable fixtures under `viberoots/` may model generic applications, libraries, deployment
families, providers, and secret contracts, but they must stay reusable examples. Do not place
parent-repository project docs, live deployment target state, family-specific bootstrap defaults, or
project-owned hash/generated state under the viberoots source tree.

Use names such as `example-app`, `console`, or `api` for reusable examples. Real project families,
including their deployment contexts, checked-in runtime names, SprinkleRef contracts, and operator
runbooks, belong under the consuming workspace, normally `projects/**`.

When a test needs a second consumer, create the consumer workspace with its own `projects/**`,
`.viberoots/workspace/**`, and parent-owned hash state. The test should fail if the reusable
viberoots source gains `.viberoots/`, `buck-out/`, `config/workspace_*`, `projects/**`, or other
consumer-owned generated state, and it should make that assertion before fixture cleanup can remove
the misplaced files.

### 4. When `v` is slow (performance regression workflow)

`v` is expected to complete in a predictable window locally. If a run regresses substantially (for example jumping from ~20 minutes to ~30+ minutes), treat it like a failing test: identify the root cause and fix it.

Practical workflow:

- **Find slow targets**: `v` writes a full log at `.viberoots/workspace/buck/verify-logs/latest.log`.
  - The verify runner also appends a “slowest targets” list at the end of that log.
- **Get structured timing** (optional but recommended): run with timing summaries enabled and then aggregate:

```bash
TEST_TIMING=summary v
node viberoots/build-tools/tools/dev/analyze-verify-timing.ts --log .viberoots/workspace/buck/verify-logs/latest.log
```

Common causes we’ve seen:

- **Accidentally added “heavy” tests** (tests that do full scaffolds, Nix builds, or large temp-repo operations without a good reason).
- **Tests doing extra work by default** (for example, creating expensive environments even when the feature isn’t used). Prefer making heavyweight inputs opt-in and keyed narrowly.
- **Always-on debug instrumentation in hot build phases** (for example, unconditional `ls` / `find` in Nix `buildPhase`) adds avoidable I/O across many tests. Keep deep diagnostics gated to failure paths or explicit debug flags.
- **Snapshotting large shared caches in locked build paths** can create both correctness and performance regressions. If an importer-specific fixed store/output already fully determines a locked build, do not also `builtins.path` or copy a workspace-wide prefetched cache into that derivation. One dangling entry in the shared cache can then break unrelated builds, and every target pays the snapshot/copy cost.
- **Too many nested Buck/Nix invocations at once** causing resource contention (adjust `VERIFY_BUCK2_THREADS` if needed, but fix avoidable work first).
- **Buck event-bus failures under full-suite fan-out** can be resource exhaustion, not a flaky assertion. Check verify resource summaries for high `max_buck`/`max_processes`; large local shared passes intentionally use a lower Buck thread cap unless `VERIFY_BUCK2_THREADS` is set.

### 4.1 Disk growth guardrails

Treat unexpected disk growth during `i`, `b`, or `v` like an execution-time regression. Collect evidence before cleanup: capture `df -h / /nix`, `du -sh` for `/private/tmp/viberoots-*`, `.viberoots/workspace`, `buck-out`, and relevant `/nix/store` output families, then preserve the verify log that shows the active pass and target names. Do not run GC or remove temp roots until the first growth pattern is recorded.

Recent fixes prove these guardrails:

- **Generated state must stay out of reviewed and seeded sources**. Source filters, seed filters, temp-repo rsync, and bootstrap repair paths must exclude generated roots consistently. Recent fixes added guardrails for `.viberoots/buck`, `.viberoots/cache`, `.viberoots/workspace/buck`, `.viberoots/workspace/codex-test-logs`, `viberoots/.viberoots`, `viberoots/buck-out`, `viberoots/node_modules`, `.direnv`, `.nix-gcroots`, `result*`, build outputs, and test logs.
- **Filtered snapshots must not copy mutable app/build outputs**. Repo and flake filters must exclude `node_modules`, `buck-out`, `dist`, `build`, `.vite`, `.next`, `.wasm-producer`, coverage, temp files, and result symlinks so stale local outputs do not enter Nix sources or Buck outputs.
- **Seed staging must be reusable, bounded, and cleaned by ownership**. Verify should prepare one staged seed per seed key, pin only live seeds, remove stale unlocked stages, and keep cleanup evidence-based so interrupted runs do not accumulate old seeds or kill unrelated concurrent work.
- **Keep seed inputs complete without broadening copies**. If a temp-repo test needs a new helper or root file, add the minimal required seed/filter coverage or read from `REPO_ROOT` when isolation is not part of the assertion. Do not broaden `TEST_RSYNC_ROOTS` to large trees just to access one file.
- **Never give Nix a raw `path:` reference to a live worktree containing generated `.viberoots` state**. Root and non-default pnpm reconciliation builds use importer-scoped filtered snapshots. Those snapshots preserve relevant dirty and untracked source inputs while excluding generated Buck, cache, `node_modules`, and result trees.
- **Keep ordinary materialization on committed, realized fixed outputs**. `i`, post-clone, node-module linking, and devshell builds probe the literal fixed-output path derived from committed hash metadata. They do not enable reconciliation or network fetches. An absent or invalid path fails closed with `repair: run u`.
- **Keep explicit pnpm reconciliation Nix-native and fixed throughout**. The update path retains recursive `outputHash`, runs the pinned pnpm fetch only inside the fixed-output derivation, accepts one strictly targeted Nix mismatch, writes only the canonical owner hash map, creates a fresh filtered snapshot, and verifies the new hash. Verification failure restores every writable hash map byte-for-byte. Do not reintroduce exact, unfixed, or add-fixed store artifacts.
- **Budget for Nix registration overlap and do not terminate it casually**. Registration can transiently hold the completed output and its canonical temporary copy at the same time. A forced termination during measured registration left about 9.36 GiB of invalid output/temp residue. Before interrupting, account for one complete candidate, measured canonicalization overhead, a full registration copy, and margin; keep `keep-failed=false`. Preserve the invalid-path and disk evidence before any cleanup.
- **Keep the pnpm fetch output store-only**. The reconciliation fetch uses a temporary modules directory only as pnpm plumbing, removes it before registration, and verifies that the candidate contains content-addressed store files but no `node_modules` tree.
- **Use measured pnpm checkpoints when changing this path**. Focused evidence for the current root lock recorded: a small native fixture at 26.83s and under 500 MiB; root reconciliation at 106.13s with a 5.19 GiB clean-baseline peak; an identical forced rebuild at 95.71s with a 9.66 GiB peak and no persistent new large output; a warm realized-output probe at 3.29s with zero new paths; and devshell materialization at 31.99s with one expected 5.278 GB node-modules output, followed by a 2.50s warm build with zero new paths.
- **Keep local generated shell state out of bootstrap and source-mode snapshots**. Bootstrap and source-selection flows must ignore generated shell/cache state and filtered input noise, so local `.envrc`/direnv/Nix artifacts do not churn source hashes or get copied into seed inputs.
- **Short-circuit fresh relative generated-workspace inputs before Nix metadata**. When the generated workspace flake and lock already use the normalized `./viberoots-flake-input` node, lock repair must return from that structural fresh state instead of running `nix flake metadata` on the enclosing generated workspace. The redundant metadata call imported a new 25,536,336-byte workspace source on each invocation; after the focused fast path, two consecutive warm `u` runs completed in 8.09s and 7.90s with zero new Nix store paths.
- **Treat Nix GC and store optimization as maintenance, not normal verify setup**. Do not run `viberoots gc`, `nix store gc`, or `nix store optimise` while verify is active. Use `viberoots gc --dry-run` before cleanup, and treat invalid store-path errors during verify as run-level evidence of concurrent store mutation.

Do not add a new disk-growth guardrail just because a theory is plausible. First prove the path with a before/after measurement, a focused regression test or contract test, and comparable validation evidence that the copied/stored bytes are reduced without hiding required source inputs.

### 5. Performance guardrails for new PRs

I want performance regressions treated as correctness issues. Use these guardrails while you implement:

These guardrails assume test tooling stays aligned with the dev shell and global Nix configuration so we avoid accidental slow paths and hidden network errors.

- **Investigation default (including LLM agents)**: severe regressions here are almost never contention alone. We run this suite routinely at high volume without contention-only degradation. Treat large slowdowns/timeouts as a recently introduced systemic change until proven otherwise.
- **Honor `XDG_CONFIG_HOME` for Nix**: if temp test environments hide or bypass it, Nix can ignore configured substituters and keys, forcing slow source builds and spurious failures.
- **Keep configured Nix caches from becoming a hard gate**: `i`, `b`, `v`, and Buck Nix actions dynamically probe configured HTTP(S) substituters and remove unreachable caches from the current process when `VBR_NIX_CACHE_POLICY=auto` (the default). Nix fallback remains enabled, so ordinary local validation should continue without the cache. Use `VBR_NIX_CACHE_POLICY=strict` only when cache availability is itself being tested, and `VBR_NIX_CACHE_POLICY=off` only when you need to skip the dynamic probe.

- **Avoid `--impure` cache busts**: untracked files can force impure mode and invalidate flake snapshots. Track new tests early (for example, `git add` new files before `i`, `b`, or `v`) or exclude them intentionally from the flake source snapshot.
- **Do not edit tracked source during a full verify timing run**: Buck and Nix can observe tracked file changes mid-run, invalidate source snapshots, rebuild distinct derivations, and make the run non-comparable to clean full-scope timings. If files changed while `v` was active, treat the timing as invalidated unless the log proves those changes were isolated from the selected targets.
- **Use the planner path**: prefer `graph-generator-selected` and avoid building larger outputs when a derivation path is enough, for example `nix eval ... .drvPath`.
- **Minimize temp-repo copy cost**: seed repo cloning can dominate runtime. Prefer tar or CoW copies, and keep rsync excludes conservative.
- **Keep verify seed copies on the same filesystem**: stage verify seeds under repo-local `buck-out/tmp` before tests start. `runInTemp` copies are much faster when seed source and temp destination share the same filesystem.
- **Treat seed staging as a one-time verify step**: verify prepares one seed path before spawning parallel tests. Parallel test workers should only copy from that prepared seed, not re-stage it.
- **Avoid lock waits in single-verify staging**: verify already holds its own run lock. Do not introduce extra staging waits that can add multi-minute stalls when a prior run was interrupted.
- **Bound seed build time**: any `nix build .#test-seed` path must run with a timeout and a clear failure message. A bounded failure is easier to diagnose than an unbounded hang.
- **Propagate timeout contracts into derivation env**: when a tool enforces a bounded `NIX_PNPM_FETCH_TIMEOUT` (or similar) in the caller, pass the same value into the Nix build environment used by `builtins.getEnv`; otherwise the outer command may allow 600s while the inner derivation silently keeps a shorter default (for example 180s), causing flaky timeout regressions under verify fan-out.
- **Avoid duplicate glue/setup passes inside one test**: if `deps-main --glue-only` (or glue-pipeline) already refreshed graph/providers/auto-map, do not run `export-graph` + `sync-providers` + `gen-auto-map` again in the same test flow.
- **Use pnpm filtered lint in template-only mode**: `v` runs `pnpm --filter . -s lint` when template selector mode is active, so template-only verification avoids unnecessary workspace-wide lint.
- **Prefer seed filters to rsync**: if a test only needs a couple files missing, keep seed-store cloning and delete those files in the temp repo instead of forcing a full rsync.
- **Avoid broad `TEST_RSYNC_ROOTS` overrides in hot tests**: forcing large root copies (for example adding `docs` just to read one file) can turn a fast temp-repo test into a multi-minute suite bottleneck. Prefer reading repo-root files directly when test semantics do not require them inside the temp copy.
- **Keep temp package stores outside tracked importers**: in `runInTemp` tests, avoid writing `.pnpm-store`/`.pnpm-home` under an importer that you later `git add -A`. Staging store blobs inflates flake snapshots, triggers noisy line-ending churn, and can turn fast negative tests into timeout-prone bottlenecks.
- **Avoid workspace-wide pnpm installs in temp-repo tests**: when a test validates one app/lib pair, do not run unfiltered `pnpm install` that traverses the whole workspace and executes root lifecycle scripts (for example `prepare`). Prefer importer-scoped lockfile generation and filtered installs (`--filter <importer>`) with `--ignore-scripts` unless scripts are part of the behavior under test.
- **Do not regenerate importer lockfiles when already fresh**: for scaffolded TS projects that already include a matching `pnpm-lock.yaml`, skip lockfile regeneration and keep the existing lockfile as the primary path. Unconditional regeneration can trigger network retry ladders (`ERR_PNPM_META_FETCH_FAIL`) and create multi-minute timeout tails in verify.
- **When lockfile generation is required, finish with explicit fixed-store reconciliation**: `pnpm install --lockfile-only` updates dependency metadata but does not realize the committed Nix FOD. After regenerating an importer lockfile, run the importer-scoped update path so pinned pnpm fetch, hash mismatch handling, and fixed-output verification stay inside the authoritative Nix build.
- **Use frozen lockfile installs for lightweight source-only scaffold tests**: in temp-repo tests that only validate scaffold shape or small source-only contracts (no dependency edits, no heavy runtime/watch loop), prefer `pnpm install --frozen-lockfile` so lockfiles stay unchanged and install paths remain bounded.
- **For lightweight source-only tests that use `--frozen-lockfile`, do not skip scaffold lockfile generation**: keep `scaf new` on its default lockfile path (no `--skip-lockfile-gen`) so the first install stays on the deterministic frozen path instead of forcing `ERR_PNPM_OUTDATED_LOCKFILE` retries.
- **For dependency-growth scaffold tests, keep `--no-frozen-lockfile` but prefer cached packages**: when a test intentionally edits dependencies, use importer-filtered install with `--prefer-offline` (plus `--ignore-scripts`) so lockfile updates stay correct while avoiding unnecessary registry round-trips that create suite-wide latency spikes.
- **When adding one workspace dependency, install only the consumer importer**: avoid dual-filter installs like `--filter <app> --filter <lib>` when the lib is already a workspace dependency of the app. Installing the app importer alone links the workspace lib transitively and prevents avoidable lockfile-resolution churn under verify fan-out.
- **Skip redundant scaffold lockfile generation in heavy runtime tests**: when a temp-repo test immediately runs `pnpm install` after `scaf new` and then boots a dev server, watcher, or runtime contract, pass `--skip-lockfile-gen` to `scaf new` and let the explicit install path own lockfile realization. This removes duplicate `update-pnpm-hash` work and reduces verify contention without changing runtime behavior under test.
- **Keep runtime/offline contracts on the local app build path unless packaging is the subject**: if a test only asserts scaffolded runtime behavior, service-worker output, or `dist/` contents, do not route it through `deps-main --glue-only`, `update-pnpm-hash`, or `nix build node-webapp.*`. Use importer-scoped `pnpm install` plus the template’s local build script so the test pays only for the behavior it is asserting.
- **Share proven pnpm-store hashes across temp repos**: when many temp repos regenerate the same importer lockfile contents under the same builder fingerprint, cache the verified `lockHash -> pnpm-store hash` mapping in a shared `buck-out` location. Repo-local markers alone are not enough; otherwise each temp repo redoes the same fixed-output mismatch/build cycle and turns one systemic regression into suite-wide latency.
- **Do not advertise dev readiness before async bootstrap is usable**: if a dev command depends on generated wasm assets, contracts, or other startup sync work, block startup on that readiness. Logging `listening` before those files exist just turns suite load into long windows of guaranteed 500s and flaky readiness timeouts.
- **Keep Buck rule timeouts aligned with verify timeouts**: if verify raises per-test budgets, update both the Buck rule metadata (`test_rule_timeout_ms`) and the inner shell/Nix timeout wrapper. Otherwise Linux will still kill the test at the old 600s boundary even though `VERIFY_TIMEOUT_SECS` or `TEST_NIX_TIMEOUT_SECS` says otherwise.
- **Use explicit `pnpm --dir <temp-repo>` in temp-repo tests**: do not rely on `cwd` alone for pnpm workspace selection inside `runInTemp`. Inherited pnpm/npm env can still bind the command to the outer workspace, which turns installs into no-ops, hides missing `node_modules`, and creates misleading performance regressions.
- **Keep `runInTemp` bootstrap lean**: do not prewarm heavyweight shared state or resolve rare tool binaries in the generic temp-repo harness. If only a small subset of tests needs a tool such as `zip`, resolve it in those tests instead of making every temp-repo target pay the Nix lookup/build cost.
- **Keep flake repo snapshots free of generated app outputs**: broad Nix builds must not ingest repo-local `dist/`, `build/`, `.vite/`, `.next/`, or `.wasm-producer/` trees. Those are mutable dev artifacts and can carry stale/broken references into `buck-out`, poisoning unrelated Linux builds. Exclude them in the repo source filter instead of relying on a clean checkout.
- **Keep broad Nix-backed Buck rules off the live repo flake**: if a rule can build through a filtered snapshot helper, do not point it at `path:$FLK_ROOT` directly. Live-repo flake inputs make broad `b` runs sensitive to untracked workspace junk and stale generated paths even after `git reset --hard`.
- **Consolidate temp-repo tests**: if multiple assertions can share one `runInTemp` repo, do so to avoid repeated seed-store copies.
- **Use scratch temp workspaces for source-only checks**: if a test only needs an isolated directory plus zx/node helpers, use `runInScratchTemp` instead of seeded `runInTemp` so it does not clone the repo, bootstrap Buck, or resolve Nix inputs.
- **Use a lightweight smoke target for seed performance checks**: for quick validation, pick a small `runInTemp` test target that still emits `seedStoreCopy(...)` timing instead of heavy planner end-to-end tests.
- **Set an explicit smoke threshold**: for local guardrails, keep `seedStoreCopy(...)` under `15000ms` and investigate anything significantly above that before running full-suite verify.
- **Keep seed inputs complete**: when new tools or helpers are needed in temp repos, ensure they are included in seed/rsync allowlists or copied from `REPO_ROOT`; missing files cause ENOENT failures and slow retries.
- **Use repo snapshots that include test-created inputs for selected planner builds**: when planner `mkGen`/`mkLib`/`mkBin` derivations execute commands against temp-repo fixtures, source snapshots must include those fixture paths. Avoid filtered sources that drop untracked temp inputs, or selected builds can fail late (`cd ... No such file or directory`) and waste long verify time before surfacing the real error.
- **Recreate filtered flake snapshots after lock-hash writes**: when `update-pnpm-hash` updates `node-modules-hashes.json`, reusing a pre-write filtered flake can re-run fixed-output builds against stale inputs and produce avoidable hash-mismatch loops. Create a fresh filtered snapshot for the second `fixed-reconcile` attempt so it evaluates the updated authoritative hash.
- **On fixed-output mismatch, prefer the derivation `got` hash and refresh snapshot before retry**: for importer-scoped `pnpm-store` updates, derive retry hashes from the fixed-output mismatch (`got:`) signal and regenerate the filtered flake snapshot after writing the hash. Retrying against the pre-write snapshot can repeat stale `specified` hashes and hide the real primary-path state.
- **Rebuild only a realized committed fixed output**: inspect the literal path derived from committed metadata before adding `--rebuild`. A realized path may be forced through deterministic verification; a physically absent or explicitly invalid path must use a normal fixed build so Nix can realize or replace it. Evaluation, malformed validity output, and tool failures remain hard errors.
- **Keep global Nix inputs present in temp repos**: tests that exercise Nix-calling macros with `global_nix_inputs()` wiring must include `flake.nix` and `flake.lock` in `TEST_RSYNC_ROOTS`; missing global inputs can fail actions before meaningful test assertions run.
- **Invalidate clean seeds on new commits**: seed repos must vary with the current `HEAD` to avoid stale code and hidden regressions. If a clean checkout uses an old seed, refresh the seed or include commit identity in the seed key.
- **Keep test HOME stable**: per-test HOME isolation wipes tool caches (Nix/pnpm) and can multiply runtime. Only set `TEST_HOME_PER_TEST=1` for tests that truly require a fresh HOME.
- **Do not bootstrap unified pnpm store per temp repo when repo prewarm exists**: temp-repo Nix call sites should prefer `REPO_ROOT/buck-out/.unified-pnpm-store/path` when available and skip local `require-unified-pnpm-store` bootstrap; per-temp bootstrap multiplies Nix eval/build cost and creates suite-wide long-tail stalls.
- **Keep temp-repo root vars self-consistent**: in `runInTemp` flows, make `WORKSPACE_ROOT`/`BUCK_TEST_SRC` authoritative for workspace resolution. Keep `REPO_ROOT` reserved for deliberate live-repo assets (for example shared caches), and avoid mixing root precedence accidentally. Mixed roots can make Nix/planner paths resolve to the live checkout (missing temp fixtures) and can also collapse per-importer install locks into one shared lock, creating suite-wide stalls/timeouts.
- **Treat interrupted verify cleanup as part of performance correctness**: if a verify run is stopped early, it must still reap registered temp Buck daemons/dev servers and remove owned temp repos. Leaked temp-repo state can accumulate across the day and turn later like-for-like full-suite runs into sudden execution-time spikes.
- **Keep verify-owned process registration opt-in**: do not register every zx-initialized Buck test process for orphan cleanup. Only long-lived helper processes that a test intentionally detaches should set `VBR_VERIFY_REGISTER_PROCESS=1`; otherwise cleanup can mistake ordinary active test children for owned orphans after a Buck client failure.
- **When scoping env for graph/setup, propagate required vars to child builds**: if `ensureGraph` is run under a scoped env (`BUCK_TARGET`, `BUCK_GRAPH_JSON`, workspace roots), pass the same required keys into downstream `nix build`/runner subprocesses. Otherwise stubs/wrappers can fail hard (`set -u` unbound vars) and trigger expensive retry paths.
- **Filtered flake helper builds must stay impure when they depend on selected-target env**: wrappers like `nix-build-filtered-flake.ts` are safe places to use `--impure` because they operate on a temporary filtered snapshot. If the helper drops `BUCK_TARGET` / `PLANNER_ONLY_CPP` / wasm selection env, planner-selected builds silently fall back to `.noop` outputs and waste full build/test time before failing.
- **Avoid per-process Buck isolation fan-out in exporter paths**: prefer the parent `BUCK_ISOLATION_DIR` for exporter `cquery` calls and only use ephemeral isolation dirs when no parent isolation exists. PID-suffixed exporter isolation forces daemon cold starts/teardowns and creates suite-wide latency.
- **Default exporter reuse to on, with a workspace-stable isolation name**: if `BUCK_EXPORTER_REUSE_DAEMON` is unset, treat it as enabled and derive a stable `exporter-shared-<workspace-hash>` isolation when no parent isolation is provided. This avoids hidden regressions from unset envs falling back to per-process isolation churn.
- **Prevent env leakage between tests**: restore `TEST_*` env vars in `finally` blocks or shared helpers.
- **Reset dev override envs**: tests that set `NIX_*_DEV_OVERRIDE_JSON` must restore it, or later tests will run with overrides and can force slow local builds.
- **Keep lint-staged scoped**: lint-staged commands should honor file arguments (avoid `eslint .` in hooks) so pre-commit and test runs do not lint the entire repo.
- **Do not remove required files**: excluding `viberoots/build-tools/tools/tests`, `*.md`, or patch session files causes missing inputs and expensive retries.
- **Target invalidation explicitly**: include patch files in graph-visible inputs so Nix can track them without extra runtime work.
- **Measure before optimizing**: identify the dominant cost first, then optimize only that path.
- **Keep per-test timing summaries opt-in**: Buck stores test stdout/stderr in its event stream, so forcing `TEST_TIMING_SUMMARY=1` across full-suite `v` can turn instrumentation into event-bus/log amplification. Use `TEST_TIMING=summary v //:target` or an intentional profiling run, not the default verify path.
- **Stage updated pnpm-store hashes in temp repos**: when a consumer test updates `projects/node-modules.hashes.json`, `git add` it before any Nix builds so the flake snapshot sees the new hash instead of the placeholder. Standalone viberoots tooling hashes stay in `build-tools/tools/nix/node-modules.hashes.json`. If a test generates a new `pnpm-lock.yaml`, always regenerate its hash even if an older entry exists in the map.
- **Watch pacing checkpoints, not just final duration**: if pass/min drops sharply between 5-minute and 10-minute checkpoints, treat that as a systemic contention signal and investigate immediately.
- **Compare like-for-like verify evidence**: use completed full-suite runs (`[verify] buck2 test exit ... status=0`) and timing summaries; partial/failed runs can under-report throughput and mislead regression analysis.
- **Confirm `verify:isolated` targets are truly isolated under wildcard/package verify scopes**: if timing-sensitive targets rely on `verify:isolated`, check the verify log for a dedicated `target pass begin name=isolated` entry. If a broad selector such as `//...` or `//project/...` stays in a single `shared` pass, the isolated label is not being materialized and suite concurrency can create false timing regressions.
- **Batch isolated targets unless debugging per-target behavior**: default `verify:isolated` handling should use one serial isolated pass (`threads=1`) plus the shared pass, avoiding one Buck invocation per isolated target. Use `VBR_VERIFY_ISOLATED_PASS_MODE=per-target` only for focused debugging where per-target pass logs matter more than total runtime.
- **Use bounded scheduling for deployment temp-repo tests**: deployment-owned tests that call `runInTemp` should carry `verify:resource-limited` through `deployment_conventions.bzl`. A broad shared pass cannot absorb dozens of deployment temp repos also starting local services, smoke checks, and nested Buck/Nix work; keep that class out of shared without forcing every target through the fully serial `verify:isolated` path.
- **Keep broad resource-limited lanes below deployment fanout saturation**: a large `verify:resource-limited` pass is still a single Buck command, and each target may create temp repos, nested Buck daemons, Nix builds, and control-plane workers. When the lane contains dozens of targets, use the broad-lane thread cap instead of the small-selection thread cap; otherwise `threads=4` can multiply into high load, 10-minute target timeouts, and false failures even though the tests are correctly outside the shared pass.
- **Give concurrent verify passes distinct Buck isolations and a staged start**: after the serial `verify:isolated` pass, `verify:resource-limited` may overlap with the normal shared pass only from a distinct top-level Buck isolation and after the broad shared startup surge has passed. Reusing the same `--isolation-dir` makes the delayed `buck2 test` wait behind the shared command instead of overlapping; starting the bounded lane too early recreates load amplification. Current full-suite evidence supports the default 900s broad-run delay.
- **Mark temp-repo dev-server tests as `verify:isolated` when startup latency matters**: scaffolding tests that run `runInTemp`, refresh lockfiles/hashes, build `node_modules`, and wait for a live dev server should not share the main verify pass with hundreds of other actions. If a saved log shows steps like `pnpm --lockfile-only`, `node-modules-build`, or server readiness suddenly inflating only under broad verify, treat missing isolation labels as a systemic execution regression.
- **Keep heavy template-owned runtime tests registered in `template_conventions.bzl`**: template tests only get `verify:isolated` if the convention layer actually assigns labels. A temp-repo dev-server test with no convention entry silently falls into the shared pass, so add or update the convention metadata in the same PR as the test.
- **Classify new deployment-owned Nix support files explicitly**: when adding reviewed deployment support modules under `viberoots/build-tools/tools/nix/`, add them to `viberoots/build-tools/tools/lib/deployment-verify-scope.ts` and the corresponding boundary docs/tests in the same PR. Leaving them unclassified makes deployment-aware verify fail closed to full `//...` scope and turns a small deployment/docs change into a suite-wide timing regression.
- **Keep temp deployment fixtures internally consistent across all referenced targets**: if a temp repo rewrites shared deployment policy files (for example `projects/deployments/*-shared/TARGETS`), preserve every target that other seeded deployments still reference. Missing sibling policies can force `resolveAllDeployments()`/Buck fallback scans into hard failures or long retry loops that appear in verify logs as “stuck” deployment tests rather than a clear configuration error.
- **Avoid eager deployment-wide discovery in no-op admission paths**: admission/prerequisite helpers should not call `resolveAllDeployments()` when the deployment has no prerequisites, or when all prerequisite providers are already explicit. Eager discovery starts nested Buck daemons in otherwise pure tests and can inflate full-suite resource fan-out.
- **Keep template-selector scope narrow for template PRs**: for template updates, ensure changed template-owned tests are registered in `viberoots/build-tools/tools/tests/template_conventions.bzl`; otherwise selector mode can drift to `mixed` and trigger full build-system verify scope.
- **Do not treat `viberoots/build-tools/tools/scaffolding/templates/<lang>/README.md.jinja` as a template id**: this file is shared template guidance, not a concrete template directory. If selector output shows ids like `ts/README.md.jinja`, fix selector/template-id parsing first, because this causes avoidable mixed-mode scope expansion.
- **Keep locked Node installs off the shared prefetched-store evaluation path**: when `mkNodeModules` already has a lockfile-specific fixed pnpm store, treat that as the primary source. Do not snapshot the shared unified prefetched store with `builtins.path` just to seed a locked install; it makes every locked Node derivation sensitive to unrelated cache corruption and adds large per-target copy cost.
- **Re-profile top offenders in isolation before broad tuning**: run `TEST_TIMING=summary v //:slow_target` for the top entries from `latest.log` to separate true per-target cost from suite fan-out contention.
- **Treat empty numeric env vars as unset**: parsing `""` with `Number(...)` yields `0`. For polling/time-budget envs (for example `VERIFY_SAFETY_RAILS_POLL_SECS`), this can silently force aggressive loops (for example 1s polling) and add suite-wide process churn. Parse empty strings as unset and apply explicit defaults first.
- **Keep `gomod2nix` incremental**: avoid shelling out to `gomod2nix` when `go.mod` has no `require/replace`; write/validate the minimal `gomod2nix.toml` directly, and skip project scans when `go.mod`/`go.sum` mtimes are older than `gomod2nix.toml`.
- **Prefer bounded-concurrency seed copies**: per-file copy loops in temp-repo setup can become global bottlenecks under verify fan-out; use bounded parallel file copies rather than fully serial recursion.
- **Avoid parallel `direnv exec` for profiling**: concurrent `direnv`/Nix eval can block on `.direnv/flake-profile` and distort timing; collect timing baselines with serialized runs.
- **Keep Nix GC idle during verify**: active `nix store gc`/`nix-store --gc` can contend on `/nix/var/nix/db/db.sqlite` and can invalidate just-realized store paths during temp-repo tests. Verify waits briefly for active GC and fails before Buck starts if GC remains active. Stop GC jobs and re-run before diagnosing target-level regressions. `l --status` / `s` will show `GC detected: yes` when the log contains a GC preflight warning.
- **Preview maintenance cleanup before running it**: use `viberoots gc --dry-run` to inspect Nix and local generated-state cleanup candidates before mutating the checkout. Do not run `viberoots gc` while verify is active. Keep `viberoots gc --optimize` opt-in maintenance, not a default speed fix.
- **Keep macOS metadata indexing out of verify temp trees**: on Darwin, verify keeps high-churn temp repos under `/tmp/viberoots-verify-$USER.noindex/tmpdir` instead of the watched checkout or per-user `/var/folders` temp area, clears stale current and legacy repo-local `buck-out/tmp/tmpdir*` contents at startup when not in explicit concurrent-verify mode, and writes `.metadata_never_index` markers under generated output/temp roots. If `fseventsd`, `mds`, or `mds_stores` stays near the top of `ps` or pass/min drops sharply, treat that as run-level contention and investigate the temp-root policy before accepting full-suite timing evidence.
- **Preserve metadata exclusion markers during cleanup**: cleanup may remove verify-owned `buck-out` children such as `v-*`, `verify-nested-*`, `tmp`, and `test-logs`, but it must not delete `.metadata_never_index`. Removing the marker after every verify can make the next broad run pay Spotlight/FSEvents contention even when temp repos themselves live under `.noindex`.
- **Treat invalid store-path errors during verify as GC-corruption signals for that run**: if logs include `error: path '/nix/store/... .drv' is not valid` together with verify GC warning/notice lines, treat the run as tainted by concurrent store mutation. Stop GC and re-run the affected targets first; do not use that run for regression attribution.
- **Keep Nix store optimisation out of the default verify path**: `v` skips `nix store optimise` unless `VERIFY_NIX_OPTIMISE=1` or `VERIFY_NIX_OPTIMIZE=1` is set. Treat optimisation as explicit recovery/maintenance work, not normal test setup.
- **Do not pre-block lockfile generation on GC process presence alone**: lockfile paths should attempt work first and only wait/retry when an actual lockfile-generation failure occurs with active GC. Process-presence gating can create deterministic multi-minute stalls/failures even when lockfile generation would have succeeded immediately.
- **Do not add bare `import "zx/globals"` to modules imported from temp repos**: that works only when `zx` is resolvable from the current workspace. Shared modules used by `runInTemp`, scaffolding temp repos, or patch workflows must load zx via `zx-init.mjs` or `viberoots/build-tools/tools/lib/ensure-zx-globals.ts`; otherwise Linux temp-repo runs can fail with `ERR_MODULE_NOT_FOUND` even though repo-local runs pass.
- **Use update-specific filtered snapshots for every pnpm hash build**: never pass the live root or non-default importer worktree directly to Nix. Create a fresh importer-scoped snapshot around each fixed build so relevant untracked inputs are visible and a post-hash retry cannot reuse stale metadata.
- **Use only the targeted fixed-output mismatch path**: for pnpm-store hash refresh, let the fixed-output derivation report one authoritative `specified`/`got` block for the expected lock-derived derivation. Reject unrelated, duplicate, or wrong-specified mismatch text without metadata mutation.
- **Reuse immutable outputs by their committed fixed path**: a warm resolver probe should validate and return the existing FOD without copying it into another cache or store family. Repeated builds of unchanged metadata should create no new large path.
- **Update contract tests when script wiring moves**: if `package.json` command wiring is delegated into `scripts/*.mjs`, update contract assertions to validate script entrypoints plus script-file contents. Leaving assertions on old inline command text causes deterministic contract failures and unnecessary verify churn.
- **Use canonical module-contract paths in tests**: when validating TS/WASM manifests, resolve paths via `resolveModuleContractsPaths(...)` (buck-out contracts) instead of polling source-tree manifest files. Polling removed source paths creates deterministic `ENOENT` retry loops that look like contention but are systemic test/runtime regressions.
- **Keep derivation build phases daemon-free**: avoid `nix-store`/`nix` introspection inside `runCommand` phases used by planner/test paths. Those calls can stall in sandboxed builds and create suite-wide timeout cascades.
- **Keep repo-local Buck isolation cleanup ownership-aware**: stale `buck-out/v-*` and `buck-out/verify-nested-*` directories should be pruned only when their encoded owner PID is no longer alive; never delete shared isolation dirs such as `exporter-shared-*` or `devbuild-shared-*` as part of automatic verify cleanup.
- **Keep missing-temp Buck daemon cleanup evidence-based**: do not rely on `buck2d[basename]` matching alone after a temp root is removed. Ownerless `zxtest-*`/verify daemons may be killed only when their cwd or forkserver state proves they belong to a missing verify temp repo; this preserves concurrent `v` runs while still reaping orphaned daemons.
- **Reap temp-repo Buck forkservers explicitly and narrowly**: successful Buck commands can still leave `buck2-forkserver` processes under a temp repo's `buck-out` state dir. Cleanup should detect and terminate only forkservers whose `--state-dir` or cwd is inside the owned temp repo, then assert none remain. Do not broaden cleanup to unrelated Buck clients, shared exporter/devbuild isolations, or live concurrent `v` runs.
