{ pkgs }:
let
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };

  UvBackend = import ./python/backends/uv.nix { inherit pkgs; };

  mkPy = {
    name,
    lockfile,
    devOverrideEnv ? "NIX_PY_DEV_OVERRIDE_JSON",
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [ ../../patches/python ],
    kind ? "app",
    groups ? [],
  }:
    let
      _guard = H.guardNoDevOverridesInCI devOverrideEnv;
      # Prefer scanning importer-local patches under <subdir>/patches/python
      patchDirAbs =
        let
          rootStr = builtins.toString srcRoot;
        in
          builtins.toPath ("${rootStr}/${subdir}/patches/python");
      patchesMap =
        if builtins.pathExists patchDirAbs then
          let
            names = builtins.attrNames (builtins.readDir patchDirAbs);
            isPatch = name: lib.hasSuffix ".patch" name;
            toKeyVal = name:
              let
                base = lib.removeSuffix ".patch" name;
                parts = lib.splitString "@" base;
                impEnc = lib.concatStringsSep "@" (lib.take (lib.length parts - 1) parts);
                ver = lib.last parts;
                importPath = lib.replaceStrings ["__"] ["/"] impEnc;
                key = (lib.toLower importPath) + "@" + (lib.toLower ver);
                content = builtins.readFile (patchDirAbs + "/" + name);
                storeFile = pkgs.writeText "py-patch-${key}.patch" content;
              in { name = key; value = [ (builtins.toString storeFile) ]; };
          in builtins.listToAttrs (map toKeyVal (lib.filter isPatch names))
        else {};
      devOverrides = H.readDevOverrides devOverrideEnv;
      # Use a stable snapshot of the app/lib subtree, including vendored test fixtures
      srcAbs = builtins.path { path = builtins.toPath ("${srcRoot}/" + subdir); name = "py-src"; };
      # Also pass through the live workspace root for test-only origin lookups
      wsRootEnv = builtins.getEnv "WORKSPACE_ROOT";
      wsRoot =
        if wsRootEnv != "" then wsRootEnv
        else builtins.toString srcRoot;
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
      subdir = subdir;
      patchesMap = patchesMap;
      devOverrides = devOverrides;
      kind = kind;
      wsRoot = wsRoot;
      groups = groups;
    };
in {
  pyApp = {
    name,
    lockfile,
    devOverrideEnv ? "NIX_PY_DEV_OVERRIDE_JSON",
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [ ../../patches/python ],
    groups ? [],
  }:
    mkPy {
      inherit name lockfile devOverrideEnv subdir srcRoot patchDirs groups;
      kind = "app";
    };

  pyLib = {
    name,
    lockfile,
    devOverrideEnv ? "NIX_PY_DEV_OVERRIDE_JSON",
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [ ../../patches/python ],
    groups ? [],
  }:
    mkPy {
      inherit name lockfile devOverrideEnv subdir srcRoot patchDirs groups;
      kind = "lib";
    };
}


