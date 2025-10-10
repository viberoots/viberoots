{ lib }:
ctx:
let
  get = ctx.get;
  pkgPathOf = ctx.pkgPathOf;
  T = ctx.T;
  # Buck labels may contain a trailing config suffix like
  #   "//apps/demo:demo_gtest__planner (config//platforms:default#hash)"
  # Normalize by stripping the suffix for stable lookups.
  cleanLabel = s:
    let parts = lib.splitString " (config//" s; in
      if (builtins.length parts) > 1 then (builtins.elemAt parts 0) else s;

  # Basic predicates
  isCxx = n:
    let rt = get n "rule_type"; in
    (rt != null) && (lib.hasPrefix "cxx_" rt || lib.hasInfix "cpp_nix_build" rt);

  hasLangCpp = n:
    let ls = (get n "labels"); in
    (ls != null) && (builtins.isList ls) && builtins.elem "lang:cpp" ls;

  kindOf = n:
    let
      rtVal = get n "rule_type"; rt = if rtVal == null then "" else rtVal;
      labs = labelsOf n;
      nm = nameOf n;
      # Treat planner stubs (cxx_library with __planner suffix) as tests
      isPlanner = (nm != null) && (lib.hasSuffix "__planner" nm);
    in if builtins.elem "kind:test" labs || isPlanner then "test"
      else if builtins.elem "kind:bin" labs then "bin"
      else if builtins.elem "kind:lib" labs then "lib"
      else if rt == "cxx_test" then "test"
      else if rt == "cxx_binary" then "bin"
      else if rt == "cxx_library" then (if isPlanner then "test" else "lib")
      else null;

  # Index nodes by name for quick lookup
  nodes = if builtins.hasAttr "nodes" ctx then ctx.nodes else [];
  byName = builtins.listToAttrs (
    map (n:
      let nm = get n "name"; raw = if nm == null then "" else nm; name = cleanLabel raw; in
      { inherit name; value = n; }
    ) (builtins.filter (n:
      let nm = get n "name"; raw = if nm == null then "" else nm; name = cleanLabel raw; in name != ""
    ) nodes)
  );

  labelsOf = n:
    let labs = (get n "labels"); in
      if labs == null then [] else (if builtins.isList labs then labs else []);

  nameOf = n:
    let nm = get n "name"; in if nm == null then "" else cleanLabel nm;

  depsOf = n:
    let ds = (get n "deps"); in
      if ds == null then [] else (
        if builtins.isList ds then (map cleanLabel ds) else []
      );

  srcsOf = name:
    let n = if builtins.hasAttr name byName then byName.${name} else null;
    in if n == null then [] else (
      let s = get n "srcs"; in if s == null then [] else (if builtins.isList s then s else [])
    );

  # Normalize Buck-provided src paths to be relative to the package subdir.
  normSrcsOf = name:
    let
      pkg = pkgPathOf name;
      dropCell = s: if lib.hasPrefix "root//" s then lib.removePrefix "root//" s else s;
      dropPkg = s:
        if lib.hasPrefix (pkg + "/") s then lib.removePrefix (pkg + "/") s else s;
    in map (s: dropPkg (dropCell s)) (srcsOf name);

  isNixLabel = l: lib.hasPrefix "nixpkg:" l;
  attrFrom = l: lib.removePrefix "nixpkg:" l;

  # DFS over deps to collect nixpkg labels; bounded by nodes present
  collectNixAttrsFor = name:
    let
      start = if builtins.hasAttr name byName then byName.${name} else null;
      step = state: dn:
        if builtins.hasAttr dn state.seen then state else
        let key = cleanLabel dn;
            n = if builtins.hasAttr key byName then byName.${key} else null;
        in if n == null then state else
          let here = map attrFrom (builtins.filter isNixLabel (labelsOf n));
              nexts = depsOf n;
              seen' = state.seen // { "${dn}" = true; };
              labels' = state.labels ++ here;
          in builtins.foldl' step { seen = seen'; labels = labels'; } nexts;
      init = if start == null then { seen = {}; labels = []; } else step { seen = {}; labels = []; } name;
      uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
    in builtins.sort (a: b: a < b) (uniq init.labels);

  # Collect nixpkg labels stamped directly on the node itself (no DFS)
  nixAttrsFromSelf = name:
    let n = if builtins.hasAttr name byName then byName.${name} else null; in
      if n == null then [] else (map attrFrom (builtins.filter isNixLabel (labelsOf n)));

  # Fallback: some Buck cquery configurations may omit deps edges on planner stubs.
  # In that case, detect common provider nodes directly and seed attrs accordingly.
  providerAttrsFallback = let
    names = builtins.map (n: let nm = get n "name"; in if nm == null then "" else cleanLabel nm) nodes;
    # Extract provider attr from a full label when it matches our providers pattern
    toAttr = full:
      let marker = "//third_party/providers:nix_pkgs_";
          parts = lib.splitString marker full;
      in if (builtins.length parts) < 2 then null else
      let tail = builtins.elemAt parts ((builtins.length parts) - 1);
          # Map gtest/gtest_main to pkgs.googletest; otherwise use pkgs.<tail with '_' -> '.'>
          isGTest = lib.hasPrefix "gtest" tail;
      in if isGTest then "pkgs.googletest" else ("pkgs." + (lib.replaceStrings ["_"] ["."] tail));
    acc = builtins.filter (a: a != null) (builtins.map toAttr names);
    uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
  in builtins.sort (a: b: a < b) (uniq acc);

  mkApp = name:
    T.cppApp {
      inherit name;
      srcRoot = ctx.repoRoot;
      subdir = pkgPathOf name;
      nixCxxAttrs = collectNixAttrsFor name;
      srcList = normSrcsOf name;
    };

  mkLib = name:
    T.cppLib {
      inherit name;
      srcRoot = ctx.repoRoot;
      subdir = pkgPathOf name;
      nixCxxAttrs = collectNixAttrsFor name;
      srcList = normSrcsOf name;
    };
  
  mkTest = name:
    T.cppTest {
      inherit name;
      srcRoot = ctx.repoRoot;
      subdir = pkgPathOf name;
      nixCxxAttrs =
        let
          fromDeps = collectNixAttrsFor name;
          fromSelf = nixAttrsFromSelf name;
          merged = fromDeps ++ fromSelf;
          uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
          all = builtins.sort (a: b: a < b) (uniq merged);
        in if all == [] then providerAttrsFallback else all;
      srcList = normSrcsOf name;
    };
in {
  isTarget = n: (isCxx n) || (hasLangCpp n);
  inherit kindOf mkApp mkLib mkTest;
  modulesFileFor = name: "";
}


