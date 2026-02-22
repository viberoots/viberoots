## PR 8.5 — Vite-based Webapp Template (projects/apps/\*)

This document specifies the design for adding a Vite + TypeScript webapp template to the scaffolding system, with importer‑scoped provider wiring, hermetic production builds through Nix and Buck, and a clean developer experience for dev mode with HMR/Fast Refresh that does not compromise our build philosophy.

Command examples use `scaf new ts ...` for template identity; `node` terminology remains runtime/toolchain naming.

### Goals

- **Scaffold** a minimal, framework‑neutral “vanilla TS” Vite webapp under `projects/apps/*`.
- **Wire** importer‑scoped Node providers and Buck auto‑map labels for precise invalidation.
- **Build** production artifacts hermetically (Nix derivation invoked via Buck macro).
- **Develop** with fast feedback (Vite dev server, HMR/Fast Refresh) without changing hermetic production rules or introducing non‑determinism.

### Scope (What lands in this PR)

- **New scaffold template:** `build-tools/tools/scaffolding/templates/node/webapp-static`
  - Files: `index.html`, `src/main.ts`, `src/style.css`, `vite.config.ts`, `.npmrc`, `tsconfig.json`, `package.json`, `TARGETS`
- **Scaffolding CLI:** expose template via `scaf new ts webapp-static <name>`; integrate with `build-tools/tools/scaffolding/new-pnpm-project.ts` as `--kind webapp`.
- **Labels & providers:** template `TARGETS` includes `labels = ["lockfile:projects/apps/<name>/pnpm-lock.yaml#projects/apps/<name>", "lang:node", "kind:app"]` so `gen-auto-map.ts` maps to the importer‑scoped provider.
- **Buck macro (initial):** add `node_webapp(...)` to `build-tools/node/defs.bzl` that stamps labels and appends providers from `//third_party/providers:auto_map.bzl`, and uses a zx shim to copy a Nix‑built `dist/` into `$OUT`.
- **Tests:** add a zx test that scaffolds a webapp, refreshes glue, asserts correct provider mapping, and asserts `dist/index.html` materializes via Buck.

### Out of Scope (separate PRs)

- Generic Node macros (PR5) alignment (if additional shared helpers are introduced).
- Framework‑specific templates (React/Vue/Svelte), SSR, routing, or advanced Vite plugins.

## Design Details

### Template contents (generated under `projects/apps/<name>`)

- `.npmrc` (strict isolation + patch location)

```ini
node-linker=isolated
patches-dir=patches/node
```

- `package.json` (minimal, pinned where reasonable)

```json
{
  "name": "@projects/apps/{{ name }}",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "eslint .",
    "format": "prettier -w .",
    "test": "echo \"(add tests)\" && exit 0"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "eslint": "^9.13.0",
    "prettier": "^3.3.3"
  }
}
```

- `tsconfig.json` (ES2022, ESM, outDir=dist; no runtime zx)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "outDir": "dist",
    "declaration": false,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- `vite.config.ts` (deterministic, framework‑neutral)

```ts
import { defineConfig } from "vite";

export default defineConfig({
  appType: "spa",
  build: {
    target: "es2022",
    sourcemap: false,
    cssMinify: true,
  },
  server: {
    strictPort: true,
  },
});
```

- `index.html` + `src/main.ts` + `src/style.css` (hello world baseline)

- `TARGETS` (macro call + importer‑scoped label)

```starlark
load("//build-tools/node:defs.bzl", "node_webapp")

node_webapp(
    name = "app",
    labels = [
        "lockfile:projects/apps/{{ name }}/pnpm-lock.yaml#projects/apps/{{ name }}",
        "lang:node",
        "kind:app",
    ],
)
```

### Buck macro: `node_webapp(...)`

- **Responsibilities**
  - Enforce exactly one importer‑scoped lockfile label (`lockfile:<path>#<importer>`).
  - Stamp labels via `build-tools/lang/defs_common.bzl` (`lang:node`, `kind:app`).
  - Append provider deps from `//third_party/providers:auto_map.bzl` for `//pkg:name`.

- **Build behavior**
  - Expand to a `genrule` that calls a zx shim to `nix build .#node-webapp.<importer>` and copies the derivation’s `dist/` into `$OUT` (no network; pinned inputs).

### Nix builder

- Flake output: `packages.<system>.node-webapp.<importer>`
  - Inputs: importer root, `pnpm-lock.yaml`, per‑importer `node-modules` derivation, pinned Node toolchain and `vite`.
  - Action: run `vite build` in a pure derivation, output `dist/`.
  - Determinism: set `SOURCE_DATE_EPOCH`, avoid nondeterministic minification and absolute paths. No network.

### Glue sequence and labels

- After scaffolding (or when lockfile changes), run:
  - Node providers + downstream glue (canonical): `node build-tools/tools/buck/sync-providers.ts --lang node`
- The template’s importer‑scoped label ensures only targets that depend on `projects/apps/<name>`’s lockfile provider are invalidated when patches/lockfile change.

## Developer Experience: Dev Mode with HMR / Fast Refresh

We enable fast local iteration via Vite’s dev server while preserving hermetic, deterministic production builds.

### Principles

- **Separation of concerns:**
  - Dev server (HMR) runs outside Buck/Nix, by design, for speed and interactivity.
  - Production builds flow through Nix derivations invoked by Buck, with no network.
- **No compromise to hermeticity:**
  - Buck builds never rely on dev‑server outputs and never run Vite in watch/HMR mode.
  - Dev server uses the importer’s dependency graph only; it does not mutate committed inputs.

### How to run dev mode

- Enter the repo dev shell (direnv/nix develop) so required tools are present and a read‑only symlink to the importer’s `node_modules` is provided.
- In the webapp directory:

```bash
cd projects/apps/<name>
pnpm dev
```

- Vite serves with HMR on a fixed port (`server.strictPort=true`); change port via CLI if needed.

### Compatibility with hermetic builds

- The dev shell links the Nix‑built, content‑addressed `node_modules` for the importer. The dev server reads from that path; writes go to `.vite` cache and project files only.
- **No cross‑contamination:** dev server does not write into `node_modules`; `.npmrc` uses `node-linker=isolated` to prevent shadow deps.
- **Testing during dev:** continue to run Buck tests (impacted or full) separately. The dev server is for UX iteration only.

### Guardrails

- Prebuild guard remains unchanged; it checks glue presence, not dev status.
- Provider wiring is unaffected by running the dev server; only lockfile/patches and glue influence providers.
- Do not commit dev artifacts (`dist/`, `.vite/`); production `dist/` is produced by Nix and materialized by Buck.

## Tests

- Add zx test `build-tools/tools/tests/scaffolding/webapp.scaffold-and-build.test.ts` (one test per file):
  - Scaffold `projects/apps/demo-web`.
  - `pnpm -w install --lockfile-only` in `projects/apps/demo-web`.
  - Run Node provider sync and auto‑map.
  - Assert `auto_map.bzl` maps `//projects/apps/demo-web:app` to the expected importer provider.
  - `buck2 build //projects/apps/demo-web:app` and assert the artifact contains `dist/index.html`.

- Add zx test `build-tools/tools/tests/scaffolding/webapp.dev-server.running.test.ts` (one test per file):
  - Create a temporary copy of the repo for the test using rsync, excluding `.git`, `node_modules`, `coverage`, and `.clinic` so the main repo is untouched.
  - In the temp repo, scaffold `projects/apps/demo-web`.
  - Enter the dev shell (direnv) and install dependencies for only this importer using our installer (e.g. `node build-tools/tools/dev/install-deps.ts --importer projects/apps/demo-web`) so installs do not affect the main repo.
  - Start the dev server in `projects/apps/demo-web` (e.g. `pnpm dev` with `server.strictPort=true`, optionally setting a known free port) in the background and wait until it is ready.
  - Probe `http://127.0.0.1:<port>/` and assert HTTP 200 and expected content (e.g. the page title or root element) to verify it is running.
  - Ensure the server is terminated at the end of the test and apply an external timeout guard so the test cannot hang indefinitely.

## Dependencies & Sequencing

- Assumes per‑importer Nix `node_modules` derivations are implemented.
- Integrates with PR5 — generic Node macros — to align `node_webapp` with shared helpers as they land.

## Risks & Mitigations

- **Vite/TypeScript version drift:** pin versions in template; for Nix builder, pin toolchain inputs.
- **Macro overlap with PR5:** if PR5 already provides a suitable macro, implement `node_webapp` as a thin wrapper or alias to avoid duplication.

## Rollout Plan

1. Land template + scaffolding CLI integration and macro using Nix builder.
2. Add zx test for provider wiring and Buck build producing `dist/`.

## Quickstart (after scaffolding)

```bash
# Create
scaf new ts webapp-static demo --yes

# Lockfile-only for stable inputs
(cd projects/apps/demo && pnpm -w install --lockfile-only)

# Glue
node build-tools/tools/buck/sync-providers.ts --lang node

# Dev mode (HMR)
(cd projects/apps/demo && pnpm dev)

# Production build via Buck
buck2 build //projects/apps/demo:app
```

## Acceptance Criteria

- `scaf new ts webapp-static <name>` generates a working project with `.npmrc`, `package.json`, Vite config, TS config, sources, and `TARGETS`.
- Glue steps produce an importer‑scoped provider and auto‑map entry for `//projects/apps/<name>:app`.
- `buck2 cquery 'deps(//projects/apps/<name>:app)'` shows the importer provider.
- `buck2 build //projects/apps/<name>:app` yields an artifact containing `dist/index.html`.
