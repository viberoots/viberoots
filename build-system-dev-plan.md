# Build System Development Plan

> Scope: Implement the Buck2 + Nix dynamic-derivations build with Go patching, wiring provider generation and auto-map, plus outer CLI `patch-pkg`. Plan follows dependency chains, defines clear outputs and acceptance checks per phase.
>
> Read alongside `build-system-design.md`. Phase bullets below include brief cross-references to design sections to keep implementation aligned and future language support unblocked.

## Guiding principles

- Architectural minimalism, deterministic behavior, and single-responsibility modules.
- Prefer synchronous, predictable operations; small files (≤250 LOC) and modular scripts.
- Buck2 remains the orchestrator; Nix handles hermetic builds via dynamic derivations; glue scripts are zx TypeScript.
- All tests should make use of a temporary copy of the repository when running tests, scaffolded as necessary to set up test preconditions.
- Follow design invariants: see `build-system-design.md` → "Path Invariants (must-follow)", "Nix Features", and "Patching UX". Keep glue scripts outside Nix and commit no generated glue.
- Maintain language-agnostic posture: single outer CLI `patch-pkg` that dispatches to `tools/patch/<lang>/...`; shared provider naming utilities in `tools/lib/providers.ts`; optional `tools/nix/mapping.nix` for dispatch; templates in `tools/nix/` per language.

## Completion criteria (overall)

- End-to-end: `buck2 build //<sample>` and impacted tests run; changing a patch invalidates only dependent targets.
- CI stages exist and enforce freshness of generated glue; dev overrides fail in CI.
- `patch-pkg` supports start/reset/apply/session for Go, is idempotent.

---

## Phase 1 — Repo Scaffolding & Invariants

- Tasks:
  - Ensure directories exist: `patches/go/` (flat), `tools/buck/`, `third_party/providers/`, `tools/nix/`.
  - Add zx lint script to warn on subdirectories under `patches/*/`.
- Outputs:
  - `patches/go/` created (no subdirs), `tools/buck/` and `tools/nix/` present.
  - Lint script committed and runnable.
- Acceptance:
  - Lint emits no warnings on clean repo; prevents bad layouts locally.
- Refs: design → "Path Invariants (must-follow)", "Nix Features", "Scaffolding Requirements".
- Extensibility: create top-level `patches/<lang>/` convention now; keep the lint generic across languages so Node/Rust can plug in later without changing rules.

## Phase 2 — Buck Macros Shell (Go)

- Depends on: Phase 1
- Tasks:
  - Add `//go/defs.bzl` macros: `nix_go_binary`, `nix_go_library`, `nix_go_test` that append providers from generated `auto_map.bzl`.
  - Add `//third_party/providers/defs.bzl` with `go_module_patch(...)` (content-addressed stamp).
  - Add test that adds one small target to macros (no behavior change expected yet).
- Outputs:
  - `go/defs.bzl`, `third_party/providers/defs.bzl`.
  - Test that successfully creates one target using macros.
- Acceptance:
  - Builds identical to pre-macro (hash/size/time parity), no providers required yet.
- Refs: design → "//third_party/providers/defs.bzl", "//go/defs.bzl macros (copy‑pasteable)", "Declaring Buck Inputs".
- Extensibility: macros must load providers via generated map only; do not embed Go-specific provider names—rely on `auto_map.bzl` so future Node/Rust providers can be added without macro changes.

## Phase 3 — Authoritative Buck Graph Exporter (Go)

- Depends on: Phase 2
- Tasks:
  - Implement `tools/buck/export-graph.ts` to emit `tools/buck/graph.json` using batched `go list -deps -json -test=all` by config tuple.
  - Ensure it runs after codegen.
  - Attach `module:<import>@<version>` labels only to targets that use them.
- Outputs:
  - `tools/buck/export-graph.ts`, generated `tools/buck/graph.json`.
- Acceptance:
  - Spot-check labels: test-only deps labeled on test targets; different configs yield different labels.
- Refs: design → "Exporting the Buck Graph (ZX)", "Authoritative exporter (Go)", "Planner Dispatch (including optional mapping.nix)".
- Extensibility: keep JSON schema stable and inclusive (e.g., allow `lockfile:<path>#<importer>` labels later). Do not consume labels in a Go-specific way downstream.

## Phase 4 — Provider Sync (Go)

- Depends on: Phase 3
- Tasks:
  - Implement `tools/buck/sync-providers.ts` to scan `patches/go/*.patch` and write `third_party/providers/TARGETS.auto` (deterministic, idempotent).
  - Enforce one patch per `module@version`; stable ordering.
- Outputs:
  - `third_party/providers/TARGETS.auto` (generated).
- Acceptance:
  - With a dummy patch present, provider appears; re-run is no-op; duplicates are rejected.
- Refs: design → "Sync Providers Generator tools/buck/sync-providers.ts", "Path Invariants".
- Extensibility: generate to `TARGETS.auto` files per language if/when added (e.g., `TARGETS.node.auto`). Keep generator input discovery language-scoped under `patches/<lang>/`.

## Phase 5 — Auto Map Generation (Go + Node-ready surface)

- Depends on: Phase 4
- Tasks:
  - Implement `tools/buck/gen-auto-map.ts` to map targets to providers from `graph.json` labels.
  - Emit `third_party/providers/auto_map.bzl` and load it from macros.
- Outputs:
  - `third_party/providers/auto_map.bzl` (generated).
- Acceptance:
  - A target importing a patched module gains the matching provider in its deps; unrelated targets do not.
- Refs: design → "//third_party/providers/auto_map.bzl (generated file)", "Generator: tools/buck/gen-auto-map.ts", "Later / Optional — Node (PNPM Importer-Scoped)".
- Extensibility: ensure the generator supports both `module:` and `lockfile:` labels so Node (PNPM importer-scoped) can be enabled without refactoring.

## Phase 6 — Wire `patch-pkg apply` (Go)

- Depends on: Phases 4–5
- Tasks:
  - Implement outer CLI `patch-pkg` (zx) and `tools/patch/patch-go.ts` subcommands: start/reset/apply/session.
  - On `apply`: write canonical patch file, run provider sync and auto-map generation.
  - macOS uses APFS CoW; Linux uses overlay or fallback copy; print warnings for overrides.
- Outputs:
  - `tools/patch/patch-go.ts`, `tools/bin/patch-pkg` (zx-wrapper).
- Acceptance:
  - `patch-pkg start/apply/reset` round-trips and subsequent `buck2 build` succeeds without extra steps.
- Refs: design → "Go Patching (outer CLI)", "Go Patching Workflow", "Idempotency Rules", "Warnings & CI Fail-Safes".
- Extensibility: keep outer CLI language-dispatch pluggable (`patch-pkg <subcmd> <language>`); require `tools/patch/<lang>/*.ts` to implement the shared interface so other languages can register cleanly.

## Phase 7 — CI Stages

- Depends on: Phases 3–6
- Tasks:
  - Add CI pipeline stages: Export Graph → Sync Providers → (optional Node sync) → Generate auto_map → Pre-build guard → Build & Test → Stale check.
  - Ensure dev overrides fail CI.
- Outputs:
  - CI config with named stages and cache keys.
- Acceptance:
  - CI regenerates glue, builds, runs tests; fails if generated files are stale or overrides are present.
- Refs: design → "CI with Jenkins (Matrix across 3 Architectures)", "Glue generation (not committed)", "Pre-build guard".
- Extensibility: stage boundaries and cache keys must remain language-neutral so adding Node/Rust doesn’t change the pipeline shape—only inputs.

## Phase 8 — Accuracy & Scale Hardening

- Depends on: Phase 7
- Tasks:
  - Optimize exporter batching and caching; handle replace/pseudo-versions; validate multi-config correctness.
- Outputs:
  - Exporter improvements; documented behavior for edge cases.
- Acceptance:
  - Tag/platform toggles adjust labels correctly; rebuild scope is minimal; replace/pseudo-versions verified.
- Refs: design → "Accuracy & Scale Hardening".
- Extensibility: keep planner small and dispatch to language templates (`tools/nix/lang-templates.nix`) via `mapping.nix` so adding languages only adds a branch.

## Phase 9 — Regression Tests & Monitors

- Depends on: Phase 5+
- Tasks:
  - Add e2e provider-wiring test (`tools/tests/e2e-provider-wiring.ts`).
  - Add lint for duplicate patches and subdir checks; pre-commit hook to run provider sync and fail on diffs.
- Outputs:
  - E2E test script; lints and hooks.
- Acceptance:
  - Changing an unrelated patch doesn’t alter a sample target’s rule key; related patch does.
- Refs: design → "Appendix — E2E Provider‑Wiring Test", "Warnings & CI Fail-Safes".
- Extensibility: structure tests so language-specific providers can be asserted independently (module providers vs lockfile providers).

## Phase 10 — Docs & Operability

- Depends on: Phase 6+
- Tasks:
  - Update README/handbook with patch workflow, locations, adding new languages, CI stages, troubleshooting.
- Outputs:
  - Documentation with runnable examples.
- Acceptance:
  - A new teammate can create a patch and see only correct targets rebuild.
- Refs: design → "Scaffolding Requirements", "Future-Proofing for Other Languages", "Developer Workflow".
- Extensibility: document the contract for adding a new language (patch dir layout, provider sync generator, labels used by `gen-auto-map`).

---

## Verification matrix

- Build: sample Go binary/library via macros.
- Impact: `buck2 cquery 'testsof(rdeps(//..., //<target>))' | xargs buck2 test` runs only impacted tests.
- Patching: touch a dummy patch and observe provider/map updates and minimal rebuild.
- CI: glue freshness and override guardrails enforced.
- Refs: design → "Developer Workflow", "Declaring Buck Inputs", "Auto Map".
- Extensibility: add Node importer-scoped verification once Node support is enabled (lockfile label presence and provider wiring).

## Risks and mitigations

- Exporter correctness: verify with multiple configs and `replace` cases; add unit tests for label assignment.
- Name collisions for providers: centralize naming in `tools/lib/providers.ts` and test collisions.
- Developer overrides leaking into CI: hard fail when `NIX_GO_DEV_OVERRIDE_JSON` is set and `CI=true`.
- Extensibility: avoid hardcoding Go-only assumptions in generators or macros; keep provider naming and auto-map logic shared and label-driven so additional languages only add inputs, not structural changes.

---

## Non-Go language extensibility guardrails

- Keep planner tiny and template-driven: see design → "graph-generator.nix" and "Planner Dispatch (including optional mapping.nix)". New languages should be added as new template branches, not new planners.
- Preserve path invariants: `patches/<lang>/` flat directories; one patch per `module@version` (or per-package for Node).
- Ensure `tools/lib/providers.ts` remains the single source of truth for provider naming across languages.
- Keep `gen-auto-map.ts` label-agnostic: support both `module:` and `lockfile:` label shapes, and do not special-case Go.
- Outer CLI remains `patch-pkg <subcommand> <language>` with language modules under `tools/patch/<lang>/` and a shared interface.
- CI stages and pre-build guard operate on generated artifacts generically; do not add language-specific gating that would block future languages.
