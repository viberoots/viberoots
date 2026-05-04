{ nixpkgs, buck2, gomod2nix, system, includeNodeMods ? false }:
let
  repoRoot = ../../../..;
  pkgs = import nixpkgs {
    inherit system;
    overlays =
      let
        haveCppOverlayFile = builtins.pathExists ../overlays/cpp-patches.nix;
        useCppOverlay = (builtins.getEnv "NIX_CPP_USE_OVERLAY") == "1";
        cppOverlays =
          if (haveCppOverlayFile && useCppOverlay) then [ (import ../overlays/cpp-patches.nix) ] else [ ];
      in
      [ gomod2nix.overlays.default ] ++ cppOverlays;
  };

  zx-wrapper = import ../lib/zx-wrapper.nix { inherit pkgs; };

  devshell = import ../devshell.nix { inherit pkgs; buck2Input = buck2; };

  liveFsRoot =
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
      hashesPath = ../node-modules.hashes.json;
      prefetchedStorePathGlobal =
        let
          s = builtins.getEnv "LOCAL_PNPM_STORE";
        in
        if s != "" then (builtins.toPath s) else null;
    };

  prelude = import ../buck-prelude.nix { inherit pkgs; buck2Input = buck2; };

  uv2nixLib =
    let
      uvPathStr = (builtins.toString repoRoot) + "/third_party/uv2nix/flake.nix";
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
  inherit pkgs system zx-wrapper devshell prelude uv2nixLib liveFsRoot mkNodeMods;
  buck2Input = buck2;
} // (if includeNodeMods then { nodeMods = mkNodeMods { }; } else { })


