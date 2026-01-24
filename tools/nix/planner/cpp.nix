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
  cleanLabel = L.cleanLabel;
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
      isPlanner = (nm != null) && (lib.hasSuffix "__planner" nm);
    in if builtins.elem "kind:test" labs || isPlanner then "test"
      else if builtins.elem "kind:bin" labs then "bin"
      else if builtins.elem "kind:headers" labs then "headers"
      else if builtins.elem "kind:lib" labs then "lib"
      else if builtins.elem "kind:addon" labs then "addon"
      else if rt == "cxx_test" then "test"
      else if rt == "cxx_binary" then "bin"
      else if rt == "cxx_library" then (if isPlanner then "test" else "lib")
      else null;

  nodes = if builtins.hasAttr "nodes" ctx then ctx.nodes else [];
  byName = L.byName;

  labelsOf = L.labelsOf;

  nameOf = L.nameOf;

  depsOf = L.depsOf;

  srcsOf = name: L.srcsOf name;

  normSrcsOf = name: srcsOf name;

  isNixLabel = l: lib.hasPrefix "nixpkg:" l;
  attrFrom = l: lib.removePrefix "nixpkg:" l;

  ensureStringList = ctx: xs:
    if xs == null then []
    else if builtins.isList xs && builtins.all (x: builtins.isString x) xs then xs
    else builtins.throw ("cpp planner: expected " + ctx + " to be a list of strings");

  nodeOfName = nm: if builtins.hasAttr nm byName then byName.${nm} else null;

  Phase1 = import ./cpp-phase1-helpers.nix {
    inherit lib get cleanLabel ensureStringList nodeOfName kindOf labelsOf hasLangCpp;
    normSrcsOf = normSrcsOf;
    pkgPathOf = pkgPathOf;
    repoRoot = ctx.repoRoot;
  };

  LinkHelpers = import ./cpp-link-helpers.nix {
    inherit lib get cleanLabel ensureStringList nodeOfName;
  };

  repoGoCArchivesFor = import ./cpp-go-archives.nix {
    inherit lib L T byName srcsOf pkgPathOf;
    modulesTomlFor = ctx.modulesTomlFor;
    repoRoot = ctx.repoRoot;
  };

  labelsFromNodeAttr = Phase1.labelsFromNodeAttr;
  dedupePreserveOrder = Phase1.dedupePreserveOrder;
  ensureRepoCppLibDep = Phase1.ensureRepoCppLibDep;
  ensureRepoCppHeadersDep = Phase1.ensureRepoCppHeadersDep;
  patchInputsFor = Phase1.patchInputsFor;
  LC = import ./link-closure.nix { inherit lib; };
  normalizeLabelList = LinkHelpers.normalizeLabelList;
  normalizeOverrides = LinkHelpers.normalizeOverrides;
  linkModeOf = LinkHelpers.linkModeOf;

  repoCppLibPkgsFor = name:
    let
      consumer = nodeOfName name;
      linkDeps0 = labelsFromNodeAttr { inherit name; attr = "link_deps"; };
      linkDeps = dedupePreserveOrder linkDeps0;
      consumerLinkMode = linkModeOf name;
      defaultClosure =
        let raw = if consumer == null then null else get consumer "link_closure";
        in if raw == null then "direct"
           else if builtins.isString raw then raw
           else builtins.throw ("cpp planner: expected link_closure for " + name + " to be a string");
      overridesRaw = if consumer == null then null else get consumer "link_closure_overrides";
      overrides0 = normalizeOverrides name overridesRaw;
      overrideKeys = builtins.attrNames overrides0;
      missingOverrideKeys = builtins.filter (k: !(builtins.elem k linkDeps)) overrideKeys;
      _overrideKeysValid =
        if missingOverrideKeys == [] then null
        else builtins.throw ("cpp planner: link_closure_overrides for " + name + " contains keys not present in link_deps: " + (builtins.toString missingOverrideKeys));

      linkDepsOf = nm:
        let
          n = nodeOfName nm;
          raw = if n == null then null else get n "link_deps";
          xs = normalizeLabelList ("link_deps for " + nm) raw;
        in dedupePreserveOrder xs;

      resolved = LC.resolveLinkClosure {
        inherit byName;
        linkDepsOf = linkDepsOf;
        roots = linkDeps;
        defaultClosure = defaultClosure;
        overrides = overrides0;
      };

      ensureSharedLinkDep = consumerName: depName:
        let mode = linkModeOf depName; in
          if mode == "shared" then depName
          else builtins.throw ("cpp planner: link_mode=shared for " + consumerName + " requires shared producer " + depName + " (expected link_mode=\"shared\" on the dep)");
      enforceLinkMode =
        if consumerLinkMode == "shared"
        then builtins.map (dn: ensureSharedLinkDep name dn) resolved
        else resolved;
      validated = builtins.map (dn: ensureRepoCppLibDep name dn) enforceLinkMode;
    in builtins.map mkLib validated;

  repoCppHeaderPkgsFor = name:
    let
      headerDeps0 = labelsFromNodeAttr { inherit name; attr = "header_deps"; };
      headerDeps = dedupePreserveOrder headerDeps0;
      validated = builtins.map (dn: ensureRepoCppHeadersDep name dn) headerDeps;
    in builtins.map mkHeaders validated;

  collectNixAttrsFor = name:
    let
      labels = L.collectLabelsWithPrefix name "nixpkg:";
      attrs = map attrFrom labels;
      uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
    in builtins.sort (a: b: a < b) (uniq attrs);

  nixAttrsFromSelf = name:
    let n = if builtins.hasAttr name byName then byName.${name} else null; in
      if n == null then [] else (map attrFrom (builtins.filter isNixLabel (L.labelsOf n)));

  providerAttrsFallback =
    (import ./cpp-provider-attrs-fallback.nix {
      inherit lib get nodes;
      cleanLabel = L.cleanLabel;
    }).providerAttrsFallback;

  mkApp = name:
    T.cppApp {
      inherit name;
      srcRoot = ctx.repoRoot;
      subdir = pkgPathOf name;
      nixCxxAttrs = collectNixAttrsFor name;
      nixCxxPkgs = (repoCppHeaderPkgsFor name) ++ (repoCppLibPkgsFor name) ++ (repoGoCArchivesFor name);
      srcList = normSrcsOf name;
      patches = patchInputsFor name;
    };

  mkLib = name:
    let
      n = if builtins.hasAttr name byName then byName.${name} else null;
      labs = if n == null then [] else labelsOf n;
      isWasmStatic = builtins.elem "flavor:wasm" labs || builtins.elem "wasm:static" labs;
      isEmscripten = builtins.elem "flavor:emscripten" labs || builtins.elem "wasm:emscripten" labs;
      wantWasi = builtins.elem "wasm:wasi" labs;
      headerPkgsForWasm =
        if isWasmStatic then (repoCppHeaderPkgsFor name) else [];
      includeRootsForWasm = builtins.map (p: "${p}/include") headerPkgsForWasm;
      mode = linkModeOf name;
    in
      (
        let
          baseAttrs = {
            inherit name;
            srcRoot = ctx.repoRoot;
            subdir = pkgPathOf name;
            nixCxxAttrs = collectNixAttrsFor name;
            srcList = normSrcsOf name;
            patches = patchInputsFor name;
          };
          wasmAttrs =
            if isWasmStatic
            then { wasmTarget = if wantWasi then "wasm32-wasi" else "wasm32-unknown-unknown"; }
            else {};
          wasmHeaderAttrs = if isWasmStatic then { includes = includeRootsForWasm; } else {};
          wasmLibAttrs = baseAttrs // wasmAttrs // wasmHeaderAttrs;
          nativeLibAttrs = baseAttrs // {
            nixCxxPkgs =
              if mode == "shared"
              then (repoCppHeaderPkgsFor name) ++ (repoCppLibPkgsFor name)
              else repoCppHeaderPkgsFor name;
          };
        in
          if isEmscripten then T.cppWasmEmscriptenLib wasmLibAttrs
          else if isWasmStatic then T.cppWasmStaticLib wasmLibAttrs
          else if mode == "shared" then T.cppSharedLib nativeLibAttrs
          else T.cppLib nativeLibAttrs
      );

  mkHeaders = name:
    let
      mode = linkModeOf name;
      _ = if mode == "shared"
        then builtins.throw ("cpp planner: link_mode=shared is invalid for header-only target " + name + " (expected kind:headers without shared linkage)")
        else null;
    in T.cppHeaders {
      inherit name;
      srcRoot = ctx.repoRoot;
      subdir = pkgPathOf name;
      srcList = normSrcsOf name;
      patches = patchInputsFor name;
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
      nixCxxPkgs = (repoCppHeaderPkgsFor name) ++ (repoCppLibPkgsFor name) ++ (repoGoCArchivesFor name);
      srcList = normSrcsOf name;
      patches = patchInputsFor name;
    };
  # Node-API addon builder (produces .node)
  mkAddon = name:
    T.cppNodeAddon {
      inherit name;
      srcRoot = ctx.repoRoot;
      subdir = pkgPathOf name;
      nixCxxAttrs = collectNixAttrsFor name;
      nixCxxPkgs = (repoCppHeaderPkgsFor name) ++ (repoCppLibPkgsFor name) ++ (repoGoCArchivesFor name);
      srcList = normSrcsOf name;
      patches = patchInputsFor name;
    };
in {
  isTarget = n: (isCxx n) || (hasLangCpp n);
  inherit kindOf mkApp mkLib mkHeaders mkTest mkAddon;
  modulesFileFor = name: "";
}
