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
      wsRoot = builtins.toString srcRoot;
      patchDir = builtins.toPath ("${wsRoot}/${subdir}/patches/python");
      uv = UvBackend {
        pname = "pylib-${H.sanitizeName name}";
        version = "0.1.0";
        srcAbs = builtins.path { path = builtins.toPath ("${builtins.toString srcRoot}/${subdir}"); name = "py-src"; };
        lockfile = lockfile;
        subdir = ".";
        patchesMap = H.pythonPatchesMapFromDirs { dirs = [ patchDir ]; };
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
