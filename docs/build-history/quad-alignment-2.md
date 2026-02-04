## Quad Alignment Plan — Cross-Language Parity Tightening (CPP / Go / PNPM / Python) — Part 2

This second part builds on Part 1 and focuses on consolidating shared logic, tightening planner cohesion, and adding parity tests. All PRs target zero functional diffs in outputs (build artifacts, provider mappings, labels) for unchanged inputs; the changes are primarily structural/ergonomic.

## PR‑1: Consolidate importer‑scoped provider core (Node + Python)

### Description

Factor the common importer‑scoped provider generation logic (discover lockfiles → compute importer labels → select effective set → gather importer‑local patches → write deterministic TARGETS) into a shared helper. Keep ecosystem‑specific lock parsing in their respective modules.

Not yet implemented (verified): no `build-tools/tools/lib/provider-writer.ts`; both `build-tools/tools/buck/providers/node.ts` and `build-tools/tools/buck/providers/python.ts` contain bespoke loops today.

### Scope & Changes

- build-tools/tools/lib/provider-writer.ts (new):
  - Minimal API to emit importer providers deterministically:
    - Input: lockfiles, parseEffectiveSet(importer) → Set<"name@version">, listImporterPatches(importer), providerNameForImporter, rule headers/load symbols.
    - Output: stable TARGETS text and auto‑section sync.
- build-tools/tools/buck/providers/node.ts and build-tools/tools/buck/providers/python.ts:
  - Replace bespoke loops with calls to the shared helper.
  - Keep `parsePnpmLock()/effectiveSetForImporter()` and `parseUvLockKeys()` local.

- Tests & Docs (as part of this PR):
  - Add a zx test that runs each generator using the new helper and asserts output equality with pre‑refactor artifacts (byte‑for‑byte).
  - Update `docs/handbook/adding-language.md` to reference the shared helper and importer utilities.

### Acceptance Criteria

- No diffs in `third_party/providers/TARGETS.node.auto` or `third_party/providers/TARGETS.python.auto` for identical inputs.
- Existing zx tests for Node/Python providers remain green; new helper test passes.

### Risks

- Low. Behavior‑preserving refactor; shared helper is thin and deterministic.

### Consequence of Not Implementing

- Ongoing duplication and drift between Node/Python provider writers.

### Downsides for Implementing

- Small one‑time refactor across two generators.

### Recommendation

- Implement.

## PR‑2: Consolidate provider TARGETS headers

### Description

Centralize the generation of deterministic TARGETS headers (generated banner + `load(...)` lines) used by Node and Python provider writers.

Not yet implemented (verified): no `build-tools/tools/lib/providers-headers.ts`; headers are inlined in `build-tools/tools/buck/providers/node.ts` and `build-tools/tools/buck/providers/python.ts`.

### Scope & Changes

- build-tools/tools/lib/providers-headers.ts (new):
  - `providersHeaderFor({ lang, load, rule })` → stable, newline‑correct header string.
- build-tools/tools/buck/providers/{node,python}.ts:
  - Replace in‑file headers with shared helper.

- Tests & Docs (as part of this PR):
  - Add a minimal unit test that snapshots header generation for Node and Python to prevent formatting drift.
  - No changes expected in provider outputs; mention helper in `docs/handbook/adding-language.md`.

### Acceptance Criteria

- No diffs in generated TARGETS files for identical inputs.

### Risks

- None material.

### Consequence of Not Implementing

- Duplication across providers; easy to diverge on header formatting.

### Downsides for Implementing

- Small refactor; trivial footprint.

### Recommendation

- Implement.

## PR‑3: Planner cohesion — route C++ via registry by default

### Description

Prefer the language registry (`LANGS.cpp`) path when constructing C++ derivations to reduce bespoke logic in the planner. Retain the existing `PLANNER_ONLY_CPP` optimization as an optional fast‑path for sliced test workspaces.

Not yet implemented (verified): `build-tools/tools/nix/graph-generator.nix` directly imports C++ planner adapter and uses `mkCpp` instead of going through `LANGS.cpp` for construction.

### Scope & Changes

- build-tools/tools/nix/graph-generator.nix:
  - Default to `LANGS.cpp.*` for kind inference and mk\* functions.
  - Keep the `onlyCpp` fast‑path minimal and clearly documented as an optimization.

- Tests & Docs (as part of this PR):
  - Add a small zx test that builds a representative C++ binary through the planner and asserts identical derivation paths vs pre‑change on unchanged inputs.
  - Update `build-tools/docs/build-system-design.md` to note registry‑first C++ construction.

### Acceptance Criteria

- `nix build .#graph-generator` yields identical outputs for unchanged graphs.
- All planner zx tests remain green; new cohesion smoke test passes.

### Risks

- Low. Behavior should be unchanged; control flow is simplified.

### Consequence of Not Implementing

- Higher cognitive load and dual code paths for C++ in the planner.

### Downsides for Implementing

- Minor churn in `graph-generator.nix`.

### Recommendation

- Implement.

## PR‑4: Split glue — isolate inline exporter from ensureGraph

### Description

Reduce the size and complexity of `ensureGraph()` by moving the inline buck2 export fallback into a dedicated module, preserving idempotence and the existing fallback order.

Not yet implemented (verified): no `build-tools/tools/buck/export-inline.ts`; inline exporter logic lives in `build-tools/tools/patch/glue.ts` today.

### Scope & Changes

- build-tools/tools/buck/export-inline.ts (new): encapsulates the inline `buck2 cquery` export path.
- build-tools/tools/patch/glue.ts: call the new module; keep file ≤250 lines; no behavior change.
- Tests & Docs (as part of this PR):
  - Keep `build-tools/tools/tests/build-tools/tools/ensure-graph.idempotent.test.ts` as‑is; add a quick unit that exercises the new module’s argument/flag wiring (no behavioral change).
  - Document the split in `build-tools/docs/build-system-design.md` (exporter/glue section).

### Acceptance Criteria

- `build-tools/tools/tests/build-tools/tools/ensure-graph.idempotent.test.ts` passes.
- No diffs in `build-tools/tools/buck/graph.json` content for identical inputs.

### Risks

- Very low. Mechanical extraction.

### Consequence of Not Implementing

- Glue remains larger and harder to maintain.

### Downsides for Implementing

- Additional small file.

### Recommendation

- Implement.

## PR‑5: Planner override env mapping table

### Description

Avoid hard‑coding per‑language override env variable names in the planner by introducing a tiny mapping table. Improves discoverability and eases future language additions.

Not yet implemented (verified): no `build-tools/tools/nix/planner/overrides.nix`; env names are hard‑coded in `build-tools/tools/nix/graph-generator.nix`.

### Scope & Changes

- build-tools/tools/nix/planner/overrides.nix (new):
  - `{ go = "NIX_GO_DEV_OVERRIDE_JSON"; cpp = "NIX_CPP_DEV_OVERRIDE_JSON"; python = "NIX_PY_DEV_OVERRIDE_JSON"; }`
- build-tools/tools/nix/graph-generator.nix:
  - Import and iterate the mapping when emitting local notices (respecting `PLANNER_NO_DEV_OVERRIDE_LOG` and `CI` semantics).
  - No change to template‑level CI guards.

- Tests & Docs (as part of this PR):
  - Add a small zx test that sets each override env and confirms planner emits the same local notice behavior as before (suppressed in CI).
  - Document the mapping table in `build-tools/docs/build-system-design.md` (planner section).

### Acceptance Criteria

- Local planner notices appear unchanged when overrides are set; CI behavior remains strict via templates.

### Risks

- Very low. Pure planner refactor.

### Consequence of Not Implementing

- Repeated env name literals; minor friction adding new languages.

### Downsides for Implementing

- One small import and lookup.

### Recommendation

- Implement.

## Rollout & Sequencing

1. PR‑1 (Importer‑scoped provider core) — unblocks header consolidation.
2. PR‑2 (Provider TARGETS headers) — remove duplication.
3. PR‑3 (Planner cohesion for C++) — contained planner refactor.
4. PR‑4 (Split glue) — mechanical extraction; keep idempotence test.
5. PR‑5 (Planner override env mapping) — tiny, low risk.

All PRs are independently reversible.

## Verification & Backout Strategy

- PR‑1:
  - Re‑run Node/Python provider sync; confirm `TARGETS.*.auto` identical byte‑for‑byte. Backout by restoring per‑language loops if any diff appears.
- PR‑3:
  - `nix build .#graph-generator` unchanged; spot‑check selected C++ targets. Backout by restoring the pre‑registry path for C++.
- PR‑4:
  - Idempotence test stays green; no diffs in `graph.json` for unchanged inputs. Backout by inlining the exporter code into `ensureGraph()`.
- PR‑2:
  - No diffs in provider TARGETS headers; revert to inline strings if necessary.
- PR‑5:
  - Planner notices unchanged; revert to literals if any unexpected log change appears.

## Summary of Expected Impact

- Reduced duplication across provider generators and headers; easier maintenance.
- Cleaner planner cohesion for C++; simpler to extend the language registry model.
- Leaner glue with clearer responsibilities; easier to test and evolve.
- No functional changes to build outputs or mappings; safer long‑term evolution.
