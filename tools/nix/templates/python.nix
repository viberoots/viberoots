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
  }:
    let
      _guard = H.guardNoDevOverridesInCI devOverrideEnv;
      patchesMap = H.patchesMapFromDirs patchDirs;
      devOverrides = H.readDevOverrides devOverrideEnv;
      srcAbs = lib.cleanSource (builtins.toPath ("${srcRoot}/" + subdir));
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
    };
in {
  pyApp = {
    name,
    lockfile,
    devOverrideEnv ? "NIX_PY_DEV_OVERRIDE_JSON",
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [ ../../patches/python ],
  }:
    mkPy {
      inherit name lockfile devOverrideEnv subdir srcRoot patchDirs;
      kind = "app";
    };

  pyLib = {
    name,
    lockfile,
    devOverrideEnv ? "NIX_PY_DEV_OVERRIDE_JSON",
    subdir ? ".",
    srcRoot ? ../../..,
    patchDirs ? [ ../../patches/python ],
  }:
    mkPy {
      inherit name lockfile devOverrideEnv subdir srcRoot patchDirs;
      kind = "lib";
    };
}


