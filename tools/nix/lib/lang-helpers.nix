{ pkgs }:
let
  Common = import ../templates-common.nix { inherit pkgs; };
in {
  inherit (Common)
    segs
    getAtPath
    resolveAttrFromPkgs
    sanitizeName
    patchesMapFromDir
    readDevOverrides
    guardNoDevOverridesInCI;
}
