{ pkgs }:
let
  App  = import ./cpp-app.nix  { inherit pkgs; };
  Headers = import ./cpp-headers.nix { inherit pkgs; };
  Lib  = import ./cpp-lib.nix  { inherit pkgs; };
  Shared = import ./cpp-shared-lib.nix { inherit pkgs; };
  Test = import ./cpp-test.nix { inherit pkgs; };
  Addon = import ./cpp-node-addon.nix { inherit pkgs; };
  Wlib = import ./cpp-wasm-lib.nix { inherit pkgs; };
  Ems = import ./cpp-emscripten-lib.nix { inherit pkgs; };
in {
  inherit (App)  cppApp;
  inherit (Headers) cppHeaders;
  inherit (Lib)  cppLib;
  inherit (Shared) cppSharedLib;
  inherit (Test) cppTest;
  inherit (Addon) cppNodeAddon;
  inherit (Wlib) cppWasmStaticLib;
  inherit (Ems) cppWasmEmscriptenLib;
}
