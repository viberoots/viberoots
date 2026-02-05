### PNPM Parity PR — Node CLI Bundling + Provider Label Parity (lang:node)

This PR proposal closes the remaining PNPM/Node gaps identified in the parity review:

- Add a proper Nix-backed bundling path for Node CLI binaries (replace stub).
- Stamp Node provider targets with a `lang:node` label (parity with C++ providers’ `lang:cpp`).

The design preserves the current model: importer‑scoped providers, validate‑only exporter for Node, and deterministic glue generation.

### Goals

- Replace the current heredoc “bundle” stub in `nix_node_cli_bin(...)` with a hermetic Nix build that emits a single-file shebanged bundle.
- Keep importer‑scoped invalidation intact; do not alter auto-map semantics.
- Improve observability by ensuring Node providers carry `lang:node` (parity with `defs_cpp.bzl` labelling).

### Non‑Goals

- No change to the validate‑only stance of the Node exporter adapter.
- No change to importer‑scoped provider keying (`lockfile:<path>#<importer>`).
- No change to Node test runner semantics beyond what bundling requires.

### Proposed Changes (Code-Level Plan)

- Node CLI bundling (macro + shim)
  - File: `build-tools/node/defs.bzl`
    - In `nix_node_cli_bin(...)`, when `bundle = True`:
      - Require `importer` (if not provided, infer from a present `lockfile:<path>#<importer>` label; otherwise fail with a clear message).
      - Replace the heredoc “stub” with a `genrule` command that invokes the zx shim to build the Nix bundle and copy it to `$OUT`:
        - Command shape (illustrative):
          - `node build-tools/tools/buck/node-cli-bundle.ts --importer <importer> --name <name> --out $OUT`
        - Inputs:
          - Continue to include importer‑local Node patches in `srcs` (already handled by `nix_node_gen`).
          - Include the CLI entry (or a minimal representative file, e.g. `src/index.ts`) in `srcs` so Buck invalidates on code changes within the importer.
        - Labels:
          - Ensure `stamp_labels(..., "node", "bin")` is applied (already done by `nix_node_gen` path), and keep the single importer‑scoped lockfile label enforcement.
  - File: `build-tools/tools/buck/node-cli-bundle.ts`
    - Do not accept an `--entry` argument. Bundled mode uses a fixed entry (`src/index.ts`) in the flake.
    - Behavior:
      - Build `.#node-cli.<sanitize(importer)>`.
      - Copy `<name>.bundle.js` from the Nix out path to `$OUT` and `chmod +x` it.
      - Emit actionable error messages when the attribute or bundle is missing.
  - File: `flake.nix`
    - Ensure the `packages.<system>.node-cli.<sanitize(importer)>` derivation produces `<name>.bundle.js`.
    - The derivation should:
      - Snapshot the repo, `cd <importer>`, and run a pure esbuild step to generate the single‑file bundle with `#!/usr/bin/env node` banner.
      - Use the pinned Node/esbuild inputs from the flake (already present).
    - Optional future extension (not required for this PR): accept an entry override via environment or a simple attribute parameter if you want the macro’s `entry` to flow through. For now, rely on the current default entry convention used in the derivation.

- Provider label parity
  - File: `third_party/providers/defs_node.bzl`
    - Stamp Node importer provider targets with a `lang:node` label to match the C++ provider’s `lang:cpp` labelling.
    - Minimal change: add `labels = ["lang:node"]` to the `genrule(...)` used by `node_importer_deps(...)`.
    - No behavior change to mapping or invalidation; this is purely for classification/observability in cquery/exporter diagnostics.

### Tests

- Scaffolding + bundling
  - Update `build-tools/tools/tests/scaffolding/node-cli.scaffold-and-build.shim-and-bundle.test.ts`:
    - Keep the existing shim test (non‑bundled).
    - For the bundling test:
      - After `buck2 build //projects/apps/demo:demo` in bundle mode, add a run step to execute the built artifact and assert basic output (e.g., “usage” text or `--help` route). This validates the bundle is actually produced by Nix and is runnable.

- Provider label presence
  - New test (example filename): `build-tools/tools/tests/node/providers/node-provider-lang-label.test.ts`:
    - Scenario: generate Node providers for a repo with a lockfile under `apps/demo`.
    - `buck2 cquery` the provider target and assert that `labels` contains `lang:node` (e.g., via `--output-attributes labels` and JSON parsing).
    - Determinism: re-run provider sync and confirm identical output.

- No regressions in Node adapter validation
  - Ensure existing validation tests continue to pass:
    - missing/multiple/malformed importer labels,
    - missing `kind:*` labels,
    - lockfile importer mismatches.

### Acceptance Criteria

- `nix_node_cli_bin(bundle=True)` builds a shebanged single-file bundle via Nix and places it at `$OUT`. No heredoc stub remains.
- The bundled artifact is executable and prints a help string in the scaffold test.
- Node provider targets (generated) carry `lang:node` in their `labels`.
- No changes to provider keying or auto-map behavior; importer‑scoped invalidation remains intact.
- All tests pass locally and in CI.

### Migration / Rollout

- Backward compatibility
  - Existing non‑bundle CLI targets continue to work unchanged.
  - Bundled CLI targets already specifying `bundle = True` and `importer = "<dir>"` will automatically switch to the Nix-backed bundling path without TARGETS edits.

- Scaffolding
  - Optionally update the Node CLI scaffold to include a commented `bundle = True` hint (remains off by default).
  - Ensure scaffolded TARGETS carry a single importer‑scoped lockfile label.

- CI
  - No pipeline changes required. Bundling occurs inside the Buck rule via the shim (which calls `nix build` for the flake attribute). Prebuild guard and provider sync stages are unaffected.

### Risks and Mitigations

- Build attribute naming must match the shim (`node-cli.<sanitize(importer)>`) and Nix output (`<name>.bundle.js`).
  - Mitigation: keep naming consistent; add clear failure messages in `node-cli-bundle.ts` for missing attributes or output files.

- Invalidation correctness for CLI bundles
  - The macro must include at least the CLI entry (or a canonical `src/index.ts`) in `srcs` so Buck sees source edits within the importer and re-runs the genrule. The Nix derivation consumes the importer’s sources; provider edges and importer-local patches are already included.

### Estimated Diff Surfaces

- `build-tools/node/defs.bzl`: adjust `nix_node_cli_bin(bundle=True)` to call the bundling shim; maintain label stamping and lockfile label enforcement.
- `build-tools/tools/buck/node-cli-bundle.ts`: remove `--entry`; retain importer/name/out behavior.
- `third_party/providers/defs_node.bzl`: add `labels = ["lang:node"]` to `node_importer_deps(...)` genrule.
- `build-tools/tools/tests/scaffolding/node-cli.scaffold-and-build.shim-and-bundle.test.ts`: extend the bundle test to run the built artifact.
- New test: `build-tools/tools/tests/node/providers/node-provider-lang-label.test.ts`.

### Summary

- Bundling gap: closed by routing `nix_node_cli_bin(bundle=True)` through a zx shim that builds `.#node-cli.<importer>` and copies `<name>.bundle.js`.
- Provider parity: `lang:node` label added to Node importer providers for classification parity with C++.
- No behavior changes to the Node exporter’s validate‑only model or provider mapping semantics. The changes improve operability and parity while preserving existing design principles.
