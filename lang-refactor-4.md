## Language architecture refactor — Phase 4 plan

This phase builds on Phase 3 and focuses on converting our language enablement into a primarily declarative, one‑shot workflow. We align exporter, planner, macros, provider sync, diagnostics, and docs around a single manifest, and ship a turnkey conformance suite so new languages start with tests.

### Design goals (Phase 4)

- Collapse multi-surface edits into a single manifest + codegen step
- Provide a ready-to-run conformance suite for each new language
- Reduce per-language Nix boilerplate via a shared templates module
- Make the scaffolding CLI produce a runnable language in one command
- Maintain determinism, sparse-checkout grace, and small API surfaces

---

## PR 33: Manifest-driven codegen across exporter, planner, macros, providers

Intent/Impact

- One declarative entry in `tools/nix/langs.json` drives:
  - exporter adapter stub (`tools/buck/exporter/lang/<id>.ts`)
  - planner plugin via `planner-gen` (`tools/nix/planner/<id>.nix`)
  - stamping macros (`<id>/defs.bzl`) with `lang:<id>` and `kind:*`
  - provider-sync skeleton in `tools/buck/providers/<id>.ts` when applicable
- Eliminates drift between detection, planning, stamping, and provider wiring.

Detailed design

- Extend manifest schema (validated by `tools/dev/validate-langs.ts`) with optional per-language hints:
  - `detect.ruleTypePrefixes: string[]`
  - `detect.requireAnyLabels: string[]`
  - `kinds: ["bin"|"lib"|"test"]` (declared capabilities)
  - `providers.kind: "module@version" | "lockfile/importer" | "none"`
  - `templatesDir: string` (existing)
  - `requiredPaths: string[]` (existing)
- Add `tools/dev/langs.codegen.ts` that:
  1. Invokes `planner-gen` for each language with detect/kindOf hints
  2. Emits or updates `tools/buck/exporter/lang/<id>.ts` with a minimal adapter that composes `helpers.ts` and the manifest-provided predicates
  3. Emits `<id>/defs.bzl` that calls `lang/defs_common.bzl#stamp_labels`, loads `MODULE_PROVIDERS`, and forwards through to the underlying language rules
  4. Optionally creates `tools/buck/providers/<id>.ts` using a small interface if `providers.kind` is not `none`
  5. Updates docs stubs and links
- Add exporter adapter template (TypeScript) that consumes `detect` hints:
  - `isNode(n)`: return `hasLabel(n, anyOf(manifest.detect.requireAnyLabels)) || isRuleType(n, anyPrefix(manifest.detect.ruleTypePrefixes))`
  - `buildBatches` and `attachLabels`: shell for language-specific logic (presently mostly no-op except languages that need it)
- Add macro template that stamps `lang:<id>` and `kind:*`, and wires `MODULE_PROVIDERS`.

Acceptance criteria

- Adding an entry to `tools/nix/langs.json` and running `node tools/dev/langs.codegen.ts` produces:
  - `tools/nix/planner/<id>.nix` via `planner-gen` (deterministic)
  - `tools/buck/exporter/lang/<id>.ts` (compiles)
  - `<id>/defs.bzl` that loads successfully in Buck
  - `tools/buck/providers/<id>.ts` when `providers.kind` ≠ `none`
- Existing languages (Go, Node where applicable) remain unchanged behaviorally.
- Tests validate codegen idempotency and stable outputs (no drift on second run).

Risks

- Overfitting manifest fields could prematurely lock APIs; keep hints optional and narrowly defined. Favor helpers, not monoliths.

If not implemented

- Adding languages still requires touching multiple surfaces, increasing cognitive load and drift risk.

---

## PR 34: Templates-common.nix — shared patching/override helpers

Intent/Impact

- Factor Go’s `patchesMapFromDir`, `devOverrideEnv` reading, and CI guard into a reusable Nix module (`tools/nix/templates-common.nix`).
- Consumers (Go now; Rust/Python later) import helpers to eliminate copy/paste and align behavior.

Detailed design

- Create `tools/nix/templates-common.nix` with:
  - `patchesMapFromDir = patchDir: { "module@ver" = [ /abs/patch1 ... ]; }`
  - `readDevOverrides = env: (envVar=="" ? {} : builtins.fromJSON envVar)`
  - `guardNoDevOverridesInCI envName`: throws in CI when overrides present
  - Small utility `lowerKey(k)` for case-insensitive keys
- Adapt `tools/nix/lang-templates.nix` to import common helpers for Go path; keep exact behavior.
- Document example usage for other languages in `docs/handbook/provider-sync-cookbook.md`.

Acceptance criteria

- No behavior changes for Go templates; outputs and build graph identical.
- New languages can depend on one function call to gain patches/overrides semantics.

Risks

- Introducing a shared module may accidentally change evaluation order; keep helper pure and side-effect free.

If not implemented

- Each new language re-implements patch map and dev override semantics, risking inconsistency.

---

## PR 35: Turnkey conformance suite per language

Intent/Impact

- Provide a generated, runnable test pack for a new language to validate:
  - exporter detection/labels determinism
  - planner kind selection and derivation wiring
  - stamping lint (`lang:<id>` and `kind:*`)
  - provider sync rules (duplicates, flat dir, deterministic order) when applicable
  - minimal Buck build smoke
- Dramatically shortens review cycles and proves integration consistency.

Detailed design

- Add `tools/scaffolding/templates/language/kit/tests` with generic zx tests parameterized by `<id>` and manifest capabilities.
- `scaf language new <id>` emits `tools/tests/<id>/contract/*` using these templates.
- Tests rely on `--simulate` where possible; where real lockfiles are needed, tiny fixtures are created under `tools/tests/lib/fixtures/<id>`.

Acceptance criteria

- Running the generated test pack passes on a fresh language scaffold with no manual edits.
- CI can execute only the language’s conformance tests by label.

Risks

- Overly strict generic assertions could hinder exotic languages; keep tests targeted, configurable via manifest flags (e.g., `providers.kind=none`).

If not implemented

- New languages may ship without immediate safety nets; regressions surface late.

---

## PR 36: “lang new” one‑shot runnable workflow

Intent/Impact

- Make `scaf language new <id>` produce a runnable language in one command, optionally writing the manifest entry, generating planner/adapter/macros/provider stubs, and emitting a conformance suite.

Detailed design

- Extend `tools/scaffolding/scaf.ts`:
  - Flags: `--write-manifest`, `--no-manifest`, `--tests`, `--yes` (non-interactive)
  - When `--write-manifest` is set, append to `tools/nix/langs.json` with minimal fields (`id`, `displayName`, `requiredPaths`, `kinds`, `templatesDir`, `providers.kind`) and run `tools/dev/validate-langs.ts`.
  - Invoke `node tools/dev/langs.codegen.ts` to generate planner/adapter/macros/provider skeletons.
  - If `--tests`, emit language contract tests under `tools/tests/<id>/contract/*`.
  - Print follow-up TODOs only when necessary (e.g., to fill lockfile parser logic).
- Update `docs/handbook/new-language-walkthrough.md` with the one-shot flow.

Acceptance criteria

- Running `scaf language new toy --write-manifest --tests --yes` yields a repo state where:
  - `buck2 test //tools/tests/toy/...` passes
  - `node tools/dev/langs-diagnose.ts --lang=toy` shows enabled/disabled status with actionable messages
- Partial-clone grace: command is no-op (skip) when repo lacks needed directories (`tools/nix/planner`, etc.).

Risks

- Accidental manifest edits on shared branches; require `--yes` and print a dry-run preview by default.

If not implemented

- New language bring-up remains multi-step and error prone.

---

## PR 37: Diagnostics “explain & fix” mode for languages

Intent/Impact

- Extend `tools/dev/langs-diagnose.ts` with `--fix` to materialize missing skeletons and stub files (never destructive), improving time-to-first-green.

Detailed design

- `--fix` behavior:
  - Create missing `tools/nix/planner/<id>.nix` via `planner-gen` if config exists
  - Create exporter adapter/macros/provider stub if absent and manifest declares language
  - Never edit `langs.json` unless `--write-manifest` is explicitly passed through (proxied to `scaf language new`)
  - CI mode prints actionable messages, never mutates files

Acceptance criteria

- On a partially configured language, running `langs-diagnose --lang=<id> --fix` creates missing non-destructive skeletons and prints next steps. Re-running is idempotent.

Risks

- Over-eager fixes could hide misconfigurations; scope to skeleton creation only and keep CI read-only.

If not implemented

- Users must manually create boilerplate, slowing enablement and causing inconsistencies.

---

## PR 38: Labeling DSL + lints (cross-language determinism)

Intent/Impact

- Formalize label shapes (`module:`, `lockfile:`, `lang:`, `kind:`) and add lints to prevent drift and unknown prefixes.

Detailed design

- Add a small schema + validator for labels in exporter results (node-level check):
  - Known prefixes only; `kind:*` in {bin, lib, test}; `lang:*` required where macro or adapter detects language
- Add a zx lint `tools/dev/labels-lint.ts` that scans `tools/buck/graph.json` and fails on violations.

Acceptance criteria

- Lint passes on current repo; negative tests verify each violation with clear remediation.

Risks

- Over-linting could block nuanced use-cases; provide `--allow` escapes per rule type.

If not implemented

- Subtle label drift reduces determinism and breaks provider mapping.

---

### Quality bar across Phase 4

- Deterministic outputs; stable sort for generated files
- Partial‑clone grace; discovery and codegen skip safely
- Strong typing (TS/Nix); small, well‑named functions with low complexity
- Codegen is idempotent; second run produces no diffs
- Tests stay green after each PR; add targeted tests per new behavior
