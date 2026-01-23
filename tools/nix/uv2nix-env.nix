{ pkgs, uv2nixLib, inputs }:
let
  srcForUv2nixEnv =
    let
      srcStr = builtins.toString inputs.src;
      subdirStr = if inputs.subdir == "." || inputs.subdir == "" then "" else inputs.subdir;
      lockAbs = builtins.toPath (
        srcStr
        + (if subdirStr == "" then "" else "/" + subdirStr)
        + "/" + inputs.lockfile
      );
      lockStore = builtins.path { path = lockAbs; name = "uv.lock"; };
      dest = "$out/" + (if subdirStr == "" then "" else subdirStr + "/") + inputs.lockfile;
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
