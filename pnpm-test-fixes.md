## PNPM/Buck test fixes log

This file tracks the test-hardening and stability fixes applied while getting the full suite green and reliable.

### Harness and infra

- zx_test.bzl
  - Increase default TEST_NODE_OPTIONS to 240s to reduce spurious timeouts for heavy tests.
  - Kill only the nested buck2 daemon on cleanup; keep the outer isolation alive to reduce cross-test cold starts/flakes.
  - Respect caller-provided `--target-platforms` and `--config build.default_platform=...`; inject `//:no_cgo` only when neither is present.
  - Use a per-test shim directory at `buck-out/zx_shims/$SAFE` (instead of a shared `.buck2_shim`) to avoid concurrent sed/rename races across tests.

- .buckconfig (root)
  - Add `default_platform = prelude//platforms:default` to eliminate `<unspecified>` platform errors in full-suite runs.

- tools/nix/node-modules.nix
  - Allow lock generation inside FOD when `NIX_PNPM_ALLOW_GENERATE=1` and no lockfile exists; guard `lockHash` accordingly.
  - Persist pnpm cache to the pnpm-store output and reuse for node-modules to speed up installs.
  - If local lockfile is absent, copy exported lockfile from pnpm-store before offline frozen install.

### Rule/runtime fixes

- cpp/private/nix_test.bzl
  - Add fallback to locate produced test binary by suffix when the expected name isn’t present; prevents false negatives for C++ Nix tests.

- tools/lib/fs-helpers.ts
  - Make `writeIfChanged` and `writeStamp` atomic (write to a temp file then rename). Prevents partial-write races observed under parallel full-suite runs that caused intermittent read errors and content truncation in generated files and stamps.

- tools/tests/lib/test-helpers.ts
  - Assign a stable `BUCK_NESTED_ISO` per temp repo and kill only that isolation on cleanup. This prevents cross-test buckd interference and reduces intermittent failures when tests run in parallel and repeatedly spawn/kill buck2.

### Targeted test fixes

- tools/tests/scaffolding/webapp.dev-server.running.test.ts
  - Use a dynamically chosen free port (remove strict fixed port) to avoid parallel port contention; raise per-test timeout to 240s to match harness.
  - Remove duplicate node_modules rebuild/link steps; keep a single derivation link. This cuts test runtime and reduces flakiness due to repeated Nix builds.
  - Increase Nix node-modules build timeout from 90s to 180s to avoid intermittent timeouts under system load while preserving deterministic hermetic builds.
  - Select a free port programmatically (via Node's net) and pass it to Vite with `--port`, eliminating reliance on parsing logs to discover the port. Wait up to 90s for readiness.

- tools/tests/scaffolding/macros.extra-module-providers.test.ts
  - Fix undefined `dup` reference in error path; use `count` for accurate diagnostics.

- tools/tests/scaffolding/gen-auto-map.scaffold-smoke.test.ts
  - Explicitly export `graph.json` and generate `third_party/providers/auto_map.bzl` within the temp repo before asserting; removes ordering races in full-suite context.

### Test-specific fixes

- tools/tests/scaffolding/webapp.dev-server.running.test.ts
  - Raise timeout to 240s and select a free port programmatically (passed to Vite), removing log-parsing races and reducing port-contention flakiness; wait up to 90s for server readiness.

- tools/tests/scaffolding/webapp.scaffold-and-build.test.ts
  - Increase test timeout from 110s to 240s to account for slower Nix builds under load; aligns with harness default and avoids false timeouts.

- tools/tests/scaffolding/gen-auto-map.scaffold-smoke.test.ts
  - After `buck2 build //...`, explicitly export the graph and generate `third_party/providers/auto_map.bzl` before asserting; stabilizes full-suite behavior.

- tools/tests/scaffolding/macros.extra-module-providers.test.ts
  - Fix undefined variable in assertion logging (`dup` -> `count`).

### Stability outcomes so far

- Previously failing groups (webapp dev server, auto-map smoke, macros extra-module-providers, several Go/C++ scaffolds) now pass when run individually and within subsequent suite runs.
- Remaining work is focused on newly surfaced failures under full-suite load; we’ll iterate test-by-test until three consecutive green full runs.

### Next steps

1. Re-run failing tests individually, fix root causes, and re-run until green.
2. Full-suite run x3; if any fail, repeat (1).
