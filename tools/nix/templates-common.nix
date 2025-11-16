{ pkgs }:
let
  LH = import ./lib/lang-helpers.nix { inherit pkgs; };
in {
  inherit (LH)
    segs
    getAtPath
    resolveAttrFromPkgs
    sanitizeName
    patchesMapFromDir
    readDevOverrides
    guardNoDevOverridesInCI;
}
