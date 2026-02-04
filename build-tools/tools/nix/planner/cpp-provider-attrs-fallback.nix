{ lib, get, nodes, cleanLabel }:
let
  names = builtins.map (n:
    let nm = get n "name"; in if nm == null then "" else cleanLabel nm
  ) nodes;
  toAttr = full:
    let
      marker = "//third_party/providers:nix_pkgs_";
      parts = lib.splitString marker full;
    in if (builtins.length parts) < 2 then null else
      let
        tail = builtins.elemAt parts ((builtins.length parts) - 1);
        isGTest = lib.hasPrefix "gtest" tail;
      in if isGTest then "pkgs.googletest" else ("pkgs." + (lib.replaceStrings ["_"] ["."] tail));
  acc = builtins.filter (a: a != null) (builtins.map toAttr names);
  uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
in {
  providerAttrsFallback = builtins.sort (a: b: a < b) (uniq acc);
}


