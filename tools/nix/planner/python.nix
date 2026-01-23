{ lib }:
# tools/nix/planner/python.nix — language plugin for Python (uv.lock-based)
ctx:
let
  T = ctx.T;
  get = ctx.get;
  repoRoot = ctx.repoRoot;
  pkgPathOf = ctx.pkgPathOf;
  LC = import ./link-closure.nix { inherit lib; };
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

  dedupePreserveOrder = xs:
    let
      step = st: x:
        if builtins.hasAttr x st.seen then st else { seen = st.seen // { "${x}" = true; }; out = st.out ++ [ x ]; };
      st0 = { seen = {}; out = []; };
    in (builtins.foldl' step st0 xs).out;

  cleanLabel = L.cleanLabel;

  normalizeLabelList = ctxStr: xs:
    builtins.map cleanLabel (dedupePreserveOrder (ensureStringList ctxStr xs));

  ensureStringAttrs = ctxStr: x:
    if x == null then {}
    else if builtins.isAttrs x then x
    else builtins.throw ("python planner: expected " + ctxStr + " to be an attrset");

  normalizeOverrides = name: overridesRaw:
    let
      overrides0 = ensureStringAttrs ("link_closure_overrides for " + name) overridesRaw;
      keys = builtins.attrNames overrides0;
      pairs = builtins.map (k: { name = cleanLabel k; value = overrides0.${k}; }) keys;
      _ = builtins.map (p:
        if builtins.isString p.value then true
        else builtins.throw ("python planner: expected link_closure_overrides['" + p.name + "'] to be a string")
      ) pairs;
      names = builtins.map (p: p.name) pairs;
      uniqNames = builtins.attrNames (builtins.listToAttrs (builtins.map (n: { name = n; value = true; }) names));
      _dupes =
        if (builtins.length uniqNames) == (builtins.length names) then null
        else builtins.throw ("python planner: normalized link_closure_overrides has duplicate keys for " + name);
    in builtins.listToAttrs pairs;

  isWasmish = labs:
    builtins.any (l:
      builtins.isString l && (
        l == "kind:wasm" ||
        l == "flavor:wasm" ||
        lib.hasPrefix "wasm:" l
      )
    ) (if labs == null then [] else labs);

  ensureRepoCppLibDep = consumer: dep:
    let
      depNode = nodeOfName dep;
      rt = if depNode == null then null else get depNode "rule_type";
      labs = if depNode == null then [] else labelsOf depNode;
      haveLang = depNode != null && builtins.elem "lang:cpp" labs;
      haveLib = depNode != null && builtins.elem "kind:lib" labs;
    in
      if depNode == null then builtins.throw ("python planner: link_deps for " + consumer + " contains " + dep + " — unknown target (missing from exported graph)")
      else if !haveLang then builtins.throw ("python planner: link_deps for " + consumer + " contains " + dep + " — expected lang:cpp; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else if isWasmish labs then builtins.throw ("python planner: link_deps for " + consumer + " contains " + dep + " — Python native extensions cannot link wasm producers; got labels=" + (builtins.toString labs))
      else if !haveLib then builtins.throw ("python planner: link_deps for " + consumer + " contains " + dep + " — expected kind:lib; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else dep;

  ensureRepoCppHeadersDep = consumer: dep:
    let
      depNode = nodeOfName dep;
      rt = if depNode == null then null else get depNode "rule_type";
      labs = if depNode == null then [] else labelsOf depNode;
      haveLang = depNode != null && builtins.elem "lang:cpp" labs;
      haveHeaders = depNode != null && builtins.elem "kind:headers" labs;
    in
      if depNode == null then builtins.throw ("python planner: header_deps for " + consumer + " contains " + dep + " — unknown target (missing from exported graph)")
      else if !haveLang then builtins.throw ("python planner: header_deps for " + consumer + " contains " + dep + " — expected lang:cpp; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else if !haveHeaders then builtins.throw ("python planner: header_deps for " + consumer + " contains " + dep + " — expected kind:headers; got labels=" + (builtins.toString labs) + " rule_type=" + (builtins.toString rt))
      else dep;

  patchInputsFor = name:
    let
      rels0 = builtins.filter (s: lib.hasSuffix ".patch" s) (srcsOf name);
      rels = builtins.filter (s: !(lib.hasInfix "placeholder" s)) rels0;
      pkg = pkgPathOf name;
      toImportedPath = p: builtins.path {
        path = (repoRoot + "/" + pkg + "/" + p);
        name = "patch";
      };
    in builtins.map toImportedPath rels;

  mkCppLib = name:
    T.cppLib {
      inherit name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      nixCxxAttrs = collectNixAttrsFor name;
      srcList = srcsOf name;
      patches = patchInputsFor name;
    };

  mkCppHeaders = name:
    T.cppHeaders {
      inherit name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      srcList = srcsOf name;
      patches = patchInputsFor name;
    };

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

  collectPyExtWasmDepsDirect = name:
    let
      directDeps = depsOfName name;
    in builtins.filter (dn:
      let n = nodeOfName dn;
          lbs = if n == null then [] else (get n "labels");
      in n != null && lbs != null && builtins.elem "kind:pyext_wasm" lbs
    ) directDeps;
  collectPyExtWasmDepsTransitive = name:
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
            isPyExtWasm = n != null && builtins.elem "kind:pyext_wasm" (labelsOf n);
            out' = if isPyExtWasm then st.out ++ [ dn ] else st.out;
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
        isPyExtWasmLabel = lbs != null && builtins.elem "kind:pyext_wasm" lbs;
    in if isWasmLabel then "wasm"
       else if isPyExtWasmLabel then "pyext_wasm"
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
      linkDeps0 = normalizeLabelList ("link_deps for " + name) (if n == null then null else get n "link_deps");
      headerDeps0 = normalizeLabelList ("header_deps for " + name) (if n == null then null else get n "header_deps");
      defaultClosure =
        let raw = if n == null then null else get n "link_closure";
        in if raw == null then "direct"
           else if builtins.isString raw then raw
           else builtins.throw ("python planner: expected link_closure for " + name + " to be a string");
      overridesRaw = if n == null then null else get n "link_closure_overrides";
      overrides0 = normalizeOverrides name overridesRaw;
      overrideKeys = builtins.attrNames overrides0;
      missingOverrideKeys = builtins.filter (k: !(builtins.elem k linkDeps0)) overrideKeys;
      _overrideKeysValid =
        if missingOverrideKeys == [] then null
        else builtins.throw ("python planner: link_closure_overrides for " + name + " contains keys not present in link_deps: " + (builtins.toString missingOverrideKeys));
      linkDepsOf = nm:
        let
          dn = cleanLabel nm;
          nn = nodeOfName dn;
          raw = if nn == null then null else get nn "link_deps";
        in normalizeLabelList ("link_deps for " + dn) raw;
      resolvedLinkDeps = LC.resolveLinkClosure {
        inherit byName;
        linkDepsOf = linkDepsOf;
        roots = linkDeps0;
        defaultClosure = defaultClosure;
        overrides = overrides0;
      };
      repoLinkPkgs = builtins.map (dn: mkCppLib (ensureRepoCppLibDep name dn)) resolvedLinkDeps;
      repoHeaderPkgs = builtins.map (dn: mkCppHeaders (ensureRepoCppHeadersDep name dn)) headerDeps0;
      includeRoots = builtins.map (p: "${p}/include") repoHeaderPkgs;
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
      lockfile = lockRel;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      srcList = srcsOf name;
      nixCxxAttrs = collectNixAttrsFor name;
      cflags = cflags;
      ldflags = ldflags;
      wheelhouse = wheelhouse;
      buildPyDeps = buildPyDeps;
      repoCxxPkgs = repoLinkPkgs;
      includeRoots = includeRoots;
    };

  backendFor = nm:
    let
      labs = labelsOfName nm;
      hits = builtins.filter (l: (builtins.typeOf l) == "string" && lib.hasPrefix "backend:" l) (if labs == null then [] else labs);
    in if hits == [] then "wasi" else (lib.removePrefix "backend:" (builtins.head hits));

  mkPyExtWasm = name:
    let
      n = nodeOfName name;
      mod = ensureString ("module for " + name) (if n == null then null else get n "module");
      cflags = ensureStringList ("cflags for " + name) (if n == null then null else get n "cflags");
      ldflags = ensureStringList ("ldflags for " + name) (if n == null then null else get n "ldflags");
      buildPyDeps = ensureStringList ("build_py_deps for " + name) (if n == null then null else get n "build_py_deps");
      linkDeps0 = normalizeLabelList ("link_deps for " + name) (if n == null then null else get n "link_deps");
      headerDeps0 = normalizeLabelList ("header_deps for " + name) (if n == null then null else get n "header_deps");
      defaultClosure =
        let raw = if n == null then null else get n "link_closure";
        in if raw == null then "direct"
           else if builtins.isString raw then raw
           else builtins.throw ("python planner: expected link_closure for " + name + " to be a string");
      overridesRaw = if n == null then null else get n "link_closure_overrides";
      overrides0 = normalizeOverrides name overridesRaw;
      overrideKeys = builtins.attrNames overrides0;
      missingOverrideKeys = builtins.filter (k: !(builtins.elem k linkDeps0)) overrideKeys;
      _overrideKeysValid =
        if missingOverrideKeys == [] then null
        else builtins.throw ("python planner: link_closure_overrides for " + name + " contains keys not present in link_deps: " + (builtins.toString missingOverrideKeys));
      linkDepsOf = nm:
        let
          dn = cleanLabel nm;
          nn = nodeOfName dn;
          raw = if nn == null then null else get nn "link_deps";
        in normalizeLabelList ("link_deps for " + dn) raw;
      resolvedLinkDeps = LC.resolveLinkClosure {
        inherit byName;
        linkDepsOf = linkDepsOf;
        roots = linkDeps0;
        defaultClosure = defaultClosure;
        overrides = overrides0;
      };
      hasLabel = nm: l: builtins.elem l (labelsOfName nm);
      ensureSupportedWasmProducer = dep:
        let
          expected = "lang:cpp, kind:wasm, wasm:static";
          got = builtins.toString (labelsOfName dep);
          ok =
            (hasLabel dep "lang:cpp") &&
            (hasLabel dep "kind:wasm") &&
            (hasLabel dep "wasm:static");
        in if ok then true
           else builtins.throw ("python planner (pyext_wasm): " + name + " link_dep '" + dep + "' is unsupported; expected labels " + expected + "; got labels " + got);
      ensureVariantCompatible = dep:
        let
          depIsWasi = hasLabel dep "wasm:wasi";
          wantWasi = backend == "wasi";
        in if wantWasi && (!depIsWasi)
           then builtins.throw ("python planner (pyext_wasm): " + name + " (backend:wasi) cannot link '" + dep + "' (missing label wasm:wasi)")
           else if (!wantWasi) && depIsWasi
           then builtins.throw ("python planner (pyext_wasm): " + name + " (backend:pyodide) cannot link '" + dep + "' (dep is stamped wasm:wasi)")
           else true;
      validatedLinkDeps = builtins.map (dep:
        builtins.seq (ensureSupportedWasmProducer dep)
          (builtins.seq (ensureVariantCompatible dep) dep)
      ) resolvedLinkDeps;
      headerDepsOf = nm:
        let
          nn = nodeOfName nm;
          raw0 = if nn == null then null else get nn "header_deps";
          raw = if raw0 != null then raw0 else (if nn == null then null else get nn "buck.header_deps");
        in normalizeLabelList ("header_deps for " + nm) raw;
      ensureSupportedHeaderDep = dep: hd:
        let
          expected = "lang:cpp, kind:headers";
          got = builtins.toString (labelsOfName hd);
          ok = (hasLabel hd "lang:cpp") && (hasLabel hd "kind:headers");
        in if ok then true
           else builtins.throw ("python planner (pyext_wasm): " + dep + " header_dep '" + hd + "' is unsupported; expected labels " + expected + "; got labels " + got);
      headerIncludeRootsFor = dep:
        let
          headerDeps1 = dedupePreserveOrder (headerDepsOf dep);
          _validated = builtins.map (hd: ensureSupportedHeaderDep dep hd) headerDeps1;
          headerPkgs = builtins.map (hd: T.cppHeaders {
            name = hd;
            srcRoot = repoRoot;
            subdir = (pkgPathOf hd);
            srcList = L.srcsOf hd;
            patches = patchInputsFor hd;
          }) headerDeps1;
        in builtins.map (p: "${p}/include") headerPkgs;
      backend = backendFor name;
      _backendOk =
        if backend == "pyodide" || backend == "wasi" then null
        else builtins.throw ("python planner: kind:pyext_wasm target " + name + " requires backend:wasi or backend:pyodide (got backend:" + backend + ")");
      repoWasmLibs = builtins.map (dep: T.cppWasmStaticLib {
        name = dep;
        srcRoot = repoRoot;
        subdir = (pkgPathOf dep);
        srcList = L.srcsOf dep;
        patches = patchInputsFor dep;
        includes = headerIncludeRootsFor dep;
        wasmTarget = if backend == "wasi" then "wasm32-wasi" else "wasm32-unknown-unknown";
      }) validatedLinkDeps;
      repoHeaderPkgs = builtins.map (dn: mkCppHeaders (ensureRepoCppHeadersDep name dn)) headerDeps0;
      includeRoots = builtins.map (p: "${p}/include") repoHeaderPkgs;
      lockRel = lockRelFor name;
      importerDir =
        if lib.hasSuffix "/uv.lock" lockRel then lib.removeSuffix "/uv.lock" lockRel
        else pkgPathOf name;
      wheelhouse =
        if (builtins.length buildPyDeps) > 0 then (
          T.pyWheelhouse {
            name = name;
            lockfile = lockRel;
            subdir = importerDir;
            srcRoot = repoRoot;
          }
        ) else null;
    in builtins.seq _backendOk (builtins.seq _overrideKeysValid (
      if backend == "pyodide" then (T.pyExtWasm {
        inherit name;
        module = mod;
        srcRoot = repoRoot;
        subdir = pkgPathOf name;
        srcList = srcsOf name;
        cflags = cflags;
        ldflags = ldflags;
        wheelhouse = wheelhouse;
        buildPyDeps = buildPyDeps;
        includeRoots = includeRoots;
        wasmStaticLibs = repoWasmLibs;
      }) else (T.pyExtWasi {
        inherit name;
        module = mod;
        srcRoot = repoRoot;
        subdir = pkgPathOf name;
        srcList = srcsOf name;
        cflags = cflags;
        ldflags = ldflags;
        wheelhouse = wheelhouse;
        buildPyDeps = buildPyDeps;
        includeRoots = includeRoots;
        wasmStaticLibs = repoWasmLibs;
      })
    ));

  # WASM variants (Phase 1: WASI baseline)
  mkWasmApp = name:
    let
      # Determine backend from labels; default to "wasi". Accept labels like "backend:pyodide".
      backend = backendFor name;
      _noPyExt =
        let
          pyExtDeps = collectPyExtDepsTransitive name;
        in if pyExtDeps == [] then null else builtins.throw (
          "python planner: kind:wasm target " + name
          + " (backend:" + backend + ") depends on kind:pyext targets, which are not supported for Python WASM backends: "
          + (builtins.toString pyExtDeps)
        );
      pyExtWasmDeps = collectPyExtWasmDepsTransitive name;
      _pyExtWasmUnsupported =
        if backend == "wasi" && pyExtWasmDeps != [] then builtins.throw (
          "python planner: wasm backend wasi does not support kind:pyext_wasm targets; use backend:pyodide instead. deps="
          + (builtins.toString pyExtWasmDeps)
        ) else null;
      badPyExtBackends =
        builtins.filter (dn: (backendFor dn) != backend) pyExtWasmDeps;
      _pyExtWasmBackendOk =
        if badPyExtBackends == [] then null else builtins.throw (
          "python planner: kind:wasm target " + name
          + " (backend:" + backend + ") depends on kind:pyext_wasm targets with mismatched backend labels: "
          + (builtins.toString badPyExtBackends)
        );
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
      overlays = map mkWasmLib pyLibDeps;
      nativeOverlays =
        if pyExtWasmDeps == [] then [] else map mkPyExtWasm pyExtWasmDeps;
    in builtins.seq _noPyExt (builtins.seq _pyExtWasmUnsupported (builtins.seq _pyExtWasmBackendOk (T.pyWasmApp {
      inherit name;
      lockfile = lockRelFor name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      libOverlays = overlays;
      nativeModuleOverlays = nativeOverlays;
      backend = backend;
      trim = trimFor name;
    })));

  mkWasmLib = name:
    let
      _noPyExt =
        let
          pyExtDeps = collectPyExtDepsTransitive name;
        in if pyExtDeps == [] then null else builtins.throw (
          "python planner: kind:wasm target " + name
          + " depends on kind:pyext targets, which are not supported for Python WASM backends: "
          + (builtins.toString pyExtDeps)
        );
      backend = backendFor name;
      pyExtWasmDeps = collectPyExtWasmDepsTransitive name;
      _pyExtWasmUnsupported =
        if backend == "wasi" && pyExtWasmDeps != [] then builtins.throw (
          "python planner: wasm backend wasi does not support kind:pyext_wasm targets; use backend:pyodide instead. deps="
          + (builtins.toString pyExtWasmDeps)
        ) else null;
      badPyExtBackends =
        builtins.filter (dn: (backendFor dn) != backend) pyExtWasmDeps;
      _pyExtWasmBackendOk =
        if badPyExtBackends == [] then null else builtins.throw (
          "python planner: kind:wasm target " + name
          + " (backend:" + backend + ") depends on kind:pyext_wasm targets with mismatched backend labels: "
          + (builtins.toString badPyExtBackends)
        );
      trimFor = nm:
        let
          labs = labelsOfName nm;
          hits = builtins.filter (l: (builtins.typeOf l) == "string" && lib.hasPrefix "trim:" l) (if labs == null then [] else labs);
        in if hits == [] then "none" else (lib.removePrefix "trim:" (builtins.head hits));
      nativeOverlays =
        if pyExtWasmDeps == [] then [] else map mkPyExtWasm pyExtWasmDeps;
    in
      builtins.seq _noPyExt (builtins.seq _pyExtWasmUnsupported (builtins.seq _pyExtWasmBackendOk (T.pyWasmLib {
        inherit name;
        lockfile = lockRelFor name;
        srcRoot = repoRoot;
        subdir = pkgPathOf name;
        trim = trimFor name;
        nativeModuleOverlays = nativeOverlays;
        backend = backend;
      })));
}

