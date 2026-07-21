{ pkgs
, H
, repoStoreRoot
, repoFsRoot
, viberootsRoot ? null
, sharedNodeMods
, lockInfoOfName
, nodeOfName
, labelsOf
, name
, frameworkMissingError
}:
let
  zx-wrapper = import ../lib/zx-wrapper.nix { inherit pkgs; };
  info = lockInfoOfName name;
  importerDir = info.importer;
  n = nodeOfName name;
  labs = if n == null then [] else labelsOf n;
  hasSsr = builtins.elem "webapp:ssr" labs;
  framework =
    if builtins.elem "framework:next" labs then "next"
    else if builtins.elem "framework:express" labs then "express"
    else if builtins.elem "framework:vite" labs then "vite"
    else "";
  nodeMods =
    if sharedNodeMods != null then sharedNodeMods
    else builtins.trace
      "[planner/node] ctx.nodeMods not provided; using compat local node-modules import"
      (import ../node-modules.nix {
        inherit pkgs;
        repoRoot = repoStoreRoot;
        repoFsRoot = repoFsRoot;
      });
  sanitize = H.sanitizeName;
  nm = nodeMods.mkNodeModules { lockfilePath = info.lockfilePath; inherit importerDir; };
  viberootsRootEnv = builtins.getEnv "VIBEROOTS_ROOT";
  nestedViberootsRoot = repoStoreRoot + "/viberoots";
  viberootsStoreRoot =
    if viberootsRoot != null && builtins.pathExists (viberootsRoot + "/build-tools/tools/dev/zx-init.mjs") then viberootsRoot
    else if builtins.pathExists (nestedViberootsRoot + "/build-tools/tools/dev/zx-init.mjs") then nestedViberootsRoot
    else if viberootsRootEnv != "" then builtins.toPath viberootsRootEnv
    else repoStoreRoot;
in
  pkgs.stdenvNoCC.mkDerivation {
    pname = "node-webapp-" + (sanitize name);
    version = sanitize importerDir;
    src = repoStoreRoot;
    nativeBuildInputs = [ pkgs.nodejs_22 zx-wrapper ];
    buildPhase = ''
      set -euo pipefail
      REPO_ROOT="$PWD"
      export WORKSPACE_ROOT="$REPO_ROOT"
      cd ${importerDir}
      export SOURCE_DATE_EPOCH=1
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
      rm -rf node_modules
      ln -s "${nm}/node_modules" node_modules
      VITE_BIN="${nm}/node_modules/.bin/vite"
      TSC_BIN="${nm}/node_modules/.bin/tsc"
      NEXT_BIN="${nm}/node_modules/.bin/next"
      WEBAPP_FRAMEWORK="${if !hasSsr then "static" else framework}"
      printf '%s\n' "$WEBAPP_FRAMEWORK" > .viberoots-webapp-framework
      VIBEROOTS_SOURCE_ROOT="${viberootsStoreRoot}"
      SYNC_CONTRACTS_SCRIPT="$VIBEROOTS_SOURCE_ROOT/build-tools/tools/dev/sync-module-contracts.ts"
      requires_module_contracts() {
        [ -f src/ts-modules.ts ] || [ -f src/wasm-contract.ts ] || [ -f app/ts-modules.ts ] || [ -f app/wasm-contract.ts ]
      }
      sync_module_contracts() {
        if ! requires_module_contracts; then
          return 0
        fi
        if [ ! -f "$SYNC_CONTRACTS_SCRIPT" ]; then
          echo "node planner: missing sync-module-contracts script for ${importerDir}" >&2
          exit 2
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
        # Ensure manifests are materialized during the build itself.
        node --experimental-top-level-await \
          --disable-warning=ExperimentalWarning \
          --experimental-strip-types \
          --import "$VIBEROOTS_SOURCE_ROOT/build-tools/tools/dev/zx-init.mjs" \
          "$SYNC_CONTRACTS_SCRIPT" \
          --cwd . \
          --app-target "//${importerDir}:$APP_STAGE_NAME" \
          --print-json 1 >/dev/null
      }
      sync_module_contracts
      ${if !hasSsr then ''
        if [ ! -x "$VITE_BIN" ]; then
          echo "node planner: missing vite in locked node_modules for ${importerDir}" >&2
          exit 2
        fi
        ${pkgs.bash}/bin/bash "$VITE_BIN" build
        test -d dist
        stage_wasm_contract "src/wasm-contract/top.wasm" "dist" "dist/server/wasm"
      '' else if framework == "express" || framework == "vite" then ''
        if [ ! -x "$VITE_BIN" ] || [ ! -x "$TSC_BIN" ]; then
          echo "node planner: expected vite and tsc in locked node_modules for ${importerDir}" >&2
          exit 2
        fi
        ${pkgs.bash}/bin/bash "$VITE_BIN" build --outDir dist/client
        ${pkgs.bash}/bin/bash "$VITE_BIN" build --ssr src/entry-server.ts --outDir dist/server
        ${pkgs.bash}/bin/bash "$TSC_BIN" -p tsconfig.server.json
        test -d dist/client
        test -f dist/server/index.js
        stage_wasm_contract "src/wasm-contract/top.wasm" "dist/client" "dist/server/wasm"
        if [ -f src/wasm-modules.manifest.json ]; then
          cp -f src/wasm-modules.manifest.json dist/server/wasm-modules.manifest.json
        fi
        if [ -f src/ts-modules.manifest.json ]; then
          cp -f src/ts-modules.manifest.json dist/server/ts-modules.manifest.json
        fi
      '' else if framework == "next" then ''
        if [ ! -x "$NEXT_BIN" ] || [ ! -x "$TSC_BIN" ]; then
          echo "node planner: expected next and tsc in locked node_modules for ${importerDir}" >&2
          exit 2
        fi
        ${pkgs.bash}/bin/bash "$NEXT_BIN" build
        ${pkgs.bash}/bin/bash "$TSC_BIN" -p tsconfig.server.json
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
      '' else ''
        echo "${frameworkMissingError}" >&2
        exit 2
      ''}
    '';
    installPhase = ''
      set -euo pipefail
      mkdir -p "$out"
      cp -R dist "$out/dist"
      WEBAPP_FRAMEWORK="$(cat .viberoots-webapp-framework 2>/dev/null || printf static)"
      if [ "$WEBAPP_FRAMEWORK" != "static" ]; then
        ln -s "${nm}/node_modules" "$out/node_modules"
      fi
    '';
  }
