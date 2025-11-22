{ lib }:
# tools/nix/planner/python.nix — language plugin for Python (uv.lock-based)
ctx:
let
  T = ctx.T;
  get = ctx.get;
  repoRoot = ctx.repoRoot;
  pkgPathOf = ctx.pkgPathOf;
  L = import ./lib.nix {
    inherit lib;
    get = ctx.get;
    nodes = (ctx.nodes or []);
    pkgPathOf = ctx.pkgPathOf;
  };

  labelsOf = L.labelsOf;
  nameOf = L.nameOf;
  byName = L.byName;
  depsOfName = nm:
    let n = if builtins.hasAttr nm byName then byName.${nm} else null;
    in if n == null then [] else L.depsOf n;
  labelsOfName = nm:
    let n = if builtins.hasAttr nm byName then byName.${nm} else null;
    in if n == null then [] else L.labelsOf n;

  # Find nearest uv.lock for a target by walking up from its package path.
  lockfileFor = name:
    let
      pkgRel = pkgPathOf name;
      split = lib.splitString "/" pkgRel;
      segments = if (builtins.length split) == 0 then [] else split;
      descend = idx:
        if idx < 0 then null else
        let rel = lib.concatStringsSep "/" (lib.take (idx + 1) segments);
            cand = builtins.toPath (repoRoot + "/" + rel + "/uv.lock");
        in if builtins.pathExists cand then cand else descend (idx - 1);
      nearest = if (builtins.length segments) > 0 then descend ((builtins.length segments) - 1) else null;
    in if nearest != null then nearest
       else builtins.throw ("uv.lock missing for target " + name + "; expected at or above " + (repoRoot + "/" + pkgRel));

  # Normalize lockfile path to be relative to repo root when passed to templates
  lockRelFor = name:
    let abs = lockfileFor name; absStr = builtins.toString abs; rootStr = builtins.toString repoRoot;
    in if lib.hasPrefix (rootStr + "/") absStr then lib.removePrefix (rootStr + "/") absStr else absStr;
in rec {
  # Detect Python nodes by rule_type prefix or lang label
  isTarget = n:
    let rt = get n "rule_type";
        lbs = get n "labels";
        hasPyRT = (rt != null) && lib.hasPrefix "python_" rt;
        hasPyLabel = (lbs != null) && builtins.elem "lang:python" lbs;
    in hasPyRT || hasPyLabel;

  kindOf = n:
    let rt = get n "rule_type";
        lbs = get n "labels";
        isBinLabel = lbs != null && builtins.elem "kind:bin" lbs;
        isWasmLabel = lbs != null && builtins.elem "kind:wasm" lbs;
        isTestLabel = lbs != null && builtins.elem "kind:test" lbs;
    in if isWasmLabel then "wasm"
       else if isTestLabel then "test"
       else if (rt != null) && lib.hasSuffix "_binary" rt then "bin"
       else if (rt != null) && lib.hasSuffix "_test" rt then "test"
       else if isBinLabel then "bin"
       else "lib";

  modulesFileFor = name: lockRelFor name;

  mkApp = name:
    T.pyApp {
      inherit name;
      lockfile = lockRelFor name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
    };

  mkLib = name:
    T.pyLib {
      inherit name;
      lockfile = lockRelFor name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
    };

  # WASM variants (Phase 1: WASI baseline)
  mkWasmApp = name:
    let
      # Collect direct python lib deps as overlays
      directDeps = depsOfName name;
      pyLibDeps =
        builtins.filter (dn:
          let n = if builtins.hasAttr dn byName then byName.${dn} else null;
              lbs = if n == null then [] else (get n "labels");
              hasPy = (n != null) && (isTarget n);
              isLib = (lbs != null) && (builtins.elem "kind:lib" lbs || builtins.elem "kind:wasm" lbs);
          in hasPy && isLib
        ) directDeps;
      overlays = map (dn: T.pyWasmLib {
        name = dn;
        lockfile = lockRelFor dn;
        srcRoot = repoRoot;
        subdir = pkgPathOf dn;
      }) pyLibDeps;
    in T.pyWasmApp {
      inherit name;
      lockfile = lockRelFor name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      libOverlays = overlays;
      backend = "wasi";
    };

  mkWasmLib = name:
    T.pyWasmLib {
      inherit name;
      lockfile = lockRelFor name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
    };
}

