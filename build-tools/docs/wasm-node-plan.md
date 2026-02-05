## Wasm Node Linking Plan

This plan implements the design in `build-tools/docs/wasm-node-linking.md`.

Each PR includes code, tests, and documentation updates together.

Scope: add asset staging and inline Wasm bundling for Node and webapp templates, update bundling
behavior, and update scaffolds so all usage examples are supported.

Non-goals: no standalone docs-only or tests-only PRs.

Completion criteria: all usage examples in `build-tools/docs/wasm-node-linking.md` work with the
scaffolded templates and the bundling paths.

---

## PR-1: Add `node_asset_stage` for runtime Wasm assets

### Description

I will add a `node_asset_stage` macro that wraps an existing app output and copies explicit Wasm
artifacts into the output directory. I will update templates and docs to use the staging rule for
runtime Wasm files.

### Scope & Changes

- Add `node_asset_stage` to `build-tools/node/defs.bzl`:
  - Accept `app`, `assets`, and `out`.
  - Copy the app output directory to `$OUT`.
  - Copy each asset to `$OUT/<dest>`, with a clear error if a destination is not a file.
- Update the `wasm-linking-app` scaffold template to use the staging rule for `top.wasm`.
- Update `build-tools/docs/wasm-node-linking.md` with the final macro name and usage.
- Update `build-tools/docs/scaffolding.md` with a short staging example.

### Tests (in this PR)

- Add a `build-tools/tools/tests/` fixture that:
  - Builds a tiny webapp with `node_webapp` and `node_asset_stage`.
  - Asserts the staged `.wasm` exists in the output and is not empty.
  - Uses a minimal Wasm producer target from the existing Go TinyGo path.

### Docs (in this PR)

- Update `build-tools/docs/wasm-node-linking.md` to document the finalized macro signature.
- Update `build-tools/docs/scaffolding.md` to show the staging pattern.

### Acceptance Criteria

- `node_asset_stage` is available and used by the `wasm-linking-app` scaffold.
- A staged `.wasm` file appears in the output for the test fixture.
- The staging example in the docs matches the real macro.

### Risks

Staging copies could mask output paths if a destination conflicts with a directory.

### Mitigation

Fail with a clear error if a destination exists and is not a file.

### Consequence of Not Implementing

Scaffolded webapps still fail to load Wasm at runtime without manual edits.

### Downsides for Implementing

One new macro to maintain.

### Recommendation

Implement.

---

## PR-2: Add `node_wasm_inline_module` for inline bundling

### Description

I will add a macro that generates a small JS module which embeds Wasm bytes and exposes a helper to
return a `Uint8Array`. This supports client-side and server-side bundling without Vite plugins.

### Scope & Changes

- Add `node_wasm_inline_module` to `build-tools/node/defs.bzl`:
  - Accept a single Wasm `src` label and output a JS module.
  - Emit `wasmBytesBase64` and `wasmBytes()` helper.
- Add a small codegen helper under `build-tools/tools/node/` to generate the module.
- Add a minimal template under `build-tools/tools/scaffolding/` for a `*-wasm-inline` package.
- Update `build-tools/docs/wasm-node-linking.md` examples to use the final macro name and output path.

### Tests (in this PR)

- Add a test fixture that:
  - Generates an inline module from a known Wasm file.
  - Runs a small Node script that imports the module and instantiates the Wasm in memory.
  - Asserts a stable exported function result.

### Docs (in this PR)

- Update `build-tools/docs/wasm-node-linking.md` with the inline module contract and example output.

### Acceptance Criteria

- `node_wasm_inline_module` produces a working JS module for a `.wasm` file.
- The inline module test instantiates and calls the Wasm export successfully.

### Risks

Large Wasm files could create large JS bundles.

### Mitigation

Document that inline bundling is intended for smaller Wasm artifacts.

### Consequence of Not Implementing

Inline bundling is not possible without custom Vite plugins or ad-hoc build steps.

### Downsides for Implementing

Adds a small codegen path to maintain.

### Recommendation

Implement.

---

## PR-3: Ensure `nix_node_cli_bin(bundle=True)` inlines workspace deps

### Description

I will verify and adjust the bundling path for `nix_node_cli_bin(bundle=True)` so it does not
externalize workspace dependencies. This is required for single-file server or CLI bundles that
embed Wasm bytes via the inline module.

### Scope & Changes

- Inspect the current bundler config and update it to inline workspace deps.
- Add a fixture that builds a bundled CLI which depends on a `node_wasm_inline_module`.
- Update `build-tools/docs/wasm-node-linking.md` to note the confirmed bundler behavior.

### Tests (in this PR)

- Add a bundle test that:
  - Builds a CLI entrypoint that imports the inline module.
  - Runs the bundled output and validates a Wasm export call.

### Docs (in this PR)

- Update `build-tools/docs/wasm-node-linking.md` to remove the warning and document the verified bundling behavior.

### Acceptance Criteria

- Bundled CLI output runs without requiring external workspace packages.
- The Wasm inline module is included in the single-file output.

### Risks

Inlining all workspace deps may increase bundle size for large CLIs.

### Mitigation

Keep the change scoped to the bundle path and document the trade-off.

### Consequence of Not Implementing

Single-file Node bundles cannot embed Wasm bytes reliably.

### Downsides for Implementing

May increase bundle sizes in some cases.

### Recommendation

Implement.

---

## PR-4: Update scaffolds for staged and inline Wasm options

### Description

I will update templates so the standard webapp and Node app scaffolds include both staged and inline
options for Wasm, and they align with the new macros.

### Scope & Changes

- Update `build-tools/tools/scaffolding/templates/ts/wasm-linking-app/`:
  - Add the staging rule for `top.wasm`.
  - Add an inline module package and show a bundle usage example.
- Update any Node or TypeScript app templates that target a bundled CLI to include the inline module pattern.
- Update `build-tools/docs/scaffolding.md` with examples for staged and inline options.

### Tests (in this PR)

- Add a scaffold test that:
  - Generates the `wasm-linking-app` template.
  - Builds the staged output and verifies the `.wasm` file exists.
  - Builds the inline bundle example and runs it to confirm Wasm instantiation.

### Docs (in this PR)

- Update `build-tools/docs/scaffolding.md` and cross-link to `build-tools/docs/wasm-node-linking.md`.

### Acceptance Criteria

- The scaffolded webapp supports both staged `.wasm` and inline bundling.
- The scaffolded bundled CLI example runs with embedded Wasm bytes.
- All usage examples in `build-tools/docs/wasm-node-linking.md` are supported.

### Risks

Template changes can drift from actual macro behavior.

### Mitigation

Use scaffold tests that build and run the generated outputs.

### Consequence of Not Implementing

The design exists but templates remain manual and inconsistent.

### Downsides for Implementing

More scaffold maintenance and test coverage.

### Recommendation

Implement.
