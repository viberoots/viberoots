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
  L = import ./lib.nix {
    inherit lib;
    get = ctx.get;
    nodes = (ctx.nodes or []);
    pkgPathOf = ctx.pkgPathOf;
  };
  # Shared, top-level helpers (deduplicated from mkApp/mkLib)
  byName = L.byName;
  depsOfName = nm:
    let n = if builtins.hasAttr nm byName then byName.${nm} else null;
    in if n == null then [] else L.depsOf n;
  labelsOfName = nm:
    let n = if builtins.hasAttr nm byName then byName.${nm} else null;
    in if n == null then [] else L.labelsOf n;
  isCppNode = nm:
    let n = if builtins.hasAttr nm byName then byName.${nm} else null;
        rt0 = if n == null then null else (get n "rule_type");
        rt = if rt0 == null then "" else rt0;
        labs = labelsOfName nm;
    in (rt != null && (lib.hasPrefix "cxx_" rt || lib.hasInfix "cpp_nix_build" rt)) || (labs != null && builtins.elem "lang:cpp" labs);
  isCppLib = nm:
    let n = if builtins.hasAttr nm byName then byName.${nm} else null;
        rt0 = if n == null then null else (get n "rule_type");
        rt = if rt0 == null then "" else rt0;
        labs = labelsOfName nm;
    in (labs != null && builtins.elem "kind:lib" labs) || (rt == "cxx_library");
  # Helper: compute absolute patch directories from a node's srcs ('.patch' siblings)
  patchDirsAbsFor = name:
    let
      srcs = L.srcsOf name;
      patchDirsLocalRel = builtins.sort (a: b: a < b) (
        builtins.attrNames (builtins.listToAttrs (
          map (p:
            let parts = lib.splitString "/" p;
                dir = if (builtins.length parts) > 1 then lib.concatStringsSep "/" (lib.init parts) else ".";
            in { name = dir; value = true; }
          ) (builtins.filter (s: lib.hasSuffix ".patch" s) srcs)
        ))
      );
    in map (d: builtins.toPath (repoRoot + "/" + (pkgPathOf name) + "/" + d)) patchDirsLocalRel;
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
    in if (lbs != null && builtins.elem "kind:carchive" lbs) then "lib"
       else if (rt != null) && lib.hasPrefix "go_" rt
         then (if lib.hasSuffix "_binary" rt then "bin" else "lib")
         else if isBinLabel then "bin" else "lib";

  modulesFileFor = name: modulesTomlFor name;

  mkApp = name:
    let
      directDeps = depsOfName name;
      cppLibDeps = builtins.filter (dn: isCppNode dn && isCppLib dn) directDeps;
      repoCgoPkgs = map (dn: T.cppLib { name = dn; srcRoot = repoRoot; subdir = (pkgPathOf dn); }) cppLibDeps;
      # Derive nixCgoAttrs (nixpkgs attrs) from transitive deps via shared DFS
      nixCgoAttrs = let
        attrFrom = l: lib.removePrefix "nixpkg:" l;
        labels = L.collectLabelsWithPrefix name "nixpkg:";
        attrs = map attrFrom labels;
        uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
      in builtins.sort (a: b: a < b) (uniq attrs);
    in T.goApp {
      inherit name;
      modulesToml = modulesTomlFor name;
      devOverridesMap = localModuleOverrides;
      srcRoot = repoRoot;
      subdir = (pkgPathOf name);
      patchDirs = patchDirsAbsFor name;
      nixCgoAttrs = nixCgoAttrs;
      nixCgoPkgs  = repoCgoPkgs;
    };

  mkLib = name:
    let
      directDeps = depsOfName name;
      cppLibDeps = builtins.filter (dn: isCppNode dn && isCppLib dn) directDeps;
      repoCgoPkgs = map (dn: T.cppLib { name = dn; srcRoot = repoRoot; subdir = (pkgPathOf dn); }) cppLibDeps;
      nixCgoAttrs = let
        attrFrom = l: lib.removePrefix "nixpkg:" l;
        labels = L.collectLabelsWithPrefix name "nixpkg:";
        attrs = map attrFrom labels;
        uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
      in builtins.sort (a: b: a < b) (uniq attrs);
    in T.goLib {
      inherit name;
      modulesToml = modulesTomlFor name;
      srcRoot = repoRoot;
      subdir = (pkgPathOf name);
      patchDirs = patchDirsAbsFor name;
      nixCgoAttrs = nixCgoAttrs;
      nixCgoPkgs  = repoCgoPkgs;
    };
}


