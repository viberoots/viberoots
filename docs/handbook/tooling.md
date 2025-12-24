# Tooling Rules (zx / Node scripts)

This repository has a lot of automation under `tools/`. These scripts run in multiple contexts:

- local shells (often via `direnv exec .`)
- Buck actions and zx tests (often in temp workspaces)
- CI

To keep behavior deterministic and avoid drift, I follow the rules below when I add or modify tooling.

## CLI parsing (required)

Tooling scripts must not hand-roll argument parsing. This prevents subtle mismatches across:

- zx-populated `globalThis.argv`
- plain Node invocation (`process.argv`)
- `runNodeWithZx` call sites (which depend on consistent argv behavior)

### Use these helpers

- **Flags**: `tools/lib/cli.ts`
  - `getFlagStr`, `getFlagBool`, `getFlagList`, `hasFlag`
- **Positionals**: `tools/lib/cli.ts`
  - `getArgvTokens` (argv tokens), `getPositionals` (positionals-only)
- **Free-form `--key=value` flag maps**: `tools/lib/cli.ts`
  - `parseFlagMap(...)` (used by `scaf`)

### Avoid these patterns

- `process.argv.slice(2)`
- `process.argv.indexOf(...)` / `process.argv.findIndex(...)`
- reading `(globalThis as any).argv` directly

## Invoking one tool from another

When one tool needs to invoke another TypeScript zx script, use `tools/lib/node-run.ts:runNodeWithZx`.

This keeps Node flags, zx init, and exit-code propagation consistent.
