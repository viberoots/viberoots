{ nixpkgs
, buck2
, gomod2nix
, system
, workspaceSrc
, viberootsInput
, version
, releaseTag
, includeNodeMods ? false
, nixpkgsRegistryExtension ? { profiles = { }; }
}:
let
  workspaceRootPath =
    if builtins.isAttrs workspaceSrc then workspaceSrc.outPath else workspaceSrc;
  viberootsRootPath =
    if builtins.isAttrs viberootsInput then viberootsInput.outPath else viberootsInput;
  repoRoot = workspaceRootPath;
  viberootsRoot = viberootsRootPath;
  evaluationBundle = import ./evaluation-bundle.nix { inherit repoRoot; };
  pkgs = import nixpkgs {
    inherit system;
    overlays =
      let
        haveCppOverlayFile = builtins.pathExists ../overlays/cpp-patches.nix;
        useCppOverlay = (builtins.getEnv "NIX_CPP_USE_OVERLAY") == "1";
        cppOverlays =
          if (haveCppOverlayFile && useCppOverlay) then [ (import ../overlays/cpp-patches.nix) ] else [ ];
      in
      [ gomod2nix.overlays.default ]
      ++ cppOverlays
      ++ (if evaluationBundle == null then [ ] else [
        (_final: _prev: { viberootsEvaluationBundle = evaluationBundle; })
      ]);
  };
  nixpkgsRegistry = import ../nixpkgs-source-registry.nix {
    inputs = { inherit nixpkgs; };
  };
  resolvedNixpkgsRegistry =
    nixpkgsRegistry // {
      profiles = (nixpkgsRegistry.profiles or { }) // (nixpkgsRegistryExtension.profiles or { });
    };

  zx-wrapper = import ../lib/zx-wrapper.nix { inherit pkgs; };

  devshell = import ../devshell.nix {
    inherit pkgs viberootsRoot version releaseTag;
    buck2Input = buck2;
  };

  liveFsRoot = if evaluationBundle != null then repoRoot else
    let
      w = builtins.getEnv "WORKSPACE_ROOT";
      t = builtins.getEnv "BUCK_TEST_SRC";
    in
    if w != "" then (builtins.toPath w) else (if t != "" then (builtins.toPath t) else repoRoot);

  mkNodeMods =
    { repoFsRoot ? liveFsRoot }:
    import ../node-modules.nix {
      inherit pkgs repoFsRoot;
      repoRoot = repoRoot;
      hashesPath = repoRoot + "/projects/config/node-modules.hashes.json";
      allowLiveHashMap = evaluationBundle == null;
      prefetchedStorePathGlobal =
        let
          s = builtins.getEnv "LOCAL_PNPM_STORE";
        in
        if s != "" then (builtins.toPath s) else null;
    };

  viberootsNodeMods = import ../node-modules.nix {
    inherit pkgs;
    repoRoot = viberootsRoot;
    repoFsRoot = viberootsRoot;
    hashesPath = viberootsRoot + "/build-tools/tools/nix/node-modules.hashes.json";
    allowLiveHashMap = false;
    prefetchedStorePathGlobal =
      let
        s = builtins.getEnv "LOCAL_PNPM_STORE";
      in
      if s != "" then (builtins.toPath s) else null;
  };
  viberootsNodeModules = viberootsNodeMods.node-modules;

  prelude = import ../buck-prelude.nix { inherit pkgs; buck2Input = buck2; };

  uv2nixLib =
    let
      uvPathStr = (builtins.toString viberootsRoot) + "/third_party/uv2nix/flake.nix";
      haveUv = builtins.pathExists uvPathStr;
      uvLocal = if haveUv then import (builtins.toPath uvPathStr) else null;
      uvOut = if haveUv && uvLocal != null then uvLocal.outputs { self = null; inherit nixpkgs; } else null;
      lib = if uvOut == null then null else (uvOut.lib or null);
    in
    if lib == null then null else {
      meta = lib.meta or { };
      mkEnv =
        args:
          if (lib ? mkEnvFor) then (lib.mkEnvFor pkgs) args
          else if (lib ? mkEnv) then lib.mkEnv args
          else builtins.throw "uv2nix lib is missing mkEnv/mkEnvFor";
    };
in
{
  inherit pkgs system zx-wrapper devshell prelude uv2nixLib evaluationBundle liveFsRoot mkNodeMods repoRoot viberootsRoot viberootsNodeMods version releaseTag;
  nixpkgsRegistry = resolvedNixpkgsRegistry;
  buck2Input = buck2;
} // (if includeNodeMods then { nodeMods = mkNodeMods { }; } else { })
