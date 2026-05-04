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

  zx-wrapper = pkgs.writeShellScriptBin "zx-wrapper" ''
    set -euo pipefail
    # Locate the repo's zx-init.mjs resolver hook (which auto-appends `.ts` to relative imports).
    # Honor an explicit ZX_INIT env var first; otherwise walk up from PWD looking for
    # build-tools/tools/dev/zx-init.mjs in the surrounding source tree (also handles temp
    # scaffolding workspaces that copy the repo into a tmpdir).
    _zx_init_import=()
    if [ -n "''${ZX_INIT:-}" ] && [ -f "''${ZX_INIT}" ]; then
      _zx_init_import=(--import="''${ZX_INIT}")
    else
      _search="''${PWD}"
      while [ "$_search" != "/" ] && [ -n "$_search" ]; do
        if [ -f "$_search/build-tools/tools/dev/zx-init.mjs" ]; then
          _zx_init_import=(--import="$_search/build-tools/tools/dev/zx-init.mjs")
          break
        fi
        _search="$(dirname "$_search")"
      done
    fi
    exec ${pkgs.nodejs_22}/bin/node \
      --experimental-strip-types \
      --experimental-top-level-await \
      --disable-warning=ExperimentalWarning \
      --import="${pkgs.nodePackages.zx}/lib/node_modules/zx/build/globals.js" \
      "''${_zx_init_import[@]}" \
      "$@"
  '';

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


