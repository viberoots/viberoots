# Quad Alignment Plan — Cross-Language Seam Tightening (CPP / Go / PNPM / Python) — Part 33

This installment follows Part 32. Part 32 focused on tightening planner-visible wiring defaults, standardizing dict-safe synthetic key prefixes, centralizing Node Nix-calling command assembly, enforcing patch_scope stamping, and reducing Go macro duplication. In Part 33 I focus on the remaining seams that still make debugging and extension work require too much cross-language context.

The themes in this installment are:

- Make patch invalidation behavior easier to understand by default, especially for importer-scoped ecosystems where provider files can be misleading.
- Make importer-scoped exporter adapter configuration more data-driven so adding a new importer-scoped language is a small, table-driven change.
- Reduce remaining duplication in package-local WASM macro shapes by introducing one shared helper surface.
- Remove small TypeScript duplication around provider index enumeration and lockfile discovery conventions.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Patch invalidation diagnostics that explain the real invalidation surface (per language, per target shape)

### Description

Patch invalidation is correct today, but it is still easy to misinterpret during debugging. The most common failure mode is looking at `third_party/providers/TARGETS.*.auto` and assuming that is the invalidation surface for importer-local patches. For Node and Python, importer-local patch invalidation is primarily driven by macro action inputs. Providers are part of wiring and observability, not the only driver.

This PR tightens the abstraction by making the patch model visible and explicit in the default diagnostics we already run and generate.

### Scope & Changes

This PR adds a single, canonical diagnostic report that answers “what invalidates what” without requiring readers to know the implementation details.

- Extend the provider index emission to include patch model metadata:
  - For each provider entry, record:
    - language (`node`, `python`, `go`, `cpp`)
    - patch scope (`package-local` vs `importer-local`)
    - what is expected to carry patch inputs (provider `patch_paths` vs macro action inputs, or both)
  - Keep the index format stable and additive.
- Extend `build-tools/tools/buck/prebuild-guard.ts` (or the existing prebuild presence guard) to print a short, consistent explanation when glue exists but invalidation expectations are likely to be misread:
  - For importer-local languages, print one line that states importer-local patch invalidation is driven by macro action inputs under `<importer>/patches/<lang>`.
  - For package-local languages, print one line that states invalidation is driven by `<pkg>/patches/<lang>` included in target inputs.
- Update patching UX messaging to reference the same terms:
  - `build-tools/tools/patch/patch-pkg.ts` should continue to print whether glue runs, but should also print the patch scope in the same vocabulary used elsewhere.

Cleanup/standardization in this PR:

- Ensure all user-facing wording uses the same terms:
  - `package-local` and `importer-local` (do not introduce alternate vocabulary).
  - `patch_scope:<...>` label name remains unchanged.

Non-goals in this PR:

- No changes to patch inclusion policy or to which files are attached as action inputs.
- No changes to provider generation semantics.

### Tests (in this PR)

- Add a focused unit test for the provider index JSON shape that:
  - asserts patch model fields are present and stable for Node and Python entries
  - asserts Go/C++ appear with `package-local` patch scope even though they do not require glue
- Add a focused test for the prebuild guard diagnostic output that:
  - runs the guard in a fixture repo with an importer lockfile and patches
  - asserts the “where invalidation comes from” one-liners are present and use canonical vocabulary

### Docs (in this PR)

- Update `abstractions.md`:
  - Add a short “Diagnostics” subsection explaining how to interpret provider files versus action-input invalidation, especially for Node.
  - Add a short “Debug checklist” item that points to the provider index report and the prebuild guard output.
- Update the patching handbook page(s) under `docs/handbook/` to include the same one-liner explanation used by the guard.

### Acceptance Criteria

- A developer can answer “where does patch invalidation come from for this language?” from one canonical diagnostic report without reading macro or provider generator code.
- The diagnostic terms match the existing contract vocabulary (`package-local` / `importer-local`).
- No behavior changes to patch invalidation or glue generation are required for this PR.

### Risks

Low. This is primarily additive diagnostics. The main risk is adding noisy output. Keep messages short and emitted only when relevant.

### Consequence of Not Implementing

Debugging remains slower and more error-prone. The same misunderstanding will recur whenever Node and Python providers are inspected without also understanding action inputs.

### Downsides for Implementing

Some churn in diagnostics and docs wording, plus small updates to tests that validate diagnostic outputs.

### Recommendation

Implement.

---

## PR‑2: Data-driven importer-scoped exporter adapter config (lockfile basename, kind gating, and nearest-lockfile discovery)

### Description

Importer-scoped exporter behavior is shared between Node and Python:

- validate importer lockfile labels
- warn on missing kind labels for targets that should have them
- auto-attach lockfile labels when a kind label is present and a nearest lockfile exists

The implementation is already shared, but configuration is still partially distributed. This PR moves the remaining “data” configuration into a single registry so adding another importer-scoped language is table-driven.

### Scope & Changes

- Introduce a single importer-scoped adapter registry in TypeScript that declares, per language:
  - lockfile basename (`pnpm-lock.yaml`, `uv.lock`)
  - “should warn missing kind label” behavior (for example, warn only for targets that look like first-class build/test targets)
  - nearest-lockfile finder function selection (or a standardized finder keyed by basename)
- Refactor Node and Python exporter adapters to read configuration from this registry and delegate to the shared importer-scoped adapter implementation.
- Ensure the registry values are treated as contract data and are stable under tests.

Cleanup/standardization in this PR:

- Remove any remaining per-language duplication of:
  - lockfile basename strings
  - nearest-lockfile lookup logic that is equivalent across adapters

Non-goals in this PR:

- No change to the lockfile label format or supported importer roots.
- No change to the gating rule that auto-attach is driven by kind labels.

### Tests (in this PR)

- Add a unit test that asserts the importer-scoped adapter registry:
  - contains `node` and `python`
  - uses the correct lockfile basenames
  - produces stable behavior for “warn missing kind” decisions on a representative fixture node set
- Ensure existing exporter adapter parity tests still pass without changing expectations other than any updated error text references if needed.

### Docs (in this PR)

- Update the exporter adapter cookbook under `docs/handbook/` to:
  - point to the registry as the canonical place to define importer-scoped adapter configuration
  - show how to add a new importer-scoped language by adding one registry entry and one adapter file

### Acceptance Criteria

- Node and Python exporter adapters no longer embed lockfile basename strings or bespoke nearest-lockfile discovery logic.
- Adding a new importer-scoped ecosystem requires updating a single registry entry plus a thin adapter file.
- Existing exporter behavior remains stable.

### Risks

Low to moderate. Exporter behavior is sensitive to small differences in “isTarget” and missing-kind warnings. Tests must cover representative targets and unlabeled helper nodes.

### Consequence of Not Implementing

Importer-scoped exporter logic remains correct but is harder to extend. New importer-scoped languages will likely duplicate strings and drift on warning behavior.

### Downsides for Implementing

Some refactor churn across exporter adapter files and tests.

### Recommendation

Implement.

---

## PR‑3: Package-local WASM macro helper (reduce duplication and lock correct ordering for stamping + patch inputs + planner-visible wiring)

### Description

Go and C++ both have package-local WASM macro shapes. These shapes need a specific ordering to avoid subtle drift:

- stamp wasm variant (and therefore language/kind labels)
- ensure patch scope stamping and include package-local patch files as real action inputs
- realize provider edges using an explicit, small vocabulary for whether edges land in deps or inputs for planner-visible shapes

Today, this ordering is implemented correctly but partly inlined. This PR introduces one shared helper surface so call sites cannot accidentally reorder steps and regress invalidation or routing.

### Scope & Changes

- Add a shared Starlark helper under `//lang:` for package-local WASM macro wiring that composes:
  - wasm stamping
  - patch_scope stamping
  - package-local patch input inclusion
  - provider edge realization into the intended location for the rule shape
- Refactor package-local WASM call sites to use the helper:
  - `build-tools/go/defs.bzl`: `nix_go_tiny_wasm_lib`
  - `build-tools/cpp/defs.bzl`: `nix_cpp_wasm_static_lib` and any planner-visible wasm shims where applicable

Cleanup/standardization in this PR:

- Remove any duplicated call-site comments that describe ordering requirements. The helper should embody the ordering.
- Ensure call sites do not manually re-read `kwargs["srcs"]` or `kwargs["labels"]` to compensate for helper side effects unless the helper explicitly returns those values.

Non-goals in this PR:

- No change to wasm artifact shapes or to which flake attributes are built.
- No change to the label vocabulary (`kind:wasm`, `wasm:<variant>`).

### Tests (in this PR)

- Add a Starlark probe test that covers a representative package-local WASM macro and asserts:
  - patch_scope label exists
  - wasm labels exist
  - package-local patch inputs are present as action inputs for the rule shape
- Add a focused enforcement test that fails if package-local WASM macros bypass the shared helper surface (similar style to existing enforcement tests for importer wiring).

### Docs (in this PR)

- Update `abstractions.md`:
  - add the new helper under “Patch invalidation models” or “WASM stamping” and state that package-local WASM macros must use it
- Update the macro stamping cookbook page under `docs/handbook/` to show the package-local WASM pattern as “use the shared helper, not manual wiring.”

### Acceptance Criteria

- Package-local WASM macros no longer re-implement ordering-sensitive wiring.
- Patch scope and wasm routing remain correct and consistent across Go and C++.
- Existing macro behavior stays stable.

### Risks

Low to moderate. This is primarily refactor and consolidation, but it touches wasm paths that are sensitive to rule shape details.

### Consequence of Not Implementing

WASM macro shapes remain a drift surface. New WASM variants will likely copy and slightly diverge from existing patterns.

### Downsides for Implementing

Some refactor churn in Go/C++ macros and new probe/enforcement coverage.

### Recommendation

Implement.

---

## PR‑4: Merge importer-scoped provider index enumeration and unify lockfile discovery conventions (Node + Python)

### Description

Node and Python provider sync share a driver, but there is still small duplication in:

- “read provider index entries” wrappers (Node and Python each implement a thin adapter)
- lockfile discovery conventions (Node uses a generic finder with a basename list, Python uses a dedicated finder)

This PR removes that duplication without forcing ecosystem parsing logic to merge.

### Scope & Changes

- Add a shared helper in TypeScript for “read importer provider index entries for a language” that:
  - accepts lockfile discovery as a parameter
  - standardizes importer enumeration behavior for the supported importer label contract
  - preserves the existing single-importer-per-lockfile convention where applicable
- Refactor:
  - `build-tools/tools/buck/providers/node.ts:readNodeProviderIndexEntries`
  - `build-tools/tools/buck/providers/python.ts:readPythonProviderIndexEntries`
    to call the shared helper.
- Introduce a small, consistent lockfile discovery helper that can cover both:
  - `pnpm-lock.yaml` (Node)
  - `uv.lock` (Python)
    by basename-based discovery with existing filtering behavior.

Cleanup/standardization in this PR:

- Ensure all lockfile discovery used for providers and provider index is driven by a shared helper surface, not bespoke filesystem scans.

Non-goals in this PR:

- No change to provider naming, provider file formats, or patch inclusion policy.
- No change to supported importer roots.

### Tests (in this PR)

- Add a unit test for the new provider-index helper that:
  - runs against fixtures with both Node and Python lockfiles
  - asserts stable ordering and stable key format for provider index entries
- Ensure existing provider golden tests remain unchanged.

### Docs (in this PR)

- Update the “Adding a language” handbook page under `docs/handbook/` to mention:
  - importer-scoped languages should use the shared provider-index helper and shared lockfile discovery helper

### Acceptance Criteria

- Node and Python no longer duplicate provider-index enumeration logic.
- Lockfile discovery conventions are consistent across Node and Python in provider tooling.
- Existing provider outputs remain unchanged.

### Risks

Low. This is mostly moving small logic into one place with stable tests.

### Consequence of Not Implementing

Small duplication remains a drift surface and makes it slightly harder to add another importer-scoped language cleanly.

### Downsides for Implementing

Minor refactor churn, plus one new helper and its tests.

### Recommendation

Implement.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and to keep each PR revertible:

1. PR‑1 first. It is additive diagnostics and reduces confusion during later refactors.
2. PR‑2 next. It makes importer-scoped exporter adapter behavior table-driven, which simplifies future extensions.
3. PR‑3 next. It reduces ordering-sensitive macro duplication for package-local WASM shapes.
4. PR‑4 last. It is small TS dedupe that is easiest to do once the exporter and diagnostics registries are stable.

---

## Verification & Backout Strategy

Each PR includes:

- At least one focused test that locks down the relevant contract behavior.
- A documentation update that points authors at the canonical helper surface and uses the same terms used by the tests.

Backout strategy:

- PR‑1 can be reverted independently if diagnostics are too noisy. Keep the tests but adjust emission conditions if needed.
- PR‑2 can be reverted independently if any adapter-level behavior changes unexpectedly. The parity tests should make drift obvious.
- PR‑3 can be reverted independently if wasm wiring changes cause graph-shape differences. Probe tests should catch regressions quickly.
- PR‑4 can be reverted independently if provider index entry ordering or lockfile discovery behavior drifts. Golden tests should catch this.
