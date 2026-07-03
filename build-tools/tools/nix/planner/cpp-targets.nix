{ lib
, T
, byName
, labelsOf
, linkModeOf
, pkgPathOf
, repoRoot
, normSrcsOf
, patchInputsFor
, collectNixAttrsFor
, nixAttrsFromSelf
, repoCppHeaderPkgsFor
, repoCppLibPkgsFor
, repoGoCArchivesFor
, providerAttrsFallback
, resolveNixpkgAttrs
, sourcePlanFor
}:
let
  nodeFor = name: if builtins.hasAttr name byName then byName.${name} else {};

  templateFor = name:
    let plan = sourcePlanFor (nodeFor name); in T.cppForPkgs plan.base_pkgs;

  profileFor = name:
    let plan = sourcePlanFor (nodeFor name); in plan.nixpkgs_profile;

  resolveNixPkgsFor = name: attrs:
    let
      records = resolveNixpkgAttrs {
        target = nodeFor name;
        attrs = attrs;
      };
      missing = builtins.filter (r: r.package == null) records;
      missingText = builtins.concatStringsSep ", " (
        map (r: r.attr + " from " + r.profile_name) missing
      );
    in
      if missing == [] then map (r: r.package) records
      else builtins.throw (
        "cpp planner: unresolved nixpkg attrs for " + name + ": " + missingText
      );

  mkApp = name:
    let
      attrs = collectNixAttrsFor name;
      TP = templateFor name;
    in TP.cppApp {
      inherit name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      nixpkgsProfile = profileFor name;
      nixCxxAttrs = [];
      nixCxxPkgs = (repoCppHeaderPkgsFor name) ++ (repoCppLibPkgsFor name) ++ (repoGoCArchivesFor name) ++ (resolveNixPkgsFor name attrs);
      srcList = normSrcsOf name;
      patches = patchInputsFor name;
    };

  mkLib = name:
    let
      n = if builtins.hasAttr name byName then byName.${name} else null;
      labs = if n == null then [] else labelsOf n;
      attrs = collectNixAttrsFor name;
      TP = templateFor name;
      isWasmStatic = builtins.elem "flavor:wasm" labs || builtins.elem "wasm:static" labs;
      isEmscripten = builtins.elem "flavor:emscripten" labs || builtins.elem "wasm:emscripten" labs;
      wantWasi = builtins.elem "wasm:wasi" labs;
      exportedFunctions =
        if n == null then null
        else if (n ? exportedFunctions) && builtins.isList n.exportedFunctions then n.exportedFunctions
        else if (n ? "buck.exportedFunctions") && builtins.isList n."buck.exportedFunctions" then n."buck.exportedFunctions"
        else if (n ? exported_functions) && builtins.isList n.exported_functions then n.exported_functions
        else if (n ? "buck.exported_functions") && builtins.isList n."buck.exported_functions" then n."buck.exported_functions"
        else null;
      headerPkgsForWasm =
        if isWasmStatic then (repoCppHeaderPkgsFor name) else [];
      includeRootsForWasm = builtins.map (p: "${p}/include") headerPkgsForWasm;
      mode = linkModeOf name;
    in
      (
        let
          baseAttrs = {
            inherit name;
            srcRoot = repoRoot;
            subdir = pkgPathOf name;
            nixpkgsProfile = profileFor name;
            nixCxxAttrs = [];
            nixCxxPkgs = resolveNixPkgsFor name attrs;
            srcList = normSrcsOf name;
            patches = patchInputsFor name;
          };
          wasmAttrs =
            if isWasmStatic
            then { wasmTarget = if wantWasi then "wasm32-wasi" else "wasm32-unknown-unknown"; }
            else {};
          wasmHeaderAttrs = if isWasmStatic then { includes = includeRootsForWasm; } else {};
          wasmLibAttrs = baseAttrs // wasmAttrs // wasmHeaderAttrs;
          emscriptenAttrs =
            if exportedFunctions != null && exportedFunctions != []
            then { exportedFunctions = exportedFunctions; }
            else {};
          nativeLibAttrs = baseAttrs // {
            nixCxxPkgs =
              if mode == "shared"
              then (repoCppHeaderPkgsFor name) ++ (repoCppLibPkgsFor name) ++ (resolveNixPkgsFor name attrs)
              else repoCppHeaderPkgsFor name ++ (resolveNixPkgsFor name attrs);
          };
        in
          if isEmscripten then TP.cppWasmEmscriptenLib (wasmLibAttrs // emscriptenAttrs)
          else if isWasmStatic then TP.cppWasmStaticLib wasmLibAttrs
          else if mode == "shared" then TP.cppSharedLib nativeLibAttrs
          else TP.cppLib nativeLibAttrs
      );

  mkHeaders = name:
    let
      mode = linkModeOf name;
      _ = if mode == "shared"
        then builtins.throw ("cpp planner: link_mode=shared is invalid for header-only target " + name + " (expected kind:headers without shared linkage)")
        else null;
      TP = templateFor name;
    in TP.cppHeaders {
      inherit name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      nixpkgsProfile = profileFor name;
      srcList = normSrcsOf name;
      patches = patchInputsFor name;
    };

  mkTest = name:
    let
      TP = templateFor name;
      attrs =
        let
          fromDeps = collectNixAttrsFor name;
          fromSelf = nixAttrsFromSelf name;
          merged = fromDeps ++ fromSelf;
          uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
          all = builtins.sort (a: b: a < b) (uniq merged);
        in if all == [] then providerAttrsFallback else all;
    in TP.cppTest {
      inherit name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      nixpkgsProfile = profileFor name;
      nixCxxAttrs = [];
      nixCxxAttrNames = attrs;
      nixCxxPkgs = (repoCppHeaderPkgsFor name) ++ (repoCppLibPkgsFor name) ++ (repoGoCArchivesFor name) ++ (resolveNixPkgsFor name attrs);
      srcList = normSrcsOf name;
      patches = patchInputsFor name;
    };

  mkAddon = name:
    let
      attrs = collectNixAttrsFor name;
      TP = templateFor name;
    in TP.cppNodeAddon {
      inherit name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      nixpkgsProfile = profileFor name;
      nixCxxAttrs = [];
      nixCxxPkgs = (repoCppHeaderPkgsFor name) ++ (repoCppLibPkgsFor name) ++ (repoGoCArchivesFor name) ++ (resolveNixPkgsFor name attrs);
      srcList = normSrcsOf name;
      patches = patchInputsFor name;
    };
in {
  inherit mkApp mkLib mkHeaders mkTest mkAddon;
}
