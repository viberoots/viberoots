# Patching Handbook (Go & Node)

Note: For per-target local patching of Go and C++, see `go-cpp-local-patching.md`. That guide covers placing patches under each target’s package directory (for example, `apps/<app>/patches/go` or `libs/<lib>/patches/cpp`) and how local patch directories integrate with the build. The global `patches/go` flow below remains supported where applicable but local patching is the default developer experience for new scaffolds.

All scripts are zx TypeScript using `#!/usr/bin/env zx-wrapper`.

## Workflow

- Start: `tools/bin/patch-pkg start go <importPath>`
  - Creates a writable workspace over the Nix store source for the module.
  - macOS uses APFS CoW (`cp -cR`) when available; otherwise falls back to `cp -a`. Other platforms use `cp -a`.
  - Writes/updates `NIX_GO_DEV_OVERRIDE_JSON` for the current `module@version` key.
  - If `PATCH_EDITOR` is set, launches it with the workspace.

- Apply: `tools/bin/patch-pkg apply go <importPath>`
  - Produces a unified diff into the canonical filename under `patches/go/`.
  - Clears dev overrides and removes the workspace.
  - Runs glue steps: sync providers → generate auto_map (see below).

- Reset: `tools/bin/patch-pkg reset go <importPath>`
  - Abandons changes, clears dev overrides, deletes the workspace.

- Session: `tools/bin/patch-pkg session go <importPath>` (Ctrl-D=apply, Ctrl-C=reset)
  - Interactive session that ends by applying or resetting.

## Canonical filenames

`patches/go/<encodedImport>@<version>.patch` (flat directory). One patch per `module@version`.

## Session store

`.patch-sessions.json` at repo root tracks local workspaces. It is ignored by Git and is local-only.

## Idempotency

Re-applying an unchanged workspace is a no-op. On apply, provider sync and auto-map generation run automatically.

## Glue regeneration

Local glue is not committed. Regenerate after apply or on-demand:

- Export graph: `node tools/buck/export-graph.ts --out tools/buck/graph.json`
- Sync providers: `node tools/buck/sync-providers.ts`
- Generate auto_map: `node tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`

Running `node tools/dev/install-deps.ts` in the dev shell runs the full sequence automatically. CI runs the same as separate stages.

## CI guardrails

Local builds warn when `NIX_GO_DEV_OVERRIDE_JSON` is set; CI fails if it is set.

In addition, CI enforces patch directory invariants for Go:

- Flat `patches/go` directory (no subdirectories)
- Files must be `.patch` only
- Exactly one patch per `module@version`

Locally, run advisory mode:

```
node tools/dev/patches-lint.ts --lang go
```

In CI, strict mode runs and exits nonzero on violations:

```
node tools/ci/run-stage.ts --stage patches-lint
```

## Node (PNPM) — importer‑local patches and invalidation

- Node targets use importer‑scoped lockfile labels: `lockfile:<path/to/pnpm-lock.yaml>#<importer>`.
- The Node macros include importer‑local patch files in `srcs` to achieve precise Buck invalidation, mirroring Go:
  - Patches live under `<importer>/patches/node/*.patch` (e.g., `apps/web/patches/node/...`).
  - Changing a patch only invalidates Node targets bound to that importer.
- Provider stamps for Node are importer‑scoped and do not reference patch files as `srcs` (see Provider sync cookbook below); correctness comes from macro‑side `srcs` inclusion.

Quick checks and guidance:

- Ensure exactly one `lockfile:<path>#<importer>` label is present on each Node target (the macros enforce this).
- Place patches under the importer’s `patches/node/` directory; no cross‑package references.
- Regenerate glue as needed (export graph → sync providers → gen auto_map). The prebuild guard will auto‑fix locally or fail fast in CI.
