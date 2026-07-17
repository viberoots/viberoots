{ lib }:
{
  T,
  get,
  repoRoot,
  pkgPathOf,
  byName,
  L,
  LC,
  normalizeLabelList,
  normalizeOverrides,
  dedupePreserveOrder,
  labelsOfName,
  nodeOfName,
  wasmBackend
}:
let
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
  hasLabel = nm: l: builtins.elem l (labelsOfName nm);
  linkDepsOf = nm:
    let
      n = nodeOfName nm;
      raw0 = get n "link_deps";
      raw = if raw0 != null then raw0 else (get n "buck.link_deps");
    in normalizeLabelList "link_deps for '${nm}'" raw;
  headerDepsOf = nm:
    let
      n = nodeOfName nm;
      raw0 = get n "header_deps";
      raw = if raw0 != null then raw0 else (get n "buck.header_deps");
    in normalizeLabelList "header_deps for '${nm}'" raw;
  ensureSupportedWasmProducer = name: dep:
    let
      expected = "lang:cpp, kind:wasm, wasm:static";
      got = builtins.toString (labelsOfName dep);
      ok =
        (hasLabel dep "lang:cpp") &&
        (hasLabel dep "kind:wasm") &&
        (hasLabel dep "wasm:static");
    in if ok then true
       else builtins.throw "go planner (mkTinyWasm): ${name} link_dep '${dep}' is unsupported; expected labels ${expected}; got labels ${got}";
  ensureVariantCompatible = name: tinyTarget: dep:
    let
      depIsWasi = hasLabel dep "wasm:wasi";
      wantWasi = tinyTarget == "wasi";
    in if wantWasi && (!depIsWasi)
       then builtins.throw "go planner (mkTinyWasm): ${name} (target=wasi) cannot link '${dep}' (missing label wasm:wasi)"
       else if (!wantWasi) && depIsWasi
       then builtins.throw "go planner (mkTinyWasm): ${name} (target=wasm) cannot link '${dep}' (dep is stamped wasm:wasi)"
       else true;
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
in {
  mkTinyWasm = name:
    let
      consumer = nodeOfName name;
      linkDepsRaw =
        let v = get consumer "link_deps";
        in if v != null then v else (get consumer "buck.link_deps");
      linkDeps = normalizeLabelList "link_deps for '${name}'" linkDepsRaw;
      defaultClosure =
        let
          raw0 = get consumer "link_closure";
          raw = if raw0 != null then raw0 else (get consumer "buck.link_closure");
        in if raw == null then "direct" else raw;
      overridesRaw =
        let v = get consumer "link_closure_overrides";
        in if v != null then v else (get consumer "buck.link_closure_overrides");
      overrides = normalizeOverrides name overridesRaw;
      overridesSummary =
        let
          ordered = builtins.filter (dep: builtins.hasAttr dep overrides) linkDeps;
          entries = builtins.map (dep: "${dep}=${overrides.${dep}}") ordered;
        in lib.concatStringsSep "," entries;
      backend = wasmBackend;
      tinyTarget = if backend == "wasi_single" then "wasi" else "wasm";
      wasmTarget = if tinyTarget == "wasi" then "wasm32-wasi" else "wasm32-unknown-unknown";

      resolved = LC.resolveLinkClosure {
        inherit byName;
        linkDepsOf = linkDepsOf;
        roots = linkDeps;
        defaultClosure = defaultClosure;
        overrides = overrides;
      };

      validated = builtins.map (dep:
        builtins.seq (ensureSupportedWasmProducer name dep)
          (builtins.seq (ensureVariantCompatible name tinyTarget dep) dep)
      ) resolved;

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
      srcRoot = repoRoot;
      subdir = (pkgPathOf name);
      wasmStaticLibs = repoWasmLibs;
      wasmStaticLibLabels = validated;
      linkClosureOverridesSummary = overridesSummary;
      target = tinyTarget;
    };
}
