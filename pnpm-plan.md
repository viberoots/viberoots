## PNPM Monorepo Enablement — Multi‑PR Development Plan

This plan sequences small, verifiable PRs to implement PNPM workspaces (apps/libs), importer‑scoped providers, hermetic Nix installs, and a Node patch wrapper. It follows the methodology (clear phases, measurable gates) and the build‑system design guide.

### PR1 — Workspace bootstrap and isolation invariants

- Scope
  - Add `pnpm-workspace.yaml` with `packages: ["apps/*", "libs/*"]`.
  - Commit `.npmrc` defaults to enforce isolation and patch location:
    - `node-linker=isolated`
    - `patches-dir=patches/node`
  - Add empty `patches/node/.gitkeep` and create `third_party/providers/` folder (if missing).
  - Add `third_party/providers/defs_node.bzl` with `node_importer_deps(...)` genrule.
- Detailed design
  - `pnpm-workspace.yaml` introduces only apps/libs; root remains a tooling importer but apps/libs do not inherit root deps.
  - `.npmrc` ensures no shadow dependencies; patches for Node land under `patches/node/` by default.
  - `defs_node.bzl` mirrors the cookbook: tiny public provider rule emitting a stable stamp from inputs.
- Acceptance criteria
  - `pnpm -w list` shows an empty or minimal workspace without errors.
  - Running `node tools/buck/sync-providers.ts --lang node` creates a deterministic `third_party/providers/TARGETS.node.auto` (empty header when no lockfiles).
  - CI prebuild-guard passes (no missing glue after running glue steps).
- Risks
  - Misconfigured `.npmrc` could allow dependency leakage.
- Consequences of not implementing
  - Future PNPM projects may suffer from shadow deps; provider wiring later becomes noisier.

### PR2 — Node provider wiring and auto‑map integration hardening

- Scope
  - Ensure `tools/buck/providers/node.ts` is used via `tools/buck/sync-providers.ts` orchestrator.
  - Add docs section in `pnpm-design.md` clarifying importer‑scoped labels and provider naming.
  - Add a minimal zx test proving `TARGETS.node.auto` is deterministic given fixed inputs.
- Detailed design
  - No code changes to the driver expected; wire an explicit `--lang node` path in docs/tests for clarity.
  - Test writes a synthetic `pnpm-lock.yaml` with one importer and ensures output is byte‑for‑byte stable after two runs.
- Acceptance criteria
  - Idempotent provider sync test passes locally and in CI.
  - `gen-auto-map.ts` includes Node providers when `lockfile:<path>#<importer>` labels exist in `graph.json`.
- Risks
  - Lockfile parsing nuances; peer resolution traversal regressions.
- Consequences of not implementing
  - Fragile Node provider determinism; harder to reason about rebuild invalidation.

### PR3 — First PNPM project scaffold (apps/example) with per‑importer lockfile

- Scope
  - Scaffold `apps/example` (TS, ESLint, Prettier, tests) with its own `package.json`, `.npmrc` (inherits repo defaults), and `pnpm-lock.yaml`.
  - Add a `TARGETS` file for the project with label:
    - `labels = ["lockfile:apps/example/pnpm-lock.yaml#apps/example"]`.
  - Add a minimal build/test genrule and integrate with Buck’s provider auto‑map.
- Detailed design
  - Scaffolding aligns with isolation: no root deps; local install runs in dev shell.
  - Test file follows one-test-per-file convention and a trivial assertion.
- Acceptance criteria
  - `pnpm -w install` completes; `apps/example` runs `pnpm test` successfully in dev shell.
  - Glue steps: export-graph → sync-providers → gen-auto-map run cleanly; Buck build/test for the example target succeeds.
- Risks
  - Mislabeling lockfile or importer; incorrect label prevents provider mapping.
- Consequences of not implementing
  - No reference implementation; future scaffolding lacks a proven template.

### PR4 — Hermetic Nix derivations for per‑importer node_modules

- Scope
  - Add Nix expressions to materialize per‑importer `node-modules` using the documented pattern (`hermetic-node-modules.md`).
  - Link `node_modules` in dev shell for the importer (read‑only symlink).
  - Add `tools/dev/update-pnpm-hash.ts` usage to update FOD hashes when lockfiles change.
- Detailed design
  - Each importer lockfile produces two derivations: `pnpm-store` (FOD) and `node-modules`.
  - Dev shell hook links the per‑importer `node_modules` for IDE and scripts, without running installers.
- Acceptance criteria
  - `nix build .#node-modules` for the example succeeds and is a cache hit on repeat.
  - Entering `nix develop` links the correct `node_modules` and exposes `.bin` for scripts.
- Risks
  - FOD `outputHash` mismatch on first build (requires documented update step).
- Consequences of not implementing
  - Non-hermetic installs; more churn and inconsistent local environments.

### PR5 — Thin Node macro for provider auto‑wiring and stamping

- Scope
  - Create `//node/defs.bzl` providing thin macros (e.g., `node_gen`, `node_test`) that:
    - Call `lang/defs_common.bzl` stamping helpers to add `lang:node` and `kind:*` labels.
    - Append providers from `//third_party/providers:auto_map.bzl`.
    - Accept a `labels` parameter so the lockfile label is explicit in the macro call.
  - Migrate `apps/example` TARGETS to use the macro.
- Detailed design
  - Macro enforces presence of `lockfile:<path>#<importer>` label at call sites and merges with user labels.
  - Leaves escape hatch to pass additional `deps` manually if needed.
- Acceptance criteria
  - Example builds/tests unchanged; `buck2 cquery deps(//apps/example:...)` shows Node provider dependency.
  - Stamping lint passes for `lang:node` and kind labels.
- Risks
  - Over‑strict validation might block legitimate custom cases.
- Consequences of not implementing
  - Repetition and inconsistent wiring across projects; harder to evolve conventions.

### PR6 — Node patch wrapper (`patch-node.ts`) and patch‑pkg integration

- Scope
  - Implement `tools/patch/patch-node.ts` mapping to pnpm’s `patch`/`patch-commit` with `patches-dir=patches/node` (from `.npmrc`).
  - Update `tools/patch/patch-pkg.ts` to support `node` as a language.
  - On apply/remove, call `runGlue()` so providers/auto_map refresh automatically.
- Detailed design
  - Reuse `tools/patch/state.ts` session store and `tools/patch/glue.ts` for glue steps.
  - Respect `$PATCH_EDITOR` and `--force` semantics where applicable.
- Acceptance criteria
  - `patch-pkg start node <pkg>` opens a temp edit dir; `apply` writes `patches/node/<name>@<version>.patch` via pnpm; glue updates run; Buck builds that depend on the importer are invalidated appropriately.
- Risks
  - Divergence between pnpm patch naming and our filename expectations (mitigated by `patches-dir` setting).
- Consequences of not implementing
  - Node patching UX diverges from Go/C++; manual steps increase mistakes.

### PR7 — CI stages and prebuild guard updates

- Scope
  - Ensure Jenkins (or CI) stages include Node steps: Export Graph → Sync Providers → Generate auto_map → Prebuild guard → Build & Test.
  - Extend prebuild-guard to include per‑importer lockfile freshness checks if not already covered.
- Detailed design
  - CI uses the unified orchestrator (`tools/ci/run-stage.ts`) and runs Node provider sync only when lockfiles exist.
- Acceptance criteria
  - CI passes on example project with and without patches; stale glue fails fast when steps are omitted.
- Risks
  - Over‑strict guard may slow iteration locally (guard already supports a local “no‑fix” mode).
- Consequences of not implementing
  - Glue freshness regressions reach build steps; slower diagnosis.

### PR8 — Scaffolding command for new PNPM projects

- Scope
  - Add `tools/scaffolding/new-pnpm-project.ts` to generate apps/libs templates with TS/ESLint/Prettier/tests, `.npmrc`, labels, and TARGETS using the Node macro.
  - Register templates in scaffolding registry.
- Detailed design
  - Command prompts for name, kind (app/lib), importer id, and creates files accordingly.
- Acceptance criteria
  - Running the command produces a project that installs, builds, tests, and wires providers correctly on first try.
- Risks
  - Template drift; mitigate with tests using scaffolding fixtures.
- Consequences of not implementing
  - Manual setup is error‑prone; slower adoption.

### PR9 — Tests and hardening

- Scope
  - Add zx tests for Node provider determinism, auto-map wiring, macro stamping, and patch wrapper behavior (idempotency, collision handling).
  - Add lint for Node patches (optional strict mode) mirroring Go rules: flat dir, one patch per key.
- Detailed design
  - Place tests under `tools/tests/**`, one test per file, with external timeouts. Include focused tests for peer traversal in `providers/node.ts`.
- Acceptance criteria
  - All tests pass locally and in CI; coverage is included in the merged report.
- Risks
  - Lockfile grammar edge cases; add fixtures to expand coverage over time.
- Consequences of not implementing
  - Regressions in determinism or wiring could go unnoticed.

### PR10 — Documentation and handbook cross‑links

- Scope
  - Update `README`/`docs` to reference `pnpm-design.md`, usage of `patch-pkg` for Node, and the Node macro.
  - Cross‑link the handbook: provider sync cookbook, macro stamping, adding language, testing, troubleshooting.
- Detailed design
  - Keep examples short; link to full guides.
- Acceptance criteria
  - A new teammate can follow docs to scaffold a PNPM app/lib, run installs (Nix hermetic), patch a dependency, and see targeted rebuilds.
- Risks
  - Doc drift; mitigate with doc validation in CI (optional link check).
- Consequences of not implementing
  - Onboarding friction; misuse of provider sync or macros.
