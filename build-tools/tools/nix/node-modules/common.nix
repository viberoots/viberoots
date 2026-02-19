{ pkgs, repoRoot, repoFsRoot, hashesPath, prefetchedStorePathGlobal ? null }:
let
  lib = pkgs.lib;
  sanitizeName = s:
    (import ../templates-common.nix { inherit pkgs; }).sanitizeName s;

  # Read mapping of lockfile path (relative) -> sha256 for FODs
  hashMap =
    if builtins.pathExists hashesPath
    then builtins.fromJSON (builtins.readFile hashesPath)
    else {};

  # Valid base64 placeholder digest (will be replaced by update-pnpm-hash.ts on first real build)
  placeholderDigest = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

  dirnameOf = p: let parts = lib.splitString "/" p; in lib.concatStringsSep "/" (lib.take (lib.length parts - 1) parts);

  # Minimal importer-scoped source snapshot:
  # copy only importer package.json/.npmrc plus lockfile/workspace metadata.
  # Prefer the flake snapshot (repoRoot); when the importer exists only in a live temp workspace,
  # fall back to repoFsRoot so temp importers (e.g., scaffolded tests) are visible.
  importerOnlySrc = { importerDir, lockfilePath }:
    let
      srcBase =
        let
          storeRootStr = builtins.toString repoRoot;
          liveRootStr = builtins.toString repoFsRoot;
          importerPathStore = storeRootStr + "/" + importerDir;
          importerPathLive = liveRootStr + "/" + importerDir;
          haveStore = builtins.pathExists importerPathStore;
          haveLive = builtins.pathExists importerPathLive;
          lockPathStore = storeRootStr + "/" + lockfilePath;
          lockPathLive = liveRootStr + "/" + lockfilePath;
          haveLockStore = builtins.pathExists lockPathStore;
          haveLockLive = builtins.pathExists lockPathLive;
        in if haveLive && haveLockLive && (!haveLockStore) then repoFsRoot else (if haveStore || !haveLive then repoRoot else repoFsRoot);
      genAllowed = (builtins.getEnv "NIX_PNPM_ALLOW_GENERATE") == "1";
      srcBaseStr = builtins.toString srcBase;
      haveImporterLock = builtins.pathExists (srcBaseStr + "/" + importerDir + "/pnpm-lock.yaml");
      ignoreImporterLock = genAllowed && (!haveImporterLock);
      impPkgJson = srcBaseStr + "/" + importerDir + "/package.json";
      impNpmrc = srcBaseStr + "/" + importerDir + "/.npmrc";
      impLock = srcBaseStr + "/" + importerDir + "/pnpm-lock.yaml";
      wantedLock = srcBaseStr + "/" + lockfilePath;
      wsNpmrc = srcBaseStr + "/.npmrc";
      wsPnpmWs = srcBaseStr + "/pnpm-workspace.yaml";
      lockDir = dirnameOf lockfilePath;
    in pkgs.runCommand "importer-src-${sanitizeName importerDir}" {} ''
      set -euo pipefail
      mkdir -p "$out"
      copy_file() {
        src="$1"
        dst="$2"
        mkdir -p "$(dirname "$dst")"
        cat "$src" > "$dst"
      }
      if [ "${importerDir}" = "." ]; then
        imp_out_dir="$out"
      else
        imp_out_dir="$out/${importerDir}"
        mkdir -p "$imp_out_dir"
      fi

      if [ -f ${builtins.toJSON impPkgJson} ]; then
        copy_file ${builtins.toJSON impPkgJson} "$imp_out_dir/package.json"
      fi
      if [ -f ${builtins.toJSON impNpmrc} ]; then
        copy_file ${builtins.toJSON impNpmrc} "$imp_out_dir/.npmrc"
      fi

      # Include only the requested lockfile path, unless generation mode intentionally
      # ignores a missing importer-local lockfile.
      if [ -n "${lockDir}" ]; then
        mkdir -p "$out/${lockDir}"
      fi
      if [ "${if ignoreImporterLock then "1" else "0"}" != "1" ] && [ -f ${builtins.toJSON wantedLock} ]; then
        copy_file ${builtins.toJSON wantedLock} "$out/${lockfilePath}"
      elif [ "${if ignoreImporterLock then "1" else "0"}" != "1" ] && [ -f ${builtins.toJSON impLock} ]; then
        copy_file ${builtins.toJSON impLock} "$out/${lockfilePath}"
      fi

      if [ -f ${builtins.toJSON wsPnpmWs} ]; then
        copy_file ${builtins.toJSON wsPnpmWs} "$out/pnpm-workspace.yaml"
      fi
      if [ -f ${builtins.toJSON wsNpmrc} ]; then
        copy_file ${builtins.toJSON wsNpmrc} "$out/.npmrc"
      fi
    '';
in {
  inherit lib sanitizeName placeholderDigest hashMap dirnameOf importerOnlySrc repoRoot repoFsRoot prefetchedStorePathGlobal;
}
