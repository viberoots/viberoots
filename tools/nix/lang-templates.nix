{ pkgs, uv2nixLib ? null }:
let
  Go  = import ./templates/go.nix  { inherit pkgs; };
  Cpp = import ./templates/cpp.nix { inherit pkgs; };
  Node = import ./templates/node.nix { inherit pkgs; };
  # Lazily import Python templates only when uv2nixLib is available.
  Python = if uv2nixLib != null then import ./templates/python.nix { inherit pkgs uv2nixLib; } else null;
  PythonWasm = if uv2nixLib != null then import ./templates/python/wasm.nix { inherit pkgs uv2nixLib; } else null;
in {
  inherit (Go)  goApp goLib goCArchive goTinyWasmLib;
  inherit (Cpp) cppApp cppHeaders cppLib cppTest cppNodeAddon cppWasmStaticLib cppWasmEmscriptenLib;
  # Expose Node symbol bag for discoverability; planner's Node plugin remains authoritative.
  inherit Node;
  # Only expose Python symbols when available
  # (keeps non-Python consumers from evaluating uv2nix or Python adapters).
  # Downstream code should guard access appropriately.
  # When unavailable, omit the attributes entirely.
} // (if Python != null then {
  inherit (Python) pyApp pyLib pyWheelhouse;
} else {}) // (if PythonWasm != null then {
  inherit (PythonWasm) pyWasmApp pyWasmLib;
} else {})


