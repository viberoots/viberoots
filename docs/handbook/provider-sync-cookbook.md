### Provider sync cookbook

Provider sync maps patch files under `patches/<lang>` to Buck providers used in builds. Keep it deterministic and idempotent.

- **Patch filenames**: `<module path with / → __>@<version>.patch` (dots are preserved).
- **Sync command**: `node tools/buck/sync-providers.ts --out third_party/providers/TARGETS.auto`.
- **Idempotency**: re-running should not change output when inputs are unchanged.
- **Tests**: create a single patch using fixtures and assert stable provider name and paths.

Useful helpers:

- `providerNameForModuleKey("github.com/stretchr/testify", "v1.9.0")` to compute labels.
- `tools/tests/lib/fixtures/go.ts: ensurePatch()` to create a patch with correct filename.
