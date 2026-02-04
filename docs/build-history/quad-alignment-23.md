## Quad Alignment Plan — Cross-Language Abstraction Tightening (CPP / Go / PNPM / Python) — Part 23

This installment follows Part 22. Part 22 tightened several concrete contract gaps in exporter behavior and provider sync boundaries. This part focuses on the remaining abstraction seams I observed while reviewing the shared layers:

- “Macros that call Nix” wiring is correct, but it is easy to apply partially because call sites must remember to stamp and to attach global inputs in a dict-safe way.
- Importer-scoped macro wiring is standardized for genrule-style wrappers, but non-genrule wrappers still duplicate the sequence (lockfile enforcement, importer derivation, patch input attachment, provider edge realization).
- Planner-visible stub targets (and “provider edges realized into srcs” shims) are a recurring pattern across languages, and the same few mistakes can reappear unless the helper surface is consolidated.

As in prior parts, each PR includes the tests and documentation required for the change. There are no PRs dedicated solely to tests or docs.

---

## PR‑1: Consolidate “macro calls Nix” wiring into a single shared helper (global inputs as real action inputs)

### Description

Some macros shell out to Nix (for example Node bundling and Node webapp builds). Those macros must treat `global_nix_inputs()` as real action inputs and must not hardcode `//:flake.lock`. The repo already has the primitives (`attach_global_nix_inputs`, `stamp_global_nix_inputs`, and `lint-global-stamping.ts`), but call sites still have to assemble the correct sequence manually, and they must handle list-shaped vs dict-shaped inputs.

This PR introduces one shared Starlark helper that makes the wiring hard to apply partially. The helper becomes the canonical way to:

- attach `global_nix_inputs()` into a chosen input attribute, including dict-safe maps
- stamp the observable label form via the existing helper surface (where justified)

### Scope & Changes

This PR changes Starlark helper plumbing and migrates the small set of macros that directly call Nix.

- Add a shared helper under `//lang` (file name TBD, but intended to be small and narrowly scoped) that:
  - takes `kwargs`, `into`, and `dict_safe` (or infers dict-safe based on current shape)
  - calls `attach_global_nix_inputs(...)` to ensure global inputs are real action inputs
  - optionally calls `stamp_global_nix_inputs(...)` for observability, without hardcoding `//:flake.lock`
- Migrate Node macros that call Nix to use the helper consistently:
  - `build-tools/node/defs_nix.bzl:node_webapp`
  - `build-tools/node/defs_nix.bzl:nix_node_cli_bin(bundle=True)`
- Keep behavior stable:
  - labels remain as before (still include `//:flake.lock` through `global_nix_inputs()`)
  - action inputs remain as before (still include `//:flake.lock` via `attach_global_nix_inputs`)
  - no new global inputs are introduced

### Tests (in this PR)

Add or update Node macro tests to lock down both the label stamp and the real action input behavior via the new helper:

- Extend the existing `build-tools/tools/tests/node/*global-inputs*` tests so they explicitly cover:
  - `node_webapp` stamps `//:flake.lock` via `global_nix_inputs()` and includes it in `srcs`
  - bundled `nix_node_cli_bin` stamps `//:flake.lock` and includes it in `srcs` even when `srcs` is dict-shaped
- Add one focused negative test that fails if a macro hardcodes `//:flake.lock` (this is already enforced by `build-tools/tools/dev/lint-global-stamping.ts`; this PR should wire that lint into whatever local/CI stage is considered canonical for guardrails if it is not already).

### Docs (in this PR)

Update the cookbook documentation to make the new helper the canonical guidance:

- `docs/handbook/macro-stamping-cookbook.md`:
  - replace the “do these two steps” guidance with “use the helper”
  - include one short example for list-shaped inputs and one for dict-shaped inputs
- `build-tools/docs/build-system-design.md`:
  - point at the helper as the canonical macro-level surface for global Nix inputs

### Acceptance Criteria

- Macros that call Nix attach global Nix inputs as real action inputs through one shared helper.
- No macro call site hardcodes `//:flake.lock`.
- Existing global inputs tests still pass and demonstrate that dict-shaped inputs remain correct.

### Risks

Low. This is primarily consolidation, but it touches macro behavior that influences action keys. The tests should guarantee stability.

### Consequence of Not Implementing

The “global inputs” policy continues to be correct but fragile at call sites. It remains possible to stamp labels without attaching real inputs, or to attach inputs without stamping, and those mistakes are hard to spot during review.

### Downsides for Implementing

Small macro churn and one more helper surface to learn. The benefit is that call sites become harder to get wrong.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

Touches only Starlark helper code, Node macro code, and a small set of Node macro tests and docs.

---

## PR‑2: Consolidate importer-scoped non-genrule macro wiring (Node + Python) behind one shared helper

### Description

Importer-scoped ecosystems (Node PNPM and Python uv) share a sequence of steps that must remain aligned:

- enforce exactly one `lockfile:<path>#<importer>` label (stable error text)
- derive the importer string deterministically from the label
- attach importer-local patch inputs to a supported attribute (list and dict shapes)
- merge provider edges via `MODULE_PROVIDERS`

We already have a good shared helper for genrule-style wrappers (`prepare_importer_genrule_kwargs`). The remaining drift risk is in non-genrule wrappers that still hand-assemble the steps (notably Node test wiring and any wrapper that needs the importer string explicitly).

This PR adds one shared helper for non-genrule importer-scoped wiring and refactors Node and Python call sites to use it.

### Scope & Changes

- Add a shared helper under `lang/importer_wiring.bzl` (or an adjacent `//lang` file) that:
  - enforces the lockfile label contract (exactly one label, importer-dir rule, supported importer roots)
  - stamps `lang:*` and `kind:*`
  - returns the derived importer string (for rules that need it)
  - attaches importer-local patch inputs into a chosen attribute:
    - list-shaped attributes directly
    - dict-shaped attributes via dict-safe synthetic keys
  - merges provider edges into `deps` by default, or into a chosen attribute when a rule shape requires it
- Refactor Node and Python non-genrule call sites to use the helper:
  - `build-tools/node/defs_core.bzl:nix_node_test` (today it repeats the sequence to derive importer and attach patches)
  - Any Python macro call sites that manually sequence the same steps outside the genrule-style path (expected to be few; if none exist, keep Python unchanged and scope the PR to Node only)

This PR should not change behavior. It should reduce the number of places where the importer-scoped contract is assembled manually.

### Tests (in this PR)

Add or update tests that would catch drift introduced by partial wiring:

- Add a focused Node macro test asserting:
  - `nix_node_test` fails with the same deterministic error text when the lockfile label is missing or malformed
  - importer derivation behavior is stable (for example `lockfile:././apps/web/pnpm-lock.yaml#apps/web` still derives `apps/web`)
  - importer-local patches appear in the action inputs (via `srcs`) after macro expansion
- If Python call sites are refactored, add a similar focused Python macro test verifying:
  - `nix_python_{library,test}` include importer-local patches in `srcs` and fail with stable error text when labels are missing

### Docs (in this PR)

- `docs/handbook/macro-stamping-cookbook.md`:
  - add a short “Importer-scoped non-genrule wiring” section pointing at the new helper
- `docs/handbook/patching.md`:
  - clarify which macros use which wiring helper (genrule-style vs non-genrule)

### Acceptance Criteria

- Node importer-scoped non-genrule macros use one shared helper to enforce labels, derive importer, attach patches, and merge provider edges.
- Node macro behavior is unchanged for existing targets (inputs and labels).
- New focused macro tests lock down both success and failure modes.

### Risks

Low to moderate. The risk is accidentally changing a macro’s input attribute shape (list vs dict) or action inputs. The tests must assert the exact inclusion of patches and the stable error text.

### Consequence of Not Implementing

Importer-scoped wiring remains correct but duplicated, which increases drift risk and makes future contract tightening more expensive.

### Downsides for Implementing

Some macro churn and the need to keep the helper small and deterministic. The benefit is reduced cognitive load and fewer “remember to do X and Y” sequences.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

Touches Node macro code, one shared Starlark helper, and a small set of focused macro tests and docs.

---

## PR‑3: Consolidate planner-visible stub and “provider edges into srcs” patterns behind a single helper surface

### Description

Across languages, we have several cases where a macro must expose a planner-visible node without building a normal artifact shape:

- planner-visible stubs (for discovery and routing)
- shims where provider edges must be realized into `srcs` (because the downstream rule shape does not accept `deps` for what we need)
- stubs that must strip provider deps to avoid visibility or graph-shape issues

The repo already has pieces of this:

- `//lang:planner_stub.bzl:planner_stub` and `planner_stub_with_package_local_patches`
- `//lang:provider_edges.bzl:strip_provider_targets` and `realize_provider_edges`

This PR consolidates the “right default” patterns into one helper surface so new macros do not re-learn the same edge cases.

### Scope & Changes

- Extend or add a helper under `//lang` that standardizes planner-visible stub wiring, including:
  - optional package-local patch input attachment (via existing `planner_stub_with_package_local_patches`)
  - optional provider edge realization into a chosen input attribute when required
  - optional stripping of provider targets for stubs that must remain free of provider deps
- Refactor the existing call sites that currently hand-roll parts of this behavior, prioritizing:
  - Go planner-visible stubs that realize provider edges into `srcs`:
    - `build-tools/go/defs.bzl:nix_go_carchive`
    - `build-tools/go/defs.bzl:nix_go_tiny_wasm_lib`
  - C++ planner-visible stubs and the split “planner-visible vs executed” test macro:
    - `build-tools/cpp/defs.bzl:nix_cpp_wasm_emscripten_lib`
    - `build-tools/cpp/defs.bzl:nix_cpp_test` (planner stub path uses `strip_provider_targets`)

The goal is not to change behavior. The goal is to make the helper surface the canonical pattern.

### Tests (in this PR)

Add a focused set of tests that would catch regressions in the tricky parts:

- A Go macro-level test that asserts:
  - the planner-visible stub target’s `srcs` includes provider edges when required (and includes local patch inputs when configured)
- A C++ macro-level test that asserts:
  - planner-visible stub targets strip provider deps when expected
  - the executed runner still runs the corresponding flake attr (no behavior change)

These tests should be narrow and should assert the exact Buck graph shape (via `buck2 cquery`).

### Docs (in this PR)

- `docs/handbook/provider-sync-cookbook.md`:
  - reinforce “planner-visible stubs should avoid provider deps unless explicitly required”
  - point at the consolidated helper as the canonical place to implement stub behavior
- `build-tools/docs/build-system-design.md`:
  - update the “planner-visible stub contract” section to reference the new helper surface and the expected patterns

### Acceptance Criteria

- The consolidated helper exists and is used by the known planner-stub call sites.
- Behavior and exported graph shape are stable for existing targets.
- New focused tests lock down the provider-edge and patch-input behavior for stubs and shims.

### Risks

Moderate. This touches a few macros that are intentionally special-cased. The tests must lock down both the graph shape and the file-like inputs.

### Consequence of Not Implementing

We keep having to re-validate the same stub and shim behavior every time we add a new macro variant. Drift becomes more likely as we add more WASM and cross-language integration targets.

### Downsides for Implementing

Some refactor churn and a careful requirement to keep the helper small and deterministic. The payoff is a single canonical pattern for a recurring class of targets.

### Recommendation

Implement.

### Sparse / Partial Clone Guidance

Touches only Starlark helper code, Go/C++ macro code, and a small set of macro-level tests and docs.

---

## Rollout & Sequencing

These PRs are ordered by dependency chain and blast radius:

1. PR‑1 first. It introduces a reusable helper and changes a small number of Nix-calling macros.
2. PR‑2 next. It consolidates importer-scoped non-genrule wiring and reduces drift risk in Node and Python.
3. PR‑3 last. It touches the most special-cased macro surfaces (planner-visible stubs and “provider edges into srcs” shims).

---

## Verification & Backout Strategy

Each PR includes:

- at least one focused test that exercises the behavior being changed
- a doc update that explains the observed behavior and points at the canonical helper surface

Backout strategy:

- Each PR is independently revertible.
- If a regression is discovered:
  - revert the PR and its tests and docs together
  - keep any new tests only if they still reproduce the issue on the prior baseline and remain meaningful
