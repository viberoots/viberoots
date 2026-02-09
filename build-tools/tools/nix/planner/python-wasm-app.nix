{ lib, ctx, core, pyext, wasmPyExt }:
let
  T = ctx.T;
  get = ctx.get;
  repoRoot = ctx.repoRoot;
  pkgPathOf = ctx.pkgPathOf;

  labelsOfName = core.labelsOfName;
  depsOfName = core.depsOfName;
  lockRelFor = core.lockRelFor;

  collectPyExtDepsTransitive = pyext.collectPyExtDepsTransitive;
  backendFor = wasmPyExt.backendFor;
  collectPyExtWasmDepsTransitive = wasmPyExt.collectPyExtWasmDepsTransitive;
  mkPyExtWasm = wasmPyExt.mkPyExtWasm;

  mkWasmApp = name:
    let
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
      trimFor = nm:
        let
          labs = labelsOfName nm;
          hits = builtins.filter (l: (builtins.typeOf l) == "string" && lib.hasPrefix "trim:" l) (if labs == null then [] else labs);
        in if hits == [] then "none" else (lib.removePrefix "trim:" (builtins.head hits));
      directDeps = depsOfName name;
      pyLibDeps =
        builtins.filter (dn:
          let n = if builtins.hasAttr dn core.byName then core.byName.${dn} else null;
              lbs = if n == null then [] else (get n "labels");
              hasPy = (n != null) && (core.isTarget n);
              isWasmLib = (lbs != null) && (builtins.elem "kind:wasm" lbs && builtins.elem "wasm:lib" lbs);
              isLib = (lbs != null) && (builtins.elem "kind:lib" lbs || isWasmLib);
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
in {
  inherit mkWasmApp mkWasmLib;
}
