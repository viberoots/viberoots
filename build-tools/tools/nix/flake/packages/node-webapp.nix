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
          REPO_ROOT="$PWD"
          export WORKSPACE_ROOT="$REPO_ROOT"
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
          SYNC_CONTRACTS_SCRIPT="${repoRoot}/build-tools/tools/dev/sync-module-contracts.ts"
          requires_module_contracts() {
            [ -f src/ts-modules.ts ] || [ -f src/wasm-contract.ts ] || [ -f app/ts-modules.ts ] || [ -f app/wasm-contract.ts ]
          }
          sync_module_contracts() {
            if ! requires_module_contracts; then
              return 0
            fi
            if [ ! -f "$SYNC_CONTRACTS_SCRIPT" ]; then
              echo "[nix] ERROR: missing sync-module-contracts script: $SYNC_CONTRACTS_SCRIPT" >&2
              exit 3
            fi
            APP_STAGE_NAME="$(
              awk '
                /node_asset_stage[[:space:]]*\(/ { in_stage=1 }
                in_stage && /name[[:space:]]*=[[:space:]]*"/ {
                  line=$0
                  sub(/^.*name[[:space:]]*=[[:space:]]*"/, "", line)
                  sub(/".*$/, "", line)
                  print line
                  exit
                }
              ' TARGETS
            )"
            if [ -z "$APP_STAGE_NAME" ]; then APP_STAGE_NAME="app"; fi
            # Primary path: generate TS/WASM manifests inside the hermetic build,
            # so webapp builds never depend on untracked local artifacts.
            node --experimental-top-level-await \
              --disable-warning=ExperimentalWarning \
              --experimental-strip-types \
              "$SYNC_CONTRACTS_SCRIPT" \
              --cwd . \
              --app-target "//${importerDir}:$APP_STAGE_NAME" \
              --print-json 1 >/dev/null
          }
          if [ ! -f TARGETS ]; then
            echo "[nix] ERROR: expected TARGETS file in ${importerDir}" >&2
            exit 3
          fi
          if grep -q "webapp:ssr" TARGETS; then
            if grep -q "framework:next" TARGETS; then
              WEBAPP_FRAMEWORK="next"
            elif grep -q "framework:vite" TARGETS; then
              WEBAPP_FRAMEWORK="vite"
            elif grep -q "framework:express" TARGETS; then
              WEBAPP_FRAMEWORK="express"
            else
              echo "[nix] ERROR: webapp:ssr target must declare framework:next, framework:vite, or framework:express" >&2
              exit 3
            fi
          else
            WEBAPP_FRAMEWORK="static"
          fi
          phase_log "webapp-framework-$WEBAPP_FRAMEWORK"
          stage_wasm_contract() {
            local wasm_src="$1"
            local client_root="$2"
            local server_root="$3"
            if [ ! -f "$wasm_src" ]; then
              return 0
            fi
            mkdir -p "$client_root/wasm-inline"
            mkdir -p "$server_root"
            cp -f "$wasm_src" "$client_root/top.wasm"
            cp -f "$wasm_src" "$server_root/top.wasm"
            local wasm_b64
            wasm_b64="$(base64 < "$wasm_src" | tr -d '\n')"
            cat > "$client_root/wasm-inline/index.js" <<EOF
export const wasmBytesBase64 = '$wasm_b64';
const decodeBase64 = (value) => {
  if (typeof atob === "function") {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(value, "base64"));
  }
  throw new Error("wasm inline module: no base64 decoder available");
};
export const wasmBytes = () => decodeBase64(wasmBytesBase64);
EOF
          }
          HB_PID=""
          trap 'if [ -n "$HB_PID" ]; then kill "$HB_PID" >/dev/null 2>&1 || true; fi' EXIT
          (
            while true; do
              sleep 15
              echo "[node-webapp][heartbeat] webapp-build running elapsed=$(( $(date +%s) - PHASE_T0 ))s"
            done
          ) &
          HB_PID="$!"
          sync_module_contracts
          if [ "$WEBAPP_FRAMEWORK" = "static" ]; then
            if [ ! -x "$VITE_BIN" ]; then
              echo "[nix] ERROR: vite binary missing for static webapp build" >&2
              exit 3
            fi
            "$VITE_BIN" build
            test -d dist
            stage_wasm_contract "src/wasm-contract/top.wasm" "dist" "dist/server/wasm"
          elif [ "$WEBAPP_FRAMEWORK" = "express" ] || [ "$WEBAPP_FRAMEWORK" = "vite" ]; then
            if [ ! -x "$VITE_BIN" ] || [ ! -x "$TSC_BIN" ]; then
              echo "[nix] ERROR: expected vite and tsc binaries for Express/Vite SSR build" >&2
              exit 3
            fi
            "$VITE_BIN" build --outDir dist/client
            "$VITE_BIN" build --ssr src/entry-server.ts --outDir dist/server
            "$TSC_BIN" -p tsconfig.server.json
            test -d dist/client
            test -f dist/server/index.js
            stage_wasm_contract "src/wasm-contract/top.wasm" "dist/client" "dist/server/wasm"
            if [ -f src/wasm-modules.manifest.json ]; then
              cp -f src/wasm-modules.manifest.json dist/server/wasm-modules.manifest.json
            fi
            if [ -f src/ts-modules.manifest.json ]; then
              cp -f src/ts-modules.manifest.json dist/server/ts-modules.manifest.json
            fi
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
            stage_wasm_contract "app/wasm-contract/top.wasm" "dist/client/public" "dist/server/wasm"
            if [ -f app/wasm-modules.manifest.json ]; then
              cp -f app/wasm-modules.manifest.json dist/server/wasm-modules.manifest.json
            fi
            if [ -f app/ts-modules.manifest.json ]; then
              cp -f app/ts-modules.manifest.json dist/server/ts-modules.manifest.json
            fi
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
          ln -s "${nm}/node_modules" "$out/node_modules"
          phase_log "install-complete"
        '';
      };
in
builtins.listToAttrs (map (imp: { name = sanitize imp; value = makeWebapp imp; }) importerDirs)

