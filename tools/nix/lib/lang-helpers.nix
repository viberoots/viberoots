{ pkgs }:
let
  Common = import ../templates-common.nix { inherit pkgs; };
in {
  inherit (Common) sanitizeName patchesMapFromDir readDevOverrides guardNoDevOverridesInCI;
}
