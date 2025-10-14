{ lib }:
ctx:
let
  get = ctx.get;
  pkgPathOf = ctx.pkgPathOf;
  T = ctx.T;
  L = import ./lib.nix {
    inherit lib;
    get = ctx.get;
    nodes = (if builtins.hasAttr "nodes" ctx then ctx.nodes else []);
    pkgPathOf = ctx.pkgPathOf;
  };
  # Buck labels may contain a trailing config suffix like
  #   "//apps/demo:demo_gtest__planner (config//platforms:default#hash)"
  # Normalize by stripping the suffix for stable lookups.
  cleanLabel = L.cleanLabel;

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
  byName = L.byName;

  labelsOf = L.labelsOf;

  nameOf = L.nameOf;

  depsOf = L.depsOf;

  srcsOf = name: L.srcsOf name;

  # Normalize Buck-provided src paths to be relative to the package subdir.
  normSrcsOf = name: srcsOf name;

  isNixLabel = l: lib.hasPrefix "nixpkg:" l;
  attrFrom = l: lib.removePrefix "nixpkg:" l;

  # DFS over deps to collect nixpkg labels; bounded by nodes present
  collectNixAttrsFor = name:
    let
      labels = L.collectLabelsWithPrefix name "nixpkg:";
      attrs = map attrFrom labels;
      uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
    in builtins.sort (a: b: a < b) (uniq attrs);

  # Identify direct deps that are Go c-archives (labeled kind:carchive) and
  # build them as repo-provided C packages to link against from C++.
  # We return a list of derivations produced via T.goCArchive with subdir/pkgPath.
  repoGoCArchivesFor = name:
    let
      start = if builtins.hasAttr name byName then byName.${name} else null;
      direct = if start == null then [] else L.depsOf start;
      isCArchive = nm:
        let n = if builtins.hasAttr nm byName then byName.${nm} else null; in
          if n == null then false else builtins.elem "kind:carchive" (L.labelsOf n);
      asDerivation = nm: T.goCArchive {
        name = nm;
        modulesToml = ctx.modulesTomlFor nm;
        srcRoot = ctx.repoRoot;
        subdir = pkgPathOf nm;
      };
    in builtins.map asDerivation (builtins.filter isCArchive direct);

  # Collect nixpkg labels stamped directly on the node itself (no DFS)
  nixAttrsFromSelf = name:
    let n = if builtins.hasAttr name byName then byName.${name} else null; in
      if n == null then [] else (map attrFrom (builtins.filter isNixLabel (L.labelsOf n)));

  # Fallback: some Buck cquery configurations may omit deps edges on planner stubs.
  # In that case, detect common provider nodes directly and seed attrs accordingly.
  providerAttrsFallback = let
    names = builtins.map (n: let nm = get n "name"; in if nm == null then "" else L.cleanLabel nm) nodes;
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
      nixCxxPkgs = repoGoCArchivesFor name;
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
      nixCxxPkgs = repoGoCArchivesFor name;
      srcList = normSrcsOf name;
    };
in {
  isTarget = n: (isCxx n) || (hasLangCpp n);
  inherit kindOf mkApp mkLib mkTest;
  modulesFileFor = name: "";
}


