{ pkgs, nodeMods, importerDirs, filterRepo, repoSnapshot, repoRoot, viberootsRoot }:
let
  sanitize = (import ../../templates-common.nix { inherit pkgs; }).sanitizeName;
  makeService =
    importerDir:
      let
        nm = nodeMods.mkNodeModules { lockfilePath = importerDir + "/pnpm-lock.yaml"; inherit importerDir; };
        attr = sanitize importerDir;
      in
      pkgs.stdenvNoCC.mkDerivation {
        pname = "node-service";
        version = attr;
        src =
          let
            wr = builtins.getEnv "WORKSPACE_ROOT";
          in
          if wr != "" then (builtins.path { path = builtins.toPath wr; name = "repo"; filter = filterRepo (builtins.toPath wr); }) else repoSnapshot;
        nativeBuildInputs = [ pkgs.nodejs_22 pkgs.cacert pkgs.coreutils ];
        buildPhase = ''
          set -euo pipefail
          REPO_ROOT="$PWD"
          export WORKSPACE_ROOT="$REPO_ROOT"
          cd ${importerDir}
          CONTRACT_REL="${let v = builtins.getEnv "VBR_NODE_SERVICE_CONTRACT"; in if v != "" then v else "service.runtime.json"}"
          test -f "$CONTRACT_REL" || {
            echo "node-service: missing declared runtime contract: ${importerDir}/$CONTRACT_REL" >&2
            exit 2
          }
          NM_TARGET="${nm}/node_modules"
          if [ -L node_modules ] && [ "$(readlink node_modules)" = "$NM_TARGET" ]; then
            :
          else
            rm -rf node_modules
            ln -s "$NM_TARGET" node_modules
          fi
          TSC_BIN="node_modules/.bin/tsc"
          test -x "$TSC_BIN" || { echo "node-service: tsc binary missing" >&2; exit 3; }
          ${pkgs.bash}/bin/bash "$TSC_BIN" -p .
          VIBEROOTS_SOURCE_ROOT="${viberootsRoot}"
          node --experimental-strip-types \
            --disable-warning=ExperimentalWarning \
            --import "$VIBEROOTS_SOURCE_ROOT/build-tools/tools/dev/zx-init.mjs" \
            "$VIBEROOTS_SOURCE_ROOT/build-tools/tools/node/service-artifact.ts" \
            --dist-dir "$PWD/dist" \
            --contract "$PWD/$CONTRACT_REL" \
            --package-json "$PWD/package.json" \
            --out "$PWD/node-service" \
            --identity-out "$PWD/node-service/artifact-identity.json"
          test -f node-service/runtime-contract.json
          test -f node-service/artifact-identity.json
        '';
        installPhase = ''
          set -euo pipefail
          mkdir -p "$out"
          if [ -d "${importerDir}/node-service" ]; then
            cp -R ${importerDir}/node-service/. "$out/"
          else
            cp -R node-service/. "$out/"
          fi
          ln -s "${nm}/node_modules" "$out/node_modules"
        '';
      };
in
builtins.listToAttrs (map (imp: { name = sanitize imp; value = makeService imp; }) importerDirs)
