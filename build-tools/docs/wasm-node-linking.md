<title>Wasm Assets for Node and Webapp Templates</title>

## Context

Our `node_webapp` target builds a Vite app and copies `dist/` to the Buck output. It does not link Wasm. The current scaffolds include Wasm libraries and runtime loaders, but they do not stage the Wasm artifact into the app output. This causes runtime fetches like `/top.wasm` to fail unless a manual copy rule is added.

I want a standard, low-friction way for templates for webapps and other Node or TypeScript apps to include in-repo Wasm artifacts at runtime.

## Goals

- Provide one simple rule that stages Wasm artifacts into an app output.
- Keep the implementation deterministic and explicit.
- Avoid changes to the Vite build pipeline.
- Make templates declare Wasm assets in a single place.
- Require a client-side JS bundling path that embeds Wasm bytes.
- Require a single-file Node bundling path that embeds Wasm bytes.

## Non-Goals

- Adding link semantics or `link_deps` to `node_webapp`.
- Inferring assets implicitly from import graphs.
- Changing how Nix builds the webapp or Node packages.
- Supporting Wasm bundling via Vite plugins or ad-hoc app config.

## Proposed Design

### 1) Add a generic staging macro

Create a small macro in `build-tools/node/defs.bzl` that wraps an existing app target and copies additional assets into its output directory. I will call it `node_asset_stage`.

**Inputs**

- `app`: label for the already-built app target
- `assets`: list of `{src, dest}` entries
  - `src` is a label that resolves to a single file
  - `dest` is a relative path inside the output directory
- `out`: name of the output directory (defaults to `dist`)

**Behavior**

- Copy the app output directory to `$OUT`.
- For each asset entry, copy `$(location src)` to `$OUT/<dest>`.
- Fail if any asset path already exists and is not a file.

This keeps the Wasm asset staging explicit and does not require new build phases inside Vite.

### 2) Template pattern for webapps

Webapp templates should use a two-step output pattern:

```
node_webapp(
    name = "webapp_raw",
    out = "dist",
)

node_asset_stage(
    name = "webapp",
    app = ":webapp_raw",
    assets = [
        {"src": "//projects/libs/{{ name }}-api:wasm", "dest": "top.wasm"},
    ],
    out = "dist",
)
```

The app continues to fetch `/top.wasm`. The staging step guarantees it exists in `dist/`.

### 3) Template pattern for other Node and TypeScript apps

For Node or TypeScript apps that already produce a `dist/` directory, the same staging rule applies. The only difference is the destination path. Suggested conventions:

- CLI and server apps: `dist/wasm/<name>.wasm`
- Libraries: `dist/wasm/<name>.wasm` or `dist/browser/<name>.wasm` if the browser entry expects it

### 4) Keep staging explicit in docs and examples

Documentation and templates should show that Wasm assets are staged as explicit artifacts. This matches the existing design guidance in `wasm-linking.md`.

### 5) Bundling into the client-side JS bundle

Webapp templates must support embedding Wasm bytes inside the JS bundle instead of shipping a separate `.wasm` file. This must be a single, deterministic pattern that does not depend on Vite plugins.

**Proposal**

- Add a `node_wasm_inline_module` macro that generates a small JS module from a Wasm file.
- The generated module exports a `Uint8Array` (or a base64 string with a helper).
- The webapp imports that module and instantiates the Wasm from memory.

**Generated module shape**

```
export const wasmBytesBase64 = "...";
export const wasmBytes = () => Uint8Array.from(atob(wasmBytesBase64), (c) => c.charCodeAt(0));
```

**Webapp usage**

```
import { wasmBytes } from "@org/{{ name }}-wasm-inline";

const { instance } = await WebAssembly.instantiate(wasmBytes(), {});
```

**Buck wiring pattern**

- `node_wasm_inline_module` produces a tiny package under `libs/{{ name }}-wasm-inline`.
- The package is included as a normal workspace dependency.
- The Vite build bundles the generated module as part of the JS output.

This keeps the inline path explicit and avoids new Vite configuration.

### 6) Bundling into a single server-side Node script

Node and TypeScript templates that target a single-file server or CLI must support a bundled output that embeds the Wasm bytes. The entrypoint imports the inline module and the bundler emits a single JS file with the Wasm bytes embedded.

**Entrypoint shape**

```
import { wasmBytes } from "@org/{{ name }}-wasm-inline";

async function main() {
  const { instance } = await WebAssembly.instantiate(wasmBytes(), {});
  // use instance.exports
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Buck wiring pattern**

- `nix_node_cli_bin(bundle=True)` (or the existing bundle path) consumes the entrypoint.
- The inline module is pulled in as a normal dependency.
- The output is one JS file that does not need any `.wasm` file at runtime.

⚠️ The bundling path used by `nix_node_cli_bin(bundle=True)` must preserve imported modules without externalizing them. I have not verified whether it currently externalizes workspace deps. If it does, the bundler config must change to inline them.

### 7) Usage examples for Go, C++, and Python Wasm producers

The inline module and staging rules should accept Wasm artifacts from any supported Wasm producer target. The examples below are template-level patterns. Each example assumes the Wasm-producing target already exists and outputs a single `.wasm` file.

**Client-side bundle with Go Wasm**

```
node_wasm_inline_module(
    name = "go-wasm-inline",
    src = "//projects/libs/math-api:wasm",
)

node_webapp(
    name = "webapp_raw",
    out = "dist",
)

node_asset_stage(
    name = "webapp",
    app = ":webapp_raw",
    assets = [
        {"src": ":go-wasm-inline", "dest": "wasm-inline/index.js"},
    ],
    out = "dist",
)
```

App entrypoint:

```
import { wasmBytes } from "./wasm-inline/index.js";

const { instance } = await WebAssembly.instantiate(wasmBytes(), {});
```

**Client-side bundle with C++ Wasm**

```
node_wasm_inline_module(
    name = "math-wasm-inline",
    src = "//projects/libs/math-core:core_cpp_wasm",
)

node_webapp(
    name = "webapp_raw",
    out = "dist",
)

node_asset_stage(
    name = "webapp",
    app = ":webapp_raw",
    assets = [
        {"src": ":math-wasm-inline", "dest": "wasm-inline/index.js"},
    ],
    out = "dist",
)
```

App entrypoint:

```
import { wasmBytes } from "./wasm-inline/index.js";

const { instance } = await WebAssembly.instantiate(wasmBytes(), {});
```

**Client-side bundle with Python Wasm**

```
node_wasm_inline_module(
    name = "py-wasm-inline",
    src = "//projects/libs/py-wasm:module",
)

node_webapp(
    name = "webapp_raw",
    out = "dist",
)

node_asset_stage(
    name = "webapp",
    app = ":webapp_raw",
    assets = [
        {"src": ":py-wasm-inline", "dest": "wasm-inline/index.js"},
    ],
    out = "dist",
)
```

App entrypoint:

```
import { wasmBytes } from "./wasm-inline/index.js";

const { instance } = await WebAssembly.instantiate(wasmBytes(), {});
```

**Server-side single-file bundle with C++ Wasm**

```
node_wasm_inline_module(
    name = "math-wasm-inline",
    src = "//projects/libs/math-core:core_cpp_wasm",
)

nix_node_cli_bin(
    name = "math-cli",
    entry = "src/index.ts",
    bundle = True,
    deps = [":math-wasm-inline"],
)
```

Entrypoint:

```
import { wasmBytes } from "@org/math-wasm-inline";

async function main() {
  const { instance } = await WebAssembly.instantiate(wasmBytes(), {});
  // use instance.exports
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Server-side single-file bundle with Go Wasm**

```
node_wasm_inline_module(
    name = "go-wasm-inline",
    src = "//projects/libs/math-api:wasm",
)

nix_node_cli_bin(
    name = "math-cli",
    entry = "src/index.ts",
    bundle = True,
    deps = [":go-wasm-inline"],
)
```

Entrypoint:

```
import { wasmBytes } from "@org/go-wasm-inline";

async function main() {
  const { instance } = await WebAssembly.instantiate(wasmBytes(), {});
  // use instance.exports
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

**Server-side single-file bundle with Python Wasm**

```
node_wasm_inline_module(
    name = "py-wasm-inline",
    src = "//projects/libs/py-wasm:module",
)

nix_node_cli_bin(
    name = "py-cli",
    entry = "src/index.ts",
    bundle = True,
    deps = [":py-wasm-inline"],
)
```

Entrypoint:

```
import { wasmBytes } from "@org/py-wasm-inline";

async function main() {
  const { instance } = await WebAssembly.instantiate(wasmBytes(), {});
  // use instance.exports
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## Rationale

- It is consistent with current rules that treat Wasm as a runtime artifact rather than a link input for Node.
- It avoids modifying the Nix webapp builder or Vite behavior.
- It keeps the asset list explicit and auditable in Buck targets.

## Acceptance Criteria

- A scaffolded webapp using a Wasm library loads the Wasm at runtime with no manual edits.
- The same pattern works for other Node and TypeScript apps that build to `dist/`.
- The staging macro does not require changes to existing app build tools.
- A scaffolded webapp can choose either staged `.wasm` or inline bytes without extra Vite config.
- A scaffolded single-file Node app can inline Wasm bytes into the bundle.

## Risks

- Template authors might select a destination path that does not match runtime fetch logic.
- Some apps might want to include assets under `public/` before build for Vite plugins. This design stages after build, so those plugins will not see the Wasm.

## Follow-up Work

- Add `node_asset_stage` macro.
- Update the `wasm-linking-app` scaffold to use it.
- Add a short section to `build-tools/docs/scaffolding.md` showing the pattern.
- Add `node_wasm_inline_module` macro and a small template that generates the inline module package.
- Verify or update the bundler config for `nix_node_cli_bin(bundle=True)` to inline workspace deps.
