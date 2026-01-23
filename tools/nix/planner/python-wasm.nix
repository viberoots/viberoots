{ lib, ctx, core, cpp, pyext }:
let
  wasmPyExt = import ./python-wasm-pyext.nix { inherit lib ctx core cpp; };
  wasmApp = import ./python-wasm-app.nix { inherit lib ctx core pyext; wasmPyExt = wasmPyExt; };
in {
  inherit (wasmPyExt) backendFor collectPyExtWasmDepsTransitive mkPyExtWasm;
  inherit (wasmApp) mkWasmApp mkWasmLib;
}
