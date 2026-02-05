## PNPM Monorepo Enablement — Multi‑PR Development Plan

This plan sequences small, verifiable PRs to implement PNPM workspaces (projects/apps + projects/libs), importer‑scoped providers, hermetic Nix installs, and a Node patch wrapper. It follows the methodology (clear phases, measurable gates) and the build‑system design guide.

### PR1 — Workspace bootstrap and isolation invariants

- Scope
  - Add `pnpm-workspace.yaml` with `packages: ["projects/apps/*", "projects/libs/*"]`.
  - Commit `.npmrc` defaults to enforce isolation and patch location:
    - `node-linker=isolated`
    - `patches-dir=patches/node`
  - Add empty `patches/node/.gitkeep` and create `third_party/providers/` folder (if missing).
  - Add `third_party/providers/defs_node.bzl` with `node_importer_deps(...)` genrule.
- Detailed design
  - `pnpm-workspace.yaml` introduces only projects/apps + projects/libs; root remains a tooling importer but projects/apps/libs do not inherit root deps.
  - `.npmrc` ensures no shadow dependencies; patches for Node land under `patches/node/` by default.
  - `defs_node.bzl` mirrors the cookbook: tiny public provider rule emitting a stable stamp from inputs.
- Acceptance criteria
  - `pnpm -w list` shows an empty or minimal workspace without errors.
  - Running `node build-tools/tools/buck/sync-providers.ts --lang node` creates a deterministic `third_party/providers/TARGETS.node.auto` (empty header when no lockfiles).
  - CI prebuild-guard passes (no missing glue after running glue steps).
- Risks
  - Misconfigured `.npmrc` could allow dependency leakage.
- Consequences of not implementing
  - Future PNPM projects may suffer from shadow deps; provider wiring later becomes noisier.

### PR2 — Node provider wiring and auto‑map integration hardening

- Scope
  - Ensure `build-tools/tools/buck/providers/node.ts` is used via `build-tools/tools/buck/sync-providers.ts` orchestrator.
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

### PR3 — First PNPM project scaffold (projects/apps/example) with per‑importer lockfile

- Scope
  - Scaffold `projects/apps/example` (TS, ESLint, Prettier, tests) with its own `package.json`, `.npmrc` (inherits repo defaults), and `pnpm-lock.yaml`.
  - Add a `TARGETS` file for the project with label:
    - `labels = ["lockfile:projects/apps/example/pnpm-lock.yaml#projects/apps/example"]`.
  - Add a minimal build/test genrule and integrate with Buck’s provider auto‑map.
- Detailed design
  - Scaffolding aligns with isolation: no root deps; local install runs in dev shell.
  - Test file follows one-test-per-file convention and a trivial assertion.
- Acceptance criteria
  - `pnpm -w install` completes; `projects/apps/example` runs `pnpm test` successfully in dev shell.
  - Glue steps: export-graph → sync-providers → gen-auto-map run cleanly; Buck build/test for the example target succeeds.
- Risks
  - Mislabeling lockfile or importer; incorrect label prevents provider mapping.
- Consequences of not implementing
  - No reference implementation; future scaffolding lacks a proven template.

### PR4 — Hermetic Nix derivations for per‑importer node_modules

- Scope
  - Add Nix expressions to materialize per‑importer `node-modules` using the documented pattern (`docs/pnpm/hermetic-node-modules.md`).
  - Link `node_modules` in dev shell for the importer (read‑only symlink).
  - Add `build-tools/tools/dev/update-pnpm-hash.ts` usage to update FOD hashes when lockfiles change.
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
  - Create `//build-tools/node/defs.bzl` providing thin macros (e.g., `node_gen`, `node_test`) that:
    - Call `build-tools/lang/defs_common.bzl` stamping helpers to add `lang:node` and `kind:*` labels.
    - Append providers from `//third_party/providers:auto_map.bzl`.
    - Accept a `labels` parameter so the lockfile label is explicit in the macro call.
  - Migrate `projects/apps/example` TARGETS to use the macro.
- Detailed design
  - Macro enforces presence of `lockfile:<path>#<importer>` label at call sites and merges with user labels.
  - Leaves escape hatch to pass additional `deps` manually if needed.
- Acceptance criteria
  - Example builds/tests unchanged; `buck2 cquery deps(//projects/apps/example:...)` shows Node provider dependency.
  - Stamping lint passes for `lang:node` and kind labels.
- Risks
  - Over‑strict validation might block legitimate custom cases.
- Consequences of not implementing
  - Repetition and inconsistent wiring across projects; harder to evolve conventions.

### PR6 — Node patch wrapper (`patch-node.ts`) and patch‑pkg integration

- Scope
  - Implement `build-tools/tools/patch/patch-node.ts` mapping to pnpm’s `patch`/`patch-commit` with `patches-dir=patches/node` (from `.npmrc`).
  - Update `build-tools/tools/patch/patch-pkg.ts` to support `node` as a language.
  - On apply/remove, call `runGlue()` so providers/auto_map refresh automatically.
- Detailed design
  - Reuse `build-tools/tools/patch/state.ts` session store and `build-tools/tools/patch/glue.ts` for glue steps.
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
  - CI uses the unified orchestrator (`build-tools/tools/ci/run-stage.ts`) and runs Node provider sync only when lockfiles exist.
- Acceptance criteria
  - CI passes on example project with and without patches; stale glue fails fast when steps are omitted.
- Risks
  - Over‑strict guard may slow iteration locally (guard already supports a local “no‑fix” mode).
- Consequences of not implementing
  - Glue freshness regressions reach build steps; slower diagnosis.

### PR8 — Scaffolding command for new PNPM projects

- Scope
  - Add `build-tools/tools/scaffolding/new-pnpm-project.ts` to generate projects/apps/libs templates with TS/ESLint/Prettier/tests, `.npmrc`, labels, and TARGETS using the Node macro.
  - Register templates in scaffolding registry.
  - Place all Node templates under `build-tools/tools/scaffolding/templates` (consistent with other languages).
  - Add a Node CLI template option (projects/apps/\*) that scaffolds a runnable command-line app:
    - Generates `bin/<name>` with `#!/usr/bin/env node` shebang and a minimal `--help` handler.
    - Adds `package.json` `bin` mapping (`"bin": { "<name>": "bin/<name>" }`) and scripts (`build`, `test`, `lint`, `format`).
    - Ensures `.npmrc` includes `node-linker=isolated` and `patches-dir=patches/node`.
    - Emits `TARGETS` using the Node macro (from PR5) with `labels = ["lockfile:<path>#<importer>", "lang:node", "kind:bin"]` so importer-scoped providers auto-wire.
    - Includes a one-test-per-file zx test under `build-tools/tools/tests` that executes the CLI with `--help` and asserts exit code 0 (no zx loader in the app itself; zx is used only for the test harness).
  - Add a Node lib template option (projects/libs/\*) that scaffolds a reusable library:
    - Generates `src/index.ts` exporting a function and a matching one-test-per-file unit test in `test/`.
    - Adds `package.json` `exports`/`types` pointing to built outputs (e.g., `dist/index.js` / `dist/index.d.ts`) and standard scripts (`build`, `test`, `lint`, `format`).
    - Ensures `.npmrc` includes `node-linker=isolated` and `patches-dir=patches/node`.
    - Emits `TARGETS` using the Node macro (from PR5) with `labels = ["lockfile:<path>#<importer>", "lang:node", "kind:lib"]` so importer-scoped providers auto-wire.
    - Avoids runtime dependence on zx; zx is used only for tests.
- Detailed design
  - Command prompts for name, kind (app/lib), importer id, and creates files accordingly.
  - For CLI template:
    - The entry file lives under `bin/` (no TypeScript required for the bin shim); main logic in `src/` (TypeScript), compiled to `dist/`, and the bin shim `require()`s `dist/index.js`.
    - Buck TARGETS use the Node macro to append provider deps from `//third_party/providers:auto_map.bzl` and carry the importer-scoped lockfile label.
    - The generator ensures `pnpm-lock.yaml` is created (via `pnpm -w install --lockfile-only` in dev shell) so provider sync has stable inputs.
  - For lib template:
    - `tsconfig.json` enables `outDir=dist`, `module=esnext`, `target=es2022`, and `declaration=true` for type output.
    - `package.json` sets `main`, `module` (optional), and `types` to `dist/*` and defines an explicit `exports` map.
    - Buck TARGETS use the Node macro to append provider deps and carry the importer-scoped lockfile label; `kind:lib` is stamped.
    - The generator ensures `pnpm-lock.yaml` exists (lockfile-only) so provider sync has stable inputs.
- Acceptance criteria
  - Running the command produces a project that installs, builds, tests, and wires providers correctly on first try.
  - CLI template: `pnpm run build` succeeds; `node bin/<name> --help` exits 0; Buck build/test targets succeed and depend on the correct importer-scoped provider (visible via `buck2 cquery deps(//projects/apps/<name>:<rule>)`).
  - Lib template: `pnpm run build` emits `dist/`; `node -e "import('<pkg>')"` succeeds (when locally linked); Buck build/test targets succeed and depend on the correct importer-scoped provider (visible via `buck2 cquery deps(//projects/libs/<name>:<rule>)`).
- Risks
  - Template drift; mitigate with tests using scaffolding fixtures.
- Consequences of not implementing
  - Manual setup is error‑prone; slower adoption.

### PR8.1 — Node CLI binary materialization (projects/apps/\*)

- Scope
  - Add a minimal Buck macro `nix_node_cli_bin(...)` that materializes a CLI launcher as a Buck output for Node CLI importers.
  - The macro wraps a `genrule` to copy the source repo’s CLI shim (e.g., `bin/<name>`) to `$OUT` and mark it executable.
  - Enforce importer‑scoped lockfile labeling, provider auto‑wiring, and stamping (`lang:node`, `kind:bin`) consistently with existing Node macros.
  - Update the Node CLI scaffold `TARGETS` template to use `nix_node_cli_bin(...)` so new CLIs build an artifact immediately.
  - Add Nix‑backed Node build rules for TS compilation/bundling to produce a single‑file, shebanged CLI bundle as a Buck materialized artifact.

- Detailed design
  - Implementation location: `//build-tools/node/defs.bzl` alongside `nix_node_gen`, `nix_node_bin`, `nix_node_lib`.
  - Macro signature (conceptual):
    - `nix_node_cli_bin(name, entry = None, out = None, labels = [], deps = [], lockfile_label = None, bundle = False, **kwargs)`
    - Defaults:
      - `entry`: if not provided, defaults to `bin/<name>` within the same package.
      - `out`: if not provided, defaults to `<name>` (so the produced artifact name matches the CLI name).
      - `bundle`: off by default (shim copy only); when `True`, build via Nix bundler (see below).
  - Behavior (shim):
    - Calls the same internal helper path as `nix_node_gen(...)` to:
      - enforce exactly one `lockfile:<path>#<importer>` label,
      - stamp `lang:node` and `kind:bin`,
      - append provider deps via `MODULE_PROVIDERS["//pkg:name"]`.
    - Expands to a `genrule` with:
      - `out = out or name`
      - `cmd = "cp ${entry} $OUT && chmod +x $OUT"`
      - `srcs` includes the CLI shim (`entry`) and provider deps to realize edges.
  - Nix‑backed build (compilation/bundling):
    - Nix flake output: expose `packages.<system>.node-cli.<importer>` that:
      - Accepts inputs: importer root path, `pnpm-lock.yaml`, per‑importer `node-modules` derivation from PR4, and a pinned bundler (`esbuild` or `tsup`).
      - Runs a build script that compiles `src/index.ts` (or the package.json `bin` target’s resolved entry) and bundles to a single JS file with shebang.
      - Produces `<name>.bundle.js` as the derivation output; set mode 0755 and prepend `#!/usr/bin/env node`.
    - Bundler settings (deterministic):
      - Tool: `esbuild` (preferred) with pinned version; fallback: `tsup` pinned.
      - Entry: `src/index.ts` by default; overrideable via package.json `bin` or macro `entry` param.
      - Options (esbuild): `{ platform: "node", target: "node22", bundle: true, format: "esm", sourcemap: false, legalComments: "none", banner: { js: "#!/usr/bin/env node" } }`.
      - Externalization: keep Node built‑ins external; resolve third‑party deps via the importer’s Nix `node-modules` path as needed; prefer inlining only project code by default.
      - Reproducibility: set `SOURCE_DATE_EPOCH` and disable nondeterministic minification; avoid absolute paths in output.
    - Buck macro `node_cli_bundle(...)` (or `nix_node_cli_bin(bundle = True)`) will:
      - stamp labels and append providers as above,
      - run a zx shim to `nix build .#node-cli[${system}].<importer>` (no network),
      - copy the resulting single file to `$OUT`.
  - Hermeticity and scope:
    - No network or install steps at Buck build time; compilation/bundling runs inside a Nix derivation using pinned inputs and the importer’s lockfile.
    - Runtime behavior: the bundled artifact is directly executable and does not rely on workspace `dist/` at runtime. When bundling is disabled, the shim behavior remains as in PR8 (loading `dist/`). The `--help` path remains fast.
  - Template updates:
    - `build-tools/tools/scaffolding/templates/node/cli/TARGETS.jinja` will switch from `nix_node_bin(...)` to `nix_node_cli_bin(...)` and optionally enable `bundle = True` to use `node_cli_bundle(...)`, passing the project’s importer‑scoped lockfile label and leaving other fields minimal.

- Acceptance criteria
  - `buck2 build //projects/apps/<name>:<name>` produces a single file artifact at `buck-out/.../<name>` with the executable bit set (shim mode) OR `<name>.bundle.js` with shebang (bundled mode).
  - Running the built artifact with `--help` exits 0 and prints usage (in both shim and bundled modes).
  - `buck2 cquery deps(//projects/apps/<name>:<name>)` shows the importer‑scoped provider dependency from `third_party/providers/auto_map.bzl`.

- Tests
  - Add a zx test under `build-tools/tools/tests/scaffolding/` that:
    - Scaffolds a Node CLI (`projects/apps/demo`), refreshes glue (export graph → sync node providers → gen auto_map),
    - Builds `//projects/apps/demo:demo` in shim mode and asserts the artifact exists and is executable; executes with `--help` and asserts exit code 0,
    - Builds `//projects/apps/demo:demo` in bundled mode (via macro `bundle = True`) and asserts the single‑file bundle exists, is executable, and `--help` exits 0.

- Risks
  - Bundling configuration drift (esbuild/tsup options) can affect hermetic outputs; mitigate by pinning tool versions and keeping configs minimal/deterministic.
  - If `entry` is customized or missing, builds will fail; defaults and template guard against this.

- Consequences of not implementing
  - CLIs scaffolded in PR8 have no visible Buck artifact, leading to confusion when trying to locate outputs.
  - Teams may roll ad‑hoc genrules per project, increasing drift and maintenance cost.

### PR8.5 — Vite‑based webapp template (projects/apps/\*)

- Scope
  - Add a `vite` + TypeScript webapp template under `projects/apps/*` to the `new-pnpm-project` scaffolder.
  - Generate minimal files: `index.html`, `src/main.ts`, `src/style.css` (optional), `vite.config.ts`.
  - Create `package.json` with scripts: `dev` (vite), `build` (vite build), `preview` (vite preview), plus `lint`/`format`.
  - Ensure `.npmrc` includes `node-linker=isolated` and `patches-dir=patches/node`; create importer‑scoped `pnpm-lock.yaml`.
  - Emit `TARGETS` using the Node macro (from PR5) with `labels = ["lockfile:<path>#<importer>", "lang:node", "kind:app"]` so importer‑scoped providers auto‑wire.

- Detailed design
  - The scaffold chooses the Vite “vanilla TS” template (framework‑neutral) to minimize dependencies and align with hermeticity goals in `build-tools/docs/build-system-design.md`.
  - `vite.config.ts` is minimal and deterministic (no ambient FS reads). Environment values flow via Vite defaults; no Nix wrappers for running Vite.
  - The generator runs `pnpm -w install --lockfile-only` (in dev shell) to materialize a stable importer lockfile; provider sync then includes the correct importer.
  - Buck TARGETS use the Node macro to append provider deps from `//third_party/providers:auto_map.bzl` and carry the importer‑scoped lockfile label.
  - Add a thin Buck macro `node_webapp(...)` (in `//build-tools/node/defs.bzl`) that builds via Nix, consistent with other templates:
    - Stamps `lang:node` and `kind:app` using `build-tools/lang/defs_common.bzl`.
    - Requires the importer‑scoped lockfile label at call sites and appends providers from `auto_map.bzl`.
    - Expands to a `genrule` that invokes a zx shim to run `nix build .#node-webapp[${system}].<importer>` and copies its `dist/` to `$OUT` (no network; uses pinned flake inputs). The shim should be minimal and deterministic.
    - Nix side: expose a flake output `packages.<system>.node-webapp.<importer>` that runs `vite build` with the per‑importer `node-modules` derivation from PR4, producing `dist/` as the derivation output.
  - Add a zx test under `build-tools/tools/tests` that:
    - Refreshes glue (export graph → sync node providers → gen auto_map).
    - Asserts the webapp targets map to the expected importer provider in `auto_map.bzl`.
    - Builds the Buck macro target and asserts the artifact contains `index.html` (verifies Nix‑backed build path end‑to‑end).

- Acceptance criteria
  - Scaffolding produces a `projects/apps/<name>` webapp that builds with `pnpm run build` in the dev shell.
  - Provider glue steps run cleanly; `auto_map.bzl` lists the importer‑scoped provider for the webapp target.
  - Buck build/test of the template’s stamp target succeeds; `buck2 cquery deps(//projects/apps/<name>:<rule>)` shows the importer provider.

- Risks
  - Tooling drift between Vite versions; mitigate with pinned versions and minimal config.
  - If a future Buck rule is desired for bundling, additional macro work will be required (out of scope here).

- Consequences of not implementing
  - No standard for webapp scaffolds; duplicated patterns and inconsistent provider wiring.

### PR9 — Tests and hardening

- Scope
  - Add zx tests for Node provider determinism, auto-map wiring, macro stamping, and patch wrapper behavior (idempotency, collision handling).
  - Add lint for Node patches (optional strict mode) mirroring Go rules: flat dir, one patch per key.
- Detailed design
  - Place tests under `build-tools/tools/tests/**`, one test per file, with external timeouts. Include focused tests for peer traversal in `providers/node.ts`.
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
