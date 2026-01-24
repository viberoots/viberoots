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
}:
let
  mkApp = name:
    T.cppApp {
      inherit name;
      srcRoot = repoRoot;
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
            srcRoot = repoRoot;
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
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      srcList = normSrcsOf name;
      patches = patchInputsFor name;
    };

  mkTest = name:
    T.cppTest {
      inherit name;
      srcRoot = repoRoot;
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

  mkAddon = name:
    T.cppNodeAddon {
      inherit name;
      srcRoot = repoRoot;
      subdir = pkgPathOf name;
      nixCxxAttrs = collectNixAttrsFor name;
      nixCxxPkgs = (repoCppHeaderPkgsFor name) ++ (repoCppLibPkgsFor name) ++ (repoGoCArchivesFor name);
      srcList = normSrcsOf name;
      patches = patchInputsFor name;
    };
in {
  inherit mkApp mkLib mkHeaders mkTest mkAddon;
}
