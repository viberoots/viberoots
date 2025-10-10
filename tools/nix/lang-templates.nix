{ pkgs }:
let
  Go  = import ./templates/go.nix  { inherit pkgs; };
  Cpp = import ./templates/cpp.nix { inherit pkgs; };
in {
  inherit (Go)  goApp goLib goCArchive;
  inherit (Cpp) cppApp cppLib cppTest;
}


