{ lib, ctx, core, cpp }:
let
  T = ctx.T;
  get = ctx.get;
  repoRoot = ctx.repoRoot;
  pkgPathOf = ctx.pkgPathOf;
  LC = import ./link-closure.nix { inherit lib; };

  cleanLabel = core.cleanLabel;
  normalizeLabelList = core.normalizeLabelList;
  normalizeOverrides = core.normalizeOverrides;
  ensureString = core.ensureString;
  ensureStringList = core.ensureStringList;
  nodeOfName = core.nodeOfName;
  labelsOfName = core.labelsOfName;
  depsOfName = core.depsOfName;
  labelsOf = core.labelsOf;
  lockRelFor = core.lockRelFor;
  dedupePreserveOrder = core.dedupePreserveOrder;

  patchInputsFor = cpp.patchInputsFor;
  mkCppHeaders = cpp.mkCppHeaders;
  ensureRepoCppHeadersDep = cpp.ensureRepoCppHeadersDep;

  backendFor = nm:
    let
      labs = labelsOfName nm;
      hits = builtins.filter (l: (builtins.typeOf l) == "string" && lib.hasPrefix "backend:" l) (if labs == null then [] else labs);
    in if hits == [] then "wasi" else (lib.removePrefix "backend:" (builtins.head hits));

  collectPyExtWasmDepsTransitive = name:
    let
      startDeps = depsOfName name;
      go = st: q:
        if q == [] then st.out else
        let
          dn0 = builtins.head q;
          dn = cleanLabel dn0;
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
        inherit (core) byName;
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
            srcList = core.srcsOf hd;
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
        srcList = core.srcsOf dep;
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
        srcList = core.srcsOf name;
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
        srcList = core.srcsOf name;
        cflags = cflags;
        ldflags = ldflags;
        wheelhouse = wheelhouse;
        buildPyDeps = buildPyDeps;
        includeRoots = includeRoots;
        wasmStaticLibs = repoWasmLibs;
      })
    ));
in {
  inherit backendFor collectPyExtWasmDepsTransitive mkPyExtWasm;
}
