## Scaffolding design (templates + copier + zx + Nix)

This document describes the scaffolding system used in this repository: how templates are organized, how we invoke Copier to materialize a new project from a template (or update an existing scaffold), and how we orchestrate the flow using zx-wrapper scripts and Nix. It is intended as an implementation guide that a junior engineer or an LLM can use to recreate the design from scratch.

### Goals

- Consistent, repeatable project scaffolds across languages.
- Idempotent, safe operations (copy new, or update existing) with clear diffs.
- Deterministic tooling via Nix; no global PATH assumptions.
- Easy entry points via zx-wrapper scripts and build tool targets.

### High-level flow

1. Select a template (e.g., a Go microservice, a TS library, etc.).
2. Compute/collect answers (template variables) and defaults.
3. Run Copier to either:
   - copy: create a new scaffold in a new directory; or
   - update: apply template changes into an existing scaffold dir.
4. Run post-generation steps (formatting, dependency bootstrapping, metadata updates).

### CLI UX (intended)

We will expose a single entrypoint `scaf` that provides a consistent, discoverable CLI to operate on templates across languages.

#### Shapes by subcommand

```text
scaf new <language> <template> <name> [--path=$DESTINATION_DIR] <template-specific args>
scaf delete <all|path1 path2 ...>
scaf regen  <all|path1 path2 ...>
scaf update <all|path1 path2 ...>
```

Where:

- `<language>`: the language family (e.g., `go`, `ts`, `python`).
- `<template>`: the template kind within that language (e.g., `lib`, `cli-app`, `service`). Synonyms are supported where brackets indicate optional suffixes (e.g., `lib[rary]`).
- `<name>`: the logical name of the scaffold (used to derive module/package names and directory names).
- `--path`: optional absolute or repo-relative destination; if omitted, the destination is inferred from repository conventions for that language and template (see Canonical locations below).
- `<template-specific args>`: additional `--key=value` pairs forwarded to Copier as variables.

Examples:

```bash
scaf new go lib[rary] greeter-utilities
scaf new go cli-app greeter-cli
scaf new ts webapp-ssr-vite demo-vite-ssr --yes
```

For TypeScript SSR templates, framework-specific names are explicit:

- `webapp-ssr-next` for Next app-router SSR.
- `webapp-ssr-vite` for the Vite-first SSR scaffold baseline.

Both examples create the destination under the canonical location for the chosen language/template. The CLI resolves synonyms (e.g., `lib`/`library`) and normalizes names.

### Local workspace TS dependency live updates (`ts/webapp-static`, `ts/webapp-ssr-vite`, `ts/webapp-ssr-next`)

Dev-update contract matrix for in-scope templates:

| Change class                                | `ts/webapp-static`                                                 | `ts/webapp-ssr-vite`                                                                                    | `ts/webapp-ssr-next`                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| App-local TypeScript edit                   | HMR or module invalidation in one dev session. No restart.         | Client and server module updates apply in one dev session. No restart.                                  | Client and server module updates apply in one dev session. No restart.                                  |
| Workspace-linked TypeScript dependency edit | HMR or module invalidation in one dev session. No restart.         | Client and SSR render paths update in one dev session. No restart.                                      | Client and SSR render paths update in one dev session. No restart.                                      |
| Non-TS wasm producer edit                   | Strict producer rebuild and contract sync without process restart. | Strict producer rebuild and contract sync visible to client and SSR entry path without process restart. | Strict producer rebuild and contract sync visible to client and SSR entry path without process restart. |

Primary path constraints:

- full reload is not the primary behavior
- no dev-process restart for change propagation
- deterministic watcher markers remain required (`[wasm-watch] rebuild:start`, `[wasm-watch] sync:ok`)

Deterministic failure signatures and recovery commands:

- app-local TypeScript edit failure:
  - signature: output does not update after source edit while dev process is still alive
  - recovery: run `pnpm run dev:ssr:only` and retry one deterministic edit
- workspace-linked TypeScript dependency failure:
  - signature: workspace dependency edit is ignored until a restart
  - recovery: verify dependency spec uses `workspace:`, `link:`, or `file:`, then restart `pnpm run dev`
- non-TS wasm producer failure:
  - signature: watcher logs miss `[wasm-watch] rebuild:start` or `[wasm-watch] sync:ok`
  - recovery: run `pnpm run dev:wasm:watch` and fix the reported producer command/path issue
- stale install lock state during dependency/bootstrap:
  - signature: install/dependency commands block or fail on install-lock acquisition
  - recovery: rerun `i`; if lock state remains stale, inspect `/tmp/bucknix-locks/` for orphaned lock directories and retry

E2E runner policy contract for this suite:

- selected runner is Node `zx-wrapper` tests with deterministic process, HTTP, and filesystem probes
- this runner is preferred for deterministic CI in this repo because probes and logs map directly to script-level contracts
- escalation triggers for Playwright adoption:
  - a required assertion cannot be validated deterministically via process, HTTP, or filesystem probes
  - repeated CI flakes show timing ambiguity that current probes cannot disambiguate
  - a required check depends on browser-only behavior that current harness cannot assert directly

For `scaf new ts webapp-static <name>` and `scaf new ts webapp-ssr-vite <name>`, the generated `vite.config.ts` includes a Phase-1 local-dependency contract:

- `server.fs.allow` includes the workspace root so source imports from sibling workspace packages resolve in dev mode.
- `optimizeDeps.exclude` is derived from `workspace:`, `link:`, and `file:` dependency specs in the app importer `package.json`.
- `webapp-ssr-vite` additionally sets `ssr.noExternal` from that same package list.

For `scaf new ts webapp-static <name>`, `scaf new ts webapp-ssr-vite <name>`, and `scaf new ts webapp-ssr-next <name>`, the generated app also includes a Phase-2 wasm producer bridge loop:

- `pnpm run dev` composes Vite and a wasm producer watcher with clean shutdown.
- `pnpm run dev:wasm:watch` syncs generated module contracts from app `TARGETS` + `package.json` into `buck-out/tmp/module-contracts/<app-id>/`.
- `pnpm run dev:wasm:watch` reads generated wasm/TS manifests from that canonical path and orchestrates one producer pipeline per declared wasm module key.
- SSR server helpers read manifests from the canonical generated contracts path via `MODULE_CONTRACTS_DIR` and no longer rely on source-tree manifest paths.
- The producer build command path is canonical TypeScript via `zx-wrapper ../../../build-tools/tools/dev/build-wasm-producer.ts`.
- Template-local `.mjs` producer build scripts are not used for substantive behavior.
- Watcher output is deterministic and structured for tests:
  - `[wasm-watch] rebuild:start ... module_type=wasm module_key=<key>`
  - `[wasm-watch] sync:ok ... module_type=wasm module_key=<key>`
  - `[wasm-watch] rebuild:fail ... module_type=wasm module_key=<key>` with a recovery command.

For `webapp-ssr-vite`, server-side dev probes read the default wasm module declared in generated manifests, and packaged builds stage each declared server runtime wasm destination under `dist/server/...`.

Phase 5 module contract terms (PR-1 baseline):

- Generated per-app manifests define module-key contracts for wasm and TypeScript modules under `buck-out/tmp/module-contracts/<app-id>/`:
  - `wasm-modules.manifest.json`
  - `ts-modules.manifest.json`
- Generated helper surfaces expose module-key APIs and remove single-module runtime assumptions:
  - `readWasmModuleBytes(moduleKey)`
  - `listWasmModules()`
  - `loadTsModule(moduleKey)`
  - `listTsModules()`
- Wasm manifest entries include runtime destination paths for client and server parity.
- TS manifest entries include source entry paths and runtime import contract paths.
- Producer surfaces are additive companion targets on existing macros and publish deterministic module metadata via `ModuleSurfaceInfo`:
  - `module_kind`
  - `source_roots`
  - `artifact_mapping_policy`
  - `watch_hints`
- Root-set module discovery is declaration-based:
  - `node_webapp(ts_module_roots=[...])`
  - `node_asset_stage(wasm_module_roots=[...])`
  - `node_asset_stage(module_deps=[...], module_surface_deps=[...])`
  - producer macros expose source-root attrs for surface metadata (`go_source_roots`, `cpp_source_roots`, `python_source_roots`)
- Runtime helpers remain generated-authoritative. Source-tree manifests do not satisfy runtime reads.
- In-session refresh contract (PR-8):
  - watcher refreshes generated manifests while `pnpm run dev:wasm:watch` is running
  - added module keys are enrolled with `[wasm-watch] refresh:ok ... added=<keys>`
  - removed module keys are retired with `[wasm-watch] refresh:ok ... removed=<keys>`
  - refresh failures are explicit and actionable:
    - `[wasm-watch] refresh:fail reason=contracts-or-surface-change`
    - `[wasm-watch] refresh:recovery: fix module contracts or surface metadata, then rerun \`pnpm run dev:wasm:watch\``
  - refresh cadence is bounded by trigger fingerprint changes and throttle windows; unchanged inputs must not hot-loop refresh probes.
- Strict contract-test enforcement (PR-8):
  - Buck probe failures in producer-surface and module-dependency normalization contract tests are hard failures.
  - Probe commands must not use silent early-return paths on non-zero exit.

Phase-3 runtime consistency checks for `webapp-ssr-vite` in one `pnpm run dev` session:

- Client module edits update client-visible output without restarting the dev process.
- Server module edits update SSR output without restarting the dev process.
- Wasm producer edits update both client and SSR-visible wasm-dependent output without restarting the dev process.
- Repeated mixed edit cycles stay deterministic and keep the dev process PID stable.
- Startup must be non-blocking. If startup or updates stall, capture `pnpm run dev` stdout/stderr and run these checks:
  - `pnpm run dev:ssr:only` to isolate the Vite SSR server path.
  - `pnpm run dev:wasm:watch` to isolate the wasm producer bridge path.
  - Verify watcher logs include deterministic markers (`[wasm-watch] rebuild:start`, `[wasm-watch] sync:ok`) and recovery guidance on failure.

For `scaf new ts webapp-ssr-next <name>`, the generated `next.config.mjs` includes:

- `transpilePackages` derived from the same `workspace:`, `link:`, and `file:` dependency specs.
- `experimental.externalDir = true` so workspace-linked source outside the app directory is resolvable in dev mode.
- `dev` and `dev:ssr` compose `next dev` with a wasm producer watcher.
- `dev:wasm:watch` rebuilds from `app/wasm-producer/*.txt` inputs and syncs each declared module key destination from `app/wasm-modules.manifest.json`.

Troubleshooting when local dependency edits do not refresh:

- Confirm the dependency spec uses `workspace:`, `link:`, or `file:` in the importer `package.json`.
- Restart `pnpm run dev` after changing dependency specs in `package.json`.
- For Vite SSR templates, verify `ssr.noExternal` still includes local workspace package names.
- For Next SSR templates, verify `transpilePackages` includes local workspace package names and `experimental.externalDir` remains enabled.
- If wasm producer updates do not apply, run `pnpm run dev:wasm:watch` and verify the logged build command uses `build-tools/tools/dev/build-wasm-producer.ts`.

Shared Phase-4 regression helper contract:

- Reuse `build-tools/tools/tests/scaffolding/lib/wasm-watch.ts` helpers for deterministic file mutation (`writeAndBumpMtime`), process no-restart assertions, watcher failure-signature checks, and local-link validation.
- Keep template-specific behavior assertions in template tests; keep deterministic probe/mutation primitives in the shared helper module.

Phase 5 matrix verification (maintainer guidance):

To verify the permanent regression matrix is complete in CI, run the following targets:

```bash
buck2 test //:scaffolding_webapp_static_dev_hmr_local_ts_dep
buck2 test //:scaffolding_webapp_static_dev_reload_wasm_producer
buck2 test //:scaffolding_webapp_ssr_vite_dev_hmr_local_ts_dep
buck2 test //:scaffolding_webapp_ssr_vite_dev_reload_wasm_producer
buck2 test //:scaffolding_webapp_ssr_vite_dev_runtime_consistency_phase3
buck2 test //:scaffolding_webapp_ssr_next_dev_hmr_local_ts_dep
buck2 test //:scaffolding_webapp_ssr_next_dev_reload_wasm_producer
buck2 test //:scaffolding_webapp_ssr_next_dev_runtime_consistency
buck2 test //:scaffolding_webapp_static_dev_multi_module_runtime_contract
buck2 test //:scaffolding_webapp_ssr_vite_dev_multi_module_runtime_contract
buck2 test //:scaffolding_webapp_ssr_next_dev_multi_module_runtime_contract
buck2 test //:scaffolding_webapp_multi_module_orchestrator_contract
buck2 test //:scaffolding_webapp_multi_module_concurrency_contract
buck2 test //:scaffolding_webapp_multi_module_generated_manifest_contract
buck2 test //:scaffolding_webapp_multi_module_contract_path_resolver_contract
buck2 test //:scaffolding_webapp_multi_module_no_source_manifest_dependency_contract
buck2 test //:scaffolding_webapp_producer_surface_contract
buck2 test //:scaffolding_webapp_root_set_discovery_contract
buck2 test //:scaffolding_webapp_module_dep_label_normalization_contract
buck2 test //:scaffolding_webapp_multi_template_parity_contract
buck2 test //:scaffolding_webapp_phase5_hardcoded_runtime_path_policy_contract
buck2 test //:scaffolding_webapp_phase5_final_goal_validation_contract
buck2 test //:scaffolding_webapp_phase5_final_goal_validation_static_contract
buck2 test //:scaffolding_webapp_phase5_final_goal_validation_ssr_next_contract
buck2 test //:scaffolding_webapp_zero_wasm_default_static_contract
buck2 test //:scaffolding_webapp_zero_wasm_default_ssr_vite_contract
buck2 test //:scaffolding_webapp_zero_wasm_default_ssr_next_contract
buck2 test //:scaffolding_webapp_zero_wasm_to_multi_wasm_growth_contract
buck2 test //:scaffolding_webapp_module_surface_dependency_growth_contract
buck2 test //:scaffolding_webapp_phase5_dynamic_refresh_contract
buck2 test //:scaffolding_webapp_phase5_dynamic_refresh_negative_contract
buck2 test //:scaffolding_template_conventions_metadata_cquery
buck2 test //:scaffolding_ts_command_path_docs_contract
buck2 test //:scaffolding_webapp_multi_module_manifest_contract
```

PR-7 zero-wasm + growth lock-in:

- generated wasm contracts can be empty (`modules: []`, `defaultModuleKey: ""`) for zero-wasm scaffolds
- `pnpm run dev` watcher path treats empty wasm manifests as a deterministic no-op
- runtime wasm helpers return zero-length bytes or byte length `0` when the wasm set is empty
- adding a first wasm producer file under declared roots rehydrates contracts without script or entrypoint rewiring

### Adding wasm to a zero-wasm webapp (app-owned and dependency-owned)

New `ts/webapp-static`, `ts/webapp-ssr-vite`, and `ts/webapp-ssr-next` scaffolds are zero-wasm by default.
You do not need to add runtime entrypoint wiring or edit generated manifests by hand.

Primary-path contract:

- generated manifests under `buck-out/tmp/module-contracts/<app-id>/` are authoritative
- `pnpm run dev` (or `pnpm run dev:ssr`) regenerates contracts and watches module roots
- module additions are discovered from declared/canonical roots, not per-file `TARGETS` entries

#### A) Add wasm owned by the app itself

1. Put a new producer source/input file in the canonical wasm producer root:
   - static / vite SSR: `src/wasm-producer/`
   - next SSR: `app/wasm-producer/`
2. Run `pnpm run dev` (or keep it running).
3. Confirm watcher markers:
   - `[wasm-watch] rebuild:start ... module_key=<key>`
   - `[wasm-watch] sync:ok ... module_key=<key>`
4. Consume via generated helpers (module-key APIs), not by hardcoded source paths.

Example (static or vite SSR app):

```text
projects/apps/demo-web/src/wasm-producer/image-filter.txt
```

No `TARGETS` edit is required when using canonical roots.
If your project intentionally uses a non-canonical root, declare it once through `wasm_module_roots` and then keep adding files under that root.

#### B) Add wasm provided by a local dependency

1. In the dependency package, define producer target(s) that export a surface companion (`__surface`).
2. In the importer webapp `TARGETS`, reference dependency surfaces with:
   - `module_deps` for standard ergonomics (`//pkg` or `//pkg:target`)
   - `module_surface_deps` when you need an explicit non-standard surface label
3. Keep `pnpm run dev` running; dependency-source edits are discovered through producer-surface roots.

Importer example (`node_asset_stage`):

```python
node_asset_stage(
    name = "app",
    app = ":app_raw",
    assets = [],
    module_deps = [
        "//projects/libs/math-wasm",        # -> //projects/libs/math-wasm:math-wasm__surface
        "//projects/libs/vision-wasm:wasm", # -> //projects/libs/vision-wasm:wasm__surface
    ],
    module_surface_deps = [
        "//projects/libs/special:runtime_surface_override",
    ],
    out = "dist",
)
```

Dependency growth rule:

- adding new wasm files inside the dependency's declared source roots does not require importer edits
- importer edits are only needed when adding/removing dependency relationships themselves

#### What you should not do

- do not hand-edit `wasm-modules.manifest.json` / `ts-modules.manifest.json`
- do not add one watcher script per wasm module
- do not hardcode `app/wasm-contract/*.wasm` or source-tree manifest paths as authority

#### Subcommands and semantics

- new: Create a new scaffold at the resolved destination using `copier copy`.
  - Refuses to overwrite a non-empty directory unless explicitly confirmed.
  - Writes `.copier-answers.yml` into the destination for future updates.

- update: Apply template evolution to existing scaffolds using `copier update`.
  - Operates on one or many targets. Targets are resolved from arguments (specific names) or discovered (see Target selection).
  - Uses the recorded `.copier-answers.yml` in each target directory to determine the template source (URL/path and optional commit/sha) and the variable values originally used. Those recorded answers are supplied to Copier so that updates are consistent with the prior generation. Additional variables provided at the CLI can override values where appropriate.
  - Shows a summary of targets and changes before applying; requires explicit confirmation.

- regen: Re-render scaffolds from their recorded answers, optionally after cleanup.
  - Equivalent to: optional cleanup followed by a fresh render using the answers from `.copier-answers.yml`; or an implementation that shells to `copier update` while forcing a full render, depending on template policy.
  - Useful when templates add files that were previously ignored or when hooks must re-run.
  - Requires explicit confirmation.
  - Staging approach: to avoid destructive changes on failure, regen may first move the existing scaffold directory to a temporary staging area, attempt re-creation, and only remove the staged content after a successful re-render; otherwise the original is restored from staging.

- delete: Remove generated scaffolds.
  - Operates on any explicitly provided paths or discovered scaffolded dirs.
  - Moves to trash or performs safe recursive delete per platform policy.
  - Requires explicit confirmation.

#### Additional commands

- templates: List available templates and their variable schema.
  - Usage:
    - `scaf templates`
    - `scaf templates <language>`
  - Output shows template name, brief description, and variables (required/optional, defaults). Provide `--json` for machine-readable output.

- ls: List scaffolded instances found via `.copier-answers.yml`.
  - Usage: `scaf ls` (supports `--json`).
  - Columns: name, path, language, template, template-ref (url@sha or local path).

- move: Safely move or rename a scaffolded instance using paths.
  - Usage: `scaf move <old-path> <new-path>`
  - Steps: move directory; update `.copier-answers.yml` key variables (e.g., name/module); run `copier update` to propagate changes.

- help and completions:
  - `scaf help <command>` shows synopsis, examples, and for `new`, the variable schema of `<language> <template>`.
  - `scaf completions <shell>` emits completion scripts for bash/zsh/fish.
  - Dev shell integration: add the following to the devShell so completions are auto-loaded:
    - bash: `eval "$(scaf completions bash)"`
    - zsh: `autoload -U compinit && compinit; eval "$(scaf completions zsh)"`
    - fish: `scaf completions fish | source`

- go test: Generate a minimal Go test file that is auto‑wired by macros.
  - Usage: `scaf new go test <name_of_test> [--path=DEST] [--yes] [--dry-run]`
  - Defaults:
    - Destination defaults to `./<name_of_test>_test.go` if `--path` is omitted.
    - Package is inferred from existing files; under `/cmd/` it defaults to `main`.
  - Auto‑wiring (no TARGETS edits):
    - Libs: tests under `projects/libs/<lib>/pkg/<pkg>/**/_test.go` bind to `//projects/libs/<lib>:<lib>_test`.
    - Apps: tests under `projects/apps/<app>/cmd/<app>/**/_test.go` bind to `//projects/apps/<app>:<app>_test`.

#### Target selection

- `scaf delete|regen|update <all|path1 path2 ...>`
  - If no names are provided, `all` is the implicit default; the tool discovers all eligible scaffolds in the repo (those with `.copier-answers.yml`).
  - If specific paths are provided, the tool validates they exist; names may also be resolved to paths via canonical rules.
  - The tool prints a table of targets and actions, then prompts `Proceed? [y/N]`.

#### Canonical locations

- The CLI infers destination directories from repository conventions per language/template. For example:
  - `go library` -> libraries root (e.g., `libs/…`).
  - `go application` -> applications root (e.g., `apps/…` or `microservices/…`).
- These conventions are defined in a small resolver module, not hard-coded paths. The resolver can be configured per repository (e.g., via a JSON/YAML in `build-tools/tools/scaffolding/`), allowing reuse across repos.

#### Guards and confirmations

- Deletion/update/regen show a summary table of targets and planned operations.
- Deleting paths without `.copier-answers.yml` is allowed when paths are explicitly provided; a confirmation prompt is still required.
- On conflicts (update), the tool surfaces Copier’s conflict markers or aborts according to policy (default: inline markers).

#### Exit codes

- 0: success; 1: generic failure; 2: invalid arguments; 3: user aborted.

#### Implementation outline

- The `scaf` CLI is a zx-wrapper script that:
  - Parses the command line into `{subcommand, language, template, name, extras}` (for `new`) or `{subcommand, targets}` (for `delete|regen|update`).
  - Resolves canonical `destination` if `--path` is not provided (for `new`).
  - Builds the Copier `data` map from `{name, language, template}` plus any template-specific args.
  - Dispatches to `copier copy` or `copier update` via Nix.
  - For multi-target operations (`delete|regen|update` without names), discovers targets by scanning for `.copier-answers.yml` and matching template metadata.
  - Implements confirmations consistently across subcommands.
  - Runs common post-steps (formatters, generators) via Nix.

### Directory layout

- `build-tools/tools/scaffolding/`
  - `templates/<template-name>/`
    - `<language>/` (e.g., `go/`, `typescript/`, etc.)
      - Template content files (Jinja-templated).
      - `copier.yaml` (template metadata: variables, defaults, prompts, hooks).
      - Optional Nix files (see below) that define environment and template-specific properties.
  - Orchestrator scripts (zx-wrapper) that parse args, assemble answers, and call Copier.

You may add additional language subdirectories as needed. Keep each template self-contained.

### Template anatomy

- Template files are standard Copier/Jinja templates. Anything under the template dir can be rendered with variables defined in `copier.yaml`.
- Required file: `copier.yaml` with fields such as:
  - `version`: schema version.
  - `subdirectory`: optional; render only a subdir.
  - `data`: variable definitions with defaults.
  - `prompts`: optional prompts if you want interactive mode (we generally pass all values non-interactively from zx).
  - `tasks` / hooks: `pre-copy`, `post-copy`, `pre-update`, `post-update` to automate steps around Copier actions.
- Use a `.copier-answers.yml` that gets written into the target scaffold. It records the template source and answers to enable future `copier update`.
- Reference schema & docs for `copier.yaml` keys: see Copier’s configuration reference at
  - https://copier.readthedocs.io/en/stable/configuring/
  - https://copier.readthedocs.io/en/stable/

### Nix integration

- Each template can include Nix expressions (e.g., `flake.nix`, `default.nix`, or a small `env.nix`) that pin the tools required to operate on the scaffold (formatters, generators, language toolchains). This ensures reproducibility.
- The orchestrator calls tools (Copier, formatters, language CLIs) through Nix to avoid host-specific drift. Example: `nix develop -c copier ...` or `nix shell <pkgs> -c <tool>`.
- Keep the template’s Nix files template-ized if the scaffold needs its own Nix environment; otherwise, keep Nix only in the scaffolding layer.

### Orchestration with zx-wrapper

- We use zx-wrapper scripts as the UX layer for scaffolding. Typical steps:
  1. Parse CLI args (e.g., `--name`, `--destination`, optional flags like `--update`).
  2. Derive additional data: normalized names, module paths, computed image/library names, etc.
  3. Build an `answers` object for Copier, ensuring all required variables are provided.
  4. Decide operation mode:
     - If destination directory does not exist: run `copier copy`.
     - If destination directory already exists and contains `.copier-answers.yml`: run `copier update`.
  5. After Copier finishes, run any post steps: format code, run dependency installers, generate code from IDLs, write convenience files, etc.

Pseudo-structure (TypeScript with zx-wrapper):

```ts
#!/usr/bin/env zx-wrapper

import { existsSync } from "node:fs";
import { join } from "node:path";

const templateDir = "build-tools/tools/scaffolding/templates/go";
const dest = process.argv[2];
const answers = {
  name: "my-service",
  module: "github.com/acme/my-service",
};

// Decide copy vs update
const isUpdate = existsSync(join(dest, ".copier-answers.yml"));

// Run Copier directly (dev shell provides copier on PATH)
if (!isUpdate) {
  await $`copier copy --trust --defaults --force --data ${JSON.stringify(answers)} ${templateDir} ${dest}`;
} else {
  // Update vs. overwrite: apply template evolution onto existing scaffold
  try {
    await $`copier recopy --trust --defaults --force ${dest}`;
  } catch {
    await $`copier update --trust --defaults --answers-file ${join(dest, ".copier-answers.yml")}`;
  }
}

// Post steps (example): formatting & install
await $`bash -c 'cd ${dest} && npm run format || true'`;
```

Notes:

- We prefer non-interactive mode and pass all variables via `--data` to keep pipelines deterministic.
- Use `--force` when re-running locally; CI may omit `--force` to surface conflicts more clearly.
- The orchestrator should exit non-zero on errors and surface Copier output directly to the caller.

### Update strategy (`copier update`)

- The presence of `.copier-answers.yml` in the destination indicates the scaffold is updatable.
- `copier update`:
  - Reuses recorded template URL/commit (or current template dir if local) and answers file.
  - Applies changes to the scaffold while preserving any user edits where possible.
  - Can surface conflicts; choose whether to use `--conflict=inline` or rely on defaults.
- Policy:
  - If destination exists but no `.copier-answers.yml`, treat it as a copy-only migration (require manual adoption or create a new scaffold and diff).
  - Never “rm -rf” an existing directory. Updates must be explicit.
- Fallback behavior:
  - Prefer a full deterministic re-render via `copier recopy` when available, and fall back to `copier update` if `recopy` is unsupported by the installed Copier version/template. This provides resilience across environments while preserving local edits.

### Variables, defaults, and naming

- Keep variable names clear and language-agnostic (`name`, `module`, `description`, `owner`, etc.).
- Normalize names (kebab-case, snake-case, PascalCase) in the orchestrator so templates can render all variants.
- Provide safe defaults in `copier.yaml`; orchestrator may override based on flags or repo conventions.

### Hooks and post-processing

- Use Copier hooks for operations tied to template rendering (e.g., renaming, generating lockfiles).
- Favor zx-wrapper post steps when logic is shared across templates (formatting, linting, bootstrapping language-specific artifacts).
- Keep hook scripts idempotent and fast.

### Lockfiles are required (and must live with the importer)

This repo’s Nix builders are **lockfile-driven**. Scaffolds must include the correct lockfile for the language/runtime so that:

- `i` can discover importers and build/link their dependencies deterministically.
- Nix builds can run with a frozen lockfile policy (no implicit resolution from the network).

Conventions:

- **Node/TS importers**: must include `pnpm-lock.yaml` at the importer root (e.g. `apps/<name>/pnpm-lock.yaml` or `libs/<name>/pnpm-lock.yaml`), and Buck targets should set `lockfile_label` accordingly.
- **Python importers**: must include `uv.lock` at the importer root (e.g. `apps/<name>/uv.lock` or `libs/<name>/uv.lock`), and Buck targets should set `lockfile_label` accordingly.

For Node/TS scaffolds, `scaf new` ensures the importer lockfile is **real and consistent with `package.json`** (because Nix builds run with a frozen-lockfile policy).

If you change dependencies in an importer, update the lockfile and then run:

- `i` (updates hashes, builds Nix `node_modules`, links outputs, and refreshes glue as needed)
- or, for just updating the hash: `node build-tools/tools/dev/update-pnpm-hash.ts --lockfile <importer>/pnpm-lock.yaml`

### Wasm asset staging for Node webapps

I stage runtime Wasm artifacts explicitly so the built `dist/` includes them without changing Vite/Next build steps. The pattern is a two-step build where `node_webapp` produces the base output and `node_asset_stage` copies the Wasm into the final output directory.

Shared client-side contract path pattern:

- `webapp-static`: `dist/<module>.wasm` and `dist/wasm-inline/index.js`
- `webapp-ssr-next`: `dist/client/public/<module>.wasm` and `dist/client/public/wasm-inline/index.js`
- `webapp-ssr-vite`: `dist/client/<module>.wasm` and `dist/client/wasm-inline/index.js`

Shared server-side parity contract path pattern:

- `webapp-static`: `dist/server/wasm-contract/<module>.wasm`
- `webapp-ssr-next`: `dist/server/wasm-contract/<module>.wasm`
- `webapp-ssr-vite`: `dist/server/wasm-contract/<module>.wasm`

Static example:

```
node_webapp(
    name = "app_raw",
)

node_wasm_inline_module(
    name = "wasm_inline",
    src = "src/wasm-contract/top.wasm",
)

node_asset_stage(
    name = "app",
    app = ":app_raw",
    assets = [
        {"src": "src/wasm-contract/top.wasm", "dest": "top.wasm"},
        {"src": ":wasm_inline", "dest": "wasm-inline/index.js"},
    ],
    out = "dist",
)
```

Source resolution contract for staged assets:

- If `src` resolves to a file, the macro stages that file directly.
- If `src` resolves to a directory, the macro prefers `top.wasm`, then exactly one `*.wasm`,
  otherwise fails with a disambiguation error.
- For ambiguous directory outputs, set `artifact_name` (preferred) or `artifact_glob`.

Example disambiguation:

```
node_asset_stage(
    name = "webapp",
    app = ":webapp_raw",
    assets = [
        {"src": "//projects/libs/math-core:core_cpp_wasm", "artifact_name": "cpp_emscripten.wasm", "dest": "top.wasm"},
    ],
    out = "dist",
)
```

### Wasm inline modules for Node webapps

I generate an inline module from a Wasm file and stage it into the client-facing output directory alongside the webapp output. The webapp loads the module at runtime, so I do not need a Vite/Next plugin.

Example:

```
node_wasm_inline_module(
    name = "wasm_inline",
    src = "//projects/libs/math-api:wasm",
)

node_webapp(
    name = "webapp_raw",
    out = "dist",
)

node_asset_stage(
    name = "webapp",
    app = ":webapp_raw",
    assets = [
        {"src": ":wasm_inline", "dest": "wasm-inline/index.js"},
    ],
    out = "dist",
)
```

Source resolution contract for inline modules matches `node_asset_stage`:

- File source: use the file.
- Directory source: `top.wasm` default, then exactly one `*.wasm`, otherwise fail.
- Ambiguous directory source: set `artifact_name` (preferred) or `artifact_glob`.

App entrypoint:

```
const mod = await import(new URL("/wasm-inline/index.js", window.location.href).toString());
const { instance } = await WebAssembly.instantiate(mod.wasmBytes(), {});
```

### Bundled CLI with inline Wasm

For a bundled CLI, I depend on the inline module and import it from the workspace package. The bundled output embeds the Wasm bytes.

Example:

```
node_wasm_inline_module(
    name = "wasm_inline",
    src = "//projects/libs/math-api:wasm",
)

nix_node_cli_bin(
    name = "math_cli",
    bundle = True,
    deps = ["//projects/libs/math-wasm-inline:wasm_inline"],
)
```

Entrypoint:

```
import { wasmBytes } from "@libs/math-wasm-inline";

const { instance } = await WebAssembly.instantiate(wasmBytes(), {});
```

Related guidance lives in `build-tools/docs/wasm-node-linking.md`.

### Determinism and safety

- Always run Copier and post steps via Nix to pin tool versions.
- Avoid mutating outside the destination directory.
- For updates, prefer Copier’s merge mechanisms over ad-hoc file copying.
- Consider adding a dry-run mode (`--dry-run` flag in orchestrator) that shells out to Copier with no side effects.

### Testing the scaffolds

- Golden tests: render a template into a temporary directory with fixed answers, then verify file tree and key file contents.
- Update path: render with V1 of the template, then update with V2 and confirm expected changes.

#### Template-test Buck conventions

Template-owned tests are encoded directly in Buck metadata so selection can be driven from Buck query output.

- Canonical taxonomy source: `build-tools/tools/scaffolding/template-manifest.json`.
- Canonical id format: `<language>/<template>` (for example `ts/lib`).
- TypeScript template ownership is `ts/*`. `node/*` is runtime/toolchain naming, not template taxonomy.
- Template id labels use `template:<language>/<template>` (for example `template:go/lib`).
- Each template-owned test carries exactly one classification label:
  - `template:smoke`
  - `template:contract`
  - `template:shared`
- Each template-owned test declares explicit `template_inputs` that point to files under `build-tools/tools/scaffolding/templates/<language>/<template>/...`.
- Conventions and the fixed template safety floor are defined in `build-tools/tools/tests/template_conventions.bzl`.

Source-of-truth matrix for template identity:

- Canonical taxonomy source:
  - `build-tools/tools/scaffolding/template-manifest.json`
  - owns template-name aliases and resolver defaults.
- Canonical template roots:
  - `build-tools/tools/scaffolding/templates/<language>/<template>/`
  - own canonical ids (`<language>/<template>`) through directory conventions.
  - template-local `meta.json` may declare `resolverDestination` overrides.
- Generated taxonomy outputs:
  - `build-tools/tools/scaffolding/scaf/templates/generated/template-taxonomy.generated.ts`
  - `build-tools/tools/tests/template_taxonomy_adapter.bzl`
  - generated by `build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts`.
- Runtime metadata consumer:
  - `build-tools/tools/scaffolding/scaf/templates/meta.ts`
  - `scaf templates` is taxonomy-driven at runtime:
    - canonical ids are read from taxonomy first
    - filesystem is validation only
    - language-scoped listing (`scaf templates <language>`) requires every canonical id root and fails fast with deterministic error text
    - discovery listing (`scaf templates`) returns only present canonical roots across enabled languages (partial-clone safe)
- Runtime template-convention consumer:
  - `build-tools/tools/tests/template_conventions.bzl`
  - consumes canonical ids through the imported adapter:
    - `build-tools/tools/tests/template_taxonomy_adapter.bzl`
  - template-owned mappings keep explicit classification metadata and derive canonical ids from canonical template root paths (`template_roots`)
- Resolver consumer:
  - `build-tools/tools/scaffolding/resolver.json`
  - TypeScript resolver keys must stay in parity with canonical `ts/*` ids.
- Validation-only parity contracts:
- `build-tools/tools/tests/scaffolding/template-taxonomy.parity-contract.test.ts`
- `build-tools/tools/tests/scaffolding/template-taxonomy.runtime-contract.test.ts`
  - these tests verify runtime consumers stay aligned with taxonomy and fail loudly on drift.

Anti-drift contracts:

- `build-tools/tools/tests/scaffolding/template-taxonomy.contract.test.ts`
  - locks the canonical TypeScript id set and `templates/ts` filesystem parity.
- `build-tools/tools/tests/scaffolding/template-taxonomy.parity-contract.test.ts`
  - enforces canonical-id uniqueness, resolver parity, convention-id parity, and adapter parity.
- `build-tools/tools/tests/scaffolding/template-taxonomy.runtime-contract.test.ts`
  - enforces taxonomy-driven metadata listing and deterministic missing-root failures.

Duplicate-id failure contract:

- Canonical ids are required to be unique across the taxonomy.
- If a duplicate id is introduced, PR-4 parity contracts fail with a duplicate-id error.
- Update workflow when adding a template:
  1. add the template root directory under `build-tools/tools/scaffolding/templates/<language>/<template>/`
  2. update template-local files (`meta.json`, `copier.yaml`, scaffold files):
     - set `language` and `template` in `meta.json`
     - set `resolverDestination` in `meta.json` when template-default routing is not enough
  3. refresh generated taxonomy/resolver surfaces:
     - `node build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts`
  4. add/update template test mappings in `template_conventions.bzl` only when adding a new template-owned test script:
     - keep explicit classification (`template:smoke|template:contract|template:shared`)
     - wire `template_roots` paths only; do not register `(language, template)` keys
  5. run parity/runtime contracts and fix reported drift before merge

Generated-surface refresh contract:

- Canonical source: `build-tools/tools/scaffolding/template-manifest.json`
- Generated outputs:
  - `build-tools/tools/scaffolding/scaf/templates/generated/template-taxonomy.generated.ts`
  - `build-tools/tools/scaffolding/resolver.json`
  - `build-tools/tools/tests/template_taxonomy_adapter.bzl`
- Deterministic freshness checks:
  - `node build-tools/tools/scaffolding/gen-template-manifest-artifacts.ts --check`
- `build-tools/tools/tests/scaffolding/template-manifest.generator-parity.contract.test.ts`
- `build-tools/tools/tests/scaffolding/template-manifest.resolver-parity.contract.test.ts`
- `scaf` command preflight:
  - `scaf` runs `gen-template-manifest-artifacts.ts` before taxonomy-consuming commands (`new`, `templates`, `template`, and template-related completion subcommands), so template-directory onboarding does not require a separate manual refresh step.
- Verify/CI freshness enforcement:
  - `v` runs `gen-template-manifest-artifacts.ts --check` before test execution.
  - CI `run-stage --stage prebuild-guard` runs the same `--check` gate.

Buck query example:

```bash
buck2 cquery //:scaffolding_go_lib_scaffold_and_build \
  --output-attribute labels \
  --output-attribute template_inputs
```

#### Template-only test selector (changed paths + Buck labels)

The selector entrypoint is `build-tools/tools/dev/select-template-tests.ts`.
It reads changed files from git by default, derives changed template ids from
`build-tools/tools/scaffolding/templates/<language>/<template>/...`, and resolves
template tests through Buck label queries (`template:<language>/<template>`).
Optional flags:

- `--changed <path1,path2,...>` to bypass git diff/status discovery.
- `--targets-only` to print only the selected target list.

Modes:

- `template-only`:
  - At least one template id changed.
  - No other build-system paths changed outside template roots.
  - Output is `label-selected targets ∪ safety floor`.
- `mixed`:
  - Template ids changed and other build-system paths changed.
  - Selector emits diagnostics and no narrowed target list (full-scope testing is required).
- `no-template-impact`:
  - No changed template ids detected.
  - Selector emits diagnostics and no template target list.

Diagnostics contract:

- Emit deterministic, sorted diagnostics that include:
  - mode
  - changed paths
  - changed template ids
  - selected targets by template id (for `template-only`)
  - fixed safety-floor targets

Safety floor:

- `//:scaffolding_smoke_lib_readme`
- `//:scaffolding_smoke_cli_readme`
- `//:scaffolding_python_wasm_app_scaffold_smoke`

#### End-to-end testing without disturbing the source repository

To exercise the full `scaf` flow safely while developing or augmenting scaffolding capabilities, run tests in an ephemeral copy of the repo:

1. Create a temporary working copy of the current repository (exclude heavy/ephemeral dirs for speed), e.g.:

```bash
TMPDIR=$(mktemp -d)
rsync -a --exclude 'buck-out' --exclude 'node_modules' --exclude '.git' ./ "$TMPDIR"/
```

2. Optionally, make edits to the repository to set up test preconditions.

3. Run `scaf` commands under test inside the temporary copy (via Nix to pin tools), e.g.:

```bash
cd '$TMPDIR'
direnv allow
scaf new go lib greeter-utilities
scaf new go cli-app greeter-cli
```

4. Verify the resulting temp repo contains the expected changes, compared to the original repo, e.g. using diff, ideally in an automated test script written using zx-wrapper.

5. Ideally, we'd use these as CI-friendly assertions (CI-friendly). For example there could be tests which assert that:

- Expected directories/files exist in `$TMPDIR` under the canonical locations.
- `.copier-answers.yml` exists for each new scaffold and references the correct template source.
- Running `scaf update all` in `$TMPDIR` is a no-op (no diff) immediately after `new` (idempotence check).

6. Cleanup when done:

```bash
rm -rf "$TMPDIR"
```

Notes:

- `scaf` should be defined (or at least added to path) by the flake, so that it can be used immediately without modifying PATH manually, etc.
- For reproducible comparisons, filter out timestamps or tool caches from the diff (use `--exclude` or a `.diffignore`).
- When testing `update`, ensure `.copier-answers.yml` is present in the target directories; the CLI uses it to resolve the template source and previously supplied variables.

#### Current scripts behavior (for reference)

- Discovery: maintenance scripts currently locate targets by finding `.copier-answers.yml` (they do not accept arbitrary paths as primary input).
- Safety flags: they support `--dry-run` to preview and `--yes` to skip interactive confirmations.

### Implementation checklist

- [ ] Create template directory under `build-tools/tools/scaffolding/templates/<language>/`.
- [ ] Author `copier.yaml` with variables, defaults, and hooks.
- [ ] Add optional Nix files that define the environment and pinned tools.
- [ ] Implement a zx-wrapper script that:
  - Parses arguments / flags.
  - Computes normalized names and defaults.
  - Calls Copier (copy or update) non-interactively.
  - Runs post-format/bootstrap steps.
- [ ] Add minimal golden tests that render the template under CI and verify success.

### Implementation plan (from scratch)

1. Establish dev shell and dependencies
   - Ensure `copier`, `yq`, `jq`, `node`, and zx-wrapper are available on PATH via the dev shell.
   - Provide `scaf` entrypoint (zx-wrapper script) in the dev shell so commands work without additional setup.

2. Template scaffolding structure
   - Create `build-tools/tools/scaffolding/templates/<template-name>/<language>/` with template files and a handwritten `copier.yaml`.
   - Follow the variable schema needed by the template; document variables in `copier.yaml`.

3. Core utilities
   - Implement `scaffold-utils.ts` with helpers:
     - `seedAnswersViaCopier(templateDir, targetDir, args)` → `copier copy --trust --defaults --force`.
     - `copierRecopyOrUpdate(targetDir)` → try `copier recopy`, else `copier update --answers-file .copier-answers.yml`.
     - `scaffoldOrUpdate(templateDir, targetDir, args)` → adopt missing answers, then recopy/update.

4. `scaf` CLI (zx-wrapper)
   - Subcommands: `new`, `update`, `regen`, `delete`, `templates`, `ls`, `move`, `help`, `completions`.
   - `new <language> <template> <name> [--path=...] <template-args>`:
     - Resolve canonical destination when `--path` is not set.
     - Build Copier data map from args; run `copier copy` and post-steps.
   - `update|regen|delete <all|path1 path2 ...>`:
     - Discover targets by `.copier-answers.yml` if `all` or none given; accept explicit paths.
     - Require confirmation unless `--yes`.
     - For `update`: use recopy→update fallback per Update strategy.
     - For `regen`: stage to temp dir, recreate, restore on failure.
     - For `delete`: safe delete (trash or recursive per platform policy).
   - `templates [<language>]`: scan templates and print variable schema; `--json` supported.
   - `ls`: list scaffolded instances (read `.copier-answers.yml`); `--json` supported.
   - `move <old-path> <new-path>`: move directory; update `.copier-answers.yml`; run update.
   - `help <command>`: rich help with examples and variable schema for `new`.
   - `completions <shell>`: emit bash/zsh/fish completions.

5. Post-steps and hooks
   - Run formatters or language bootstrapping (`npm run format`, `go mod tidy`, etc.) directly; rely on dev shell PATH.
   - Keep Copier hooks minimal and idempotent; prefer shared post-steps in zx.

6. Testing
   - Add golden tests for `copier copy` outputs per template.
   - Add end-to-end tests in a temp repo (rsync) exercising `scaf new/update/regen/delete`.
   - Validate completions export and `help` contents.

7. CI wiring
   - Job that runs the e2e scaffolding tests under the dev shell.
   - Optionally validate template updates from previous versions using `update`.

This design allows new templates to be added incrementally while keeping scaffolding reproducible, safe to re-run, and easy to evolve through `copier update`.
