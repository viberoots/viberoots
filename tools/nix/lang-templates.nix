{ pkgs }:
let
  Go = import ./templates/go.nix { inherit pkgs; };
in {
  inherit (Go) goApp goLib;
}


