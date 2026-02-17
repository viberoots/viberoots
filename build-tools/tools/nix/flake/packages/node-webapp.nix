{ pkgs, nodeMods, importerDirs, filterRepo, repoSnapshot, repoRoot }:
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
        src =
          let
            wr = builtins.getEnv "WORKSPACE_ROOT";
          in
          if wr != "" then (builtins.path { path = filterRepo (builtins.toPath wr); name = "repo"; }) else repoSnapshot;
        nativeBuildInputs = [ pkgs.nodejs_22 pkgs.esbuild pkgs.cacert pkgs.coreutils ];
        buildPhase = ''
          set -euo pipefail
          PHASE_T0="$(date +%s)"
          phase_log() { echo "[node-webapp][phase] $1 t=$(date +%s)"; }
          phase_log "begin"
          cd ${importerDir}
          phase_log "cd-importer"
          export SOURCE_DATE_EPOCH=1
          NM_TARGET="${nm}/node_modules"
          phase_log "prepare-node-modules-link"
          if [ -L node_modules ] && [ "$(readlink node_modules)" = "$NM_TARGET" ]; then
            :
          else
            rm -rf node_modules
            ln -s "$NM_TARGET" node_modules
          fi
          phase_log "node-modules-ready"
          VITE_BIN=$(ls -d node_modules/.pnpm/vite@*/node_modules/vite/bin/vite.js 2>/dev/null | head -n1 || true)
          if [ -z "$VITE_BIN" ]; then
            echo "[nix] ERROR: Vite bin not found under node_modules/.pnpm" >&2
            echo "[nix] listing node_modules (depth 3)" >&2
            find node_modules -maxdepth 3 -type d -print || true
            exit 3
          fi
          phase_log "vite-bin-resolved"
          VITE_NODE_MODULES=$(dirname "$VITE_BIN")/..
          export NODE_PATH="$VITE_NODE_MODULES''${NODE_PATH:+:$NODE_PATH}"
          echo "[nix] invoking: node $VITE_BIN build"
          HB_PID=""
          trap 'if [ -n "$HB_PID" ]; then kill "$HB_PID" >/dev/null 2>&1 || true; fi' EXIT
          (
            while true; do
              sleep 15
              echo "[node-webapp][heartbeat] vite-build running elapsed=$(( $(date +%s) - PHASE_T0 ))s"
            done
          ) &
          HB_PID="$!"
          node "$VITE_BIN" build
          if [ -n "$HB_PID" ]; then kill "$HB_PID" >/dev/null 2>&1 || true; fi
          phase_log "vite-build-complete"
        '';
        installPhase = ''
          set -euo pipefail
          phase_log() { echo "[node-webapp][phase] $1 t=$(date +%s)"; }
          phase_log "install-begin"
          mkdir -p $out
          if [ -d dist ]; then cp -R dist $out/; else echo "dist missing" >&2; exit 2; fi
          phase_log "install-complete"
        '';
      };
in
builtins.listToAttrs (map (imp: { name = sanitize imp; value = makeWebapp imp; }) importerDirs)


