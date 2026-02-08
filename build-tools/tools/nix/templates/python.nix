{ pkgs, uv2nixLib ? null }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };
  DevOverrideEnvs = import ../lib/dev-override-envs.nix { inherit pkgs; };

  UvBackend = import ./python/backends/uv.nix { inherit pkgs; uv2nixLib = uv2nixLib; };
  PyExt = import ./python/pyext.nix { inherit pkgs; };
  PyExtWasm = import ./python/pyext-wasm.nix { inherit pkgs; };
  PyExtWasi = import ./python/pyext-wasi.nix { inherit pkgs; };

  mkPy = {
    name,
    lockfile,
    devOverrideEnv ? DevOverrideEnvs.envNameForLang "python",
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [ ../../patches/python ],
    kind ? "app",
    groups ? [],
    nativeModuleOverlays ? [],
  }:
    let
      _guard = H.guardNoDevOverridesInCI devOverrideEnv;
      wsRootEnv = builtins.getEnv "WORKSPACE_ROOT";
      wsRoot =
        if wsRootEnv != "" then wsRootEnv
        else builtins.toString srcRoot;
      patchDir = builtins.toPath ("${wsRoot}/${subdir}/patches/python");
      patchesMap = H.pythonPatchesMapFromDirs { dirs = [ patchDir ]; };
      devOverrides = H.readDevOverrides devOverrideEnv;
      # Also pass through the live workspace root for test-only origin lookups
      # Use a stable snapshot of the app/lib subtree, preferring the live WORKSPACE_ROOT
      # so temp repos created during tests are visible even if srcRoot was store-snapshotted earlier.
      srcAbs =
        let
          baseWS = wsRoot;
          baseSrcRoot = builtins.toString srcRoot;
          baseFlake = builtins.toString ../../..;
          candidate =
            if wsRootEnv != "" && builtins.pathExists (builtins.toPath ("${baseWS}/" + subdir)) then baseWS
            else if builtins.pathExists (builtins.toPath ("${baseSrcRoot}/" + subdir)) then baseSrcRoot
            else if builtins.pathExists (builtins.toPath ("${baseFlake}/" + subdir)) then baseFlake
            else baseSrcRoot;
        in builtins.path { path = builtins.toPath ("${candidate}/" + subdir); name = "py-src"; };
      lockRel = lockfile;
      pname =
        if kind == "app"
        then "py-${H.sanitizeName name}"
        else if kind == "test"
        then "pytest-${H.sanitizeName name}"
        else "pylib-${H.sanitizeName name}";
    in UvBackend {
      inherit pname srcAbs;
      version = "0.1.0";
      lockfile = lockRel;
      subdir = ".";
      patchesMap = patchesMap;
      devOverrides = devOverrides;
      kind = kind;
      wsRoot = wsRoot;
      groups = groups;
      siteOverlays = nativeModuleOverlays;
    };
in {
  pyApp = {
    name,
    lockfile,
    devOverrideEnv ? DevOverrideEnvs.envNameForLang "python",
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [ ../../patches/python ],
    groups ? [],
    nativeModuleOverlays ? [],
  }:
    mkPy {
      inherit name lockfile devOverrideEnv subdir srcRoot patchDirs groups nativeModuleOverlays;
      kind = "app";
    };

  pyLib = {
    name,
    lockfile,
    devOverrideEnv ? DevOverrideEnvs.envNameForLang "python",
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [ ../../patches/python ],
    groups ? [],
    nativeModuleOverlays ? [],
  }:
    mkPy {
      inherit name lockfile devOverrideEnv subdir srcRoot patchDirs groups nativeModuleOverlays;
      kind = "lib";
    };

  pyTest = {
    name,
    lockfile,
    devOverrideEnv ? DevOverrideEnvs.envNameForLang "python",
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [ ../../patches/python ],
    groups ? [ "test" ],
    nativeModuleOverlays ? [],
  }:
    mkPy {
      inherit name lockfile devOverrideEnv subdir srcRoot patchDirs groups nativeModuleOverlays;
      kind = "test";
    };

  pyExt = {
    name,
    module,
    lockfile,
    wheelhouse ? null,
    srcRoot ? ../../..,
    subdir ? ".",
    srcList ? [],
    cflags ? [],
    ldflags ? [],
    nixCxxAttrs ? [],
    buildPyDeps ? [],
    repoCxxPkgs ? [],
    includeRoots ? [],
  }:
    PyExt {
      inherit name module lockfile srcRoot subdir srcList cflags ldflags nixCxxAttrs wheelhouse buildPyDeps repoCxxPkgs includeRoots;
    };

  pyExtWasm = {
    name,
    module,
    wheelhouse ? null,
    srcRoot ? ../../..,
    subdir ? ".",
    srcList ? [],
    cflags ? [],
    ldflags ? [],
    buildPyDeps ? [],
    includeRoots ? [],
    wasmStaticLibs ? [],
  }:
    PyExtWasm {
      inherit name module srcRoot subdir srcList cflags ldflags wheelhouse buildPyDeps includeRoots wasmStaticLibs;
    };

  pyExtWasi = {
    name,
    module,
    wheelhouse ? null,
    srcRoot ? ../../..,
    subdir ? ".",
    srcList ? [],
    cflags ? [],
    ldflags ? [],
    buildPyDeps ? [],
    includeRoots ? [],
    wasmStaticLibs ? [],
  }:
    PyExtWasi {
      inherit name module srcRoot subdir srcList cflags ldflags wheelhouse buildPyDeps includeRoots wasmStaticLibs;
    };

  # Reusable, content-addressed wheelhouse keyed ONLY by lockfile + patches.
  # Dev overrides are intentionally ignored; groups default to [].
  # This realizes a minimal src containing just uv.lock to avoid importer-path churn.
  pyWheelhouse = {
    name,
    lockfile,
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [ ../../patches/python ],
  }:
    let
      wsRootEnv = builtins.getEnv "WORKSPACE_ROOT";
      wsRoot =
        if wsRootEnv != "" then wsRootEnv
        else builtins.toString srcRoot;
      patchDir = builtins.toPath ("${wsRoot}/${subdir}/patches/python");
      patchesMap = H.pythonPatchesMapFromDirs { dirs = [ patchDir ]; };

      # Build a minimal store directory containing only the lockfile at ./uv.lock
      # Lockfile path relative to repo root (flake calls pass importer+'/uv.lock')
      importerLockAbs = builtins.toPath ("${builtins.toString srcRoot}/${lockfile}");
      lockOnlySrc = pkgs.runCommand "py-lock-only-src" {} ''
        set -euo pipefail
        mkdir -p "$out"
        cp ${builtins.path { path = importerLockAbs; name = "uv.lock"; }} "$out/uv.lock"
      '';
      # Use a constant pname so identical inputs across importers yield identical store paths.
      pname = "py-wheelhouse";
    in UvBackend {
      inherit pname;
      version = "0.1.0";
      srcAbs = lockOnlySrc;
      lockfile = "uv.lock";
      subdir = ".";
      patchesMap = patchesMap;
      devOverrides = {};
      kind = "lib";
      wsRoot = builtins.toString srcRoot;
      groups = [];
    };
}


