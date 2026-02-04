# Quad Alignment Plan - Close Remaining Cross-Language Gaps (CPP / Go / PNPM / Python) - Part 45

#

#

# This plan targets the remaining gaps identified in the current repo state.

#

# Each PR includes code, tests, and documentation updates together.

#

# Scope: Python binary patch invalidation wiring, and clearer diagnostic guidance for importer-local

# patch invalidation.

#

# Non-goals: no standalone docs-only or tests-only PRs.

#

## PR-1: Replace python_binary patch workaround with srcsless wiring

#

### Description

#

I will remove the custom genrule hash workaround in `nix_python_binary` and route importer-local
patch invalidation through the shared `srcsless_rule` wiring path. This keeps the workaround
inside `//lang` wiring helpers and aligns Python binary wiring with the stated contract.

#

### Scope & Changes

#

- Update `python/defs.bzl`:
  - Remove the `genrule` and helper `python_library` used for patch hashing in `nix_python_binary`.
  - Call `prepare_language_wiring(...)` with `wiring = "srcsless_rule"` for `nix_python_binary`.
  - Keep label stamping and provider edge realization behavior unchanged.
- If needed, adjust `lang/importer_wiring.bzl` or `lang/defs_common.bzl` so the `srcsless_rule`
  path carries importer-local patch inputs as action inputs for `python_binary` consistently.

#

### Tests (in this PR)

#

- Extend the Python importer patch wiring test to cover `nix_python_binary`.
- Add a probe that asserts importer-local patch inputs are realized for `python_binary` without
  relying on the macro-level genrule workaround.

#

### Docs (in this PR)

#

- Update `abstractions.md` to list `nix_python_binary` under the `srcsless_rule` wiring path and
  remove references to the macro-level patch hashing workaround.

#

### Acceptance Criteria

#

- `nix_python_binary` no longer defines a custom genrule or helper `python_library` for patch hashing.
- Importer-local patch invalidation for Python binaries is preserved via shared wiring.
- Tests cover the binary wiring path and pass.

#

### Risks

#

Patch inputs might not be attached as action inputs for `python_binary`, causing missed invalidation.

#

### Mitigation

#

Add a focused cquery-based test that confirms importer-local patches appear as real action inputs
for a Python binary.

#

### Consequence of Not Implementing

#

Python binary patch invalidation remains a macro-level workaround and drifts from the shared
cross-language wiring contract.

#

### Downsides for Implementing

#

Small refactor and test adjustments for Python binary wiring.

#

### Recommendation

#

Implement.

#

---

#

## PR-2: Make importer-local patch invalidation guidance more explicit

#

### Description

#

I will make the diagnostic guidance for importer-local patch invalidation more explicit in
`prebuild-guard` output. This reduces confusion about provider `patch_paths` by pointing to the
canonical invalidation report for per-target details.

#

### Scope & Changes

#

- Update `build-tools/tools/buck/prebuild-guard.ts` to print a short line that points to
  `build-tools/tools/buck/invalidation-report.txt` when importer-local patch models are detected.
- Keep the existing one-liner patch scope messages unchanged.

#

### Tests (in this PR)

#

- Update `build-tools/tools/tests/prebuild/guard.patch-invalidation.one-liners.test.ts` to assert the new
  guidance line is present when importer-local patches are enabled.

#

### Docs (in this PR)

#

- Update the diagnostics section in `abstractions.md` to mention the new prebuild-guard guidance
  line and point to `build-tools/tools/buck/invalidation-report.txt` as the canonical per-target source.

#

### Acceptance Criteria

#

- Prebuild guard output includes a clear pointer to `build-tools/tools/buck/invalidation-report.txt`.
- Existing patch scope one-liners remain unchanged.
- Tests cover the new output and pass.

#

### Risks

#

Minor output churn could affect downstream tooling that parses guard output.

#

### Mitigation

#

Keep the new line additive and stable, and update only the tests that assert guard output.

#

### Consequence of Not Implementing

#

Importer-local invalidation remains easy to misread from provider outputs alone.

#

### Downsides for Implementing

#

Small output change and a test update.

#

### Recommendation

#

Implement.
