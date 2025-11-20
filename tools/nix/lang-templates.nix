{ pkgs }:
let
  Go  = import ./templates/go.nix  { inherit pkgs; };
  Cpp = import ./templates/cpp.nix { inherit pkgs; };
  Node = import ./templates/node.nix { inherit pkgs; };
in {
  inherit (Go)  goApp goLib goCArchive goTinyWasmLib;
  inherit (Cpp) cppApp cppLib cppTest cppNodeAddon cppWasmStaticLib cppWasmEmscriptenLib;
  # Expose Node symbol bag for discoverability; planner's Node plugin remains authoritative.
  inherit Node;
}


