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
```

Both examples create the destination under the canonical location for the chosen language/template. The CLI resolves synonyms (e.g., `lib`/`library`) and normalizes names.

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

#### Target selection

- `scaf delete|regen|update <all|path1 path2 ...>`
  - If no names are provided, `all` is the implicit default; the tool discovers all eligible scaffolds in the repo (those with `.copier-answers.yml`).
  - If specific paths are provided, the tool validates they exist; names may also be resolved to paths via canonical rules.
  - The tool prints a table of targets and actions, then prompts `Proceed? [y/N]`.

#### Canonical locations

- The CLI infers destination directories from repository conventions per language/template. For example:
  - `go library` -> libraries root (e.g., `libs/…`).
  - `go application` -> applications root (e.g., `apps/…` or `microservices/…`).
- These conventions are defined in a small resolver module, not hard-coded paths. The resolver can be configured per repository (e.g., via a JSON/YAML in `tools/scaffolding/`), allowing reuse across repos.

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

- `tools/scaffolding/`
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

import { $ } from "zx";
import { existsSync } from "node:fs";
import { join } from "node:path";

const templateDir = "tools/scaffolding/templates/go";
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

### Determinism and safety

- Always run Copier and post steps via Nix to pin tool versions.
- Avoid mutating outside the destination directory.
- For updates, prefer Copier’s merge mechanisms over ad-hoc file copying.
- Consider adding a dry-run mode (`--dry-run` flag in orchestrator) that shells out to Copier with no side effects.

### Testing the scaffolds

- Golden tests: render a template into a temporary directory with fixed answers, then verify file tree and key file contents.
- Update path: render with V1 of the template, then update with V2 and confirm expected changes.

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

- [ ] Create template directory under `tools/scaffolding/templates/<language>/`.
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
   - Create `tools/scaffolding/templates/<template-name>/<language>/` with template files and a handwritten `copier.yaml`.
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
