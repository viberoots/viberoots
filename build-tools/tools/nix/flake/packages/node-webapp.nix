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
          VITE_BIN="node_modules/.bin/vite"
          TSC_BIN="node_modules/.bin/tsc"
          NEXT_BIN="node_modules/.bin/next"
          if [ ! -f TARGETS ]; then
            echo "[nix] ERROR: expected TARGETS file in ${importerDir}" >&2
            exit 3
          fi
          if grep -q "webapp:ssr" TARGETS; then
            if grep -q "framework:next" TARGETS; then
              WEBAPP_FRAMEWORK="next"
            elif grep -q "framework:express" TARGETS; then
              WEBAPP_FRAMEWORK="express"
            else
              echo "[nix] ERROR: webapp:ssr target must declare framework:next or framework:express" >&2
              exit 3
            fi
          else
            WEBAPP_FRAMEWORK="static"
          fi
          phase_log "webapp-framework-$WEBAPP_FRAMEWORK"
          HB_PID=""
          trap 'if [ -n "$HB_PID" ]; then kill "$HB_PID" >/dev/null 2>&1 || true; fi' EXIT
          (
            while true; do
              sleep 15
              echo "[node-webapp][heartbeat] webapp-build running elapsed=$(( $(date +%s) - PHASE_T0 ))s"
            done
          ) &
          HB_PID="$!"
          if [ "$WEBAPP_FRAMEWORK" = "static" ]; then
            if [ ! -x "$VITE_BIN" ]; then
              echo "[nix] ERROR: vite binary missing for static webapp build" >&2
              exit 3
            fi
            "$VITE_BIN" build
            test -d dist
          elif [ "$WEBAPP_FRAMEWORK" = "express" ]; then
            if [ ! -x "$VITE_BIN" ] || [ ! -x "$TSC_BIN" ]; then
              echo "[nix] ERROR: expected vite and tsc binaries for Express SSR build" >&2
              exit 3
            fi
            "$VITE_BIN" build --outDir dist/client
            "$VITE_BIN" build --ssr src/entry-server.ts --outDir dist/server
            "$TSC_BIN" -p tsconfig.server.json
            test -d dist/client
            test -f dist/server/index.js
          else
            if [ ! -x "$NEXT_BIN" ] || [ ! -x "$TSC_BIN" ]; then
              echo "[nix] ERROR: expected next and tsc binaries for Next SSR build" >&2
              exit 3
            fi
            "$NEXT_BIN" build
            "$TSC_BIN" -p tsconfig.server.json
            test -d .next
            mkdir -p dist/client
            cp -R .next dist/client/.next
            if [ -d public ]; then cp -R public dist/client/public; fi
            if [ -f package.json ]; then cp package.json dist/client/package.json; fi
            if [ -f next.config.mjs ]; then cp next.config.mjs dist/client/next.config.mjs; fi
            if [ -f dist/server/index.js ]; then mv dist/server/index.js dist/server/server-main.js; fi
            cat > dist/server/index.js <<'EOF'
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
process.chdir(path.resolve(__dirname, "../client"));
await import("./server-main.js");
EOF
            test -d dist/client
            test -f dist/server/index.js
            test -f dist/server/server-main.js
          fi
          if [ -n "$HB_PID" ]; then kill "$HB_PID" >/dev/null 2>&1 || true; fi
          phase_log "webapp-build-complete"
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


