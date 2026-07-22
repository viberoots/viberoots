{ pkgs, repoRoot, repoFsRoot, hashesPath, prefetchedStorePathGlobal ? null, allowLiveHashMap ? true }:
let
  lib = pkgs.lib;
  sanitizeName = s:
    (import ../templates-common.nix { inherit pkgs; }).sanitizeName s;

  readHashMap = p:
    if builtins.pathExists p
    then builtins.fromJSON (builtins.readFile p)
    else {};

  liveHashMap =
    let
      wr = builtins.getEnv "WORKSPACE_ROOT";
      candidates =
        if (!allowLiveHashMap) || wr == "" then []
        else [
          (builtins.toPath (wr + "/projects/config/node-modules.hashes.json"))
        ];
    in
      lib.foldl' (acc: p: acc // (readHashMap p)) {} candidates;

  # Read mapping of lockfile path (relative) -> sha256 for FODs.
  # Live temp workspaces may generate importer hashes after the locked viberoots
  # input was evaluated, so allow WORKSPACE_ROOT-local maps to override the
  # committed tool input map.
  hashMap = (readHashMap hashesPath) // liveHashMap;

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
      srcBaseStr = builtins.toString srcBase;
      impPkgJsonPath = srcBaseStr + "/" + importerDir + "/package.json";
      impNpmrcPath = srcBaseStr + "/" + importerDir + "/.npmrc";
      impPnpmWsPath = srcBaseStr + "/" + importerDir + "/pnpm-workspace.yaml";
      impLockPath = srcBaseStr + "/" + importerDir + "/pnpm-lock.yaml";
      wantedLockPath = srcBaseStr + "/" + lockfilePath;
      wsNpmrcPath = srcBaseStr + "/.npmrc";
      wsPnpmWsPath = srcBaseStr + "/pnpm-workspace.yaml";
      impPkgJson = if builtins.pathExists impPkgJsonPath then (builtins.path { path = impPkgJsonPath; name = "importer-package.json"; }) else null;
      impNpmrc = if builtins.pathExists impNpmrcPath then (builtins.path { path = impNpmrcPath; name = "importer.npmrc"; }) else null;
      impPnpmWs = if builtins.pathExists impPnpmWsPath then (builtins.path { path = impPnpmWsPath; name = "importer-pnpm-workspace.yaml"; }) else null;
      impLock = if builtins.pathExists impLockPath then (builtins.path { path = impLockPath; name = "importer-pnpm-lock.yaml"; }) else null;
      wantedLock = if builtins.pathExists wantedLockPath then (builtins.path { path = wantedLockPath; name = "requested-pnpm-lock.yaml"; }) else null;
      wsNpmrc = if builtins.pathExists wsNpmrcPath then (builtins.path { path = wsNpmrcPath; name = "workspace.npmrc"; }) else null;
      wsPnpmWs = if builtins.pathExists wsPnpmWsPath then (builtins.path { path = wsPnpmWsPath; name = "pnpm-workspace.yaml"; }) else null;
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

      if [ -f ${if impPkgJson != null then builtins.toJSON (builtins.toString impPkgJson) else "\"/nonexistent\""} ]; then
        copy_file ${if impPkgJson != null then builtins.toJSON (builtins.toString impPkgJson) else "\"/nonexistent\""} "$imp_out_dir/package.json"
      fi
      if [ -f ${if impNpmrc != null then builtins.toJSON (builtins.toString impNpmrc) else "\"/nonexistent\""} ]; then
        copy_file ${if impNpmrc != null then builtins.toJSON (builtins.toString impNpmrc) else "\"/nonexistent\""} "$imp_out_dir/.npmrc"
      fi
      if [ -f ${if impPnpmWs != null then builtins.toJSON (builtins.toString impPnpmWs) else "\"/nonexistent\""} ]; then
        copy_file ${if impPnpmWs != null then builtins.toJSON (builtins.toString impPnpmWs) else "\"/nonexistent\""} "$imp_out_dir/pnpm-workspace.yaml"
      fi

      # Include only the requested lockfile path. Missing metadata is repaired by u.
      if [ -n "${lockDir}" ]; then
        mkdir -p "$out/${lockDir}"
      fi
      if [ -f ${if wantedLock != null then builtins.toJSON (builtins.toString wantedLock) else "\"/nonexistent\""} ]; then
        copy_file ${if wantedLock != null then builtins.toJSON (builtins.toString wantedLock) else "\"/nonexistent\""} "$out/${lockfilePath}"
      elif [ -f ${if impLock != null then builtins.toJSON (builtins.toString impLock) else "\"/nonexistent\""} ]; then
        copy_file ${if impLock != null then builtins.toJSON (builtins.toString impLock) else "\"/nonexistent\""} "$out/${lockfilePath}"
      fi

      if [ -f ${if wsPnpmWs != null then builtins.toJSON (builtins.toString wsPnpmWs) else "\"/nonexistent\""} ]; then
        copy_file ${if wsPnpmWs != null then builtins.toJSON (builtins.toString wsPnpmWs) else "\"/nonexistent\""} "$out/pnpm-workspace.yaml"
      fi
      if [ -f ${if wsNpmrc != null then builtins.toJSON (builtins.toString wsNpmrc) else "\"/nonexistent\""} ]; then
        copy_file ${if wsNpmrc != null then builtins.toJSON (builtins.toString wsNpmrc) else "\"/nonexistent\""} "$out/.npmrc"
      fi
    '';
in {
  inherit lib sanitizeName placeholderDigest hashMap dirnameOf importerOnlySrc repoRoot repoFsRoot prefetchedStorePathGlobal;
}
