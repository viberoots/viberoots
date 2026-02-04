{ lib }:
ctx:
let
  core = import ./python-core.nix { inherit lib ctx; };
  cpp = import ./python-cpp.nix { inherit lib ctx core; };
  pyext = import ./python-pyext.nix { inherit lib ctx core cpp; };
  wasm = import ./python-wasm.nix { inherit lib ctx core cpp pyext; };
in {
  inherit (core) isTarget kindOf modulesFileFor;
  inherit (pyext) mkApp mkLib mkPyExt;
  inherit (wasm) backendFor mkPyExtWasm mkWasmApp mkWasmLib;
}

