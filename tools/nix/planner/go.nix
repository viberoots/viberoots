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
  LC = import ./link-closure.nix { inherit lib; };
  depsOfName = nm:
    let n = if builtins.hasAttr nm byName then byName.${nm} else null;
    in if n == null then [] else L.depsOf n;
  labelsOfName = nm:
    let n = if builtins.hasAttr nm byName then byName.${nm} else null;
    in if n == null then [] else L.labelsOf n;
  nodeOfName = nm:
    if builtins.hasAttr nm byName then byName.${nm}
    else builtins.throw "go planner: unknown node '${nm}' (missing from byName)";
  ensureStringList = ctxStr: xs:
    if xs == null then []
    else if builtins.isList xs && builtins.all (x: builtins.isString x) xs then xs
    else builtins.throw "go planner: expected ${ctxStr} to be a list of strings";
  ensureStringAttrs = ctxStr: x:
    if x == null then {}
    else if builtins.isAttrs x then x
    else builtins.throw "go planner: expected ${ctxStr} to be an attrset";
  normalizeLabelList = ctxStr: xs:
    builtins.map L.cleanLabel (ensureStringList ctxStr xs);
  normalizeOverrides = name: overridesRaw:
    let
      overrides0 = ensureStringAttrs "link_closure_overrides for '${name}'" overridesRaw;
      keys = builtins.attrNames overrides0;
      pairs = builtins.map (k: { name = L.cleanLabel k; value = overrides0.${k}; }) keys;
      _ = builtins.map (p:
        if builtins.isString p.value then true
        else builtins.throw "go planner: expected link_closure_overrides['${p.name}'] to be a string"
      ) pairs;
      names = builtins.map (p: p.name) pairs;
      uniqNames = builtins.attrNames (builtins.listToAttrs (builtins.map (n: { name = n; value = true; }) names));
      _dupes =
        if (builtins.length uniqNames) == (builtins.length names) then null
        else builtins.throw "go planner: normalized link_closure_overrides has duplicate keys for '${name}'";
    in builtins.listToAttrs pairs;
  dedupePreserveOrder = xs:
    let
      step = st: x:
        if builtins.hasAttr x st.seen
        then st
        else { seen = st.seen // { "${x}" = true; }; out = st.out ++ [ x ]; };
      st0 = { seen = {}; out = []; };
    in (builtins.foldl' step st0 xs).out;
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
  patchInputsFor = name:
    let
      rels0 = builtins.filter (s: lib.hasSuffix ".patch" s) (L.srcsOf name);
      rels = builtins.filter (s: !(lib.hasInfix "placeholder" s)) rels0;
      pkg = pkgPathOf name;
      toImportedPath = p: builtins.path {
        path = (repoRoot + "/" + pkg + "/" + p);
        name = "patch";
      };
    in builtins.map toImportedPath rels;
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
        isWasmLabel = lbs != null && builtins.elem "kind:wasm" lbs;
    in if (lbs != null && builtins.elem "kind:carchive" lbs) then "lib"
         else if isWasmLabel then "tinywasm"
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

  # Build a TinyGo WebAssembly module that optionally links C/C++ wasm archives
  mkTinyWasm = name:
    let
      consumer = nodeOfName name;
      linkDepsRaw =
        let v = get consumer "link_deps";
        in if v != null then v else (get consumer "buck.link_deps");
      linkDeps = normalizeLabelList "link_deps for '${name}'" linkDepsRaw;
      defaultClosure =
        let raw0 = get consumer "link_closure";
            raw = if raw0 != null then raw0 else (get consumer "buck.link_closure");
        in if raw == null then "direct" else raw;
      overridesRaw =
        let v = get consumer "link_closure_overrides";
        in if v != null then v else (get consumer "buck.link_closure_overrides");
      overrides = normalizeOverrides name overridesRaw;
      backend = builtins.getEnv "WEB_WASM_BACKEND";
      tinyTarget = if backend == "wasi_single" then "wasi" else "wasm";
      wasmTarget = if tinyTarget == "wasi" then "wasm32-wasi" else "wasm32-unknown-unknown";

      linkDepsOf = nm:
        let n = nodeOfName nm;
            raw0 = get n "link_deps";
            raw = if raw0 != null then raw0 else (get n "buck.link_deps");
        in normalizeLabelList "link_deps for '${nm}'" raw;

      resolved = LC.resolveLinkClosure {
        inherit byName;
        linkDepsOf = linkDepsOf;
        roots = linkDeps;
        defaultClosure = defaultClosure;
        overrides = overrides;
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
           else builtins.throw "go planner (mkTinyWasm): ${name} link_dep '${dep}' is unsupported; expected labels ${expected}; got labels ${got}";

      ensureVariantCompatible = dep:
        let
          depIsWasi = hasLabel dep "wasm:wasi";
          wantWasi = tinyTarget == "wasi";
        in if wantWasi && (!depIsWasi)
           then builtins.throw "go planner (mkTinyWasm): ${name} (target=wasi) cannot link '${dep}' (missing label wasm:wasi)"
           else if (!wantWasi) && depIsWasi
           then builtins.throw "go planner (mkTinyWasm): ${name} (target=wasm) cannot link '${dep}' (dep is stamped wasm:wasi)"
           else true;

      # Validate dep shape before variant compatibility so error messages stay targeted:
      # a non-wasm producer should fail as "unsupported", not as a variant mismatch.
      validated = builtins.map (dep:
        builtins.seq (ensureSupportedWasmProducer dep)
          (builtins.seq (ensureVariantCompatible dep) dep)
      ) resolved;

      headerDepsOf = nm:
        let
          n = nodeOfName nm;
          raw0 = get n "header_deps";
          raw = if raw0 != null then raw0 else (get n "buck.header_deps");
        in normalizeLabelList "header_deps for '${nm}'" raw;
      ensureSupportedHeaderDep = dep: hd:
        let
          expected = "lang:cpp, kind:headers";
          got = builtins.toString (labelsOfName hd);
          ok = (hasLabel hd "lang:cpp") && (hasLabel hd "kind:headers");
        in if ok then true
           else builtins.throw "go planner (mkTinyWasm): ${dep} header_dep '${hd}' is unsupported; expected labels ${expected}; got labels ${got}";
      headerIncludeRootsFor = dep:
        let
          headerDeps0 = headerDepsOf dep;
          headerDeps = dedupePreserveOrder headerDeps0;
          _validated = builtins.map (hd: ensureSupportedHeaderDep dep hd) headerDeps;
          headerPkgs = builtins.map (hd: T.cppHeaders {
            name = hd;
            srcRoot = repoRoot;
            subdir = (pkgPathOf hd);
            srcList = L.srcsOf hd;
            patches = patchInputsFor hd;
          }) headerDeps;
        in builtins.map (p: "${p}/include") headerPkgs;
      repoWasmLibs = builtins.map (dep: T.cppWasmStaticLib {
        name = dep;
        srcRoot = repoRoot;
        subdir = (pkgPathOf dep);
        srcList = L.srcsOf dep;
        patches = patchInputsFor dep;
        includes = headerIncludeRootsFor dep;
        wasmTarget = wasmTarget;
      }) validated;
    in T.goTinyWasmLib {
      inherit name;
      # TinyGo build uses module sources directly; gomod2nix not required here
      srcRoot = repoRoot;
      subdir = (pkgPathOf name);
      wasmStaticLibs = repoWasmLibs;
      wasmStaticLibLabels = validated;
      target = tinyTarget;
    };
}

