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

  # Minimal importer-scoped source snapshot (pure): include only importer dir and lockfile
  importerOnlySrc = { importerDir, lockfilePath }:
    pkgs.lib.cleanSourceWith {
      src = repoRoot;
      filter = path: type:
        let
          p = builtins.toString path;
          rel = lib.removePrefix ((builtins.toString repoRoot) + "/") p;
          impPrefix = importerDir + "/";
          lockDir = dirnameOf lockfilePath;
          lockPrefix = if lockDir == "" then "" else (lockDir + "/");
          # Helper: does REL start with prefix S?
          relHasPrefix = s: lib.hasPrefix s rel;
          # Helper: is REL a parent of importerDir? i.e. REL is a prefix of impPrefix
          isParentOfImporter = lib.hasPrefix rel impPrefix;
          # Helper: is REL a parent of lockDir?
          isParentOfLock = lockPrefix != "" && lib.hasPrefix rel lockPrefix;
          # Exclude any vendor artifacts to keep derivations stable and cached
          # - Always ignore paths under importerDir/node_modules and importerDir/.pnpm
          # - When importerDir is the repo root ("."), also ignore top-level node_modules/.pnpm
          isVendorPath =
            (relHasPrefix (impPrefix + "node_modules") || relHasPrefix (impPrefix + ".pnpm")) ||
            (importerDir == "." && (relHasPrefix "node_modules" || relHasPrefix ".pnpm"));
        in
        (
          # Always include parent directories so traversal reaches importerDir/lockDir
          (type == "directory" && (rel == importerDir || relHasPrefix impPrefix || isParentOfImporter || (lockPrefix != "" && (rel == lockDir || relHasPrefix lockPrefix || isParentOfLock))))
          # Include files under importerDir
          || ((type != "directory") && (relHasPrefix impPrefix))
          # Special-case root importer: include top-level package.json so pnpm sees a project
          || (importerDir == "." && type != "directory" && rel == "package.json")
          # Include lockfile and files under its dir; special-case root lockfile
          || ((lockPrefix == "" && type != "directory" && rel == lockfilePath) || (lockPrefix != "" && ((type != "directory" && (rel == lockfilePath || relHasPrefix lockPrefix)))))
          # Top-level files sometimes consulted by pnpm
          || (builtins.match "^pnpm-workspace\\.yaml$" rel != null)
          || (builtins.match "^\\.npmrc$" rel != null)
          # Always include root lockfile so builders can fallback when importer lock is missing
          || (type != "directory" && rel == "pnpm-lock.yaml")
        ) && (!isVendorPath);
    };
in {
  inherit lib sanitizeName placeholderDigest hashMap dirnameOf importerOnlySrc repoRoot repoFsRoot prefetchedStorePathGlobal;
}
