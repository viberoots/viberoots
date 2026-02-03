## Trio Alignment Plan — Abstraction Tightening (CPP / Go / PNPM) — Part 5

This plan advances the consolidation from Parts 3–4. Each PR is small, independently reversible, and targets high value-per-effort improvements: single sources of truth, bootstrap safety, and removal of lingering duplication — all without changing behavior or invalidation semantics.

## PR‑1: Language metadata — single source of truth

### Description

Eliminate drift between `tools/nix/langs.json`, `tools/lib/langs.ts`, and `tools/nix/langs.nix` by introducing one authoritative source and generating the others.

### Scope & Changes

- Make `tools/nix/langs.json` authoritative (ids, requiredPaths, capabilities, templatesDir)
- Update `tools/lib/langs.ts` to read from JSON (remove hard‑coded KNOWN list)
- Generate `tools/nix/langs.nix` from JSON (retain “GENERATED FILE” header)
- Add a tiny generator script (`tools/dev/gen-langs.ts`) invoked by glue/dev flows

### Acceptance Criteria

- Behavior unchanged: enabled language detection and capability flags match current behavior
- `tools/nix/langs.nix` regenerates deterministically from JSON (idempotent)
- No downstream code needs updates beyond imports/removals of constants

### Risks

Low. Pure refactor/code‑generation.

### Consequence of Not Implementing

Ongoing drift risk and duplicated edits when adding/updating languages.

### Downsides for Implementing

Small import churn; adds a tiny generator.

### Recommendation

Implement.

## PR‑2: Bootstrap‑safe patch CLI for Node (remove fs‑extra)

### Description

Ensure patching works before `node_modules` are linked. Replace `fs-extra` usage in Node patching entrypoints with `node:fs/promises`.

### Scope & Changes

- Update `tools/patch/patch-node.ts` to use `node:fs/promises` (mkdirp → recursive mkdir, etc.)
- Quick pass over glue entrypoints invoked pre‑install to confirm no `fs-extra` usage

### Acceptance Criteria

- `patch-pkg start/apply/reset node` works in a fresh dev shell without installing deps
- Dev/CI glue unaffected; no behavior or output changes

### Risks

Low. Straightforward API substitutions.

### Consequence of Not Implementing

Intermittent bootstrap failures in environments lacking `node_modules`.

### Downsides for Implementing

None material.

### Recommendation

Implement.

## PR‑3: Shared patch filename decoding (Node) + duplicate detection

### Description

Centralize `<name>@<version>.patch` decoding used by Node provider sync and unify duplicate detection with the shared flat‑dir scanner.

### Scope & Changes

- Add a shared `decodeNameVersionFromPatch(filename)` helper (builds on existing encode/decode)
- Make `tools/buck/providers/node.ts` use `scanFlatPatchDir` with the shared decoder
- Ensure duplicate detection and sort order remain deterministic

### Acceptance Criteria

- No diffs in `third_party/providers/TARGETS.node.auto` on clean trees
- Duplicate/conflict detection remains deterministic and user‑friendly

### Risks

Low. Refactor to shared utility.

### Consequence of Not Implementing

Multiple subtly different decoders across call sites; future drift risk.

### Downsides for Implementing

Minimal refactor; small test updates.

### Recommendation

Implement.

## PR‑4: Consolidate label normalization/sanitization in glue

### Description

Replace ad‑hoc label cleaning/sanitization in glue scripts with shared helpers from `tools/lib/labels.ts`.

### Scope & Changes

- Update scripts (e.g., `tools/dev/build-selected.ts`) to use:
  - `dropConfigSuffix`, `dropCellPrefix`, `normalizeTargetLabel`
  - `sanitizeAttrNameFromLabel` for attr identifiers
- Remove duplicate local implementations

### Acceptance Criteria

- No output/behavior changes in build‑selected and related flows
- Glue passes existing tests and snapshots

### Risks

Low. Readability and consistency improvement.

### Consequence of Not Implementing

Subtle drift and small bugs in label formatting.

### Downsides for Implementing

Very small code edits.

### Recommendation

Implement.

## PR‑5: Nix template helper DRY — move shared attr resolution to common

### Description

Factor duplicated attribute resolution helpers (`getAtPath`, resolve functions) from `tools/nix/templates/go.nix` and `tools/nix/templates/cpp.nix` into `tools/nix/templates-common.nix` to reduce duplication without changing behavior.

### Scope & Changes

- Move generic helpers to `templates-common.nix`; re‑export via `lib/lang-helpers.nix`
- Update `go.nix`/`cpp.nix` to import the shared helpers
- Keep language‑specific logic and overrides intact

### Acceptance Criteria

- Identical derivations/store paths across representative builds
- Templates remain ≤ current file sizes and easier to read

### Risks

Low. No behavior change.

### Consequence of Not Implementing

Two copies of near‑identical helpers to maintain.

### Downsides for Implementing

Minor edits and re‑wires.

### Recommendation

Implement.

## PR‑6: Unified patches lint across languages

### Description

Extend the existing patches lint to uniformly cover Go/Node/C++ with flat‑dir checks and duplicate detection using the shared decoders.

### Scope & Changes

- Update `tools/dev/patches-lint.ts` to lint:
  - `patches/go`, `patches/node`, `patches/cpp` (flat dir enforcement)
  - Duplicate keys per language using shared decode helpers
- Keep severities and messages consistent with current style

### Acceptance Criteria

- Lint is idempotent; no findings on clean tree
- Intentional duplicate fixtures (tests) are flagged deterministically

### Risks

Low. Lint‑only.

### Consequence of Not Implementing

CPP/Node/Go lint coverage diverges; easier to miss duplicates/subdirs.

### Downsides for Implementing

Small lint/test additions.

### Recommendation

Implement.

## Rollout & Sequencing

1. PR‑2 (Bootstrap‑safe patch CLI) — removes the biggest operational footgun
2. PR‑1 (Language metadata SSoT) — centralizes metadata before more refactors
3. PR‑3 (Shared patch decode) — prepares provider sync for future languages
4. PR‑4 (Label helpers consolidation) — removes glue‑layer duplication
5. PR‑5 (Nix template helper DRY) — tidies templates with no behavior change
6. PR‑6 (Unified patches lint) — aligns guardrails across languages

## Verification & Backout Strategy

- Verification:
  - PR‑1: Diff generated `tools/nix/langs.nix`; run scaffolding and ensure enabled languages unchanged
  - PR‑2: Run `patch-pkg start/apply/reset node` in a clean dev shell; no dependency install required
  - PR‑3: Diff `TARGETS.node.auto`; run provider sync tests; simulate duplicate files
  - PR‑4: Run glue and build‑selected flows; confirm no output diffs
  - PR‑5: Snapshot derivations for representative Go/CPP targets; parity required
  - PR‑6: Run lint across repo; add small zx tests for duplicates/subdirs
- Backout:
  - Each PR is isolated (utilities/templates/lint). Revert individually with no cross‑PR coupling.

## Summary of Expected Impact

- Reduced duplication and fewer drift vectors across glue/templates
- More reliable bootstrap (patching works without `node_modules`)
- Single source of truth for language capabilities/paths
- Stronger, uniform lint guardrails over all patch directories
