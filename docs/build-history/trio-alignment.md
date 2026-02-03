## Trio Alignment Plan — Cross-language Build Abstractions (CPP / Go / PNPM)

This document sequences a focused set of PRs to strengthen our cross-language abstractions now that C++, Go, and PNPM are at feature parity. The goals are to reduce duplication, align behaviors across languages, and improve diagnosability without changing the high-level architecture (labels → exporter → planner/templates for planner languages; macro + provider map for Node).

The plan is intentionally incremental. Each PR is scoped to be reviewable, independently reversible, and covered by tests. CI continues to generate glue and verify freshness (exporter → sync providers → auto_map → guard → build/tests).

## PR‑1: Clean auto_map output (skip provider-package nodes)

### Description

`gen-auto-map.ts` currently includes entries for nodes under `//third_party/providers:*` when those nodes carry `nixpkg:` labels. While harmless, this creates self-mappings and adds noise. We will filter provider-package nodes out of the mapping generation.

### Scope & Changes

- Update `tools/buck/gen-auto-map.ts` to ignore nodes whose `name` starts with `//third_party/providers:`.
- Keep existing label parsing logic via `tools/lib/labels.ts` unchanged.
- No changes to Starlark macros or planners.

### Acceptance Criteria

- `third_party/providers/auto_map.bzl` no longer contains entries for provider-package nodes mapping to themselves.
- All existing builds and tests pass with identical behavior for non-provider targets.
- No increase in generated diff churn after subsequent runs.

### Risks

- Low: purely generated artifact; behavior is strictly a no-op for real targets.

### Consequence of Not Implementing

- Ongoing mapping noise; slightly higher cognitive load and risk of confusion during diagnostics.

### Downsides for Implementing

- Very small: adds an explicit filter which slightly diverges from “map everything literally.” Could obscure future debugging if someone expects provider-package nodes to appear in the map.

### Recommendation

- Implement. This aligns with architectural minimalism and reduces cognitive load without affecting determinism or invalidation semantics.

## PR‑2: Centralize nix attribute normalization in Starlark

### Description

We currently duplicate nix attribute normalization in both `go/defs.bzl` and `cpp/defs.bzl`, and also in TS. We will add a single Starlark helper in `lang/defs_common.bzl` (mirroring the TS rules) and have Go/C++ macros consume it.

### Scope & Changes

- Add `normalize_nix_attr(attr: str) -> str` in `lang/defs_common.bzl` (trim, lower-case, ensure `pkgs.` prefix, map `pkgs.gtest → pkgs.googletest`).
- Replace local `_normalize_nix_attr` uses in `go/defs.bzl` and `_normalize_cxx_attr` in `cpp/defs.bzl` with the shared helper.
- Ensure emitted `nixpkg:` labels are bit-for-bit identical to current output.

### Acceptance Criteria

- Label snapshots for `nixpkg:` across Go/C++ remain identical before vs after.
- No change to provider names in `TARGETS.cpp.auto` or to `auto_map.bzl` content (except for PR‑1’s intentional noise reduction).

### Risks

- Low: refactor-only; guarded by label snapshot tests and CI.

### Consequence of Not Implementing

- Continued duplication and risk of drift across languages for nix attribute handling.

### Downsides for Implementing

- Tighter coupling between Starlark and TS normalizers; when we evolve normalization rules, we must update both places in lockstep.
- Slight risk of transient mismatches during refactors until both sides are updated.

### Recommendation

- Implement. Centralization matches our DRY and determinism goals; the coupling risk is manageable with tests and clear ownership.

## PR‑3: Unify Go provider attachment via auto_map only (remove direct injection)

### Description

Go macros currently attach provider deps in two ways: (1) via `MODULE_PROVIDERS` from `auto_map.bzl` and (2) by directly constructing provider labels from `nixpkg_deps`. This duplication is safe but increases maintenance and diverges from Node’s single-path approach. We will remove the direct injection and rely solely on `MODULE_PROVIDERS`, keeping `nixpkg:` labels so the mapping remains correct.

### Scope & Changes

- In `go/defs.bzl`, stop appending `_nixpkg_provider_for(...)` results in `_merge_cgo_deps`; keep `nixpkg:` labels via `_apply_cgo_labels`.
- Ensure `gen-auto-map.ts` (which already translates `nixpkg:` labels via `tools/lib/labels.ts`) provides the necessary providers to Go targets.
- Update any tests that assumed direct provider deps to assert provider presence via deps resolved from `MODULE_PROVIDERS`.

### Acceptance Criteria

- For a Go target with `nixpkg_deps = ["pkgs.zlib"]`, `deps(...)` includes `//third_party/providers:nix_pkgs_zlib` only through `MODULE_PROVIDERS`.
- No change in rebuild invalidation boundaries for CGO-enabled targets (cache keys and impacted tests unaffected, aside from expected PR‑1 mapping cleanup).
- All Go tests pass; CI green.

### Risks

- Medium: if any private scripts relied on the direct injection path implicitly. Mitigate by running provider-wiring e2e tests and spot-checking `buck2 cquery deps(...)` deltas.

### Consequence of Not Implementing

- Ongoing duplication and divergence from Node/C++ conceptual model; higher maintenance burden.

### Downsides for Implementing

- Transitional risk: hidden consumers might have depended on the previous direct-injection path, causing short-term friction.
- Increased reliance on glue freshness (auto_map); misconfigured local flows could surface as mapping errors rather than direct deps.

### Recommendation

- Implement. Unifying on `auto_map` improves conceptual integrity and reduces surface area. It fits our philosophy of single, deterministic paths with clear guardrails.

## PR‑4: Strengthen prebuild guard to validate provider coverage

### Description

Enhance `tools/buck/prebuild-guard.ts` to validate that any node with `lockfile:` or `nixpkg:` labels (from `tools/buck/graph.json`) is covered by a generated provider and mapped in `auto_map.bzl`. Fail in CI; warn locally unless `--strict` is passed.

### Scope & Changes

- Read `graph.json` and aggregate nodes with `lockfile:` and `nixpkg:` labels.
- For each affected node, assert:
  - A corresponding provider target exists in `third_party/providers` (e.g., `//third_party/providers:lf_*` or `//third_party/providers:nix_*`).
  - `MODULE_PROVIDERS` maps the node `//pkg:target` to the provider(s).
- Severity: default warn locally; forced error under `CI=true` or `--strict` flag locally.

### Acceptance Criteria

- When provider sync or auto-map is stale/missing, the guard emits actionable diagnostics and fails CI.
- With fresh glue, guard passes with no added noise.

### Risks

- Low/Medium: Overly strict guard could annoy local flows. Mitigate with warn-by-default locally and clearly documented `--strict` mode.

### Consequence of Not Implementing

- Potential silent drift where labels exist but providers/mappings are missing, leading to subtle invalidation gaps.

### Downsides for Implementing

- Added local friction when glue is stale; may require developers to run sync steps more often.
- Slight runtime cost during prebuild checks (file reads and small graph scans).

### Recommendation

- Implement. Fail-fast diagnostics align with our deterministic reliability principle; the local friction is mitigated by warn-by-default and good docs.

## PR‑5 (Nice-to-have): Factor “include local patches in srcs” helper

### Description

Each language macro includes local patch files (e.g., `patches/go/*.patch`, importer-local Node patches) into `srcs` for precise invalidation. We can DRY this with a small helper in `lang/defs_common.bzl`.

### Scope & Changes

- Add `append_patch_srcs(kwargs, dirs: list[str])` in `lang/defs_common.bzl`:
  - Globs `*.patch` per dir, appends to `srcs`, stable-dedup via `dedupe_preserve`.
- Update Go/Node/C++ macros to use the helper instead of open-coding glob logic.

### Acceptance Criteria

- No change to which patch files are included as inputs for macro targets.
- Fewer duplicated lines across macro files; consistent behavior.

### Risks

- Low: purely internal macro refactor.

### Consequence of Not Implementing

- Small ongoing duplication and higher chance of minor behavioral drift across languages.

### Downsides for Implementing

- Introduces a small shared helper that slightly increases coupling between macro implementations; limited immediate user-facing value.

### Recommendation

- Implement (opportunistically). It’s a low-risk cleanup that reinforces consistency; schedule after core items to minimize rebase churn.

## PR‑6 (Nice-to-have): Tests and docs consolidation for guard & mapping

### Description

Add/align tests that assert (a) provider self-mappings are absent, (b) prebuild-guard detects missing providers or mappings, and (c) Go provider wiring remains correct after PR‑3.

### Scope & Changes

- Tests:
  - Extend or add zx tests under `tools/tests`:
    - `gen-auto-map.no-self-entries.test.ts` (assert no `//third_party/providers:*` keys in `MODULE_PROVIDERS`).
    - `prebuild-guard.provider-coverage.test.ts` (simulate missing provider file or stale auto_map and assert guard behavior for warn vs CI error).
    - `go.wiring-cgo-provider.test.ts` (assert providers appear via mapping, not direct injection).
- Docs:
  - Update `docs/handbook/troubleshooting.md` and `docs/handbook/conventions.md` with the new guard checks and expected remediation steps.

### Acceptance Criteria

- New tests pass locally and in CI and are stable (no flakiness).
- Documentation reflects the updated flow succinctly.

### Risks

- Low: test maintenance; ensure tests don’t rely on external network or mutable environment beyond our dev shell.

### Consequence of Not Implementing

- Gaps may reappear over time; fewer safety nets against regressions in provider wiring and guard behavior.

### Downsides for Implementing

- Additional test and documentation surface to maintain; may increase CI time slightly.

### Recommendation

- Implement. Stronger, focused tests and concise docs prevent regression and uphold our reliability standards with minimal ongoing cost.

## Rollout & Sequencing

1. PR‑1 (auto_map cleanup): trivial, safe. Land first to reduce noise for subsequent diffs.
2. PR‑2 (Starlark normalization): safe refactor; land second so both C++ and Go macros use a consistent helper before further changes.
3. PR‑3 (Go provider unification): main behavioral alignment. With PR‑1/PR‑2 in place, diffs are isolated and easier to review.
4. PR‑4 (prebuild-guard coverage): ensures future glue freshness and mapping correctness; naturally follows PR‑3.
5. PR‑5 (patch src helper): optional refactor; land after the above to avoid rebase churn.
6. PR‑6 (tests/docs): reinforce the changes; can partially land alongside earlier PRs if desired.

Each PR should:

- Run the full test suite per project convention (via dev shell) and maintain green CI.
- Include small, focused commits with clear messages and acceptance checks.
- Avoid modifying specification tests unless they are clearly in error; prefer adding new tests.

## Verification & Backout Strategy

- Verification: for each PR, run provider-wiring e2e checks and confirm expected `buck2 cquery deps(...)` outputs on representative targets (Go with CGO, Node importer-scoped, C++ nixpkgs).
- Backout: each PR is isolated and can be reverted independently without breaking later steps (only minor merge conflicts from shared files like `defs_common.bzl` may need small resolution).

## Summary of Expected Impact

- Reduced duplication (normalization, patch inclusion) and fewer moving parts in Go provider wiring.
- Cleaner `auto_map.bzl` and stronger guardrails for stale/missing glue.
- Consistent developer experience across C++, Go, and Node with the same mental model for providers and patches.
