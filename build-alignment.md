## Build Alignment Plan (PR Sequence)

This plan brings the repository into alignment with `build-system-design.md`, favoring simplicity and early erroring over fallbacks. Each PR is small, testable, and reversible.

### PR 1 — Restore filtered source for planner (apps/libs only) and fix working dirs

- Summary: Switch planner `srcRoot` from repository root back to the filtered `appsLibsSrc` snapshot. Update Nix templates to set `pwd/modRoot` so paths resolve without needing the entire repo.
- Consequence if not implemented: Larger Nix input closure, avoidable invalidation on unrelated root changes, weaker guardrails against cross-tree references.
- Changes:
  - `tools/nix/graph-generator.nix`: set `srcRoot = appsLibsSrc` for `goApp`/`goLib`.
  - Ensure `subdir`, `pwd`, and `modRoot` are computed so `cd` and module-relative paths work when only `apps/` and `libs/` are present.
  - Remove any reliance on repo-root existence during build steps.
- Acceptance criteria:
  - Building `//apps/test-cli:test-cli` materializes the binary and records it in the manifest.
  - Nix closure excludes files outside `apps/` and `libs/` (verify via `nix path-info -r`).
  - Changing a non-app/lib file at repo root does not invalidate the app derivation.
- Tests:
  - e2e build test materializing `test-cli` and asserting non-empty manifest entry.
  - Closure check test: assert no repo-root-only files appear in `nix-store -qR` output for the app.
  - Invalidation test: touch a non-app/lib file; build should be a cache hit.
- Risks & mitigations:
  - Risk: path resolution breaks when using filtered source. Mitigation: explicitly set `pwd/modRoot` exactly as in the design; add an e2e that fails fast if `cmd/<name>` cannot be found.
  - Risk: hidden reliance on root files. Mitigation: filtered source hard-fails on missing paths; early erroring is desired.
  - Rollback: revert to repo-root `srcRoot` (no data migration).

### PR 2 — Make exporter authoritative; remove heuristic labeling

- Summary: Ensure `cquery` reliably emits `rule_type` (and/or macro labels). Map any `buck.*` attributes to canonical names, then remove heuristic additions of `lang:go`/`kind:bin`.
- Consequence if not implemented: Misclassification risks for Go nodes, noisy/incorrect provider mapping, brittle planner behavior.
- Changes:
  - `tools/buck/exporter/io.ts`: keep canonical mapping (`buck.deps` → `deps`, etc.).
  - Enforce presence of `rule_type` or macro-stamped labels (`lang:go`, `kind:bin`); if absent, early error with a precise message listing affected targets.
  - Remove heuristic label additions based on file extensions.
- Acceptance criteria:
  - Every Go node in `graph.json` has `rule_type` starting with `go_` or has explicit `lang:go` label.
  - Planner classifies nodes solely from `rule_type`/labels; no heuristics.
  - Materialization still lists the expected binaries.
- Tests:
  - Exporter unit test: synthetic `cquery` JSON with `buck.*` keys is normalized correctly.
  - Negative test: a target missing both `rule_type` and labels triggers a clear failure.
  - e2e: build flow remains successful for `test-cli`.
- Risks & mitigations:
  - Risk: some targets lack `rule_type`. Mitigation: stamp labels in macros (`nix_go_*`) and fail early if absent.
  - Rollback: temporarily re-enable heuristics behind a guarded flag (not default) if needed, then remove once fixed.

### PR 3 — Remove `gomod2nix` Nix fallback; enforce presence via guard and install-deps

- Summary: Delete the inline fallback `gomod2nix.toml` generation in Nix; rely on `tools/dev/install-deps.ts` to generate per-app files. Strengthen prebuild guard to fail if any required `gomod2nix.toml` is missing.
- Consequence if not implemented: Builds may proceed with incomplete dependency metadata, causing subtle failures later; divergence from spec (“install-deps generates deterministically”).
- Changes:
  - `tools/nix/graph-generator.nix`: remove inline/default `gomod2nix.toml` text generation; require the file to exist.
  - `tools/buck/prebuild-guard.ts`: ensure it errors when any `apps/**/go.mod` exists without `apps/**/gomod2nix.toml`.
  - Docs: add a troubleshooting note that “run install-deps” is required after Go dep changes.
- Acceptance criteria:
  - Running materialization without per-app `gomod2nix.toml` fails fast with a clear error.
  - After running `tools/dev/install-deps.ts`, materialization succeeds.
- Tests:
  - Guard test: create a temp app with `go.mod` only; guard must fail.
  - e2e: run install-deps; guard passes; build succeeds.
- Risks & mitigations:
  - Risk: dev friction if contributors forget to run install-deps. Mitigation: `dev-build` triggers glue-only steps and prints actionable hints; guard messages are explicit.
  - Rollback: none needed; this tightens correctness.

### PR 4 — Eliminate git force-stage for glue; rely on clean working snapshot

- Summary: Stop force-staging `graph.json` and `gomod2nix.toml`. The prebuild step generates glue; planner references those files directly from the working tree snapshot captured by `builtins.path` and the filtered source.
- Consequence if not implemented: Local dev continues to depend on git index mutations, adding cognitive overhead and risk of accidental staging.
- Changes:
  - `tools/dev/dev-build.ts`: remove `git add -f` and corresponding reset; keep glue generation.
  - Ensure `flake.nix` uses a stable, minimal snapshot strategy (filtered where applicable) so Nix sees the files without staging.
  - Guard already enforces presence; early error if missing.
- Acceptance criteria:
  - `b //apps/test-cli:test-cli` works from a clean or dirty working tree without staging.
  - No git index changes occur during the build.
- Tests:
  - Integration test invoking `dev-build` verifying no changes in `git status --porcelain` before/after.
  - e2e build still lists binary in manifest.
- Risks & mitigations:
  - Risk: flake snapshot misses files if paths are wrong. Mitigation: guard and failing tests catch it; adjust path wiring.
  - Rollback: reintroduction of staging (discouraged) is trivial.

### PR 5 — Restrict planner outputs to binaries in `graph-outputs`

- Summary: Align `graph-outputs` to only include app binaries (not libraries). Libraries are still individually addressable via the planner but not linked into the manifest bundle.
- Consequence if not implemented: Slightly larger materialized set and potential confusion about non-executable outputs in the manifest directory.
- Changes:
  - `tools/nix/graph-generator.nix`: filter `goTargets` to `kind == "bin"` for `all` and manifest emission.
  - Keep ability to reference libs via separate attribute path for advanced use cases.
- Acceptance criteria:
  - Manifest lists only binaries; libs are excluded.
  - Materialized `bin/` symlinks correspond only to executables.
- Tests:
  - e2e: ensure no lib-only targets appear in manifest; ensure binaries remain present.
- Risks & mitigations:
  - Risk: future workflows need libs in the bundle. Mitigation: document how to access library derivations by attribute without including them in `all`/manifest.

### PR 6 — Remove vendor and special-case preBuild logic (uuid, etc.)

- Summary: Delete preBuild vendor and ad-hoc patch application in templates. Depend solely on `gomod2nix` and the patch map per design.
- Consequence if not implemented: Risk of impurity drift and hidden differences between local/CI; conflicts with the “no vendoring” principle.
- Changes:
  - `tools/nix/lang-templates.nix`: remove vendor calls and special-case module patching; apply patches only via `overrides` and patch map.
- Acceptance criteria:
  - Builds remain green without vendor mode; patches from `patches/go/*.patch` are respected.
  - No ad-hoc patch logic remains.
- Tests:
  - e2e: apply a dummy patch file and confirm provider mapping triggers rebuild correctly.
  - Negative: with no patches, ensure no vendor-related behavior occurs.
- Risks & mitigations:
  - Risk: a dependent module previously worked only due to vendor fallback. Mitigation: fail early; add/adjust patch files; update `gomod2nix.toml`.

### PR 7 — Strengthen prebuild guard freshness checks

- Summary: Guard fails when `graph.json` is older than any `TARGETS`/`*.bzl` or provider auto files are missing/stale. Make messages actionable and concise by default; provide verbose and JSON modes.
- Consequence if not implemented: Stale glue can slip through, causing confusing build or mapping results.
- Changes:
  - `tools/buck/prebuild-guard.ts`: implement mtime-based freshness checks; verify presence of `TARGETS*.auto` when patches/lockfiles exist; keep verbose and JSON flags as documented.
- Acceptance criteria:
  - Changing any `TARGETS` or `*.bzl` triggers guard failure until `export-graph`/sync steps run.
  - If patches exist, at least one `TARGETS*.auto` must be present.
- Tests:
  - Freshness test: touch `TARGETS`; guard fails; after running glue scripts, guard passes.
  - Providers test: add/remove a patch file; guard response matches expectations.
- Risks & mitigations:
  - Risk: minor dev friction. Mitigation: fast scripts and clear errors; optional `--verbose` for diagnostics.

## Execution Order and Rollout

1. PR 2 (authoritative exporter) can land first or in parallel with PR 1; doing it first reduces heuristic dependence.
2. PR 1 (filtered source) once paths are correct.
3. PR 3 (no `gomod2nix` fallback) to enforce correctness.
4. PR 4 (no git staging) to simplify dev workflow.
5. PR 5 (bins-only in manifest) for clarity.
6. PR 6 (remove vendor/special-cases) to drop impurities.
7. PR 7 (guard freshness) to harden against staleness.

Each PR is independently testable; ship in small increments to minimize risk. All changes prefer early erroring over fallbacks, aligning with the design.
