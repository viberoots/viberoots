# Exploratory Issues 2026-07-07

Tracking issues found during manual flake-mode exploration in `unfairly-common`.

## Issue 1: scaf terminal output wraps poorly

- Status: fixed
- Symptom: `scaf help` and `scaf templates` include long lines that wrap poorly in a terminal.
- Root cause: `scaf templates` printed raw tab-separated template metadata, including long descriptions and unwrapped comma lists of template variables. Detailed `scaf help <language> <template>` output printed long usage, note, and example strings directly from template metadata.
- Fix: Added terminal-width-aware formatting helpers for template lists and hanging-indent text. `scaf templates`, default `scaf help`, `scaf help new <language>`, and detailed template help now use aligned rows and wrapped continuation lines. The default template catalog is grouped by language and omits variable lists for scanability; `scaf templates --details` and `--json` keep the detailed reference data available.
- Verification: `./build-tools/tools/bin/v build-tools/tools/tests/scaffolding/help.new-list.test.ts` passed as part of the focused impacted set. A follow-up scaffold verification also passed for `help.new-list`, `help.templates-json`, and `scaf.template-manifest-preflight`. Manual source-root-cleared checks showed grouped `scaf templates`, detailed `scaf templates ts --details`, and wrapped `scaf help ts webapp-ssr-vite` output at terminal widths.

## Issue 2: webapp scaffold lockfile write gets EACCES

- Status: fixed
- Symptom: `scaf new ts webapp-ssr-vite demo-webapp` failed writing `projects/apps/demo-webapp/pnpm-lock.yaml` with `EACCES`.
- Root cause: In flake mode, templates are copied from the Nix store through `.viberoots/current`, so Copier can materialize generated files with read-only owner bits. The importer lockfile refresh ran before the later formatting path that already made lockfiles writable, so `pnpm-lock.yaml` could still be read-only when the lockfile command tried to update it.
- Fix: Added `ensureScaffoldTreeWritable(dest)` immediately after Copier finishes and before scaffold post-processing, lockfile refresh, and formatting.
- Verification: `./build-tools/tools/bin/v build-tools/tools/tests/scaffolding/scaf-format-writable.test.ts` passed as part of the focused impacted set, including a regression that chmods a copied tree read-only and verifies owner write bits are restored.

## Issue 3: `d` default target and `d .` target normalization

- Status: fixed
- Symptom: `d` without arguments prints usage instead of defaulting to `.`, and `d .` resolves to an invalid Buck pattern `//projects/apps/demo-webapp`.
- Root cause: `run-runnable` rejected an omitted target before resolution instead of treating it as the current directory. Separately, runnable label resolution returned a package label when graph data did not already contain a runnable node for the package. Buck requires a concrete target label, so newly scaffolded or stale-graph package paths could reach Buck as invalid patterns.
- Fix: `run-runnable` now resolves an omitted target as `"."`. Runnable package-label fallback now returns the conventional `:app` target when no runnable graph node is available, while still preserving ambiguity errors.
- Verification: `./build-tools/tools/bin/v build-tools/tools/tests/dev/runnable-commands.package-label-resolution.test.ts` passed as part of the focused impacted set, including regressions for no-arg `d` and stale-graph directory fallback to `//projects/apps/demo:app`.

## Issue 4: managed agent wrappers missing from project directories

- Status: fixed
- Symptom: `codex` reports a missing managed binary under the flake source store path, and `claude` is not found in PATH, even after `i`.
- Root cause: In flake consumer workspaces, `VIBEROOTS_SOURCE_ROOT` can point at `.viberoots/current` or a Nix store source tree that does not have runtime `node_modules`. The dev shell already knows the materialized node package location as `VIBEROOTS_NODE_PATH`, but the `codex` and `claude` wrappers and PATH setup did not consistently use it. A stale already-loaded shell can also have `VIBEROOTS_NODE_PATH` refreshed to a newer store path while `PATH` still contains the previous source-linked managed Codex path.
- Fix: The dev shell now puts `${VIBEROOTS_NODE_PATH}/.bin` on PATH for flake consumer workspaces. The Codex wrapper accepts managed Codex binaries from both `VIBEROOTS_NODE_PATH` and the source-root `node_modules`, while still rejecting app Codex and transient arg0 shims. Its missing-binary hint was simplified. The Claude wrapper now resolves native optional package binaries through `VIBEROOTS_NODE_PATH`.
- Verification: `./build-tools/tools/bin/v build-tools/tools/tests/dev/codex-wrapper.safehouse.test.ts build-tools/tools/tests/dev/claude-wrapper.native-resolution.test.ts` passed as part of the focused impacted set, including regressions for `VIBEROOTS_NODE_PATH` resolution. A direct `./build-tools/tools/tests/dev/codex-wrapper.safehouse.test.ts` run later passed with an added stale-shell regression, and `codex --version` worked from `/Users/kiltyj/Code/common`.

## Issue 5: `sprinkleref --init-local` writes nested `projects/projects`

- Status: fixed
- Symptom: Running local SprinkleRef initialization from `~/Code/unfairly-common/projects` created `projects/projects/config/local.json`.
- Root cause: `initLocalSprinkleRefValues` resolved the fixed `projects/config/local.json` path relative to `process.cwd()`. From a subdirectory such as `projects/`, that became `projects/projects/config/local.json`.
- Fix: `initLocalSprinkleRefValues` now resolves the workspace root with `findRepoRoot(cwd)` before appending `projects/config/local.json`.
- Verification: Added a regression for running `sprinkleref --init-local` from a `projects/` subdirectory. A minimal direct Node exercise from a temp repo layout wrote `/private/tmp/.../projects/config/local.json` and verified no nested `projects/projects/config/local.json` was created. The broader deployment test file was not run to completion because its unrelated setup-heavy cases are slow in this sandbox and emit Nix cache warnings.

## Focused Verification

- Passed: `./build-tools/tools/bin/v build-tools/tools/tests/scaffolding/scaf-format-writable.test.ts build-tools/tools/tests/scaffolding/help.new-list.test.ts build-tools/tools/tests/dev/runnable-commands.package-label-resolution.test.ts build-tools/tools/tests/dev/codex-wrapper.safehouse.test.ts build-tools/tools/tests/dev/claude-wrapper.native-resolution.test.ts`
- Passed after scanability follow-up: `./build-tools/tools/bin/v build-tools/tools/tests/scaffolding/help.new-list.test.ts build-tools/tools/tests/scaffolding/help.templates-json.test.ts build-tools/tools/tests/scaffolding/scaf.template-manifest-preflight.test.ts`
