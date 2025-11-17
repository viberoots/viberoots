## Trio Alignment Plan — Cross-Language Tightening (CPP / Go / PNPM) — Part 14

This plan contains small, high‑leverage refactors that reduce duplication, improve parity across languages, and clarify intent. All items are designed to be low‑risk, independently reversible, and behavior‑preserving for builds, labels, and provider mapping.

## PR‑1: TS↔Starlark parity for nixpkgs attr normalization

### Description

Ensure `normalizeNixAttr` produces identical results across TypeScript and Starlark and centralize the alias table (`pkgs.gtest → pkgs.googletest`) to reduce drift risk.

### Scope & Changes

- `tools/lib/provider-names.ts` and `lang/defs_common.bzl`:
  - Introduce a tiny, shared alias table source (TS) and mirror it in a Starlark test probe.
  - Keep existing normalization logic; do not change semantics.
- Tests:
  - Add `tools/tests/lib/normalize-nix-attr.parity.test.ts`:
    - Calls TS `normalizeNixAttr` and Starlark `normalize_nix_attr_probe` on the same inputs and asserts identical normalized values.

### Acceptance Criteria

- Parity test passes for a matrix of inputs (aliases, deep paths, capitalization, whitespace).
- No changes to provider names or mapping outputs in existing tests.

### Risks

Low. Pure test/alias‑table consolidation; no functional change to builders or macros.

### Consequence of Not Implementing

Potential divergence between TS and Starlark normalization over time.

### Downsides for Implementing

Minor new test and small data table.

### Recommendation

Implement.

## PR‑2: Centralize importer resolution for Node tools

### Description

Unify logic that determines the PNPM importer directory to avoid local ad‑hoc implementations and subtle path mismatches.

### Scope & Changes

- `tools/lib/lockfiles.ts`:
  - Add `resolveImporterDir(cwd?: string, flag?: string): Promise<string>` that:
    - Honors an explicit `--importer` (or equivalent flag value),
    - Falls back to walking upward from `cwd` for the nearest directory containing `pnpm-lock.yaml`,
    - Returns a normalized POSIX‑style relative path from repo root.
- `tools/patch/patch-node.ts`:
  - Replace local importer discovery with `resolveImporterDir`.
- (Optional) `tools/buck/prebuild/*` and provider generation entrypoints:
  - Where importer detection is needed, use the shared helper or rely on already parsed lockfiles.

### Acceptance Criteria

- Identical behavior for `patch-pkg start/apply/reset node` in representative repos.
- No diffs in generated provider files or auto_map for the same inputs.

### Risks

Low. Centralization only; surface area is small and covered by existing zx tests.

### Consequence of Not Implementing

Drift between importer detection across scripts; harder debugging of edge cases.

### Downsides for Implementing

Small refactor across 1–2 call sites.

### Recommendation

Implement.

## PR‑3: Local prebuild guard — friendly dev‑override notices

### Description

Add clear local warnings when `NIX_GO_DEV_OVERRIDE_JSON` or `NIX_CPP_DEV_OVERRIDE_JSON` is set. Preserve CI behavior (still forbidden in Nix templates).

### Scope & Changes

- `tools/buck/prebuild/main.ts`:
  - When `CI!=true` and either env var is non‑empty, print a one‑line notice explaining that local derivation hashes will differ and how to clear overrides.
  - No exit/status changes; purely informational locally.

### Acceptance Criteria

- Local runs print a single‑line notice; CI output remains unchanged.
- No change to build/test outcomes or glue freshness checks.

### Risks

Very low. Logging only.

### Consequence of Not Implementing

Developers may forget overrides are active, causing confusing cache/key differences.

### Downsides for Implementing

None.

### Recommendation

Implement.

## PR‑4: Document Node template shim intent

### Description

Clarify that `tools/nix/templates/node.nix` serves as a discoverability shim (planner plugin remains authoritative) to prevent misinterpretation by newcomers.

### Scope & Changes

- `tools/nix/templates/node.nix`:
  - Add a brief header comment describing the shim role and where the authoritative Node planner logic lives.
- Docs:
  - Add a short note to `docs/handbook/adding-language.md` reinforcing the separation.

### Acceptance Criteria

- No code changes or output diffs; documentation clarifies the architecture.

### Risks

None.

### Consequence of Not Implementing

Occasional confusion interpreting an empty (or minimal) Node template.

### Downsides for Implementing

None.

### Recommendation

Implement.

## PR‑5: Lint to prevent ad‑hoc provider naming/hashing

### Description

Prevent future re‑implementations of `shortHash`, `providerNameForImporter`, `providerNameForNixAttr` outside `tools/lib/providers.ts`.

### Scope & Changes

- ESLint config or a lightweight grep‑lint script:
  - Rule: disallow new definitions matching common naming/hashing shapes; require imports from `tools/lib/providers.ts`.
- Tests:
  - Add a guard test that runs the lint task and asserts zero violations on the repo.

### Acceptance Criteria

- The lint passes on the current codebase and fails on intentional examples.
- No behavior changes to builds or tests.

### Risks

Low. Incremental guardrail.

### Consequence of Not Implementing

Future drift/duplication in naming logic across scripts.

### Downsides for Implementing

Slight contributor friction when introducing new helpers (intended).

### Recommendation

Implement.

## PR‑6: Unify patch filename parsing usage

### Description

Ensure all patch‑consuming scripts use the shared decoder(s) for canonical keys to catch case/encoding edge cases consistently.

### Scope & Changes

- Audit TS scripts and replace local parsing with:
  - `decodeNameVersionFromPatch` (Node/Go),
  - Existing C++ decode path through `decodeNixAttrFromPatchPrefix` where applicable.
- No behavior change; keep outputs identical.

### Acceptance Criteria

- No diffs in provider files, auto_map, or lints for the same inputs.
- Existing zx tests remain green.

### Risks

Low. Straightforward adoptions.

### Consequence of Not Implementing

Latent parsing drift across tools; harder to reason about edge cases.

### Downsides for Implementing

Small edits.

### Recommendation

Implement.

## Rollout & Sequencing

1. PR‑1 (Normalization parity + alias table) — tests only; safest to land first.
2. PR‑2 (Importer resolution centralization) — refactor; low risk, lands next.
3. PR‑3 (Prebuild notices) — messaging only; land anytime after 1–2.
4. PR‑4 (Node template doc) — documentation; independent.
5. PR‑5 (Lint guard) — add after 1–4 to avoid distracting diffs in parallel.
6. PR‑6 (Parsing audit/adoption) — final pass once guard is present.

All PRs are independent and reversible.

## Verification & Backout Strategy

- PR‑1:
  - Run the new parity test; run existing provider/auto‑map zx tests; expect no diffs.
  - Backout: remove parity test and alias table file; no code changes revert needed.
- PR‑2:
  - Run `patch-pkg start/apply/reset node` scenarios; verify provider sync and auto_map are unchanged.
  - Backout: restore prior importer discovery in `patch-node.ts`.
- PR‑3:
  - Local run of prebuild guard prints notices; CI output unchanged; no diffs in artifacts.
  - Backout: remove the log lines.
- PR‑4:
  - Docs render; no code path changes.
  - Backout: delete comment/doc lines.
- PR‑5:
  - Lint passes on repo; fails on seeded violations in a test fixture.
  - Backout: disable the rule or remove the grep‑lint.
- PR‑6:
  - Re‑run provider sync/gen‑auto‑map; expect identical outputs; all zx tests green.
  - Backout: revert individual adoptions (no schema changes).

## Summary of Expected Impact

- Stronger parity and lower drift risk across TS/Starlark for nixpkgs normalization.
- Fewer bespoke importer/patch parsing implementations; simpler maintenance.
- Improved DX via clear local override notices; zero CI behavior change.
- Clearer documentation of Node template boundaries.
- Preventative lint guard to keep future contributions aligned with shared helpers.
