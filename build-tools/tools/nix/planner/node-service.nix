{ pkgs
, H
, repoStoreRoot
, repoFsRoot
, viberootsRoot ? null
, sharedNodeMods
, lockInfoOfName
, labelsOf
, nodeOfName
, name
, nativeAddons
}:
let
  info = lockInfoOfName name;
  importerDir = info.importer;
  node = nodeOfName name;
  labels = if node == null then [] else labelsOf node;
  contractLabels = builtins.filter
    (label: builtins.isString label && pkgs.lib.hasPrefix "runtime_contract:" label)
    labels;
  contract =
    if contractLabels == [] then "service.runtime.json"
    else pkgs.lib.removePrefix "runtime_contract:" (builtins.head contractLabels);
  nodeMods =
    if sharedNodeMods != null then sharedNodeMods
    else builtins.trace
      "[planner/node] ctx.nodeMods not provided; using compat local node-modules import"
      (import ../node-modules.nix {
        inherit pkgs;
        repoRoot = repoStoreRoot;
        repoFsRoot = repoFsRoot;
      });
  nm = nodeMods.mkNodeModules {
    lockfilePath = info.lockfilePath;
    inherit importerDir;
  };
  nestedViberootsRoot = repoStoreRoot + "/viberoots";
  sourceRoot =
    if viberootsRoot != null && builtins.pathExists (viberootsRoot + "/build-tools/tools/dev/zx-init.mjs")
    then viberootsRoot
    else if builtins.pathExists (nestedViberootsRoot + "/build-tools/tools/dev/zx-init.mjs")
    then nestedViberootsRoot
    else repoStoreRoot;
  addons = nativeAddons.forTarget name;
in
pkgs.stdenvNoCC.mkDerivation {
  pname = "node-service-" + H.sanitizeName name;
  version = H.sanitizeName importerDir;
  src = repoStoreRoot;
  nativeBuildInputs = [ pkgs.nodejs_22 pkgs.bash pkgs.coreutils ]
    ++ nativeAddons.packages addons;
  buildPhase = ''
    set -euo pipefail
    export WORKSPACE_ROOT="$PWD"
    cd ${importerDir}
    test -f ${pkgs.lib.escapeShellArg contract} || {
      echo "node planner: missing declared runtime contract: ${importerDir}/${contract}" >&2
      exit 2
    }
    rm -rf node_modules
    ln -s "${nm}/node_modules" node_modules
    TSC_BIN="${nm}/node_modules/.bin/tsc"
    test -x "$TSC_BIN" || {
      echo "node planner: tsc binary missing for ${importerDir}" >&2
      exit 3
    }
    ${pkgs.bash}/bin/bash "$TSC_BIN" -p .
    ${nativeAddons.stage addons "$PWD/dist/native"}
    node --experimental-strip-types \
      --disable-warning=ExperimentalWarning \
      --import "${sourceRoot}/build-tools/tools/dev/zx-init.mjs" \
      "${sourceRoot}/build-tools/tools/node/service-artifact.ts" \
      --dist-dir "$PWD/dist" \
      --contract "$PWD/${contract}" \
      --package-json "$PWD/package.json" \
      --out "$PWD/node-service" \
      --identity-out "$PWD/node-service/artifact-identity.json"
    test -f node-service/runtime-contract.json
    test -f node-service/artifact-identity.json
  '';
  installPhase = ''
    set -euo pipefail
    mkdir -p "$out"
    cp -R node-service/. "$out/"
    ln -s "${nm}/node_modules" "$out/node_modules"
    if [ -d "$out/dist/native" ]; then
      cp -R "$out/dist/native" "$out/native"
    fi
  '';
}
