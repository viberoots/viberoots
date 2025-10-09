{ lib }:
# tools/nix/planner/go.nix — language plugin for Go (import-if-exists)
# Exports a function that accepts a context from graph-generator and returns
# the Go language adapter surface used by the planner.

ctx:
let
  # Unpack required fields from the provided context
  T = ctx.T;
  get = ctx.get;
  modulesTomlFor = ctx.modulesTomlFor;
  repoRoot = ctx.repoRoot;
  localModuleOverrides = ctx.localModuleOverrides;
  pkgPathOf = ctx.pkgPathOf;
in {
  isTarget = n:
    let rt = get n "rule_type";
        lbs = get n "labels";
        hasGoRT = (rt != null) && lib.hasPrefix "go_" rt;
        hasGoLabel = (lbs != null) && builtins.elem "lang:go" lbs;
    in hasGoRT || hasGoLabel;

  kindOf = n:
    let rt = get n "rule_type";
        lbs = get n "labels";
        isBinLabel = lbs != null && builtins.elem "kind:bin" lbs;
    in if (rt != null) && lib.hasPrefix "go_" rt
         then (if lib.hasSuffix "_binary" rt then "bin" else "lib")
         else if isBinLabel then "bin" else "lib";

  modulesFileFor = name: modulesTomlFor name;

  mkApp = name: T.goApp {
    inherit name;
    modulesToml = modulesTomlFor name;
    devOverridesMap = localModuleOverrides;
    srcRoot = repoRoot;
    subdir = (pkgPathOf name);
    # Derive nixCgoAttrs from any nixpkg:* labels stamped on deps/self for this node.
    # We pass attrs literally (e.g., "pkgs.zlib") so templates can resolve them against pkgs.
    nixCgoAttrs = let
      # Scan nodes for this label's transitive deps to collect nixpkg labels
      nodesAll = ctx.nodes or [];
      get = ctx.get;
      labelsOf = n: let labs = (get n "labels"); in if labs == null then [] else (if builtins.isList labs then labs else []);
      isNixLabel = l: lib.hasPrefix "nixpkg:" l;
      attrFrom = l: lib.removePrefix "nixpkg:" l;
      cleanLabel = s: let parts = lib.splitString " (config//" s; in if (builtins.length parts) > 1 then (builtins.elemAt parts 0) else s;
      byName = builtins.listToAttrs (map (n: { name = cleanLabel (get n "name"); value = n; }) (builtins.filter (n: (get n "name") != null) nodesAll));
      depsOf = n: let ds = (get n "deps"); in if ds == null then [] else (if builtins.isList ds then (map cleanLabel ds) else []);
      start = if builtins.hasAttr name byName then byName.${name} else null;
      step = state: dn:
        if builtins.hasAttr dn state.seen then state else
        let n = if builtins.hasAttr dn byName then byName.${dn} else null; in
        if n == null then state else
        let here = map attrFrom (builtins.filter isNixLabel (labelsOf n));
            nexts = depsOf n;
        in builtins.foldl' step { seen = state.seen // { "${dn}" = true; }; out = state.out ++ here; } nexts;
      init = if start == null then { seen = {}; out = []; } else step { seen = {}; out = []; } name;
      uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
    in builtins.sort (a: b: a < b) (uniq init.out);
  };

  mkLib = name: T.goLib {
    inherit name;
    modulesToml = modulesTomlFor name;
    srcRoot = repoRoot;
    subdir = (pkgPathOf name);
    nixCgoAttrs = let
      nodesAll = ctx.nodes or [];
      get = ctx.get;
      labelsOf = n: let labs = (get n "labels"); in if labs == null then [] else (if builtins.isList labs then labs else []);
      isNixLabel = l: lib.hasPrefix "nixpkg:" l;
      attrFrom = l: lib.removePrefix "nixpkg:" l;
      cleanLabel = s: let parts = lib.splitString " (config//" s; in if (builtins.length parts) > 1 then (builtins.elemAt parts 0) else s;
      byName = builtins.listToAttrs (map (n: { name = cleanLabel (get n "name"); value = n; }) (builtins.filter (n: (get n "name") != null) nodesAll));
      depsOf = n: let ds = (get n "deps"); in if ds == null then [] else (if builtins.isList ds then (map cleanLabel ds) else []);
      start = if builtins.hasAttr name byName then byName.${name} else null;
      step = state: dn:
        if builtins.hasAttr dn state.seen then state else
        let n = if builtins.hasAttr dn byName then byName.${dn} else null; in
        if n == null then state else
        let here = map attrFrom (builtins.filter isNixLabel (labelsOf n));
            nexts = depsOf n;
        in builtins.foldl' step { seen = state.seen // { "${dn}" = true; }; out = state.out ++ here; } nexts;
      init = if start == null then { seen = {}; out = []; } else step { seen = {}; out = []; } name;
      uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
    in builtins.sort (a: b: a < b) (uniq init.out);
  };
}


