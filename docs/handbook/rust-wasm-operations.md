# Rust WebAssembly Operations

I use this guide to build, stage, execute, and deploy Rust WebAssembly artifacts. The public
Starlark attributes are documented in [Starlark API](starlark-api.md); this page owns the
end-to-end operator path.

## Browser and webapp path

Declare the generated browser package and stage the exact background module into the webapp:

```python
load("@viberoots//build-tools/rust:defs.bzl", "rust_wasm_browser_package")
load("@viberoots//build-tools/node:defs.bzl", "node_asset_stage")

rust_wasm_browser_package(
    name = "math_browser",
    crate = "math",
    srcs = ["src/lib.rs"],
    features = ["browser"],
    exported_functions = ["answer"],
)

node_asset_stage(
    name = "webapp",
    app = ":webapp_raw",
    assets = [{
        "src": ":math_browser",
        "artifact_name": "math_bg.wasm",
        "dest": "client/wasm/math_bg.wasm",
    }],
)
```

Run `b //path/to/package:webapp`, serve the resulting directory, and load the staged URL from the
client. Do not copy a guessed `*.wasm`: `artifact_name` makes ambiguity fail during the build.
The producer's `pkg/` directory also contains its ESM loader, TypeScript declarations,
`package.json`, and `browser-harness.html`.

The acceptance fixture launches the Firefox executable named in
`share/viberoots-rust/wasm-manifest.json`, loads `browser-harness.html`, invokes an exported
function, and requires its reported result. This is the hermetic browser-engine check; a Node
import is useful additional coverage but is not browser evidence.

For SSR, CLI, and service layouts, use the reviewed destinations in
[Wasm Assets for Node and Webapp Templates](../../build-tools/docs/wasm-node-linking.md). The
generated `asset-manifest.json` is the staging authority for downstream packaging.

## Component-model path

Keep the WIT file package-local and select its world explicitly:

```python
load("@viberoots//build-tools/rust:defs.bzl", "rust_wasm_component")

rust_wasm_component(
    name = "calculator_component",
    crate = "calculator",
    srcs = ["src/lib.rs"],
    wit = "wit/calculator.wit",
    wit_world = "calculator",
    exported_functions = ["add"],
)
```

Use `wasm_abi = "wasi"` with `component_adapter = "wasi-preview1-reactor"` only for a preview1
reactor. Bare components use `component_adapter = "none"`. The build validates the component and
publishes both `lib/<crate>.component.wasm` and normalized component WIT. To execute the same
pinned runtime used by the build, read `tools.wasmtime` from
`share/viberoots-rust/wasm-manifest.json` and run:

```bash
"$WASMTIME_ROOT/bin/wasmtime" run --invoke 'add(2, 3)' path/to/calculator.component.wasm
```

Do not resolve `wasmtime` from `PATH`: the manifest path and adapter identity are part of artifact
provenance.

## Deployment consumers

A deployment consumes the Node stage, not an independently rediscovered producer file.

1. Build the staged app or service target.
2. Inspect its `asset-manifest.json`; confirm the expected destination and content SHA-256.
   `resolvedSource` is the portable Buck/content identity of the staged input. For Rust WASM
   family outputs, also confirm `producer.storePath`, `producer.outputIdentity`, and
   `producer.sourceRevision`; these are transported from the immutable Nix producer manifest
   rather than inferred from the Buck copy path.
3. Run `deploy --deployment <label> --validate-only`.
4. Deploy through the same label after validation succeeds.

Static deployments copy client destinations. SSR and service deployments copy both their declared
client and server destinations. Component deployments admit the exact component blob and its
producer identity; they must not rebuild a component or adapter during packaging.

## Remote-readiness boundary

Rust WASM targets labeled `remote:ready` must declare the reviewed source snapshot,
materialization manifest, artifact contract, tool closure, and remote-builder smoke evidence. The
acceptance fixture runs bare and WASI static libraries, a browser package, and bare and WASI
components through their real Buck remote-ready action categories under hostile host tool
resolution. It then poisons the ambient owner source, replays the selected builds from an immutable
execution snapshot, and executes or inspects the replayed outputs.

This is local remote-readiness conformance evidence. It proves the action shape is portable and
does not silently consume host Cargo, Rust, Nix, Wasmtime, wasm-tools, or ambient owner source. It
does not claim execution on a production remote worker; production worker admission and external
platform evidence remain the PR-12 environment gate.

## Troubleshooting

- `zero or multiple *.wasm matches`: set `artifact_name` to the producer's exact public filename.
- Browser page never reports a result: serve `.wasm` as `application/wasm`, inspect the generated
  ESM loader, and verify the requested probe is in `exported_functions`.
- `unknown WASM probe`: the query named a binding the package does not export.
- ABI/target/libc incompatibility: every static edge must use the same `bare` or `wasi` ABI. WASI
  uses `wasm32-wasip1` and `wasi-libc`; do not mix it with a bare archive.
- Component adapter rejection: use `none` for bare components or
  `wasi-preview1-reactor` for the supported WASI reactor shape.
- Component export absent: update the selected WIT world as well as Rust code; validation checks
  the component WIT, not only core-WASM symbols.
- Deployment misses an asset: fix the app's `node_asset_stage` entry. Deployment packaging follows
  `asset-manifest.json` and intentionally does not scan producer outputs.
