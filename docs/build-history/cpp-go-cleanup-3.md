## Cross‑Language Cleanup and Consolidation — PR Sequence (Go ↔ C++) — Round 3 (Approach A: keep direct Go provider deps, align naming to TS)

This plan implements the improvements discussed while explicitly choosing Approach A: retain direct provider dependencies for Go `nix_cgo_deps` and make them fully consistent with the canonical TypeScript naming helpers used by generators and auto‑map. Each PR is intentionally small, independently mergeable, and ships with tests and docs updates.

---

### PR 1 — Align Go nixpkgs provider naming with TS helper

Scope

- Update `go/defs.bzl` to generate provider names for `nix_cgo_deps` using the same rules as `build-tools/tools/lib/providers.ts` (`normalizeNixAttr` + `providerNameForNixAttr`).
- Remove the Starlark‑local naming differences (e.g., dropping `pkgs.` prefix) to ensure names match the TS path and avoid duplicate stamp files.

Detailed Design

- Current behavior (Starlark): `_nixpkg_provider_for("pkgs.zlib") -> //third_party/providers:nix_pkgs_pkgs_zlib` (duplicated `pkgs_`).
- Canonical behavior (TS): `providerNameForNixAttr("pkgs.zlib") -> nix_pkgs_zlib`.
- Change Starlark logic to:
  - Preserve `pkgs.` prefix when forming the tail.
  - Normalize to lowercase and replace non‑alnum with `_`.
  - Final format: `//third_party/providers:nix_<tail>` where `<tail>` corresponds to `normalizeNixAttr(attr).replace(/[^a-z0-9]+/g, "_")`.
- Do not alter the labels‑only path; this PR is naming parity only.

Acceptance Criteria

- For a matrix of attrs (`pkgs.zlib`, `pkgs.openssl`, `pkgs.gnome.glib`), Go macro emits provider names exactly matching TS helper output.
- No duplicate stamps appear in `third_party/providers/stamps/` for the matrix (i.e., no both `nix_pkgs_zlib.stamp` and `nix_pkgs_pkgs_zlib.stamp`).
- Builds and tests pass unchanged.

Risks

- Downstream references to previous provider target names (if any were hand‑typed) may need to be updated. We expect only generated references; risk is low.

Consequence if not implemented

- Ongoing divergence between Starlark and TS naming; duplicate stamps and potential provider name collisions.

---

### PR 2 — Node provider sync idempotent writes

Scope

- Update `build-tools/tools/buck/providers/node.ts` to use `writeIfChanged` when writing `TARGETS.node.auto`.
- Ensure empty/no‑op outputs are stable and avoid unnecessary diffs.

Detailed Design

- Replace `fs.outputFile(OUT_FILE, header + "\n" + entries.join("\n") + "\n")` with `writeIfChanged(OUT_FILE, data)`.
- Keep content identical; only change the write semantics.

Acceptance Criteria

- Running the Node provider sync twice without changes produces no file modifications on the second run.
- CI diffs stabilize (no spurious updates when content is unchanged).

Risks

- None, provided content is unchanged.

Consequence if not implemented

- Occasional needless diffs/churn in generated files.

---

### PR 3 — Sanitizer parity guard (Starlark ↔ Nix)

Scope

- Add a small test to assert `_sanitize_to_bin_name` (Starlark) matches the canonical `sanitizeName` used in Nix templates.

Detailed Design

- Use `cpp_sanitize_probe` to surface Starlark sanitizer outputs for a table of labels containing `//`, `:`, `/`, spaces, mixed case, and punctuation.
- A zx test computes Nix `sanitizeName` for the same inputs and compares results.
- Adjust `_sanitize_to_bin_name` only if parity fails; otherwise no code change beyond the test.

Acceptance Criteria

- Parity test passes across the matrix.
- No behavior changes to builds.

Risks

- Very low; changes only if parity is off, in which case we fix the drift.

Consequence if not implemented

- Potentially subtle mismatches in artifact naming between Buck macros and Nix derivations.

---

### PR 4 — Provider generator IO consistency

Scope

- Ensure all provider generators (Go, C++, Node) use `writeIfChanged` and shared helpers (`stableUnique`, `writeStamp`).

Detailed Design

- Audit `build-tools/tools/buck/providers/*.ts`:
  - Confirm Go/C++ already use `writeIfChanged` and `writeStamp` (`fs-helpers`).
  - Switch Node to `writeIfChanged` (covered by PR 2).
  - Confirm `stableUnique` is used where deduping is needed (C++ path already imports it).

Acceptance Criteria

- All provider generators produce byte‑stable outputs and avoid re‑writes on no‑op runs.

Risks

- None; no behavior change, only IO semantics.

Consequence if not implemented

- Inconsistent behavior across generators, risk of noisy diffs.

---

### PR 5 — Docs refresh: provider naming and glue freshness

Scope

- Update documentation to reflect the aligned provider naming for Go, idempotent writes, and the standard glue freshness guard.

Detailed Design

- Update relevant sections:
  - Provider naming source of truth: `build-tools/tools/lib/providers.ts`.
  - Go macros keep direct provider deps for `nix_cgo_deps`, but naming is now canonical.
  - Prebuild guard: missing or stale `auto_map.bzl` and provider files fails fast.
- Ensure examples use provider names consistent with the canonical helper (retain `pkgs.` prefix in names).

Acceptance Criteria

- Handbook/design snippets compile cleanly and reflect the updated naming.
- Onboarding flow shows one consistent naming scheme across Go/C++/Node.

Risks

- None; doc‑only changes.

Consequence if not implemented

- Documentation lags behind implementation; onboarding friction persists.

---

### PR 6 — Optional: Compatibility map for historical provider names

Scope

- If any repositories or scripts still reference old Go provider names (without `pkgs.`), provide a temporary mapping to avoid breakage while migrating references.

Detailed Design

- Generate a small Starlark alias file (optional) mapping old target names to new ones via `alias` rules in `third_party/providers/TARGETS` (only if we find real consumers).
- Publish a short migration note and a lint to detect legacy names.

Acceptance Criteria

- Repos with legacy references build successfully during the migration window.
- Lint flags remaining uses; teams can update at their pace.

Risks

- Slight maintenance overhead during transition; remove once usage drops to zero.

Consequence if not implemented

- Any stray references to old names would fail after PR 1; teams must fix immediately.

---

## Program‑level Outcomes

- Go `nix_cgo_deps` direct provider deps are retained but fully aligned with canonical naming.
- All generators adopt idempotent write patterns; diffs remain quiet on no‑ops.
- Sanitizer parity is verified and guarded with a test.
- Docs reflect consistent naming and the standard glue freshness expectations.

## Rollout & Verification

- Merge PRs in order. After PR 1, run full provider sync and auto‑map generation locally, then the full test suite with coverage and timeouts.
- Verify stamps and provider files show only canonical names and no duplicates.
- Ensure CI prebuild guard passes and that no stale glue errors are reported.
