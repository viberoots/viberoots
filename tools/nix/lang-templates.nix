{ pkgs, uv2nixLib ? null }:
let
  Go  = import ./templates/go.nix  { inherit pkgs; };
  Cpp = import ./templates/cpp.nix { inherit pkgs; };
  Node = import ./templates/node.nix { inherit pkgs; };
  Python = import ./templates/python.nix { inherit pkgs uv2nixLib; };
  PythonWasm = import ./templates/python/wasm.nix { inherit pkgs; };
in {
  inherit (Go)  goApp goLib goCArchive goTinyWasmLib;
  inherit (Cpp) cppApp cppLib cppTest cppNodeAddon cppWasmStaticLib cppWasmEmscriptenLib;
  # Expose Node symbol bag for discoverability; planner's Node plugin remains authoritative.
  inherit Node;
  inherit (Python) pyApp pyLib pyWheelhouse;
  inherit (PythonWasm) pyWasmApp pyWasmLib;
}


