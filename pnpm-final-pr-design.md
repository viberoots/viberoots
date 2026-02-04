## PR 9 — PNPM/Node Tests and Hardening (Updated Design)

This PR finalizes the PNPM/Node path by adding missing tests around importer‑scoped providers, effective‑set precision (including peers/optionals), name‑collision guards, auto‑map integration checks, a thin provider index test, a safe patch‑wrapper behavioral test, and a Node patch lint. It aligns with `METHODOLOGY.XML` and existing repository conventions.

### Current state (as of this PR)

- Provider sync driver exists and is used by the orchestrator:
  - `build-tools/tools/buck/providers/node.ts` generates `third_party/providers/TARGETS.node.auto` deterministically.
  - Normalizes importer "." to the lockfile directory, sorts entries, and writes an auto‑managed section in `third_party/providers/TARGETS` to ensure Buck can load `defs_node.bzl` providers.
- Provider naming helpers exist: `build-tools/tools/lib/providers.ts` implements `providerNameForImporter()`.
- Node macros exist: `node/defs.bzl` (`nix_node_gen`, `nix_node_lib`, `nix_node_bin`, `nix_node_test`, `node_webapp`, `nix_node_cli_bin`) and enforce exactly one `lockfile:<path>#<importer>` label while stamping `lang:node`/`kind:*`.
- Patch wrapper exists: `build-tools/tools/patch/patch-node.ts` supports `start`, `apply`, `reset`, `session`, `remove`, and calls `runGlue()` after apply/remove.
- Existing Node tests cover idempotency, scoped packages, `--lang node` orchestration, macro provider wiring, and auto‑map label→provider mapping.

### Scope for PR 9 (what we add now)

1. Effective‑set traversal tests (peers + optional deps)

- Verify `syncNodeProviders` includes patch paths only for packages in the importer’s effective set, including:
  - Peer dependency traversal when peers are resolved via the importer’s dependencies
  - Optional dependencies

2. Importer normalization and multi‑importer determinism

- Verify `importer === "."` is normalized to the lockfile’s directory in provider names/entries.
- Multi‑importer lockfiles remain deterministic on repeat runs.

3. Collision guard test

- Force a synthetic scenario to exercise the provider name collision guard; assert clear error text and stable behavior when non‑colliding.

4. Auto‑map integration checks (supplemental)

- Add a small negative/edge test to ensure targets without lockfile labels do not receive Node providers.

5. Provider index smoke test

- Exercise `readNodeProviderIndexEntries()` to prove stable `(provider, key)` pairs and ordering.

6. Patch wrapper behavioral test (hermetic)

- Non‑network test: create `patches/node/<name>@<ver>.patch`, run provider sync + auto‑map, and assert only importers with that `<name>@<ver>` in their effective set were affected.
- Optional gated E2E (`NODE_PATCH_E2E=1`): run `patch-pkg start/apply node <pkg>` inside a temp importer if `pnpm` is on PATH (dev shell), then assert the patch lands under `patches/node/` and glue refreshes.

7. Node patches lint

- Extend `build-tools/tools/dev/patches-lint.ts` to support `node` with rules mirroring Go:
  - Flat dir: `patches/node/` contains no subdirectories
  - Files end with `.patch`
  - Exactly one patch per `<pkg>@<version>` (case‑insensitive key); decode PNPM scoped names by mapping `__` → `/`
  - Default warn locally; strict mode (`NODE_PATCH_LINT_STRICT=1` or CI stage) exits non‑zero on violations

8. Graceful degradation tests (missing YAML / no lockfiles)

- When `yaml` module is unavailable or no `pnpm-lock.yaml` files exist, provider sync writes an empty, deterministic header and exits cleanly.

### Test files to add (one‑test‑per‑file; zx)

- Effective set (peers + optional):
  - `build-tools/tools/tests/node/providers/sync-providers-node.effective-set-peers.test.ts`
  - `build-tools/tools/tests/node/providers/sync-providers-node.effective-set-optional.test.ts`
- Importer normalization + determinism:
  - `build-tools/tools/tests/node/providers/sync-providers-node.importer-dot-normalization.test.ts`
  - `build-tools/tools/tests/node/providers/sync-providers-node.multi-importer-determinism.test.ts`
- Collision guard:
  - `build-tools/tools/tests/node/providers/sync-providers-node.collision-guard.test.ts`
- Graceful degradation:
  - `build-tools/tools/tests/node/providers/sync-providers-node.no-yaml-package.test.ts`
- Auto‑map edge (no lockfile label):
  - `build-tools/tools/tests/node/auto-map/auto-map.node.no-lockfile-label-skip.test.ts`
- Provider index:
  - `build-tools/tools/tests/node/providers/node-provider-index.entries-ordering.test.ts`
- Patch wrapper (hermetic + gated E2E):
  - `build-tools/tools/tests/node/patch/patch-node.behavioral-apply-glue.test.ts`
  - `build-tools/tools/tests/node/patch/patch-node.e2e-session-optional.test.ts` (skips unless `NODE_PATCH_E2E=1`)
- Patches lint:
  - `build-tools/tools/tests/node/lint/node-patches.lint-flat-and-uniqueness.test.ts`

All tests:

- Use zx harness with external timeouts
- Rely on dev shell for tools on PATH; do not mutate PATH
- Are hermetic (no network) by default

### Implementation notes (grounded in current code)

- Provider sync driver behavior anchors to these specifics:
  - Importer label normalization `"." → <dirname(lockfile)>`
  - Deterministic sort of provider entries
  - Auto‑section update inside `third_party/providers/TARGETS` to ensure loads always succeed
  - Provider set selection via effective set traversal that includes peers when resolved
- Node macros already enforce a single importer‑scoped lockfile label and stamp `lang:node`/`kind:*`; provider deps are appended from `auto_map.bzl` outputs.
- Patch wrapper delegates to real `pnpm patch/patch-commit` and calls `runGlue()`; keep the default test path hermetic by directly writing a `.patch` file and running glue.

### CI and coverage

- Auto‑discovery under `build-tools/tools/tests/**` (no per‑file rules). Full suite with coverage:
  - `buck2 test //... -- --env COVERAGE=1`
- Optional focused runs (developer convenience):
  - `buck2 test //build-tools/tools/tests/... --filter sync-providers-node`
  - `buck2 test //build-tools/tools/tests/... --filter auto-map.node`
- Integrate Node patch lint into the existing `patches-lint` stage; strict mode in CI.

### Acceptance criteria

- Determinism: Re‑running provider sync without input changes is a no‑op (covered and kept).
- Effective set: Peers and optional deps are included correctly; unrelated importers unaffected.
- Importer normalization: `"."` importer produces the expected provider key and name.
- Collision guard: Synthetic collision raises a clear error, non‑colliding runs succeed deterministically.
- Auto‑map: Targets with lockfile labels map to fully‑qualified provider labels; unlabeled targets do not.
- Provider index: `(provider, key)` entries are stable and ordered.
- Patch wrapper behavior: Non‑network path updates providers/auto‑map correctly; gated E2E passes when enabled.
- Node patch lint: Warns locally; exits non‑zero in CI on duplicates/subdirs/invalid files.
- Graceful degradation: Missing YAML package or no lockfiles produces an empty header in `TARGETS.node.auto` without errors.

### Risks and mitigations

- pnpm availability for E2E: keep default tests hermetic; gate E2E with `NODE_PATCH_E2E=1` and rely on dev shell.
- Lockfile grammar edge cases: incrementally add fixtures for scoped packages, peers, and optionals (some already covered).
- Macro variance: tests avoid requiring full macro builds; focus on mapping and provider presence; leave macro stamping verified by existing test.

### Rollout order (small commits)

1. Add effective‑set tests (peers/optional) and importer normalization/determinism tests.
2. Add collision‑guard test.
3. Add auto‑map edge (no lockfile label) test.
4. Add provider index test.
5. Add hermetic patch wrapper test; add optional gated E2E.
6. Extend `build-tools/tools/dev/patches-lint.ts` with Node support and add Node lint test.
7. Ensure CI stage runs lint in strict mode and that full suite passes with coverage.
