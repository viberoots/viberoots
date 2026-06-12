## C++/Go Cleanup 5 — Tightening Cross‑Language Abstractions (Plan)

This plan consolidates small, high‑value improvements to our cross‑language abstractions now that C++ and Go have feature parity. The focus is on reducing duplication, centralizing rules, and improving developer ergonomics without changing core behavior or invalidation semantics.

- **Scope:** Generators, exporter validation, Nix templates, and optional introspection outputs.
- **Non‑goals:** Redesigning provider wiring, changing label taxonomy, or altering CI stages.

### Summary of Proposed Work

- **PR‑1:** Centralize label→provider parsing in a shared helper.
- **PR‑2:** Consolidate flat patch directory scanning/validation; reuse across languages where practical.
- **PR‑3:** Factor a tiny shared TARGETS rendering helper for consistent output formatting.
- **PR‑4:** Add an optional cross‑language provider index for introspection and tooling.
- **PR‑5:** Add a validation severity mode (warn vs error) for exporter, with CI forcing error.
- **PR‑6:** DRY small repetition in `build-tools/tools/nix/templates/cpp.nix` without behavior changes.
- **PR‑7:** Documentation updates and quickstart snippets.

---

## PR‑1: Shared label parsing helper

- **Title:** feat(glue): add shared label→provider parsing helper
- **Scope:**
  - Add `build-tools/tools/lib/labels.ts` exporting `providersForLabels(labels: string[]): string[]`.
  - Update `build-tools/tools/buck/gen-auto-map.ts` to use it.
  - No behavior change expected; output must be bit‑for‑bit identical.
- **Detailed design:**
  - The helper accepts Buck node `labels` and returns fully qualified provider targets (e.g., `//third_party/providers:mod_...`, `//third_party/providers:lf_...`, `//third_party/providers:nix_...`).
  - Internally reuse existing functions from `build-tools/tools/lib/providers.ts`: `providerNameForModuleKey`, `providerNameForImporter`, `normalizeNixAttr`, and `providerNameForNixAttr`.
  - Deduplicate and sort outputs for determinism.
- **Acceptance criteria:**
  - `gen-auto-map.ts` writes a file identical to pre‑change across the repository.
  - Unit coverage: parsing of `module:`, `lockfile:`, and `nixpkg:` labels (mixed and edge cases) yields stable results.
- **Risks:** Low; helper is a direct extraction of existing logic.
- **Consequence of not implementing:** Label parsing logic remains duplicated, making future label kinds harder to add consistently.

---

## PR‑2: Consolidate flat patch directory scanning

- **Title:** refactor(providers): reuse flat patch scanning/validation across languages
- **Scope:**
  - Keep Node’s importer‑scoped logic and C++’s attr‑scoped logic intact.
  - Reuse `build-tools/tools/lib/provider-sync.ts` where practical to validate flat directories and detect duplicate patches.
  - For Node: use the scanner for basic validation (flatness, duplicates), then apply current importer‑scoped filtering.
  - For C++: preserve attr‑prefix filtering; add a small helper to warn/error on subdirectories (flatness) for consistency.
- **Detailed design:**
  - Extend `scanFlatPatchDir` to allow a `fileFilter?(entry: Dirent): boolean` or a `preDecodeFilter?(filename: string): boolean` so Node/C++ can opt‑in to shared validation while still performing language‑specific selection.
  - Node flow: (1) validate with scanner, (2) compute effective set by importer, (3) intersect with validated patches.
  - C++ flow: keep `listCppPatchesFor(attr)` to find attr‑scoped files; add a `validateFlatDir("patches/cpp")` using the shared helper to warn on subdirs/invalid files once.
- **Acceptance criteria:**
  - No change to the generated `TARGETS.auto`/`TARGETS.node.auto`/`TARGETS.cpp.auto` contents.
  - Running with `--strict` continues to catch duplicates/invalid names deterministically across languages.
- **Risks:** Very low; we’re reusing validation helpers without changing provider semantics.
- **Consequence of not implementing:** Small validation differences persist, increasing cognitive load and risk of drift.

---

## PR‑3: Shared TARGETS rendering helper

- **Title:** refactor(glue): factor TARGETS rendering helper
- **Scope:**
  - Add `renderTargetsFile(header: string, entries: string[])` to `build-tools/tools/lib/fs-helpers.ts` or a new `build-tools/tools/lib/render.ts`.
  - Adopt in `build-tools/tools/buck/providers/go.ts`, `build-tools/tools/buck/providers/node.ts`, and `build-tools/tools/buck/providers/cpp.ts`.
- **Detailed design:**
  - Helper ensures stable trailing newlines and empty‑state headers.
  - No behavioral changes; textual outputs must be identical.
- **Acceptance criteria:**
  - All three generators write unchanged files (diff‑free) across the repo.
  - New unit test: empty inputs produce a deterministic header‑only file.
- **Risks:** None.
- **Consequence of not implementing:** Minor formatting logic remains duplicated; trivial but recurring footguns.

---

## PR‑4: Cross‑language provider index (optional, introspection)

- **Title:** feat(glue): emit `provider_index.bzl` for introspection
- **Scope:**
  - Add `build-tools/tools/buck/gen-provider-index.ts` and `third_party/providers/provider_index.bzl` (generated).
  - Provide `--emit-index` flag in `build-tools/tools/buck/sync-providers.ts` to generate alongside provider files.
  - Non‑blocking for builds; used by build-tools/tools/tests only.
- **Detailed design:**
  - Index maps each provider target to `{ kind: "go"|"cpp"|"node", key: string }` where key is:
    - Go: `module:<import>@<version>`
    - C++: `nixpkg:<attr>` (source of truth: `nix_attr_map.bzl`)
    - Node: `lockfile:<path>#<importer>`
  - Implementation strategy:
    - Reuse in‑memory entries produced during provider sync (Go and Node) and the C++ `nix_attr_map.bzl` map to build a single dictionary.
    - Deterministic sorting and stable output.
  - Optional CLI support in `build-tools/tools/patch/glue.ts` to explain provider origins for a given target by joining `auto_map.bzl` with the index.
- **Acceptance criteria:**
  - `node build-tools/tools/buck/sync-providers.ts --emit-index` writes `third_party/providers/provider_index.bzl` with consistent content across runs.
  - A small e2e script demonstrates explaining providers for a target using the index.
  - No change to build behavior or dependencies of targets.
- **Risks:** Low; outputs are additive. Keep the index opt‑in to avoid new required files in workflows.
- **Consequence of not implementing:** Harder debugging/introspection; tests/tools must parse multiple files or replicate logic.

---

## PR‑5: Validation severity mode for exporter

- **Title:** feat(exporter): add `--validation=warn|error` with CI override
- **Scope:**
  - Add `--validation` flag and `EXPORTER_VALIDATION` env in `build-tools/tools/buck/exporter/main.ts`.
  - Unify adapter `validate()` to return findings rather than throw; the main driver applies severity.
  - CI always treats findings as errors regardless of flag.
- **Detailed design:**
  - Go adapter: replace throw with reporting into a `problems: string[]` list.
  - C++ adapter: already warn‑only; move messages into the same reporting channel.
  - Main driver:
    - severity = `error` by default; if `EXPORTER_VALIDATION=warn` or `--validation=warn`, use warn unless `CI=true`.
    - Print grouped, colorized messages; exit non‑zero only in error mode.
- **Acceptance criteria:**
  - Local: `--validation=warn` prints warnings and exits zero; `--validation=error` fails.
  - CI: always fails on findings, regardless of local flags.
  - No change in which issues are detected; only severity handling changes.
- **Risks:** Low; contained to exporter. Ensure existing users without flags see identical behavior (default error).
- **Consequence of not implementing:** Persistent Go vs C++ severity asymmetry; friction in local dev when classification is being fixed.

---

## PR‑6: DRY repetition in `build-tools/tools/nix/templates/cpp.nix`

- **Title:** refactor(cpp.nix): factor attr resolution and flag joins
- **Scope:**
  - Extract repeated attribute resolution (`getAtPath`, `segs`, `normalize`, gtest alias handling) into a tiny local set of helpers at the top of the file.
  - Use the helpers in `cppApp`, `cppLib`, and `cppTest` where the logic is identical today.
- **Detailed design:**
  - No logic changes; maintain identical lists, ordering, and env flags.
  - Keep any test‑specific differences (e.g., thread libs) as‑is.
- **Acceptance criteria:**
  - Derivations produce identical artifacts and logs to pre‑change.
  - Internal unit tests (if any) stay green; CI build parity confirmed.
- **Risks:** Low; pure refactor.
- **Consequence of not implementing:** Small duplication remains, making future edits noisier.

---

## PR‑7: Documentation updates

- **Title:** docs(glue): document validation modes and provider index
- **Scope:**
  - Add a short section to `README.md` and `build-tools/docs/build-system-design.md`:
    - Validation modes (`--validation=warn|error`, CI override).
    - Optional provider index: purpose, how to enable (`--emit-index`), and example of using `build-tools/tools/patch/glue.ts` to explain providers for a target.
- **Detailed design:**
  - Provide concise examples; avoid long narrative.
- **Acceptance criteria:**
  - A new teammate can discover and use warn‑mode locally and the provider index without asking for help.
- **Risks:** None.
- **Consequence of not implementing:** Features become “hidden”; usage patterns drift or are rediscovered ad‑hoc.

---

## Rollout & Verification

- Land PRs in order (1→7). Keep each PR narrowly scoped to ease review and bisectability.
- After PR‑1..3 land, regenerate glue locally and confirm zero diffs.
- After PR‑4, run the new explain flow once on a representative target; keep index opt‑in by default.
- After PR‑5, confirm exporter behavior:
  - Local: `--validation=warn` prints warnings and exits success.
  - CI: with classification mistakes, build fails as before.
- After PR‑6, rebuild a small C++ app/lib/test trio and compare logs/artifacts for parity.

## Risks & Mitigations (global)

- **Accidental behavior change:** Guard with snapshot tests on generated files and compare pre/post outputs.
- **Hidden coupling in exporters:** Keep adapter interfaces stable; return findings instead of throwing.
- **Tooling drift:** Centralize helpers (labels, scanner, render) to reduce future divergence.

## Consequences of not implementing (global)

- Minor duplication remains across languages (label parsing, rendering, flat dir checks).
- Exporter validation severity stays asymmetrical, increasing friction in local iteration.
- Tooling/debugging lacks a single provider origin index; repeated bespoke logic persists in scripts/tests.
