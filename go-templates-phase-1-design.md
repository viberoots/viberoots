## Go Scaffolding Templates — Phase 1 Detailed Design (Metadata & Variables)

### Goal

Deliver complete metadata and variable contracts for `build-tools/tools/scaffolding/templates/go/lib` and `build-tools/tools/scaffolding/templates/go/cli` so that:

- `scaf validate all` passes (uses `build-tools/tools/scaffolding/validate.ts`).
- `scaf help new go <template>` shows accurate usage, notes, examples, and variables.
- Variables are sufficient to drive Phase 2 file generation without later breaking changes.

### Why this matters now

Phase 1 is a hard prerequisite for Phase 2 because Copier requires stable variable names and help text. We also encode repo-specific rules here so templates behave predictably across partial clones and in CI.

### Constraints and repository rules (summarized)

- All glue scripts are zx TypeScript and run outside Nix (see build-tools/docs/build-system-design.md).
- Decentralized registration is a hard requirement to support partial clones: each scaffold owns its `TARGETS` and no central registry must be edited later.
- Tests run in temporary copies of the repo and under a direnv-loaded dev shell; tests must not modify PATH.
- Template metadata must reside in `meta.json` with `help` (no `help.md` files).

---

## Template inventory

- go/lib — Library scaffold under `libs/{{ name }}/`.
- go/cli — CLI scaffold under `apps/{{ name }}/`.

Each template provides:

- `meta.json` — template metadata and help content.
- `copier.yaml` — variables (inputs, defaults, validation).
- `README.md.jinja` — rendered documentation.

---

## meta.json schema (per template)

Required keys validated by `build-tools/tools/scaffolding/validate.ts`:

- `language` (must equal `go`)
- `template` (one of `lib`, `cli`)
- `description` (string)
- `help` object with:
  - `usage` (non-empty string)
  - `notes` (array of strings, optional)
  - `examples` (array of strings, optional)

### go/lib meta.json (example)

```json
{
  "language": "go",
  "template": "lib",
  "description": "Go library scaffold",
  "help": {
    "usage": "scaf new go lib <name> [--path=DEST] [--key=value ...]",
    "notes": [
      "After creation, run glue: export-graph → sync-providers → gen-auto-map.",
      "Run tasks/tests in a direnv-loaded shell; do not modify PATH in tests.",
      "Tests run from a temporary copy (rsync), excluding heavy/generated dirs."
    ],
    "examples": [
      "scaf new go lib greeter-utilities",
      "scaf new go lib auth-core --module=github.com/example/auth-core"
    ]
  }
}
```

### go/cli meta.json (example)

```json
{
  "language": "go",
  "template": "cli",
  "description": "Go CLI scaffold",
  "help": {
    "usage": "scaf new go cli <name> [--path=DEST] [--key=value ...]",
    "notes": [
      "After creation, run glue: export-graph → sync-providers → gen-auto-map.",
      "Run tasks/tests in a direnv-loaded shell; do not modify PATH in tests.",
      "Tests run from a temporary copy (rsync), excluding heavy/generated dirs."
    ],
    "examples": [
      "scaf new go cli greeter-cli",
      "scaf new go cli payments-svc --module=github.com/example/payments-svc"
    ]
  }
}
```

---

## Variable contract (copier.yaml)

We standardize a small variable surface that covers both templates and sets us up for Phase 2.

Common inputs (both templates):

- `name` (string, required)
  - Directory and binary/library base name. Kebab-case recommended for directories; Go package name derived (sanitized) when needed.
- `module` (string, optional)
  - Go module path. Default is computed if omitted: `{{ host }}/{{ org }}/{{ name }}`.
- `org` (string, optional; default `example`)
- `host` (string, optional; default `github.com`)
- `description` (string, optional; default empty)
- `go_min` (string, optional; default `1.22`)
- `license` (string, optional; SPDX identifier; default empty)
- `enable_ci` (bool, optional; default `false`)

Derived/hidden variables (computed in copier.yaml):

- `package_name` — sanitized package name for Go source files (lowercase, non-alnum → `_`, leading digits prefixed with `_`).
- `year` — current year.
- `created` — ISO-8601 date.

Validation rules:

- `name`: `^[a-z0-9][a-z0-9-]*$` (kebab-case, no uppercase).
- `module`: `^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/.+` if provided.
- `go_min`: `^1\.[0-9]+$` (e.g., 1.22, 1.23).
- `license`: if provided, must be a plausible SPDX id (basic regex `^[A-Za-z0-9-.+]+$`).

### copier.yaml (shared structure outline)

```yaml
# Required variables
name: ""
module: ""

# Optional inputs with defaults
org: "example"
host: "github.com"
description: ""
go_min: "1.22"
license: ""
enable_ci: false

# Derived variables (using Copier Jinja)
_package_base: "{{ name }}"
package_name: "{{ _package_base | lower | regex_replace('[^a-z0-9]', '_') | regex_replace('^([0-9])', '_\1') }}"
year: "{{ now().strftime('%Y') }}"
created: "{{ now().strftime('%Y-%m-%d') }}"

# Compute module if not supplied
_module_default: "{{ host }}/{{ org }}/{{ name }}"
module_computed: "{{ module if module else _module_default }}"

# Validation (Copier 8+ check blocks or post-validate script if needed)
# Pseudocode here; actual enforcement can be done via Copier's built-in templating
# and letting our `scaf validate` catch meta/help issues.
```

Each template includes its own `copier.yaml`, reusing the same variable set. Minor differences in notes/examples live in `meta.json`.

---

## README.md.jinja contract

Each template must render a README that:

- States what was created and where (e.g., `libs/{{ name }}` or `apps/{{ name }}`).
- Lists the next steps (glue generation):
  - `node build-tools/tools/buck/export-graph.ts`
  - `node build-tools/tools/buck/sync-providers.ts`
  - `node build-tools/tools/buck/gen-auto-map.ts --graph build-tools/tools/buck/graph.json --out third_party/providers/auto_map.bzl`
- Reminds that builds/tests must run in a direnv-loaded environment.
- Mentions decentralized registration: presence of the directory and its `TARGETS` is sufficient for discovery via `//...`.
- For libs: add a minimal example of import path using `{{ module_computed }}`.
- For CLI: mention example dependency on a local lib (to be implemented in Phase 2 files).

---

## Acceptance criteria (Phase 1)

- `meta.json` present for `go/lib` and `go/cli` with required fields and helpful notes/examples.
- `copier.yaml` present for both templates with the variable contract above.
- `README.md.jinja` present for both templates using variables described above.
- `scaf validate all` passes in a temporary copy of the repo under a direnv-loaded shell.
- `scaf help new go lib` and `scaf help new go cli` display variables and usage consistent with the contract.

---

## Test plan (Phase 1 only)

Execution environment for all tests:

- Use a temporary copy of the repo (rsync) excluding heavy/generated dirs.
- Run under a direnv-loaded dev shell; do not modify PATH in tests.

Checks:

1. Validation
   - Run: `node build-tools/tools/scaffolding/validate.ts all`
   - Expect: OK — template meta/help validated
2. Help surfaces variables
   - Run: `scaf help new go lib` and `scaf help new go cli`
   - Expect: Usage printed; variables list includes `name,module,org,host,description,go_min,license,enable_ci`
3. Negative meta.json change (local only)
   - Temporarily remove `help.usage` in a temp copy and confirm `validate` fails; revert afterwards.

---

## Risks and mitigations

- Divergence between variable names and Phase 2 content generation
  - Mitigation: Lock variable names in this design; Phase 2 uses only these.
- Inconsistent module formatting
  - Mitigation: Provide default computation but allow explicit override via `--module`.
- Developer confusion about PATH or environment
  - Mitigation: README template and help notes reiterate direnv requirement and no PATH hacks.

---

## Handover to Phase 2

With Phase 1 in place, Phase 2 can:

- Generate files using `module_computed`, `package_name`, `go_min`, etc.
- Emit per-package `TARGETS` that load `//build-tools/go:defs.bzl` macros (decentralized registration).
- Keep README steps aligned with glue generation and testing rules.
