# Tooling Rules (zx / Node scripts)

This repository has a lot of automation under `build-tools/tools/`. These scripts run in multiple contexts:

- local shells (often via `direnv exec .`)
- Buck actions and zx tests (often in temp workspaces)
- CI

To keep behavior deterministic and avoid drift, I follow the rules below when I add or modify tooling.

## Top-level layout anchors

I keep stable anchor directories for the reorg. These are structural only:

- `build-tools/` — build system and tooling anchor
- `projects/apps/` — application roots
- `projects/libs/` — library roots
- `build-tools/docs/` — build-system docs
- `build-tools/docs/lang/` — language-specific build docs
- `docs/history/build-system/logs/` — historical build notes

## CLI parsing (required)

Tooling scripts must not hand-roll argument parsing. This prevents subtle mismatches across:

- zx-populated `globalThis.argv`
- plain Node invocation (`process.argv`)
- `runNodeWithZx` call sites (which depend on consistent argv behavior)

### Use these helpers

- **Flags**: `build-tools/tools/lib/cli.ts`
  - `getFlagStr`, `getFlagBool`, `getFlagList`, `hasFlag`
- **Positionals**: `build-tools/tools/lib/cli.ts`
  - `getArgvTokens` (argv tokens), `getPositionals` (positionals-only)
- **Free-form `--key=value` flag maps**: `build-tools/tools/lib/cli.ts`
  - `parseFlagMap(...)` (used by `scaf`)

### Avoid these patterns

- `process.argv.slice(2)`
- `process.argv.indexOf(...)` / `process.argv.findIndex(...)`
- reading `(globalThis as any).argv` directly

## Invoking one tool from another

When one tool needs to invoke another TypeScript zx script, use `build-tools/tools/lib/node-run.ts:runNodeWithZx`.

This keeps Node flags, zx init, and exit-code propagation consistent.

## Patch tooling boundaries (required)

Patch tooling is split into small entrypoints under `build-tools/tools/patch/` and shared helper modules under `build-tools/tools/patch/lib/`.

To keep patch behavior consistent across languages and avoid reintroducing drift, patch tooling entrypoints must delegate to the shared helper surfaces rather than implementing local one-off logic.

### Helper surfaces you must use

- **Importer-local patch directory resolution (Node + Python)**: `build-tools/tools/patch/lib/importer-local-patch-dir.ts`
  - Entry points must call `resolveImporterLocalPatchDir(...)`.
  - Do not assemble `<importer>/patches/<lang>` paths directly.
- **Workspace-based patch workflow (Go + Python)**: `build-tools/tools/patch/lib/workspace-workflow.ts`
  - Entry points must call `startWorkspaceWorkflow(...)`, `applyWorkspaceWorkflow(...)`, and `resetWorkspaceWorkflow(...)`.
  - Do not reimplement session reuse, no-op apply cleanup, or patch verification at call sites.

### Enforcement test

The repository includes an enforcement-style test that scans patch tooling for known drift patterns:

- Test: `build-tools/tools/tests/patching/patch-tooling.helper-boundaries.enforcement.test.ts`

When this test fails, the fix is to move the flagged logic behind the canonical helper surfaces listed above. If the test is a false positive, tighten the patterns rather than disabling the enforcement.

## The `codex` wrapper (agent CLI)

The repository ships a `codex` wrapper at `build-tools/tools/bin/codex` that layers a per-invocation macOS safehouse, worktree management, and a multi-account layer over the upstream `codex` CLI. The multi-account layer (rebinds `CODEX_HOME` per-account; supports `--account`, `--list-accounts`, `--remove-account`, guided `codex login`) is specified in [docs/history/designs/codex-wrapper-accounts-design.md](../history/designs/codex-wrapper-accounts-design.md). Account argv parsing, canonical resolution, structured auth inspection, login/removal lifecycle, listing, and NUL-delimited wrapper transport live in `build-tools/tools/dev/codex-accounts.ts` and its focused `codex-accounts/` modules. The Bash wrapper remains the tool-discovery, Safehouse, and worktree boundary.

## The `happy` CLI

The root tooling importer pins `happy-coder` exactly and exposes its `happy` and `happy-mcp`
commands through the normal devshell `PATH`. This makes both commands available from consumer
project directories after direnv activation without a user-level npm installation. The npm registry
marks `happy-coder` as deprecated in favor of the renamed `happy` package; the existing pin keeps the
requested package identity explicit until that migration is reviewed. Its dependency graph adds
approximately 4 GiB to the shared pinned canonical `node_modules` realization and local Nix cache.
That cost, together with the upstream rename, motivates reviewing a migration to `happy` rather than
carrying the deprecated package indefinitely.
