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
  srcsOf = name: L.srcsOf name;
  depsOfName = nm:
    let
      _byNameOk =
        if builtins.isAttrs byName then null
        else builtins.throw "python planner: internal error: byName is not an attrset";
      n = if builtins.hasAttr nm byName then byName.${nm} else null;
      _nodeOk =
        if n != null && !(builtins.isAttrs n)
        then builtins.throw ("python planner: internal error: node value for '" + nm + "' is not an attrset")
        else null;
    in if n == null then [] else L.depsOf n;
  labelsOfName = nm:
    let
      _byNameOk =
        if builtins.isAttrs byName then null
        else builtins.throw "python planner: internal error: byName is not an attrset";
      n = if builtins.hasAttr nm byName then byName.${nm} else null;
      _nodeOk =
        if n != null && !(builtins.isAttrs n)
        then builtins.throw ("python planner: internal error: node value for '" + nm + "' is not an attrset")
        else null;
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

  ensureString = ctxStr: x:
    if x == null then ""
    else if builtins.isString x then x
    else builtins.throw ("python planner: expected " + ctxStr + " to be a string");

  ensureStringList = ctxStr: xs:
    if xs == null then []
    else if builtins.isList xs && builtins.all builtins.isString xs then xs
    else builtins.throw ("python planner: expected " + ctxStr + " to be a list of strings");

  nodeOfName = nm:
    if builtins.hasAttr nm byName then byName.${nm} else null;

  collectNixAttrsFor = name:
    let
      labels = L.collectLabelsWithPrefix name "nixpkg:";
      attrs = map (l: lib.removePrefix "nixpkg:" l) labels;
      uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
    in builtins.sort (a: b: a < b) (uniq attrs);

  collectPyExtDepsTransitive = name:
    let
      startDeps = depsOfName name;
      go = st: q:
        if q == [] then st.out else
        let
          dn0 = builtins.head q;
          dn = L.cleanLabel dn0;
          rest = builtins.tail q;
        in
          if builtins.hasAttr dn st.seen then go st rest else
          let
            seen' = st.seen // { "${dn}" = true; };
            n = nodeOfName dn;
            isPyExt = n != null && builtins.elem "kind:pyext" (labelsOf n);
            out' = if isPyExt then st.out ++ [ dn ] else st.out;
            nexts = if n == null then [] else depsOfName dn;
          in go { seen = seen'; out = out'; } (rest ++ nexts);
    in go { seen = {}; out = []; } startDeps;
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
        isPyExtLabel = lbs != null && builtins.elem "kind:pyext" lbs;
    in if isWasmLabel then "wasm"
       else if isPyExtLabel then "pyext"
       else if isTestLabel then "test"
       else if (rt != null) && lib.hasSuffix "_binary" rt then "bin"
       else if (rt != null) && lib.hasSuffix "_test" rt then "test"
       else if isBinLabel then "bin"
       else "lib";

  modulesFileFor = name: lockRelFor name;

  mkApp = name:
    let
      pyExtDeps = collectPyExtDepsTransitive name;
      overlays = map mkPyExt pyExtDeps;
    in T.pyApp {
      inherit name;
      lockfile = lockRelFor name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      nativeModuleOverlays = overlays;
    };

  mkLib = name:
    let
      pyExtDeps = collectPyExtDepsTransitive name;
      overlays = map mkPyExt pyExtDeps;
    in T.pyLib {
      inherit name;
      lockfile = lockRelFor name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      nativeModuleOverlays = overlays;
    };

  mkPyExt = name:
    let
      n = nodeOfName name;
      mod = ensureString ("module for " + name) (if n == null then null else get n "module");
      cflags = ensureStringList ("cflags for " + name) (if n == null then null else get n "cflags");
      ldflags = ensureStringList ("ldflags for " + name) (if n == null then null else get n "ldflags");
      buildPyDeps = ensureStringList ("build_py_deps for " + name) (if n == null then null else get n "build_py_deps");
      lockRel = lockRelFor name;
      importerDir =
        if lib.hasSuffix "/uv.lock" lockRel then lib.removeSuffix "/uv.lock" lockRel
        else pkgPathOf name;
      wheelhouse =
        if (builtins.length buildPyDeps) > 0 then (
          T.pyWheelhouse {
            # Name is not part of the wheelhouse key (template uses constant pname); keep for debugging only.
            name = name;
            lockfile = lockRel;
            subdir = importerDir;
            srcRoot = repoRoot;
          }
        ) else null;
    in T.pyExt {
      inherit name;
      module = mod;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      srcList = srcsOf name;
      nixCxxAttrs = collectNixAttrsFor name;
      cflags = cflags;
      ldflags = ldflags;
      wheelhouse = wheelhouse;
      buildPyDeps = buildPyDeps;
    };

  # WASM variants (Phase 1: WASI baseline)
  mkWasmApp = name:
    let
      # Determine backend from labels; default to "wasi". Accept labels like "backend:pyodide".
      backendFor = nm:
        let
          labs = labelsOfName nm;
          hits = builtins.filter (l: (builtins.typeOf l) == "string" && lib.hasPrefix "backend:" l) (if labs == null then [] else labs);
        in if hits == [] then "wasi" else (lib.removePrefix "backend:" (builtins.head hits));
      # Determine trim mode from labels; default to "none". Accept labels like "trim:safe" or "trim:aggressive".
      trimFor = nm:
        let
          labs = labelsOfName nm;
          hits = builtins.filter (l: (builtins.typeOf l) == "string" && lib.hasPrefix "trim:" l) (if labs == null then [] else labs);
        in if hits == [] then "none" else (lib.removePrefix "trim:" (builtins.head hits));
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
        trim = trimFor dn;
      }) pyLibDeps;
    in T.pyWasmApp {
      inherit name;
      lockfile = lockRelFor name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      libOverlays = overlays;
      backend = backendFor name;
      trim = trimFor name;
    };

  mkWasmLib = name:
    let
      trimFor = nm:
        let
          labs = labelsOfName nm;
          hits = builtins.filter (l: (builtins.typeOf l) == "string" && lib.hasPrefix "trim:" l) (if labs == null then [] else labs);
        in if hits == [] then "none" else (lib.removePrefix "trim:" (builtins.head hits));
    in
      T.pyWasmLib {
        inherit name;
        lockfile = lockRelFor name;
        srcRoot = repoRoot;
        subdir = pkgPathOf name;
        trim = trimFor name;
      };
}

