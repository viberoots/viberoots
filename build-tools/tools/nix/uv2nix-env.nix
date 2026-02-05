{ pkgs, uv2nixLib, inputs }:
let
  lib = pkgs.lib;
  srcForUv2nixEnv =
    let
      wsEnv = builtins.getEnv "WORKSPACE_ROOT";
      buckEnv = builtins.getEnv "BUCK_TEST_SRC";
      originRoot =
        if wsEnv != "" then wsEnv
        else if buckEnv != "" then buckEnv
        else inputs.originRoot;
      srcStr = builtins.toString inputs.src;
      srcIsStore = lib.hasPrefix "/nix/store/" srcStr;
      subdirStr = if inputs.subdir == "." || inputs.subdir == "" then "" else inputs.subdir;
      lockRel = inputs.lockfile;
      lockAbs =
        if lib.hasPrefix "/" lockRel then builtins.toPath lockRel
        else if lib.hasPrefix "projects/apps/" lockRel || lib.hasPrefix "projects/libs/" lockRel
          then builtins.toPath (originRoot + "/" + lockRel)
          else if srcIsStore
            then builtins.toPath (
              srcStr
              + (if subdirStr == "" then "" else "/" + subdirStr)
              + "/" + lockRel
            )
          else builtins.toPath (
            originRoot
            + (if subdirStr == "" then "" else "/" + subdirStr)
            + "/" + lockRel
          );
      lockStore = builtins.path { path = lockAbs; name = "uv.lock"; };
      dest = "$out/" + (if subdirStr == "" then "" else subdirStr + "/") + lockRel;
    in
      pkgs.runCommand "uv2nix-env-src" {} ''
        set -euo pipefail
        mkdir -p "$(dirname "${dest}")"
        cp ${lockStore} "${dest}"
      '';
  uvDrv = uv2nixLib.mkEnv {
    src = srcForUv2nixEnv;
    subdir = inputs.subdir;
    lockfile = inputs.lockfile;
    devOverrides = inputs.devOverridesCoerced;
    patchesMap = inputs.patchesMap;
    testResolve = inputs.testResolveObj;
    groups = inputs.groups;
    kind = inputs.kind;
  };
  metaRaw = if (uv2nixLib ? meta) then uv2nixLib.meta else null;
  meta =
    if (metaRaw != null && builtins.isAttrs metaRaw)
    then metaRaw
    else { version = "unknown"; rev = "unknown"; };
in {
  inherit uvDrv srcForUv2nixEnv meta;
}
