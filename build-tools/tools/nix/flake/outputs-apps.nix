{ pkgs, zx-wrapper, viberootsRoot, version, releaseTag, ... }:
let
  remoteTools = import ./packages/remote-worker-tools.nix { inherit pkgs zx-wrapper; };
  viberoots = import ../packages/viberoots-command.nix {
    inherit pkgs zx-wrapper version releaseTag;
    viberootsSrc = viberootsRoot;
  };
  bootstrap = pkgs.writeShellScriptBin "remote-worker-bootstrap" ''
    set -euo pipefail
    helper="${viberootsRoot}/build-tools/tools/remote-exec/remote-worker-bootstrap.ts"
    if [ ! -f "$helper" ]; then
      echo "remote-worker-bootstrap: viberoots source is missing $helper" >&2
      exit 1
    fi
    exec ${remoteTools.remote-worker-tools}/bin/zx-wrapper \
      --import "${viberootsRoot}/build-tools/tools/dev/zx-init.mjs" \
      "$helper" \
      --remote-worker-tools "${remoteTools.remote-worker-tools}" \
      "$@"
  '';
in
{
  gomod2nix = {
    type = "app";
    program = "${pkgs.gomod2nix}/bin/gomod2nix";
  };
  pnpm = {
    type = "app";
    program = "${pkgs.pnpm}/bin/pnpm";
  };
  bulk-move = {
    type = "app";
    program = "${pkgs.writeShellScriptBin "bulk-move" ''
      set -euo pipefail
      helper="${viberootsRoot}/build-tools/tools/dev/bulk-move.ts"
      if [ ! -f "$helper" ]; then
        echo "bulk-move: viberoots source is missing $helper" >&2
        exit 1
      fi
      exec ${pkgs.nodejs_22}/bin/node \
        --experimental-strip-types \
        --experimental-top-level-await \
        --disable-warning=ExperimentalWarning \
        --import="${pkgs.nodePackages.zx}/lib/node_modules/zx/build/globals.js" \
        --import="${viberootsRoot}/build-tools/tools/dev/zx-init.mjs" \
        "$helper" "$@"
    ''}/bin/bulk-move";
  };
  viberoots = {
    type = "app";
    program = "${viberoots}/bin/viberoots";
  };
  remote-worker-bootstrap = {
    type = "app";
    program = "${bootstrap}/bin/remote-worker-bootstrap";
  };
}
