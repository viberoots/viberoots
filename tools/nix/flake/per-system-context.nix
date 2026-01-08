{ nixpkgs, buck2, gomod2nix, system }:
let
  repoRoot = ../../..;
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

  zx-wrapper = pkgs.writeShellScriptBin "zx-wrapper" ''
    set -euo pipefail
    exec ${pkgs.nodejs_22}/bin/node \
      --experimental-strip-types \
      --experimental-top-level-await \
      --disable-warning=ExperimentalWarning \
      --import="${pkgs.nodePackages.zx}/lib/node_modules/zx/build/globals.js" \
      "$@"
  '';

  devshell = import ../devshell.nix { inherit pkgs; buck2Input = buck2; };

  liveFsRoot =
    let
      w = builtins.getEnv "WORKSPACE_ROOT";
    in
    if w != "" then (builtins.toPath w) else repoRoot;

  nodeMods = import ../node-modules.nix {
    inherit pkgs;
    repoRoot = repoRoot;
    repoFsRoot = liveFsRoot;
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
      uvPath = repoRoot + "/third_party/uv2nix/flake.nix";
      haveUv = builtins.pathExists uvPath;
      uvLocal = if haveUv then import uvPath else null;
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
  inherit pkgs system zx-wrapper devshell nodeMods prelude uv2nixLib;
  buck2Input = buck2;
}


