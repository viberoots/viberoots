## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 21

This installment follows Part 20. It focuses on the remaining contract gaps that show up in real code paths now that C++, Go, PNPM (Node), and Python are at feature parity.

The intent is to keep the shared seams stable:

- Supported importer policy is enforced consistently across layers (TypeScript tooling, Starlark macros, generated glue).
- Importer scoped provider wiring does not reference providers we will never generate.
- Importer patch inclusion policy remains explicit and hard to accidentally change.
- Public option surfaces only expose behavior that is real.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Close the supported-importer contract hole (auto_map and tooling must not emit edges to unsupported importers)

### Description

Provider generation already filters to supported importer labels (`apps/*`, `libs/*`, and `.`). Today, the TS label-to-provider mapping used by `gen-auto-map.ts` can still emit provider edges for any syntactically valid `lockfile:<path>#<importer>` label, even if the importer is unsupported.

This is a cross-layer contract hole. It creates a failure mode where `third_party/providers/auto_map.bzl` references providers that `sync-providers` will never generate.

This PR makes the supported importer policy a contract in the TS mapping layer, so `auto_map` cannot point at providers that do not exist.

### Scope & Changes

This PR changes only TS tooling behavior. It does not change provider generation policies.

- Update `build-tools/tools/lib/labels.ts:providersForLabels(...)` to:
  - parse `lockfile:` labels with the canonical parser
  - require `isSupportedImporterLabel(importer)` before emitting the corresponding `//third_party/providers:lf_*` provider label
- Add a small unit test covering the contract:
  - a valid lockfile label for an unsupported importer does not produce a provider label
  - supported importers continue to produce provider labels deterministically
- Update `build-tools/tools/buck/gen-auto-map.ts` (if needed) to rely on `providersForLabels(...)` without adding any extra filtering logic.

### Tests (in this PR)

Add a focused test under `build-tools/tools/tests/lib/` that:

- feeds `providersForLabels(...)` a set of `lockfile:` labels with importers:
  - `"apps/demo"`
  - `"libs/demo"`
  - `"."`
  - an unsupported value like `"services/api"` or `"third_party/foo"`
- asserts that only the supported importer labels yield provider labels.

### Docs (in this PR)

Update the glue and mapping documentation to clarify the policy:

- The label `lockfile:<path>#<importer>` can be present anywhere, but only supported importer labels participate in provider wiring and auto-map.
- If a repo wants to support additional importer roots, it should extend the supported importer predicate in `build-tools/tools/lib/importers.ts` and keep parity checks passing.

### Acceptance Criteria

- `third_party/providers/auto_map.bzl` never contains a provider edge for an unsupported importer label.
- No behavior changes for existing importers under `apps/*`, `libs/*`, or `.`.

### Risks

Low. This narrows mapping output for unsupported importers and should only remove invalid edges.

### Consequence of Not Implementing

`auto_map` can keep producing provider edges to providers that are not generated, which can surface as missing-target failures or confusing “no-op wiring” behavior depending on how macros consume the map.

### Downsides for Implementing

Slightly stricter mapping behavior can surface latent misuse of lockfile labels outside supported importer roots.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

Touches only `build-tools/tools/lib/labels.ts`, `build-tools/tools/buck/gen-auto-map.ts` (if needed), and a narrow unit test.

---

## PR‑2: Make importer patch inclusion policy an explicit enum (replace boolean flag) and lock it down with tests

### Description

Importer-scoped provider generation intentionally differs between Node and Python:

- Node includes all importer-local patch files in provider `patch_paths`.
- Python includes only importer-local patch files that are present in the `uv.lock` effective set.

This policy is correct and already tested, but the current API expresses it as a boolean (`includeAllImporterLocalPatches`). That makes accidental inversions easier and makes call sites less self-documenting.

This PR replaces the boolean with an explicit enum and keeps the policy behavior and regression test coverage intact.

### Scope & Changes

- Update `build-tools/tools/lib/provider-sync-driver.ts`:
  - replace `includeAllImporterLocalPatches?: boolean` with something explicit, for example:
    - `importerPatchInclusionPolicy?: "all" | "effective-set-only"`
  - update selection logic accordingly
- Update Node and Python adapters:
  - `build-tools/tools/buck/providers/node.ts` uses `"all"`
  - `build-tools/tools/buck/providers/python.ts` uses `"effective-set-only"`
- Update any shared wrappers or call sites that pass the old boolean.
- Keep behavior identical:
  - Node continues to include all importer-local patches
  - Python continues to filter to the effective set

### Tests (in this PR)

Update the existing regression test (or add a new one if needed) so it asserts:

- Node provider `patch_paths` includes both an effective and non-effective importer-local patch.
- Python provider `patch_paths` includes only effective importer-local patches.

The test should exercise the new enum surface so it fails if a future refactor accidentally swaps Node and Python policies.

### Docs (in this PR)

Update the provider generation documentation to describe the policy using the new enum terminology. Keep it stated as observed behavior with the “why” being invalidation trade-offs, not abstract preference.

### Acceptance Criteria

- Node and Python provider outputs are unchanged for the same inputs.
- The policy is expressed via an enum and enforced by a regression test.

### Risks

Low. This is a mechanical API refactor, but it touches core glue generation code, so tests must be the primary guardrail.

### Consequence of Not Implementing

The policy remains correct but easier to accidentally flip, and call sites remain less explicit about which behavior they depend on.

### Downsides for Implementing

Small churn across call sites and types.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

Touches `build-tools/tools/lib/provider-sync-driver.ts`, Node/Python provider adapters, and one existing regression test.

---

## PR‑3: Remove misleading provider-sync option surfaces (Python patchDir) and tighten the driver registry defaults

### Description

The Python provider sync function accepts a `patchDir` option via `providers/index.ts`, but the implementation does not use it. This is misleading because it implies there is a configurable global patch directory for Python provider sync.

This PR removes the dead option surface. It keeps the actual patch discovery behavior unchanged: Python importer-local patches remain under `<importer>/patches/python/*.patch`.

### Scope & Changes

- Update `build-tools/tools/buck/providers/python.ts`:
  - remove the `patchDir` option from the function signature
  - remove any related plumbing
- Update `build-tools/tools/buck/providers/index.ts`:
  - stop passing `patchDir` to Python provider sync
  - keep default out file wiring unchanged
- Confirm there are no other call sites depending on the parameter.

If the intent is to support a Python global patch directory in the future, it should be added with a concrete contract and tests. This PR does not add new behavior.

### Tests (in this PR)

Add or update a small unit test that:

- asserts `syncAllProviders({ lang: "python" })` still produces the expected stable header-only output when there are no lockfiles
- asserts importer-local patches are still discovered from `<importer>/patches/python` (this can be exercised indirectly through an existing provider sync test, or a small new one)

### Docs (in this PR)

Update the provider sync authoring notes to clarify:

- Python provider sync does not support a global patch directory input
- Python patch discovery is importer-local and lockfile-effective-set filtered

### Acceptance Criteria

- No behavior change in generated `third_party/providers/TARGETS.python.auto`.
- The Python provider sync API surface no longer advertises an unused option.

### Risks

Low. Risk is primarily around a hidden call site, which the PR should eliminate by static search and tests.

### Consequence of Not Implementing

The codebase retains a misleading configuration surface that can lead to assumptions and drift in future work.

### Downsides for Implementing

Minor churn in provider registry wiring.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

Touches only the Python provider adapter and the registry, plus a narrow test.

---

## PR‑4: Enforce supported-importer policy in Starlark lockfile label validation (fail early at macro time)

### Description

TypeScript tooling will be stricter after PR‑1, but the earliest and clearest place to enforce policy is at the macro boundary. Today, Starlark validates that a `lockfile:` label is well-formed and that `importer` matches `dirname(lockfilePath)`. It does not enforce that the importer itself is within the supported importer roots.

This PR tightens the Starlark contract so unsupported importers fail at macro definition time with deterministic error text. This reduces “glue silently missing” failure modes and keeps the label contract aligned across layers.

### Scope & Changes

- Update `lang/lockfile_labels.bzl`:
  - after parsing `(path_part, importer)`, validate importer is supported:
    - `"."` is allowed
    - `apps/*` and `libs/*` are allowed
    - everything else fails with deterministic text
- Keep existing parsing rules unchanged:
  - `./` normalization
  - exactly one `#`
  - `#.` only for repo-root lockfiles
  - importer-dir consistency
- Ensure the error text is stable and actionable.

### Tests (in this PR)

Extend the existing TS ↔ Starlark lockfile label parity test matrix to include at least one unsupported importer case where:

- TS considers the label syntactically valid (it will still parse)
- Starlark now rejects it because the importer is unsupported

This test should assert that Buck build fails with an error that includes the deterministic unsupported-importer text.

### Docs (in this PR)

Update the importer-scoped macro documentation to state:

- importer-scoped lockfile labels are contracts
- supported importer roots are restricted to `apps/*`, `libs/*`, and `.`
- how to extend the set (where to change it, and which tests will enforce it)

### Acceptance Criteria

- Unsupported importer labels fail during macro evaluation with deterministic error text.
- Supported importer labels continue to behave identically.

### Risks

Moderate. This can surface latent usage where someone hand-applied a lockfile label outside supported roots.

### Consequence of Not Implementing

Unsupported importer labels can still exist in targets and remain “partially valid” across layers, increasing the chance of confusing glue behavior.

### Downsides for Implementing

Slightly stricter macro-level validation may require cleanup in repos that relied on broader importer roots.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

Touches `lang/lockfile_labels.bzl` and one parity test.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and blast radius:

1. PR‑1 first. It prevents `auto_map` from referencing unsupported importer providers.
2. PR‑2 next. It refactors the provider sync driver API without changing behavior.
3. PR‑3 next. It removes dead option surfaces and keeps the registry honest.
4. PR‑4 last. It tightens macro-level validation and can surface latent invalid usage.

---

## Verification & Backout Strategy

Each PR includes:

- A focused regression test that fails if the tightened contract or standardized behavior regresses.
- A doc update that describes the user-visible behavior in concrete “what happens” terms.

Backout strategy:

- Each PR is independently revertible.
- If a regression is discovered:
  - revert the PR and its tests/docs together
  - keep any new tests only if they still reproduce the issue on the prior baseline and remain meaningful
