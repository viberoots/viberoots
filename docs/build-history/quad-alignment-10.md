## Quad Alignment Plan — Cross-Language Parity & DRY Tightening (CPP / Go / PNPM / Python) — Part 10

This installment finishes the round of small, high‑impact refactors to harden partial‑clone friendliness, standardize macro surfaces, and reduce remaining boilerplate across languages. Each PR is self‑contained, preserves current behavior for unchanged inputs, and includes tests and documentation updates within the same change.

---

## PR‑1: Python provider sync activation in sparse/partial clones (uv.lock detection)

### Description

Enable Python provider sync when only `uv.lock` is present (e.g., sparse slices) by mirroring Node’s PNPM detection logic. This makes Python parity explicit without requiring full language scaffolding files in the slice.

### Scope & Changes

- Extend `build-tools/tools/buck/providers/index.ts` handler discovery to activate Python when any `uv.lock` is discovered (using existing `findUvLockfiles`).
- No behavior change when no `uv.lock` is present.

### Tests (in this PR)

- zx test: with a temp repo slice containing only `libs/foo/uv.lock` and importer‑local patches, `syncAllProviders({ lang: "python" })` emits `third_party/providers/TARGETS.python.auto` deterministically.
- zx test: absence of `uv.lock` yields an empty/no‑op write (stable banner with “No patches present” if applicable).

### Docs (in this PR)

- Short contributor note in provider sync section: Python activation is lockfile‑driven in sparse clones (parity with Node).

### Acceptance Criteria

- `TARGETS.python.auto` is generated in a sparse slice containing only `uv.lock` under `apps/*` or `libs/*`.
- Node behavior remains unchanged.

### Risks

- Very low; discovery is already implemented for reading Python lockfiles. Activation gating is minimal.

### Consequence of Not Implementing

- Python provider sync remains disabled in sparse slices unless full language files are present.

### Downsides for Implementing

- Small additional branch in provider handler discovery.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Works with only `uv.lock` and importer‑local patches in slice; no dependency on full Python templates.

---

## PR‑2: Teach language detection to honor globbed requiredPaths (Node/Python parity) and prefer it over ad‑hoc activation

### Description

Generalize `build-tools/tools/lib/langs.ts:detectEnabledLanguages()` to treat `requiredPaths` entries that are globs (e.g., `**/pnpm-lock.yaml`, `**/uv.lock`) as “present if any match exists.” Update the Python language manifest to include `**/uv.lock`. With this, provider discovery no longer needs bespoke enablement per language.

### Scope & Changes

- Add minimal glob support in `detectEnabledLanguages` (fast, ignore repo‑wide heavy dirs).
- Update `build-tools/tools/nix/langs.json`:
  - For Python, add `**/uv.lock` to `requiredPaths` (keeping existing entries).
- In `build-tools/tools/buck/providers/index.ts`, rely primarily on `detectEnabledLanguages` for Node/Python enablement; keep the existing Node PNPM detection as a soft fallback for ultra‑thin slices.

### Tests (in this PR)

- zx tests:
  - With only `apps/web/pnpm-lock.yaml` in slice, Node is detected as enabled via glob logic and providers sync emits `TARGETS.node.auto`.
  - With only `libs/foo/uv.lock` in slice, Python is detected as enabled and emits `TARGETS.python.auto`.
  - Golden comparison: outputs are byte‑identical to pre‑change behavior for unchanged inputs.

### Docs (in this PR)

- Note in language detection docs: `requiredPaths` may contain globs; glob presence enables the language in partial clones.

### Acceptance Criteria

- Node/Python are enabled in sparse slices via glob presence without bespoke checks, and generated artifacts are unchanged for full clones.

### Risks

- Minimal; glob evaluation is bounded and respects ignore directories.

### Consequence of Not Implementing

- Continued reliance on language‑specific ad‑hoc checks for activation.

### Downsides for Implementing

- Small complexity increase in detection logic.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Works when only lockfiles are sliced in; maintains Node fallback in extreme slices.

---

## PR‑3: Table‑driven provider writer configuration (reduce conditionals, ease new ecosystems)

### Description

Replace the conditional chain in `build-tools/tools/lib/provider-writer.ts:writeImporterProvidersByLang(...)` with a registry mapping language → rule name, sentinels, default output path. No output changes.

### Scope & Changes

- Introduce a tiny constant registry `{ node, python }` with values: rule name, auto‑section sentinels, default out path.
- Use the registry in `writeImporterProvidersByLang` to assemble header and write options.

### Tests (in this PR)

- Golden tests for Node and Python confirm byte‑for‑byte identical `TARGETS.*.auto` files pre/post change.

### Docs (in this PR)

- Contributor note: add new importer‑scoped ecosystems by extending the registry.

### Acceptance Criteria

- Outputs remain unchanged; adding a new importer‑scoped language requires only registry wiring.

### Risks

- Very low; refactor of internal table only.

### Consequence of Not Implementing

- Ongoing duplication and small drift risk when adding future ecosystems.

### Downsides for Implementing

- Minor churn to one helper function.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Pure glue change; no extra files required in thin slices.

---

## PR‑4: Default package‑local patch directory helper in Starlark

### Description

Add `default_package_patch_dirs(lang)` (tiny helper) in `//lang:defs_common.bzl` and migrate macros to use it instead of hard‑coded strings, keeping current defaults exactly the same.

### Scope & Changes

- New helper in `defs_common.bzl`: returns `["patches/<lang>"]` (or extended list if customized later).
- Migrate Go/CPP macros to call the helper where they currently default `local_patch_dirs`.

### Tests (in this PR)

- Starlark probe test: `package_local_patches_probe(...)` produces identical `srcs` lists pre/post migration for representative packages.

### Docs (in this PR)

- Brief contributor note: prefer the helper to avoid string duplication and future drift.

### Acceptance Criteria

- No change in invalidation behavior; identical `srcs` expansions.

### Risks

- Very low.

### Consequence of Not Implementing

- Repeated string defaults across macros; slightly higher drift risk.

### Downsides for Implementing

- Minimal code motion across 2–3 macro files.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Helper lives under `//lang`; macro files already sliced in standard clones.

---

## PR‑5: Unify `nixpkgs` deps kwarg naming across macros (add `nixpkg_deps` alias)

### Description

Introduce `nixpkg_deps` as the preferred kwarg across macros and keep existing names as aliases (no breaking change):

- Go: `nix_cgo_deps` (alias to `nixpkg_deps`)
- Python: `nix_native_deps` (alias to `nixpkg_deps`)
- C++: `nix_cxx_attrs` (alias to `nixpkg_deps`)

### Scope & Changes

- Plumb alias handling in each macro, funnelling into `append_nixpkg_labels(...)` without changing emitted labels.
- Maintain current behavior for all callers; document the preferred kwarg name.

### Tests (in this PR)

- Macro zx tests: passing either the legacy kwarg or `nixpkg_deps` yields identical label sets and provider mappings.

### Docs (in this PR)

- Macro docs: recommend `nixpkg_deps`; legacy names remain supported.

### Acceptance Criteria

- No behavioral diffs; both names accepted; labels unchanged.

### Risks

- Low; kwarg normalization only.

### Consequence of Not Implementing

- Minor inconsistency across languages and a steeper learning curve for new contributors.

### Downsides for Implementing

- Small additions to macro argument plumbing.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Macro edits only; safe in standard slices that include language defs.

---

## PR‑6: Provider driver registry in providers/index.ts (reduce manual wiring)

### Description

Introduce a tiny registry mapping language id → loader for its `sync*Providers` function. Replace per‑language conditionals with a lookup and narrow‑filter when `--lang` is passed. Future ecosystems add one registry entry without touching logic.

### Scope & Changes

- New registry object (lang → async loader/adapter).
- `buildHandlers(...)` iterates detected languages (from PR‑2) and consults the registry. Node fallback PNPM detection remains as a safety net.

### Tests (in this PR)

- zx tests:
  - With both PNPM and uv lockfiles sliced, `buildHandlers()` yields Node and Python handlers.
  - With `--lang python`, only Python handler is loaded.
  - Golden outputs remain identical.

### Docs (in this PR)

- Contributor note: add ecosystems by extending the registry; no logic edits required.

### Acceptance Criteria

- Handlers are built via registry; outputs and CLI ergonomics are unchanged.

### Risks

- Low; straightforward refactor.

### Consequence of Not Implementing

- Small ongoing duplication in provider handler assembly.

### Downsides for Implementing

- Minor import/wiring churn.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

- Works in slices that include glue libs and relevant provider modules.

---

## Rollout & Sequencing

1. PR‑1 (Python sparse activation) — unlock parity quickly.
2. PR‑2 (Globbed language detection) — generalize activation and reduce ad‑hoc enablement.
3. PR‑3 (Table‑driven provider writer) — prepare for easy future ecosystems.
4. PR‑4 (Default patch‑dir helper) — tighten Starlark DRY.
5. PR‑5 (Unify `nixpkg_deps` alias) — align macro surfaces; no behavior change.
6. PR‑6 (Provider driver registry) — finish DRY in handler assembly.

---

## Verification & Backout Strategy

- Each PR ships zx tests (golden outputs where applicable) and updated contributor notes.
- Backout is simple: revert the PR; outputs remain stable because changes are either additive or refactors with golden coverage.
- For PR‑2 specifically, keep the Node fallback in `providers/index.ts` until glob detection proves stable in CI across sparse scenarios; remove only after an observability window if desired.

---

## Summary of Expected Impact

- **Partial‑clone parity**: Node and Python enable cleanly via lockfile presence without bespoke wiring.
- **Maintainability**: Table‑driven provider writer and a provider driver registry reduce conditional sprawl.
- **Consistency**: Unified `nixpkg_deps` alias and a shared default patch‑dir helper make macros more uniform.
- **Safety**: No behavioral changes for unchanged inputs; golden tests ensure byte‑for‑byte output stability.
