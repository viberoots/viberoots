{ pkgs, repoRoot ? ../../.,
  # Live filesystem root of the repo (not snapshotted), used to locate importer lockfiles at eval time
  repoFsRoot ? ../../.,
  hashesPath ? ../../tools/nix/node-modules.hashes.json,
  prefetchedStorePathGlobal ? null
}:
let
  common = import ./node-modules/common.nix { inherit pkgs repoRoot repoFsRoot hashesPath prefetchedStorePathGlobal; };
  store = import ./node-modules/store.nix { inherit pkgs repoRoot repoFsRoot hashesPath prefetchedStorePathGlobal; };
  modules = import ./node-modules/modules.nix { inherit pkgs repoRoot repoFsRoot hashesPath prefetchedStorePathGlobal; };

  inherit (common) sanitizeName;
  inherit (store) mkPnpmStore;
  inherit (modules) mkNodeModules;

  # Backward-compat: default to repo root lockfile if present
  defaultLock = if builtins.pathExists (repoRoot + "/pnpm-lock.yaml") then "pnpm-lock.yaml" else null;
  pnpm-store-default = if defaultLock == null then null else mkPnpmStore {
    lockfilePath = defaultLock;
    importerDir = ".";
  };
  node-modules-default = if defaultLock == null then null else mkNodeModules {
    lockfilePath = defaultLock;
    importerDir = ".";
  };
in {
  inherit mkPnpmStore mkNodeModules sanitizeName;
  # Preserve previous attribute names when root lockfile exists
  pnpm-store = if pnpm-store-default == null then (pkgs.runCommand "pnpm-store-missing" {} "mkdir -p $out; echo no-root-lockfile > $out/info") else pnpm-store-default;
  node-modules = if node-modules-default == null then (pkgs.runCommand "node-modules-missing" {} "mkdir -p $out; echo no-root-lockfile > $out/info") else node-modules-default;
}


