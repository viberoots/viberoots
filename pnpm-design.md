## PNPM Monorepo Design for this Repository

This document proposes how to add first-class PNPM projects to this monorepo, integrating cleanly with Buck2 and Nix while preserving existing conventions. It summarizes options, recommends a path, and outlines phases to adopt it incrementally.

### Goals

- **Workspaces:** Enable PNPM workspaces under `apps/*` and `libs/*` (no `packages/*`) without breaking the root `package.json` dev tooling.
- **Hermeticity:** Keep installs reproducible using Nix; prefer immutable `node_modules` realized in the Nix store, symlinked in dev shells (see `hermetic-node-modules.md`).
- **Build invalidation:** Use importer‑scoped providers derived from per‑project `pnpm-lock.yaml` for precise Buck2 rebuilds and impacted tests.
- **Patching:** Use PNPM’s native `patchedDependencies` and optional flat `patches/node/*.patch` for advanced cases; wire providers automatically.
- **Scaffolding:** Provide a generator to create a new PNPM project with TS, ESLint/Prettier, and tests.

### Current State (repo)

- Existing glue for Node providers and auto‑map generation:
  - `tools/buck/providers/node.ts`: parses `pnpm-lock.yaml` and emits `TARGETS.node.auto` with one provider per importer.
  - `tools/buck/sync-providers-node.ts`: thin wrapper delegating to the provider driver.
  - `tools/buck/gen-auto-map.ts`: maps target labels to provider deps, including `lockfile:<path>#<importer>`.
  - `hermetic-node-modules.md`: documents immutable, Nix‑built `node_modules`.
- Missing pieces:
  - No committed `pnpm-workspace.yaml` yet.
  - No `third_party/providers/defs_node.bzl` (simple genrule macro placeholder is referenced in docs).
  - No Node Buck macros (we can start with a thin macro over genrules for better DX).

### Decisions captured

- **Per‑project importer‑scoped lockfiles:** Each project under `apps/*` / `libs/*` owns its `pnpm-lock.yaml` and importer key. Labels use `lockfile:<relative/path>#<importer>`.
- **Workspace roots:** Only `apps/*` and `libs/*` are included in `pnpm-workspace.yaml`.
- **Macros vs. raw genrules:** Prefer a thin macro that wraps genrules and injects providers automatically for better DX (details below).
- **Scaffold contents:** Include TypeScript, ESLint/Prettier, and a test setup by default.

### Caching with per‑project lockfiles

- **Nix store:** We still get strong caching. Each importer’s `pnpm-lock.yaml` keys its own pair of derivations (`pnpm-store` FOD and `node-modules`). Unchanged lockfiles are full cache hits. Different importers with overlapping tarballs will reuse the same tarballs via the fixed‑output store content once built.
- **Buck2 invalidation scope:** Importer‑scoped providers ensure that edits to `apps/web/pnpm-lock.yaml` only invalidate targets that depend on `apps/web`’s provider, not the whole repo.
- **Trade‑offs:** More lockfiles means more (smaller) derivations, but better isolation and parallelism. The PNPM global content‑addressable behavior plus Nix FODs preserves efficiency across importers.

### Recommended Approach

1. **Introduce `pnpm-workspace.yaml` (apps/libs only)**
   - Initial contents:
     - `packages: ["apps/*", "libs/*"]`.
   - Keep the root `package.json` for shared dev tools; the root can remain an importer if desired.

2. **Nix hermetic installs (per importer)**
   - Reuse `hermetic-node-modules.md`, but instantiate the derivations per `pnpm-lock.yaml` path (per project importer).
   - Keep the dev shell symlink behavior so tools resolve from Nix‑built `node_modules`.

3. **Provider wiring (already scaffolded)**
   - Add `third_party/providers/defs_node.bzl` with a tiny `node_importer_deps(...)` genrule.
   - Continue to use `tools/buck/sync-providers-node.ts` to emit `TARGETS.node.auto` deterministically from all lockfiles and relevant `patches/node/*.patch`.
   - `gen-auto-map.ts` already maps `lockfile:<path>#<importer>` labels to provider deps used by Buck macros.

4. **Labels on Node targets**
   - For each Node target, include `labels = ["lockfile:<relative/path/to/pnpm-lock.yaml#<importer>"]`.
   - Auto‑map includes the appropriate provider so only impacted targets rebuild.

5. **Scaffolding command**
   - Extend `tools/scaffolding` to create a new PNPM project (e.g., `apps/web` or `libs/utils`) with:
     - `package.json` (name, version, scripts), `pnpm-lock.yaml` (after `pnpm install` run in dev shell), and `.npmrc` if needed.
     - `tsconfig.json` with top‑level await if required by zx scripts; sensible module/target defaults.
     - ESLint + Prettier config aligned with repo standards.
     - `src/index.ts` and `test/example.test.ts` (one-test-per-file style).
     - `TARGETS` stub with Node build/test genrules and the lockfile label.
     - A short README and usage scripts (build/test/lint/format).

### Macros vs. raw genrules (trade‑offs and recommendation)

- **Raw genrules**
  - Pros: maximum flexibility; easy to start.
  - Cons: repetitive wiring of provider deps and labels; inconsistent conventions across projects; harder to evolve.
- **Thin macro over genrules (recommended)**
  - Pros: injects provider deps from `MODULE_PROVIDERS` automatically; enforces presence/shape of lockfile labels; fewer footguns; single place to evolve Node build conventions.
  - Cons: small initial effort to add the macro; still limited by underlying genrule capabilities (which is acceptable for our current needs).
  - **Call:** Implement `//node/defs.bzl` with:
    - `nix_node_gen(...)` and `nix_node_test(...)` — thin wrappers over `genrule` that:
      - enforce exactly one importer‑scoped lockfile label (`lockfile:<path>#<importer>`),
      - stamp `lang:node` and `kind:*`, and
      - append providers from `//third_party/providers:auto_map.bzl` using `MODULE_PROVIDERS["//pkg:name"]`.
    - `nix_node_lib(...)` and `nix_node_bin(...)` — ergonomic aliases that set `kind` to `lib`/`bin` and reuse `nix_node_gen`.
  - Escape hatch: callers may still pass additional `deps` manually when needed.

### Patching workflow

- Default: use `pnpm patch` / `pnpm patch-commit` so patches are captured by the lockfile and flow through Nix.
- Optional advanced: keep `patches/node/*.patch` in a flat dir keyed as `<name>@<version>.patch`; the Node provider sync includes only patches relevant to each importer’s effective set.

### Phases

- **Phase A: Workspace bootstrapping**
  - Add `pnpm-workspace.yaml` with `apps/*` and `libs/*`.
  - Commit minimal `third_party/providers/defs_node.bzl`.
  - Verify `tools/buck/sync-providers-node.ts` runs idempotently with empty or initial projects.

- **Phase B: First PNPM project (per‑project lockfile)**
  - Scaffold `apps/example` with its own `package.json` and `pnpm-lock.yaml`.
  - Add Buck `TARGETS` with `labels = ["lockfile:apps/example/pnpm-lock.yaml#apps/example"]`.
  - Run exporters/generators: export graph → sync node providers → gen auto‑map; build target.

- **Phase C: Hermetic dev shell**
  - Expose per‑importer `.#pnpm-store` / `.#node-modules` derivations and link in shell.
  - Ensure CI stages call Node provider sync and auto‑map before builds (as in `build-system-design.md`).

- **Phase D: Scaffolding command**
  - Add a zx script (e.g., `tools/scaffolding/new-pnpm-project.ts`) to generate the skeleton with TS, ESLint/Prettier, tests, labels, and scripts.

### Completion Criteria

- `pnpm-workspace.yaml` present with `apps/*` and `libs/*`; at least one PNPM project builds under Buck2 with importer‑scoped providers.
- Per‑importer Nix derivations for `node_modules` are documented and linked in the dev shell.
- `TARGETS.node.auto` is generated deterministically and `gen-auto-map.ts` includes Node providers for labeled targets.
- Scaffolding command can create a new PNPM project with TS/ESLint/Prettier/tests and correct labels and scripts.

### Wrapping pnpm patching with our patch-pkg interface

pnpm’s native patch flow maps cleanly to our `patch-pkg` subcommands. We standardize on `patches/node/*` for Node patches so provider wiring picks them up.

Configuration

- Set pnpm’s patches directory to `patches/node` so `patch-commit` writes there by default. Either:
  - Add to the project’s `.npmrc` (preferred per importer):
    - `patches-dir=patches/node`
  - Or set once at the repo root `.npmrc` if you want a shared default for all importers.

Command mapping

- `patch-pkg start node <pkg>` → `pnpm patch <pkg>`
  - Behavior: pnpm returns a temp workspace path. Our wrapper stores it (e.g., under `.tmp/patches-node/<pkg>/…`) and optionally launches `$PATCH_EDITOR`.
- `patch-pkg apply node <pkg>` → `pnpm patch-commit <tempDir>`
  - Behavior: writes `patches/node/<name>@<version>.patch` (via `patches-dir` setting) and updates `pnpm.patchedDependencies` in the importer’s `package.json`.
  - Post‑steps (same turn): run `node tools/buck/sync-providers-node.ts` and `node tools/buck/gen-auto-map.ts` so Buck picks up the provider immediately.
  - Clean up: remove the temp dir.
- `patch-pkg reset node <pkg>` → discard temp dir (no patch written)
  - Behavior: deletes the stored temp path; no changes to files.
- `patch-pkg session node <pkg>` → long‑lived edit session
  - Start with `pnpm patch <pkg>` and open `$PATCH_EDITOR`.
  - On Ctrl‑D (EOF): run `pnpm patch-commit <tempDir>` + provider sync + auto‑map.
  - On Ctrl‑C: discard temp (same as reset).
- `patch-pkg remove node <pkg>` → remove the patch for `<pkg>`
  - If supported: `pnpm patch-remove <pkg>`; otherwise: remove the `<pkg>` entry from `pnpm.patchedDependencies`, delete the corresponding file in `patches/node/*`, then run provider sync + auto‑map.

Notes

- Provider generator already filters `patches/node/*.patch` per importer’s effective set; only relevant patches affect each importer’s provider.
- Because patches are recorded in `pnpm-lock.yaml`/`package.json`, the Nix hermetic flow remains reproducible and cacheable.

### ZX compatibility and consolidation

Our current zx setup remains compatible with PNPM workspaces and the Node provider flow:

- zx bootstrap: `tools/dev/zx-init.mjs` injects zx globals and a resolver, independent of `node_modules` layout. Scripts run via `node --import tools/dev/zx-init.mjs ...` (already handled by helpers).
- Unified glue: `tools/patch/glue.ts` exports `runGlue()` which runs `sync-providers` and `gen-auto-map` with zx flags; `ensureGraph()` calls the exporter when needed. This works for Node as well.
- Orchestrator: `tools/buck/sync-providers.ts` delegates to `tools/buck/providers/index.ts`, which already includes the Node driver (`syncNodeProviders`). No changes needed.

Consolidation and reuse for a Node patch wrapper

- Add `tools/patch/patch-node.ts` implementing `LanguageHandler` using pnpm’s patch flow (see mapping above). It should:
  - Use `.patch-sessions.json` via `tools/patch/state.ts` to track temp edit dirs (language key `node`).
  - On apply/remove, call `runGlue()` from `tools/patch/glue.ts` to update providers and auto_map.
  - Respect `$PATCH_EDITOR` for `start`/`session`.
  - Read and honor `.npmrc` `patches-dir=patches/node` (or set it in process env temporarily) so `patch-commit` writes under `patches/node/`.
- Update `tools/patch/patch-pkg.ts` to accept `node` as a supported language and dynamic‑import `tools/patch/patch-node.ts` (mirroring Go and C++ handlers).
- Keep shared helpers in place:
  - Provider naming stays in `tools/lib/providers.ts`.
  - Provider sync driver already lives at `tools/buck/providers/node.ts`.
  - Auto‑map (`tools/buck/gen-auto-map.ts`) already maps `lockfile:<path>#<importer>` labels to providers.

Net result: zx scripts continue to run the same way (via `tools/bin/patch-pkg` and other zx entrypoints). The Node patch wrapper reuses existing session/glue infrastructure for a consistent developer experience.

### Isolation and non‑inheritance (no shadow dependencies)

Requirements

- Projects under `apps/*` and `libs/*` must not inherit dependencies or devDependencies from the repo root.
- zx bootstrap (`tools/dev/zx-init.mjs`) is for zx scripts only; app/lib runtime must not depend on it or run with the zx loader.

How we enforce this

- Per‑importer lockfiles: each app/lib has its own `package.json` and `pnpm-lock.yaml`; builds key to that importer only.
- No hoisting/shadowing: set `node-linker=isolated` in `.npmrc` (root or per importer) so packages can only access declared deps.
- No global NODE_PATH: do not set `NODE_PATH` in dev shell or CI for app/lib execution; zx scripts run with their own loader via `node --import tools/dev/zx-init.mjs` and do not affect app processes.
- No root devDep leakage: root `package.json` is for repo tooling only (zx scripts, generators). Do not reference root as a workspace dependency. Avoid `workspace:*` pointing to the root.
- Nix hermetic installs: per‑importer `node-modules` derivations materialize exactly the declared graph; the dev shell only symlinks that specific output.

Implication for scaffolding

- Generated projects include their own `package.json`, `.npmrc` (with `patches-dir=patches/node` and `node-linker=isolated`), `pnpm-lock.yaml`, and tool configs (TS, ESLint/Prettier, tests).
- Scripts in apps/libs run with plain `node` (or bundler) without the zx import hook. zx is reserved for `tools/**` scripts.

### Provider Naming and Labeling

Each Node target must include a label identifying its lockfile and importer to enable importer-scoped provider wiring.

#### Label Format

```python
labels = ["lockfile:apps/web/pnpm-lock.yaml#apps/web"]
```

**Format:** `lockfile:<relative-path-to-lockfile>#<importer-id>`

- `<relative-path-to-lockfile>`: Path from repo root to `pnpm-lock.yaml`
- `<importer-id>`: The importer key from the lockfile's `importers` section

**Examples:**

| Target              | Lockfile Path               | Importer ID  | Label                                           |
| ------------------- | --------------------------- | ------------ | ----------------------------------------------- |
| `//apps/web:bundle` | `apps/web/pnpm-lock.yaml`   | `apps/web`   | `lockfile:apps/web/pnpm-lock.yaml#apps/web`     |
| `//libs/utils:lib`  | `libs/utils/pnpm-lock.yaml` | `libs/utils` | `lockfile:libs/utils/pnpm-lock.yaml#libs/utils` |
| `//apps/api:test`   | `apps/api/pnpm-lock.yaml`   | `apps/api`   | `lockfile:apps/api/pnpm-lock.yaml#apps/api`     |

#### Provider Naming Convention

Provider names are generated by `providerNameForImporter(lockfilePath, importer)`:

**Format:** `lf_<hash>_<suffix>`

- `<hash>`: 12-character SHA256 prefix of `${lockfilePath}#${importer}`
- `<suffix>`: Sanitized combination of importer and lockfile path (special chars → `_`)

**Example:**

```typescript
providerNameForImporter("apps/web/pnpm-lock.yaml", "apps/web");
// => "lf_a1b2c3d4e5f6_apps_web__apps_web_pnpm_lock_yaml"
```

**Properties:**

- ✅ Deterministic (same input always produces same output)
- ✅ Collision-resistant (12-char hash from SHA256)
- ✅ Case-sensitive (preserves path casing for lockfile and importer)
- ✅ Fully qualified (`//third_party/providers:<name>`)

#### Effective Set Calculation

The provider includes patches for all packages in the importer's **effective set**:

1. **Direct dependencies** (from `importers.<id>.dependencies`)
2. **Optional dependencies** (from `importers.<id>.optionalDependencies`)
3. **Peer dependencies** (from `importers.<id>.peerDependencies` if resolved)
4. **Transitive dependencies** (depth-first traversal of all deps)
5. **Peer resolution edges** (if package declares peer and resolves it)

**Traversal Algorithm:**

```typescript
// Pseudocode
function effectiveSet(importer):
  roots = importer.dependencies + importer.optionalDependencies + resolved_peers
  visited = {}
  queue = roots
  while queue not empty:
    pkg = queue.pop()
    if pkg in visited: continue
    visited.add(pkg)
    for dep in pkg.dependencies:
      queue.push(dep)
    for peer in pkg.peerDependencies:
      if resolved in pkg.dependencies:
        queue.push(resolved)
  return visited
```

**Result:** Only patches matching packages in the effective set are included in the provider.

#### Why Importer-Scoped?

Importer-scoped providers enable **precise invalidation**:

| Change                                   | Invalidates                    | Does NOT Invalidate                   |
| ---------------------------------------- | ------------------------------ | ------------------------------------- |
| Edit `apps/web/pnpm-lock.yaml`           | `//apps/web:*` targets         | `//apps/api:*`, `//libs/utils:*`      |
| Patch `lodash@4.17.21` used by web only  | `//apps/web:*` targets         | Other importers                       |
| Patch `react@18.0.0` used by web and api | `//apps/web:*`, `//apps/api:*` | `//libs/utils:*` (if not using React) |

**Contrast with Shared Lockfile:**

If we used a single workspace lockfile, ANY change would invalidate ALL Node targets (coarse invalidation). Per-importer lockfiles + importer-scoped providers = **fine-grained Buck2 invalidation**.

### Testing Provider Determinism

The Node provider system has comprehensive tests ensuring deterministic behavior:

#### Test Categories

1. **Idempotency** — Running sync twice with same inputs produces identical output
2. **Determinism** — Provider names and ordering are consistent across runs
3. **Edge Cases** — Empty importers, peer deps, optional deps, scoped packages
4. **Integration** — Auto-map correctly maps lockfile labels to providers
5. **Graceful Degradation** — Missing yaml package, no lockfiles

#### Running Tests

```bash
# Run all Node provider tests
buck2 test //tools/tests/... --filter sync-providers-node
buck2 test //tools/tests/... --filter auto-map.node

# Run with coverage
buck2 test //... -- --env COVERAGE=1
```

#### Adding New Tests

Follow the one-test-per-file convention:

```typescript
#!/usr/bin/env zx-wrapper
import { test } from "node:test";
import { runInTemp } from "../lib/test-helpers";

test("node provider: <specific behavior>", async () => {
  await runInTemp("test-name", async (tmp, $) => {
    // Setup fixture
    // Run provider sync
    // Assert expected output
  });
});
```

**File naming:** `tools/tests/scaffolding/sync-providers-node.<behavior>.test.ts`

### Handbook alignment checklist

- Adding a language: PNPM/Node hooks in as an existing language variant. We reuse the provider sync orchestrator and `gen-auto-map.ts`, and propose a thin Node macro (`//node/defs.bzl`) consistent with `lang/defs_common.bzl` stamping.
- Provider sync cookbook: Covered — Node provider generator exists (`tools/buck/providers/node.ts`), invoked via `tools/buck/sync-providers.ts`, deterministic outputs, and `tools/lib/providers.ts` for naming.
- Macro stamping: Planned — Node macro should call `stamp_labels(lang="node", kind=...)` and append providers from `//third_party/providers:auto_map.bzl`.
- Testing: No changes to harness; zx tests and external timeouts remain. Add focused zx tests for Node provider determinism and auto-map wiring when we add the macro.
- Troubleshooting: Glue sequence, prebuild-guard, and patches lint patterns already documented for Go; Node follows the same flow with importer‑scoped lockfile inputs and `TARGETS.node.auto` presence. Documented in this design and consistent with the handbook.
