# Patching Handbook (Go)

All scripts are zx TypeScript using `#!/usr/bin/env zx-wrapper`.

## Workflow

- Start: `tools/bin/patch-pkg start go <importPath>`
- Apply: `tools/bin/patch-pkg apply go <importPath>`
- Reset: `tools/bin/patch-pkg reset go <importPath>`
- Session: `tools/bin/patch-pkg session go <importPath>` (Ctrl-D=apply, Ctrl-C=reset)

## Canonical filenames

`patches/go/<encodedImport>@<version>.patch` (flat). One patch per `module@version`.

## Session store

`.patch-sessions.json` at repo root tracks local workspaces. It is ignored by Git and is local-only.

## Idempotency

Re-applying an unchanged workspace is a no-op. On apply, provider sync and auto-map generation run automatically.

## CI guardrails

`NIX_GO_DEV_OVERRIDE_JSON` warnings locally; CI fails if set.
