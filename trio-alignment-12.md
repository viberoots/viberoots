## Trio Alignment Plan — Abstraction Tightening (CPP / Go / PNPM) — Part 12

This plan lands additional small, high‑value refinements that further tighten cross‑language abstractions, reduce maintenance risk, and improve parity across Go/C++/Node without changing behavior. All items are scoped to be low‑risk and independently reversible.

## PR‑1: Go patch CLI — override UX parity with C++

### Description

Align `patch-go` UX with `patch-cpp` by adding an optional flag to print an export snippet for dev overrides (rather than only setting the env in‑process). This helps operators copy/paste the same style of env setup across languages.

### Scope & Changes

- `tools/patch/patch-go.ts`:
  - Add a `--echo-snippet` flag, mirroring C++ behavior.
  - When present, print `export NIX_GO_DEV_OVERRIDE_JSON='{"<module@version>":"<abs/path>"}'` to stderr in the same format used by C++.
  - Default remains to set the env in‑process; no behavior change for existing flows.
- Docs:
  - Note parity across Go/C++ override UX in the patching section.

### Acceptance Criteria

- End‑to‑end `patch-pkg {start|apply|reset|session} go …` works identically pre/post (no change when flag is not used).
- With `--echo-snippet`, a correctly formatted export string is printed and accepted by a shell.
- All zx tests for Go patching remain green without updates.

### Risks

Low. Pure UX enhancement guarded by a flag.

### Consequence of Not Implementing

Minor UX inconsistency vs C++ persists, increasing small context switches for operators.

### Downsides for Implementing

None material.

### Recommendation

Implement.

## PR‑2: Cross‑runtime normalization parity tests (TS / Starlark / Nix)

### Description

Add a tiny zx test that asserts equivalence of our normalization/decoding across runtimes:

- nixpkgs attr normalization (`tools/lib/provider-names.ts.normalizeNixAttr`, `lang/defs_common.bzl:normalize_nix_attr`, and Nix helper used by C++).
- flat patch filename decoding (Go/Node) using `tools/lib/providers.decodeNameVersionFromPatch`.

### Scope & Changes

- `tools/tests/normalize-parity.test.ts` (new):
  - Invokes the Starlark probe (`normalize_nix_attr_probe`) and a mini Nix function via `nix eval`, and compares results with TS helpers for a small corpus (e.g., `pkgs.zlib`, `zlib`, `pkgs.gtest`, scoped node names, and encoded patch names).
- No product code changes.

### Acceptance Criteria

- Test passes locally and in CI.
- Failing this test clearly reports which runtime diverged for which input.

### Risks

Low. Test‑only.

### Consequence of Not Implementing

Small risk of drift between TS/Starlark/Nix normalization logic over time.

### Downsides for Implementing

Adds one test that shells out to Buck/Nix; minimal runtime.

### Recommendation

Implement.

## PR‑3: Extract auto‑managed section writer helper

### Description

Factor the “managed block between BEGIN/END markers” logic used by Node provider sync into a small shared helper so similar patterns can reuse it without bespoke text surgery.

### Scope & Changes

- `tools/lib/auto-section.ts` (new):
  - `ensureAutoSection({ file, begin, end, header, body })` reads/creates the file, replaces or inserts the auto block deterministically, and keeps the rest untouched.
- `tools/buck/providers/node.ts`:
  - Replace in‑file section management with `ensureAutoSection`.
- No format/output changes.

### Acceptance Criteria

- Byte‑for‑byte identical `third_party/providers/TARGETS` for the same inputs.
- Node provider sync zx tests remain green; no test updates required beyond imports.

### Risks

Low. Pure extraction with identical behavior.

### Consequence of Not Implementing

Small duplication persists; future edits risk drift in ad‑hoc text manipulation.

### Downsides for Implementing

Minimal churn in imports; one new utility file.

### Recommendation

Implement.

## PR‑4: Optional — Expose Node template symbol bag in `lang-templates.nix`

### Description

Expose a `Node` symbol bag (e.g., `inherit (Node) nodeBundle;`) from `tools/nix/lang-templates.nix` for discoverability, keeping the planner’s Node plugin as the authoritative path. This is a non‑functional ergonomics improvement for engineers exploring the template registry.

### Scope & Changes

- `tools/nix/lang-templates.nix`:
  - Add an `import ./templates/node.nix` and re‑export of stable names (no consumers rely on this today).
- Docs:
  - One‑line note that Node remains planner‑plugin driven; the symbol bag is for discoverability only.

### Acceptance Criteria

- No changes to planner outputs or store paths.
- `nix build .#graph-generator` remains unchanged for representative samples.

### Risks

Low. Symbol exposure only.

### Consequence of Not Implementing

Slightly less discoverable Node template entrypoints for new contributors.

### Downsides for Implementing

Adds a couple of imports/exports with no runtime effect.

### Recommendation

Implement (optional; can defer).

## PR‑5: Optional — Reuse classification helper for Node “lang label” advisory

### Description

Reuse `validateLanguageClassification` for a narrow advisory: when a Node target clearly matches our macro‑stamped pattern but lacks `lang:node`, surface a unified message style. Keep importer/kind validation exactly as‑is.

### Scope & Changes

- `tools/buck/exporter/lang/node.ts`:
  - Add a gated call to the shared classification helper for “missing lang label” only (warn‑level, same severity as today’s advisories).
  - Retain importer‑scoped lockfile and kind validations unchanged.
- No changes to label stamping or behavior.

### Acceptance Criteria

- No change in exporter labels or graph content for the same inputs.
- Validation messages align with the shared helper style without new false positives.

### Risks

Low. Message shape change only; severity unchanged.

### Consequence of Not Implementing

Minor inconsistency in validation phrasing persists across languages.

### Downsides for Implementing

Negligible; tiny code path.

### Recommendation

Optional; safe to defer.

## Rollout & Sequencing

1. PR‑1 (Go patch CLI parity) — tiny, isolated UX improvement; land first.
2. PR‑2 (Normalization parity tests) — test‑only; safe to land early.
3. PR‑3 (Auto‑section helper extraction) — behavior‑preserving refactor.
4. PR‑4 (Optional Node symbol bag) — ergonomics only; anytime after 1–3.
5. PR‑5 (Optional Node classification helper reuse) — message‑level tweak; anytime.

All PRs are independent and reversible.

## Verification & Backout Strategy

- Verification (per PR):
  - PR‑1: Exercise `patch-pkg` Go lifecycle; verify `--echo-snippet` prints a usable export and that default flows are unchanged.
  - PR‑2: Run the new zx test locally and in CI; verify consistent results across runtimes.
  - PR‑3: Snapshot `third_party/providers/TARGETS` before/after; expect byte‑for‑byte identity for given inputs. Existing provider sync tests remain green.
  - PR‑4: Build representative targets; confirm no diffs in Nix store paths or planner outputs.
  - PR‑5: Run exporter with/without the change; labels unchanged; advisory text style aligns with helper output.
- Backout:
  - Revert individual PRs cleanly. Each PR confines changes to leaf modules or tests with no public API changes beyond imports.

## Summary of Expected Impact

- Improved operator UX parity between Go and C++ for dev overrides.
- Stronger guardrails via cross‑runtime normalization parity tests.
- Smaller, clearer provider sync implementation with a reusable auto‑section helper.
- Better discoverability of Node template entrypoints (optional).
- Slightly more consistent validation phrasing across languages (optional).
