## Quad Alignment Plan — Cross-Language Parity Tightening (CPP / Go / PNPM / Python) — Part 6

This installment finalizes small cross-language refinements identified during the parity review. It removes the last helper duplication in Starlark, aligns Node macros that invoke Nix with the unified global inputs policy, and retires an unused Go provider rule to reduce conceptual load. Each PR ships tests and minimal doc updates in the same change. No behavior changes are intended for unchanged inputs; all changes are refactors or guardrails that preserve existing artifacts and mappings.

---

## PR‑1: Unified importer extraction helper in Starlark; remove deprecated Node wrapper

### Description

Introduce a single Starlark helper to (a) enforce exactly one importer‑scoped lockfile label and (b) return the importer string, then have Node and Python macros use it to include importer‑local patches via the already‑shared `append_importer_patches(...)`. Remove the deprecated `append_node_patches_for_importer(...)` wrapper.

### Scope & Changes

- `build-tools/lang/defs_common.bzl`:
  - Add `importer_from_labels(kwargs)` that:
    - Delegates to `ensure_single_lockfile_label(...)` to validate presence (and dedupe) of the single lockfile label.
    - Extracts and returns the importer (text after `#`), with consistent error text.
  - Add `include_importer_patches_from_labels(kwargs, lang)` that calls the above and `append_importer_patches(...)` for `lang`.
  - Remove `append_node_patches_for_importer(...)` (deprecated shim), after updating in‑tree references.
- Helper contracts (exact signatures/semantics):
  - `def importer_from_labels(kwargs):`
    - Preconditions: `kwargs["labels"]` may be missing or mixed‐type; the helper must tolerate that.
    - Behavior: calls `ensure_single_lockfile_label(kwargs, None)`; then parses the only `lockfile:<path>#<importer>` label; returns `<importer>` as a string (e.g., `"."`, `"apps/web"`).
    - Error text: rely on and preserve the message produced by `ensure_single_lockfile_label` to keep tests stable: `Exactly one importer-scoped lockfile label is required (lockfile:<path>#<importer>); got: [...]`.
  - `def include_importer_patches_from_labels(kwargs, lang):`
    - Behavior: `imp = importer_from_labels(kwargs)`; then `append_importer_patches(kwargs, imp, lang)`; no-op if `imp` is empty (should not occur if preconditions pass).
    - Ordering: preserves callers’ existing `srcs` order and uses `dedupe_preserve`.
- `build-tools/node/defs.bzl`:
  - Replace local importer extraction logic with `include_importer_patches_from_labels(kwargs, "node")` in `nix_node_gen(...)` and `nix_node_test(...)`.
  - No other call sites required: `nix_node_lib/bin` delegate to `nix_node_gen`.
- `build-tools/python/defs.bzl`:
  - Replace local importer extraction logic with `include_importer_patches_from_labels(kwargs, "python")` in all `nix_python_*` macros (including wasm stamps).
- Edge cases handled:
  - Root importer `"."` vs nested importers (`apps/*`, `libs/*`) produce the correct patch directory (`patches/<lang>` vs `<importer>/patches/<lang>`).
  - Multiple `lockfile:` labels → error (delegated to `ensure_single_lockfile_label`).
  - Non-string/empty labels are ignored when scanning.
- Tests (in this PR):
  - Starlark↔TS importer parity: build a small table of lockfile labels in zx, call a Starlark probe via a tiny test rule and compare to the TS `computeImporterLabel(...)` output for the same cases (repo root `.` and nested `apps/*`, `libs/*`).
  - Macro srcs realization: for minimal Node and Python importer fixtures with a single patch, `buck2 cquery --json --output-attributes=srcs` includes the importer‑local patch path for representative macros (bin/lib/test).
  - Grep guard: no references remain to `append_node_patches_for_importer(` in the repo.
- Docs (in this PR):
  - Update the Patching Handbook and Adding‑Language guide to reference the new `include_importer_patches_from_labels(...)` helper and remove the Node‑specific deprecated wrapper.

### Acceptance Criteria

- Node and Python macros include importer‑local patches via one shared helper; error text for missing/duplicate lockfile labels is consistent.
- No references to `append_node_patches_for_importer(...)` remain in the repo.
- Parity tests pass across representative importer‑scoped labels.

### Risks

- Low: helper consolidates existing logic; behavior is unchanged for valid call sites.

### Consequence of Not Implementing

- Small duplication persists and increases the chance of future drift in importer handling.

### Downsides for Implementing

- Minor refactor; straightforward review and verification.

### Recommendation

Implement.

---

## PR‑2: Stamp global Nix inputs in Node macros that invoke Nix

### Description

Align Node macros that shell out to `nix build` with the unified global inputs policy by stamping `global_nix_inputs()` (e.g., `//:flake.lock`) at the macro level. This mirrors the C++ behavior and ensures expected invalidation when Nix global inputs change.

### Scope & Changes

- `build-tools/node/defs.bzl`:
  - For `node_webapp(...)`: import `//build-tools/lang:global_inputs.bzl:global_nix_inputs` and append returned labels to `kwargs["labels"]` before invoking the genrule that runs `nix build`.
  - For `nix_node_cli_bin(bundle=True)`: same as above when bundling is enabled (the non‑bundled cp‑only mode remains unchanged).
- Macro update detail:
  - Use the existing pattern and ordering stability: `kwargs["labels"] = dedupe_preserve((kwargs.get("labels", []) or []) + global_nix_inputs())`.
  - Do not stamp `global_nix_inputs()` in `nix_node_gen` (non‑Nix) or in `nix_node_cli_bin(bundle=False)`.
- Tests (in this PR):
  - Fixture toggling `flake.lock` (e.g., modify timestamp content) causes `buck2` to report a rule key change for `node_webapp(...)` and bundled `nix_node_cli_bin(...)`, while unrelated Node targets that do not call Nix remain cache hits.
  - Control: revert the `flake.lock` change and confirm cache hits return.
- Docs (in this PR):
  - Add a short “Global Input Policy” note in the build‑system design docs clarifying that macro‑level stamping is used only where a macro directly calls Nix, otherwise prefer builder/Nix‑level consideration.

### Acceptance Criteria

- Changing `flake.lock` invalidates only Node macros that call Nix (`node_webapp`, bundled `nix_node_cli_bin`), matching the existing C++ pattern.
- No change in behavior for macros that do not call Nix or for unchanged inputs.

### Risks

- Slightly broader invalidation surface for the two affected Node macros when global inputs change (intended and documented).

### Consequence of Not Implementing

- Nix‑invoking Node macros may miss expected rebuilds when global inputs change, diverging from C++ policy.

### Downsides for Implementing

- Minimal; adds one shared label list to two macros.

### Recommendation

Implement.

---

## PR‑3: Retire unused Go provider rule; clarify Go patch flow remains srcs‑driven

### Description

Remove the unused `go_module_patch(...)` provider rule to reduce cognitive overhead. Go patching remains package‑local and is invalidated via `patches/go/*.patch` included in target `srcs` per current policy.

### Scope & Changes

- `third_party/providers/defs.bzl`:
  - Remove `go_module_patch(...)` and any dead exports, keeping Node/Python defs unchanged.
- Repo sweep:
  - Grep ensure: no references to `go_module_patch(` across the repo (including tests/docs). If any historical mention exists in docs, replace with a sentence clarifying Go is srcs‑driven only.
- Tests (in this PR):
  - Confirm provider index and auto‑map remain unchanged for real targets (Go does not use providers). Run representative Go builds before/after to ensure byte‑stable outputs for unchanged inputs.
  - Provider writers (Node/Python) continue to generate deterministic files; smoke run of `node build-tools/tools/buck/sync-providers.ts` stays green.
- Docs (in this PR):
  - Clarify in the patching section that Go does not use provider rules; patching is driven solely by package‑local patch files included in `srcs`.

### Acceptance Criteria

- No repository references to the removed rule.
- No change in build artifacts or provider mappings for unchanged inputs.

### Risks

- If an out‑of‑tree consumer used the rule, they would break (not applicable in‑repo; audit confirms unused).

### Consequence of Not Implementing

- Dead code remains and invites confusion about the Go provider model.

### Downsides for Implementing

- None material.

### Recommendation

Implement.

---

## Rollout & Sequencing

1. PR‑1 (Importer helper consolidation): small, self‑contained; reduces duplication immediately.
2. PR‑2 (Node global inputs stamping): aligns invalidation policy; independent of PR‑1.
3. PR‑3 (Remove unused Go provider rule): safe cleanup after helper consolidation lands.

---

## Verification & Backout Strategy

- PR‑1
  - Verification: parity zx test passes; Node/Python macro cquery shows importer‑local patch paths in `srcs`; identical artifacts for unchanged inputs.
  - Backout: revert helper and macro call‑site changes; restore deprecated Node shim if necessary.
- PR‑2
  - Verification: modifying `flake.lock` invalidates only Nix‑invoking Node macros; unchanged inputs remain cache hits elsewhere.
  - Backout: remove the additional labels; behavior returns to current state.
- PR‑3
  - Verification: provider index and auto‑map are unchanged; Go builds are byte‑identical for unchanged inputs.
  - Backout: re‑add the removed rule (no functional coupling).

---

## Summary of Expected Impact

- One shared Starlark path for importer handling eliminates duplication across Node/Python.
- Node macros that call Nix now consistently honor global inputs, matching C++ policy.
- Go provider dead code is removed, clarifying that Go remains srcs‑driven for patching.
