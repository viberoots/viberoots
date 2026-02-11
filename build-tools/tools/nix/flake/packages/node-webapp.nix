{ pkgs, nodeMods, importerDirs, repoSnapshot, repoRoot }:
let
  sanitize = (import ../../templates-common.nix { inherit pkgs; }).sanitizeName;
  makeWebapp =
    importerDir:
      let
        nm = nodeMods.mkNodeModules { lockfilePath = importerDir + "/pnpm-lock.yaml"; inherit importerDir; };
        name = builtins.baseNameOf importerDir;
      in
      pkgs.stdenvNoCC.mkDerivation {
        pname = "node-webapp";
        version = sanitize importerDir;
        src = builtins.path { path = repoRoot; name = "repo"; };
        nativeBuildInputs = [ pkgs.nodejs_22 pkgs.esbuild pkgs.cacert pkgs.coreutils ];
        buildPhase = ''
          set -euo pipefail
          cd ${importerDir}
          export SOURCE_DATE_EPOCH=1
          ln -s ${nm}/node_modules node_modules
          VITE_BIN=$(ls -d node_modules/.pnpm/vite@*/node_modules/vite/bin/vite.js 2>/dev/null | head -n1 || true)
          if [ -z "$VITE_BIN" ]; then
            echo "[nix] ERROR: Vite bin not found under node_modules/.pnpm" >&2
            echo "[nix] listing node_modules (depth 3)" >&2
            find node_modules -maxdepth 3 -type d -print || true
            exit 3
          fi
          VITE_NODE_MODULES=$(dirname "$VITE_BIN")/..
          export NODE_PATH="$VITE_NODE_MODULES''${NODE_PATH:+:$NODE_PATH}"
          echo "[nix] invoking: node $VITE_BIN build"
          node "$VITE_BIN" build
        '';
        installPhase = ''
          set -euo pipefail
          mkdir -p $out
          if [ -d dist ]; then cp -R dist $out/; else echo "dist missing" >&2; exit 2; fi
        '';
      };
in
builtins.listToAttrs (map (imp: { name = sanitize imp; value = makeWebapp imp; }) importerDirs)


