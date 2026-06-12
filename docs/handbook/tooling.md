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
