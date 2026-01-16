{ pkgs, uv2nixLib ? null }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };
  DevOverrideEnvs = import ../lib/dev-override-envs.nix { inherit pkgs; };

  UvBackend = import ./python/backends/uv.nix { inherit pkgs; uv2nixLib = uv2nixLib; };
  PyExt = import ./python/pyext.nix { inherit pkgs; };

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
      # Prefer scanning importer-local patches under <subdir>/patches/python using shared helper
      patchesMap = H.patchesMapFromImporterDirToStore {
        inherit srcRoot subdir;
        lang = "python";
        normalizeVersion = (v: lib.head (lib.splitString "-" v));
        namePrefix = "py-patch";
      };
      devOverrides = H.readDevOverrides devOverrideEnv;
      # Also pass through the live workspace root for test-only origin lookups
      wsRootEnv = builtins.getEnv "WORKSPACE_ROOT";
      wsRoot =
        if wsRootEnv != "" then wsRootEnv
        else builtins.toString srcRoot;
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
      # Compute lockfile path relative to srcAbs to keep builds hermetic.
      lockRel =
        let lf = lockfile;
            withPrefix = subdir + "/";
        in if lib.hasPrefix withPrefix lf then lib.removePrefix withPrefix lf
           else (
             if lib.hasSuffix "/uv.lock" lf then "uv.lock" else lf
           );
      pname =
        if kind == "app"
        then "py-${H.sanitizeName name}"
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

  pyExt = {
    name,
    module,
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
      inherit name module srcRoot subdir srcList cflags ldflags nixCxxAttrs wheelhouse buildPyDeps repoCxxPkgs includeRoots;
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
      # Compute importer-local patch map exactly as mkPy (reuse logic to ensure identical keys).
      patchesMap = H.patchesMapFromImporterDirToStore {
        inherit srcRoot subdir;
        lang = "python";
        normalizeVersion = (v: lib.head (lib.splitString "-" v));
        namePrefix = "py-patch";
      };

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


