## Language architecture refactor — Phase 2 plan

This follow-on plan builds on PRs 1–9 to further improve clarity, reduce cyclomatic complexity, and make the system more self‑documenting while making it easier to add new languages. Each PR below is incremental and keeps tests green.

### Design goals (Phase 2)

- Improve readability and explicitness of language plug‑ins; minimize per‑language ceremony
- Reduce duplication via shared helpers and contracts
- Formalize registries with types and (optionally) codegen from a single manifest
- Strengthen partial‑clone grace and error UX (hard requirement)

---

## PR 10: Typed language contracts (TS interfaces) — partial‑clone safe

**Intent/Impact**

- Define strong contracts for language integration in one place to reduce ambiguity and implicit coupling.

**Changes**

- Add `tools/lib/lang-contracts.ts`:
  - `LanguageProviderSync` (provider sync adapter)
  - `PlannerLanguage` (planner predicates and mk\* hooks)
  - `ScaffoldingLanguage` (id, kinds, requiredPaths, templatesDir)
- Update `tools/buck/providers/index.ts`, `tools/lib/langs.ts`, and planner-adjacent TS to import these interfaces.
- Contracts must not assume a language is present; interfaces work with zero enabled languages.

**Acceptance criteria**

- All language registries compile against the shared interfaces.
- No behavior change; tests pass.
- Partial clone: importing contracts/types in a repo without Go does not throw; discovery returns an empty set.

**If not implemented**

- Registry drift and ad‑hoc shapes make adding languages slower and error‑prone.

---

## PR 11: Single source of truth for languages (manifest → codegen) — partial‑clone aware

**Intent/Impact**

- Eliminate duplication by generating registries from one manifest, improving clarity and consistency.

**Changes**

- Introduce `tools/nix/langs.json` (authoritative): `[ { id, displayName, requiredPaths, optionalPaths, kinds, templatesDir } ]`.
- Add `tools/dev/codegen.ts` step to emit:
  - `tools/lib/langs.ts` (scaffolding/enablement list)
  - Optional `tools/nix/langs.nix` for planner references
- Update glue and `scaf` to import the generated TS.
- Codegen reads only the manifest; it does not access language files and thus never fails on missing languages.

**Acceptance criteria**

- Editing `tools/nix/langs.json` and rerunning codegen updates registries; tests green.
- Partial clone: languages with missing `requiredPaths` are not enabled; commands still succeed.

**If not implemented**

- Two sources of truth (TS + Nix) may drift; adding languages requires touching multiple files.

---

## PR 12: Provider sync framework (shared helpers) — graceful skip if patches dir missing

**Intent/Impact**

- Reduce cyclomatic complexity in each provider sync script; enforce naming and validation centrally.

**Changes**

- Add `tools/lib/provider-sync.ts` with helpers:
  - scan flat patch dirs, validate shapes, duplicate detection, sort, write deterministic `TARGETS.*.auto`
  - hooks: `decodeKey(filename)`, `providerNameFor(key)`
- Refactor Go sync to use framework; keep behavior identical.
- If `patches/<lang>` is absent, framework returns an empty entries list (no-op) in non‑strict mode.

**Acceptance criteria**

- Go provider sync output unchanged and deterministic; duplicate/subdir tests remain green.
- Partial clone: running sync with a missing language directory produces no diffs or errors.

**If not implemented**

- New languages must re‑implement scanning/validation logic, inviting subtle bugs.

---

## PR 13: Exporter adapter contract — inert when adapter not present

**Intent/Impact**

- Make per‑language exporter logic consistently pluggable with a single entrypoint; lower the barrier to add labelers.

**Changes**

- Add `tools/buck/exporter/lang/contract.ts` defining `exportLabels(nodes, batches, cacheDir) → nodesWithLabels`.
- Ensure Go adapter implements contract; `main.ts` dispatches by `lang:*` label or `rule_type`.
- Avoid dynamic imports for missing adapters; maintain a small present-adapters list and guard dispatch.

**Acceptance criteria**

- No functional change for Go; exporter tests pass (cache reuse, test‑only deps, tuple correctness).
- Partial clone: exporter writes a valid `graph.json` with zero language labels for missing adapters.

**If not implemented**

- Language adapters remain implicit; future languages take longer to integrate safely.

---

## PR 14: Planner plug‑in files per language (Nix) — import‑if‑exists

**Intent/Impact**

- Keep `graph-generator.nix` minimal; move language specifics into `tools/nix/planner/<lang>.nix` and import when present.

**Changes**

- Create `tools/nix/planner/go.nix` providing `{ isTarget, kindOf, modulesFileFor, mkApp, mkLib }`.
- `graph-generator.nix` imports `./tools/nix/planner/<lang>.nix` if the file exists; otherwise skips.

**Acceptance criteria**

- Planner output unchanged for Go; partial clones without Go continue to produce an empty outputs dir.
- Importing planner in repos missing plugin files does not error; branches guarded by `pathExists`.

**If not implemented**

- The planner accumulates per‑language branches, increasing complexity over time.

---

## PR 15: New‑language scaffolding kit — defaults to conditional imports

**Intent/Impact**

- Make adding a language mostly mechanical and self‑documenting.

**Changes**

- Add `tools/scaffolding/templates/lang-kit/` that generates:
  - `tools/nix/templates/<lang>.nix`
  - `tools/nix/planner/<lang>.nix`
  - `<lang>/defs.bzl`
  - `tools/buck/providers/<lang>.ts` (stub)
  - Registry entry (extends `tools/nix/langs.json`)
  - Contract tests under `tools/tests/<lang>/`

**Acceptance criteria**

- Running `scaf new lang-kit <id>` yields a compilable, testable skeleton; at least one sample contract test passes after minimal edits.
- Generated code uses import‑if‑exists patterns to avoid hard failures in sparse checkouts.

**If not implemented**

- New languages require manual file creation and cross‑referencing multiple docs.

---

## PR 16: Language conformance tests (contract suite) — include sparse‑checkout cases

**Intent/Impact**

- Ensure each new language meets the minimum wiring guarantees (labels → providers → auto‑map → macros).

**Changes**

- Add a zx test suite that runs against a temp repo using fixtures:
  - provider sync determinism, duplicate handling
  - auto‑map mapping of language labels to providers
  - macro label stamping and test auto‑wiring
  - sparse‑checkout behavior

**Acceptance criteria**

- Go passes the contract suite; suite can be parameterized for future languages.
- Removing a language’s required files in a temp repo yields graceful no‑ops for that language; others still work.

**If not implemented**

- Regressions in new languages are discovered late; manual review burden remains high.

---

## PR 17: Centralized error & UX policy for partial clones — standard messages & exit codes

**Intent/Impact**

- Make missing components and stale glue uniformly actionable with low noise.

**Changes**

- Add `tools/lib/errors.ts` with helpers for friendly messages.
- Standardize missing‑language messages in `scaf`, glue, and prebuild guard.
- Commands exit 0 when skipping absent languages (outside strict test modes); non‑zero reserved for real failures.

**Acceptance criteria**

- When files are missing, commands still succeed where possible and report uniform guidance.
- Sparse‑checkout smoke tests validate both messaging and exit codes.

**If not implemented**

- Mixed error styles degrade DX and make debugging slower.

---

## PR 18: Capability matrix & CI auto‑staging — treat missing languages as disabled

**Intent/Impact**

- Drive CI stages from a small capability manifest so new languages automatically wire into pipelines.

**Changes**

- Extend `tools/nix/langs.json` with booleans: `{ patching, lockfileLabels, testAutoWire }`.
- CI (and local glue) stages pick steps based on capabilities.
- Stage generators consider missing `requiredPaths` ⇒ language disabled; no error.

**Acceptance criteria**

- Current CI behavior remains for Go; flipping capabilities in a temp branch alters stages as expected.
- CI simulation of a sparse checkout passes without manual edits or mock files.

**If not implemented**

- CI plumbing must be edited per language, raising friction and risk.

---

## PR 19: Docs — “Build a language in 60 minutes”

**Intent/Impact**

- Consolidate the above into a short, prescriptive tutorial that pairs with the lang‑kit.

**Changes**

- Add `docs/handbook/new-language-walkthrough.md` with copy‑paste snippets and commands.

**Acceptance criteria**

- A teammate can scaffold a toy language and pass the contract suite without reading internal source.

**If not implemented**

- Onboarding remains dependent on deep code reading.

---

### Quality bar across all PRs

- Reduce cyclomatic complexity; prefer small, well‑named functions
- Strengthen types and contracts over comments; self‑document through code
- Maintain partial‑clone grace and deterministic outputs
- Keep tests green; add/extend contract tests where practical
