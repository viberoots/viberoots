## Python Freshness & Guard Parity — Implementation Plan

## PR‑1: Include uv.lock in prebuild freshness inputs

### Description

Ensure the prebuild guard’s freshness detection accounts for Python importer changes by treating any uv.lock edit as a “glue may be stale” signal. This makes Python parity consistent with Node’s pnpm-lock.yaml handling.

### Scope & Changes

- tools/buck/prebuild/scan.ts
  - Add uv.lock to the input filters in both git-based discovery and the filesystem fallback walker.
  - No changes to outputs listing; presence/coverage logic remains in presence.ts and coverage.ts.
  - Tests: add tools/tests/prebuild/freshness.uv-lock.stale-triggers-fix.test.ts
    - Temp repo with apps/pytool/uv.lock and valid glue → touch uv.lock → guard marks stale and auto-fixes locally.
  - Docs: update docs/python-wasm-wasi.md
    - Add a “Prebuild guard” subsection noting freshness inputs include uv.lock and describing the local auto-fix vs CI-fail behavior.

### Acceptance Criteria

- Touching apps/_/uv.lock or libs/_/uv.lock leads the guard to:
  - In CI: fail with a “glue is stale” error unless glue is regenerated beforehand.
  - Locally: auto-fix (run export-graph → sync-providers → gen-auto-map) and then pass.
- New freshness test passes on Linux/macOS.
- Documentation updated and committed alongside the code change.

### Risks

Low. Only expands the freshness inputs list; behavior mirrors existing pnpm-lock.yaml handling.

### Consequence of Not Implementing

Changes to uv.lock may not trigger glue regeneration, risking mismatched providers/auto_map.

### Downsides for Implementing

None material beyond a slightly larger input set for freshness checks.

### Recommendation

Implement.

## PR‑2: Provider coverage fallback across TARGETS.\*.auto (including Python)

### Description

Generalize provider coverage fallback to read all TARGETS.\*.auto files (Python and Node), not just TARGETS.node.auto, when provider_index is missing or stale. This prevents false “missing provider” reports for Python.

### Scope & Changes

- tools/buck/prebuild/coverage.ts
  - When provider*index.json lacks an entry for an expected importer provider (lf*_), search across every file matching third_party/providers/TARGETS._.auto for a matching rule stanza.
  - Keep the current fast path via provider_index; only use the autos scan as a fallback.
  - Tests: add tools/tests/prebuild/coverage.python-provider-fallback.test.ts
    - With provider_index absent/stale but TARGETS.python.auto present and correct, coverage reports success for Python importers.
  - Docs: update build-system-design.md
    - Brief note in the “Prebuild guard / provider coverage” area that fallback checks scan TARGETS.\*.auto (including Python), with provider_index as the primary source.

### Acceptance Criteria

- With provider_index absent/stale but TARGETS.python.auto present and correct, coverage check does not report a provider miss for Python targets.
- Node behavior unchanged; still supported by the generalized scan.
- New coverage fallback test passes on Linux/macOS.
- Documentation updated and committed alongside the code change.

### Risks

Low. Read-only, deterministic string lookup across a small set of files.

### Consequence of Not Implementing

Spurious coverage failures when provider_index lags behind autos for Python importers.

### Downsides for Implementing

Negligible extra IO to read autos files in fallback scenarios.

### Recommendation

Implement.

## PR‑3: Explicit detection of missing Python importer providers

### Description

Add a precise diagnostic for Python importers missing corresponding providers (analogous to Node). Improves error locality and guard auto-fix clarity.

### Scope & Changes

- tools/buck/prebuild/presence.ts
  - Implement findMissingPythonImporterProviders(): discover \*\*/uv.lock via git (fallback: FS), compute importer label (dirname or "."), derive expected provider via providerNameForImporter, and check for a matching python_importer_deps in TARGETS.python.auto.
- tools/buck/prebuild/main.ts
  - Integrate the Python check alongside Node’s; in CI, fail with a targeted error; locally, run auto-fix and re-check.
  - Tests: update tools/tests/prebuild/guard.python-importers.presence-and-autofix.test.ts
    - Assert precise missing-provider diagnostics for Python and successful local auto-fix.
  - Docs: update docs/python-wasm-wasi.md
    - Extend the “Prebuild guard” subsection with a short “Missing provider diagnostics and auto-fix” paragraph for Python importers.

### Acceptance Criteria

- If a uv.lock exists but TARGETS.python.auto lacks the importer’s provider rule, guard:
  - In CI: fails with “missing Python importer provider…” and the expected provider name.
  - Locally: auto-fixes by regenerating providers and passes on re-run.
- Updated guard test passes on Linux/macOS.
- Documentation updated and committed alongside the code change.

### Risks

Low. Mirrors existing Node logic with Python-specific inputs/outputs.

### Consequence of Not Implementing

Guard only detects file presence, not per-importer omissions; errors are less actionable.

### Downsides for Implementing

Minimal code addition and one re-check cycle after auto-fix.

### Recommendation

Implement.

## Rollout & Sequencing

1. PR‑1 (uv.lock freshness): smallest change; immediately improves guard signal (with tests/docs).
2. PR‑2 (coverage fallback): broadens coverage logic safely (with tests/docs).
3. PR‑3 (missing Python provider detection): sharper diagnostics + auto-fix hook (with tests/docs).

All PRs are small, independent, and reversible.

## Verification & Backout Strategy

- PR‑1: Touch uv.lock; expect stale detection. Backout: revert input filter line.
- PR‑2: Remove provider_index.json; keep TARGETS.python.auto; expect coverage OK. Backout: scope fallback to Node-only.
- PR‑3: Remove Python provider entry; expect missing-provider error in CI, local auto-fix. Backout: delete the Python presence helper and its call site.

## Summary of Expected Impact

- Deterministic, accurate guard behavior for Python importers on freshness and presence.
- Fewer false alarms via generalized coverage fallback across autos.
- Faster diagnosis with precise “missing Python importer provider” messages.
- Clear documentation of Python parity with Go/Node and the prebuild guard’s role.
