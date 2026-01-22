{ lib, pkgs, H, DevOverrideEnvs, UvBackend }:
{
  mkOverlaySite = {
    name,
    lockfile,
    subdir ? ".",
    srcRoot ? ../../..,
    devOverrideEnv ? DevOverrideEnvs.envNameForLang "python",
    groups ? [],
  }:
    let
      _guard = H.guardNoDevOverridesInCI devOverrideEnv;
      buckTestSrc = builtins.getEnv "BUCK_TEST_SRC";
      workspaceEnv = builtins.getEnv "WORKSPACE_ROOT";
      wsRoot =
        if buckTestSrc != "" then buckTestSrc
        else if workspaceEnv != "" then workspaceEnv
        else builtins.toString srcRoot;
      uv = UvBackend {
        pname = "pylib-${H.sanitizeName name}";
        version = "0.1.0";
        srcAbs = builtins.path { path = builtins.toPath ("${builtins.toString srcRoot}/${subdir}"); name = "py-src"; };
        lockfile = if lib.hasSuffix "/uv.lock" lockfile then "uv.lock" else lockfile;
        subdir = ".";
        patchesMap = H.patchesMapFromImporterDirToStore {
          srcRoot = srcRoot;
          subdir = subdir;
          lang = "python";
          normalizeVersion = (v: lib.head (lib.splitString "-" v));
          namePrefix = "py-patch";
        };
        devOverrides = H.readDevOverrides devOverrideEnv;
        kind = "lib";
        wsRoot = wsRoot;
        groups = groups;
      };
    in pkgs.runCommand ("pywasm-lib-" + H.sanitizeName name) {} ''
      set -euo pipefail
      mkdir -p $out/site $out/meta
      if [ -d "${uv}/site" ]; then
        cp -R "${uv}/site/." "$out/site/" || true
      fi
      cat > "$out/BUILD-INFO.json" <<JSON
      {
        "kind": "wasm-lib",
        "lockfile": "${lockfile}",
        "subdir": "${subdir}",
        "groups": ${builtins.toJSON groups}
      }
JSON
    '';
}
