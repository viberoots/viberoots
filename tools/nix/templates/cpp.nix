{ pkgs }:
let
  App  = import ./cpp-app.nix  { inherit pkgs; };
  Lib  = import ./cpp-lib.nix  { inherit pkgs; };
  Test = import ./cpp-test.nix { inherit pkgs; };
in {
  inherit (App)  cppApp;
  inherit (Lib)  cppLib;
  inherit (Test) cppTest;
}
