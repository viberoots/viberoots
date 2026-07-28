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
  dependencyArtifactOf,
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
  value = node: field: fallback:
    let found = get node field;
    in if found == null || found == "" then fallback else found;
  sourcePathFor = name: raw:
    let
      clean = lib.replaceStrings [ ":" ] [ "/" ] raw;
      relative =
        if lib.hasPrefix "root//" clean then lib.removePrefix "root//" clean
        else if lib.hasPrefix "//" clean then lib.removePrefix "//" clean
        else "${pkgPathOf name}/${clean}";
    in repoRoot + "/${relative}";
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
      expected = "wasm:static plus lang:cpp or lang:rust";
      got = builtins.toString (labelsOfName dep);
      ok =
        (hasLabel dep "kind:wasm") &&
        (hasLabel dep "wasm:static") &&
        ((hasLabel dep "lang:cpp") || (hasLabel dep "lang:rust"));
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
  ensureAuthorityCompatible = name: tinyTarget: dep:
    let
      node = nodeOfName dep;
      cpp = hasLabel dep "lang:cpp";
      expectedTarget = if tinyTarget == "wasi" then "wasm32-wasip1"
        else "wasm32-unknown-unknown";
      claimedTarget = value node "wasm_target" "";
      targetCompatible = claimedTarget == expectedTarget
        || (cpp && tinyTarget == "wasi" && claimedTarget == "wasm32-wasi");
      allocator = value node "wasm_allocator" "";
      libc = value node "wasm_libc" "";
      expectedLibc = if tinyTarget == "wasi" then "wasi-libc" else "none";
      exceptionPolicy = value node "wasm_exception_policy" "";
      runtime = value node "wasm_runtime" "";
    in if !targetCompatible then builtins.throw
      "go planner (mkTinyWasm): ${name} link_dep '${dep}' has incompatible target authority ${claimedTarget}"
    else if !(builtins.elem allocator [ "none" "rust" ]) then builtins.throw
      "go planner (mkTinyWasm): ${name} link_dep '${dep}' has incompatible allocator authority ${allocator}"
    else if libc != expectedLibc then builtins.throw
      "go planner (mkTinyWasm): ${name} link_dep '${dep}' has incompatible libc authority ${libc}; expected ${expectedLibc}"
    else if !(builtins.elem exceptionPolicy [ "none" "trap" ]) then builtins.throw
      "go planner (mkTinyWasm): ${name} link_dep '${dep}' has incompatible exception authority ${exceptionPolicy}"
    else if runtime != "link-only" then builtins.throw
      "go planner (mkTinyWasm): ${name} link_dep '${dep}' has incompatible runtime authority ${runtime}"
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
      linkKind = value consumer "wasm_link_kind" "module";
      abiExplicit = value consumer "wasm_abi_explicit" false;
      abi =
        if abiExplicit
        then value consumer "wasm_abi" "bare"
        else if backend == "wasi_single" then "wasi" else "bare";
      tinyTarget = if abi == "wasi" then "wasi" else "wasm";
      compilerTarget =
        if linkKind == "static" && tinyTarget == "wasm" then "wasm-unknown" else tinyTarget;
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
          (builtins.seq (ensureVariantCompatible name tinyTarget dep)
            (builtins.seq (ensureAuthorityCompatible name tinyTarget dep) dep))
      ) resolved;

      repoWasmLibs = builtins.map (dep:
        if hasLabel dep "lang:rust" then dependencyArtifactOf dep
        else T.cppWasmStaticLib {
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
      target = compilerTarget;
      outputKind = linkKind;
      artifactName = builtins.elemAt (lib.splitString ":" name) 1;
      wasmHeader = let header = get consumer "wasm_header";
        in if header == null then null else sourcePathFor name header;
    };
}
