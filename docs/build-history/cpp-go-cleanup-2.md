## Cross‑Language Cleanup and Consolidation — PR Sequence (Go ↔ C++) — Round 2 (Option A)

This plan implements the next set of focused improvements to keep Go and C++ feature‑parity tight, remove duplication, and harden cross‑language abstractions. Each PR is intentionally small, independently mergeable, and comes with tests and docs updates. We adopt Option A for C++ nixpkgs label mapping: generate a mapping during provider sync and consume it in the C++ macros, avoiding string heuristics.

---

### PR 1 — Unify Node provider sync on shared helpers

Scope

- Refactor Node provider sync (invoked through `node build-tools/tools/buck/sync-providers.ts --lang node --no-glue`) to reuse `build-tools/tools/lib/providers.ts` helpers (`shortHash`, `providerNameForImporter`).
- No behavior changes; only remove local implementations and import shared helpers.

Detailed Design

- Replace local `shortHash` and `nameForImporterProvider` functions with imports from `build-tools/tools/lib/providers.ts`.
- Keep traversal logic for PNPM importer effective sets unchanged.
- Ensure generated `TARGETS.node.auto` is byte‑for‑byte stable.

Acceptance Criteria

- Running Node provider sync before and after the refactor yields identical `TARGETS.node.auto`.
- No changes to consumer Buck graphs or invalidation behavior.

Risks

- Low: helper names and semantics are already used by `gen-auto-map.ts`.

Consequence if not implemented

- Drift between naming in auto‑map vs Node sync may reappear, risking collisions or inconsistent invalidation.

---

### PR 2 — Canonical nixpkgs attr normalization and provider naming everywhere

Scope

- Enforce single‑source normalization and naming for nixpkgs attributes across all generators.
- Use `normalizeNixAttr` and `providerNameForNixAttr` from `build-tools/tools/lib/providers.ts` in any script that maps `nixpkg:` labels to provider names.

Detailed Design

- Audit scripts in `build-tools/tools/buck/*` for any custom `nixpkg:` handling.
- Ensure `build-tools/tools/buck/gen-auto-map.ts` (already compliant) remains the example reference.
- Add a small unit test exercising alias `pkgs.gtest → pkgs.googletest`, deep paths (e.g., `pkgs.gnome.glib`), and punctuation normalization.

Acceptance Criteria

- Tests pass, and generated provider names remain stable (or change only where alias normalization fixes inconsistencies).

Risks

- Very low; minor renames only if historical ad‑hoc normalization existed.

Consequence if not implemented

- Inconsistent provider names across scripts, increasing risk of name collisions and mismatched invalidation.

---

### PR 3 — Generate `nix_attr_map.bzl` during provider sync (Option A)

Scope

- Extend provider sync to emit `third_party/providers/nix_attr_map.bzl`: a mapping from provider targets to canonical nixpkgs attr labels.
- Update C++ macros to consume this mapping instead of guessing labels from provider names.

Detailed Design

- Extend the existing provider sync orchestrator to compute, for each generated nixpkgs provider (e.g., `//third_party/providers:nix_pkgs_zlib`), the corresponding normalized attr (e.g., `nixpkg:pkgs.zlib`).
- Write a deterministic Starlark file:
- `NIX_ATTR_MAP = { "//third_party/providers:nix_pkgs_zlib": "nixpkg:pkgs.zlib", ... }`
- Sorted keys, newline‑terminated, generated idempotently.
- In `cpp/defs.bzl`, replace heuristic derivation of `nixpkg:` labels with a mapping lookup:
  - For each provider dep under `//third_party/providers:*`, if present in `NIX_ATTR_MAP`, append the associated `nixpkg:` label to the planner labels.
- Keep existing provider nodes (`third_party/providers/defs_cpp.bzl`) unchanged; they already carry `nixpkg:` labels for visibility.

Acceptance Criteria

- With and without providers, `buck2 cquery` of planner nodes shows the same `nixpkg:` labels as before.
- Changing the mapping file generation does not alter builds or invalidation other than intended determinism.
- Unit test: a tiny Starlark test or zx check validates `NIX_ATTR_MAP` contains expected keys for a sample set (including googletest alias).

Risks

- Low: ensure the mapping file is generated before macro evaluation paths that rely on it; covered by prebuild guard and CI stage ordering.

Consequence if not implemented

- The C++ macro continues to rely on string heuristics, which is brittle and harder to audit for correctness.

---

### PR 4 — Sanitize parity guard (Nix ↔ Starlark)

Scope

- Add a small parity test ensuring `_sanitize_to_bin_name` in `cpp/defs.bzl` matches the canonical Nix `sanitizeName` used by the planner/templates.

Detailed Design

- Use the existing `cpp_sanitize_probe` rule to surface Starlark sanitizer results.
- Add a zx test that computes Nix `sanitizeName` for a matrix of labels and asserts equality with the outputs from `cpp_sanitize_probe`.
- If parity fails, adjust `_sanitize_to_bin_name` accordingly.

Acceptance Criteria

- Parity test passes on the matrix (labels with `//`, `:`, `/`, spaces, and mixed case).

Risks

- Very low; changes are limited to sanitizer parity.

Consequence if not implemented

- Silent drift risks mismatched artifact names between Buck macros and Nix artifacts.

---

### PR 5 — Centralize Nix dev override handling

Scope

- Introduce `build-tools/tools/nix/dev-overrides.nix` and refactor language templates to import a single implementation for reading override JSON, warning locally, and throwing in CI.

Detailed Design

- Implement a small pure module exposing `readOverrides { envName, ciForbidden ? true }` returning `{ map, warnEffect, ciGuard }`.
- Refactor Go language templates to replace inline `builtins.getEnv` logic with the helper.
- If C++ uses similar override inputs in Nix templates, switch them as well.

Acceptance Criteria

- Behavior unchanged: local warnings still appear; CI still fails when overrides are set.
- Existing dev‑override tests pass.

Risks

- Low; ensure imports don’t introduce evaluation cycles.

Consequence if not implemented

- Override semantics may drift across languages; audits become harder.

---

### PR 6 — Merge provider sync entrypoints

Scope

- Consolidate per‑language sync into the existing orchestrator (`build-tools/tools/buck/sync-providers.ts`) so a single command updates all provider files.

Detailed Design

- Ensure orchestrator calls language drivers (Go, C++, Node) and writes:
  - `third_party/providers/TARGETS.auto`
  - `third_party/providers/TARGETS.node.auto` (when present)
  - `third_party/providers/nix_attr_map.bzl`
- Support `--lang=<go|cpp|node>` for scoped runs; default runs all.
- Update CI to call only the orchestrator.

Acceptance Criteria

- A single invocation regenerates all expected files deterministically.
- CI stage uses the unified command; outputs match pre‑merge state.

Risks

- Low; ensure idempotency and stable sort across drivers.

Consequence if not implemented

- Multiple entrypoints remain, increasing the chance of stale or partially updated provider files.

---

### PR 7 — Split C++ macros into smaller files (maintain ≤250 lines per file)

Scope

- Move helpers from `cpp/defs.bzl` into `cpp/private/*.bzl` while preserving public API (`nix_cpp_library`, `nix_cpp_binary`, `nix_cpp_test`).

Detailed Design

- Extract `_sanitize_to_bin_name`, planner stub rule, and external runner rule implementations into private modules.
- Keep loads and public wrappers in `cpp/defs.bzl` small and focused.

Acceptance Criteria

- No behavior changes; builds and tests remain green.
- Each file stays ≤250 lines to match methodology constraints.

Risks

- Very low; pure refactor with stable imports.

Consequence if not implemented

- Macro file continues to grow, raising maintenance complexity and risk of subtle edits.

---

### PR 8 — External‑runner helper single‑source verification

Scope

- Ensure `build-tools/tools/dev/build-selected.ts` is the only entry used by external runner flows (currently used by C++ tests/build rules). Add a smoke test for logs and output path handling.

Detailed Design

- Verify the C++ rules call the zx helper. If missing in any path, replace inlined shell with the helper call.
- Add a micro test that runs the helper in a dry context and validates expected messages and a non‑empty out path (mock when necessary).

Acceptance Criteria

- Existing external‑runner tests pass; helper logs appear as expected.

Risks

- Low; keeping one source of logic reduces bash in macros.

Consequence if not implemented

- Divergent shell snippets are harder to debug and maintain.

---

### PR 9 — Documentation updates

Scope

- Update handbook and design docs to reflect: single provider sync entrypoint, canonical nixpkgs naming, `nix_attr_map.bzl` mapping, sanitize parity guard, and centralized dev overrides.

Detailed Design

- Refresh:
  - Provider sync cookbook (mention orchestrator and mapping file)
  - Macro stamping/sanitization notes (parity test)
  - Troubleshooting (dev overrides helper)
  - CI stages (single sync entrypoint)

Acceptance Criteria

- Docs are consistent, with runnable examples that match the updated commands and files.

Risks

- None; doc‑only changes.

Consequence if not implemented

- Onboarding friction and increased chance of running stale commands.

---

### PR 10 — CI guardrails and prebuild checks

Scope

- Update CI pipeline and `build-tools/tools/buck/prebuild-guard` to require `nix_attr_map.bzl` whenever provider files are present.

Detailed Design

- In CI, call the unified provider sync script once.
- Extend prebuild guard to fail if:
  - `third_party/providers/nix_attr_map.bzl` is missing while `TARGETS*.auto` exists, or
  - `build-tools/tools/buck/graph.json` is older than any `TARGETS`/`*.bzl` (optional stronger freshness check).

Acceptance Criteria

- Guard fails fast on missing mapping; green when all glue is fresh.

Risks

- Low; tune messages to be actionable.

Consequence if not implemented

- Stale or missing mapping can silently degrade planner labeling.

---

## Program‑Level Success Criteria

- Node provider sync and auto‑map use the same naming helpers.
- C++ planner receives canonical `nixpkg:` labels via a generated mapping, no heuristics.
- Starlark↔Nix name sanitization parity is tested and enforced.
- Dev overrides are handled centrally in Nix across languages.
- One command refreshes all provider glue; CI enforces freshness and presence of mapping.
