# Build System Development Plan 2 — Close Remaining Gaps

This plan addresses four targeted items. We keep changes minimal, deterministic, and testable per AI-PREFERENCES.XML and METHODOLOGY.XML.

- Nix planner not present
- gomod2nix integration in install-deps
- Pre-build guard enhancements
- Codegen stub

## PR sequence and scope

### PR 1 — Minimal Nix planner (Go only)

- Scope
  - Add `graph-generator.nix` (outer planner) reading `tools/buck/graph.json` and dispatching to Go templates.
  - Add `tools/nix/lang-templates.nix` (Go templates) applying `patches/go/*.patch` and `NIX_GO_DEV_OVERRIDE_JSON`.
  - Add optional `tools/nix/mapping.nix` (empty registry now).
  - Update `flake.nix` to expose `packages.<system>.graph-generator` without breaking existing outputs.
- Design refs
  - build-system-design.md → “Nix with Dynamic Derivations”, “graph-generator.nix”, “Planner Dispatch (including optional mapping.nix)”, “Go Templates (goApp / goLib)”.
- Implementation notes
  - Keep the planner tiny: read JSON, pick Go targets, call `goApp` / `goLib` from `lang-templates.nix`.
  - `lang-templates.nix` constructs a patches map from `patches/go/` and applies `NIX_GO_DEV_OVERRIDE_JSON`. CI throws if overrides set.
  - The output derivation should expose a simple directory of per-target symlinks as in the design sketch.
- Acceptance
  - `nix build .#graph-generator` succeeds on supported systems.
  - Jenkins “nix-build-graph-generator” no longer skips.
- Tests
  - zx test: write a tiny `tools/buck/graph.json` with one Go target, run `nix build .#graph-generator`, assert the output directory exists and contains an entry for the target.

### PR 2 — gomod2nix in install-deps

- Scope
  - Update `tools/dev/install-deps.ts` to detect `go.mod`/`go.sum` and regenerate `gomod2nix.toml` non-interactively; skip if absent.
  - Add dry-run (env flag) that logs the intended command without executing.
- Design refs
  - build-system-design.md → “gomod2nix Integration (called from tools/install-deps.ts)”.
- Implementation notes
  - Respect PATH from dev shell; fail with a clear message if `gomod2nix` is unavailable.
  - Write `gomod2nix.toml` only if content changes (use a temp file + compare) to avoid churn.
- Acceptance
  - Editing `go.mod` then running install-deps regenerates `gomod2nix.toml` deterministically.
  - Dry-run logs the exact command and skip behavior.
- Tests
  - zx dry-run test: in a temp repo create minimal `go.mod`, run with dry-run, assert the log contains the `gomod2nix` invocation.
  - zx optional integration: gated by an env flag; executes `gomod2nix` if available.

### PR 3 — Pre-build guard freshness

- Scope
  - Enhance `tools/buck/prebuild-guard.ts` to compare mtimes of inputs (TARGETS, _.bzl, patches, pnpm-lock) vs outputs (graph.json, auto_map.bzl, TARGETS_.auto).
  - Local mode: warn; CI mode: fail with details listing newer inputs.
- Design refs
  - build-system-design.md → “CI with Jenkins (Matrix across 3 Architectures)” → Pre-build guard notes.
- Implementation notes
  - Use a small threshold (e.g., 1–2s skew allowance) to avoid false positives.
  - Keep checks fast: discover inputs with `git ls-files` filters when available; fallback to glob on non-git contexts.
- Acceptance
  - Stale outputs detected; re-running export-graph + sync-providers + gen-auto-map clears failures.
- Tests
  - zx test: synthesize outputs, then `touch` a TARGETS or .bzl file; guard warns in local mode and fails in CI mode.

### PR 4 — Codegen stub

- Scope
  - Add `tools/codegen.ts` zx script that exits 0.
- Design refs
  - build-system-design.md → “CI with Jenkins” (Codegen stage before Export Graph).
- Implementation notes
  - Keep script tiny and idempotent; it can print “codegen: OK” and exit 0.
- Acceptance
  - `tools/ci/run-stage.ts --stage codegen` returns 0 locally and in CI.
- Tests
  - zx test executes the stage and asserts success.

## Cross-cutting checks

- Keep files ≤250 LOC; split if needed.
- One-test-per-file; use external timeouts.
- Conventional Commits with real newlines.

## Rollout

- Submit PRs in the listed order; keep each PR small and green.
- Rebase and merge once CI passes.

## Outcomes

- Nix planner available as `.#graph-generator`.
- install-deps regenerates gomod2nix on Go dep changes.
- Guard detects stale glue.
- Codegen stage present (no-op).

## Final completeness review against build-system-design.md

- Buck exporter and glue
  - Exporter implemented; hardening and caching done; simulate mode supported.
  - `sync-providers.ts` and `gen-auto-map.ts` implemented; provider naming centralized in `tools/lib/providers.ts`.
  - After PR 3 the pre-build guard matches the design’s freshness intent.
- Nix planner and templates
  - After PR 1, `graph-generator.nix` + `tools/nix/lang-templates.nix` fulfill the planner and template contract for Go.
  - Optional `mapping.nix` present as empty registry; ready for custom rule mapping.
- gomod2nix
  - After PR 2, install-deps drives regeneration per design.
- CI stages and operability
  - Jenkinsfile and zx stage runner exist; after PR 4 codegen stage is present; pre-build guard enhanced in PR 3.
- Out-of-scope by agreement for now
  - Optional Node importer-scoped labels and `defs_node.bzl` wiring (kept experimental in the design) remain disabled.
  - Wrapper-to-TS conversion for `tools/bin/patch-pkg` left as-is.

Conclusion: with PRs 1–4 merged, the design is fully implemented for the Go path and CI glue as specified, excluding the intentionally deferred Node and wrapper details.
