{ nodeMods, importerDirs, haveRootLock, viberootsNodeMods ? null }:
let
  localPnpmStore =
    let
      s = builtins.getEnv "LOCAL_PNPM_STORE";
    in
    if s != "" then s else null;

  perImporterNM = builtins.listToAttrs (map (imp: {
    name = (nodeMods.sanitizeName imp);
    value = nodeMods.mkNodeModules { lockfilePath = imp + "/pnpm-lock.yaml"; importerDir = imp; };
  }) importerDirs);

  perImporterStore = builtins.listToAttrs (map (imp: {
    name = (nodeMods.sanitizeName imp);
    value = nodeMods.mkPnpmStore {
      lockfilePath = imp + "/pnpm-lock.yaml";
      importerDir = imp;
      prefetchedStorePath = localPnpmStore;
    };
  }) importerDirs);

in
{
  pnpm-store =
    ({} // (if haveRootLock then {
      default = nodeMods.mkPnpmStore {
        lockfilePath = "pnpm-lock.yaml";
        importerDir = ".";
        prefetchedStorePath = localPnpmStore;
      };
    } else {}) // (if viberootsNodeMods != null then { viberoots = viberootsNodeMods.pnpm-store; } else {}) // perImporterStore);

  node-modules =
    ({}
      // (if haveRootLock then { default = nodeMods.node-modules; } else {})
      // (if viberootsNodeMods != null then { viberoots = viberootsNodeMods.node-modules; } else {})
      // perImporterNM);
}
