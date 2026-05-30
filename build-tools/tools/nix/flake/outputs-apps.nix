{ pkgs, zx-wrapper, ... }:
let
  remoteTools = import ./packages/remote-worker-tools.nix { inherit pkgs zx-wrapper; };
  bootstrap = pkgs.writeShellScriptBin "remote-worker-bootstrap" ''
    set -euo pipefail
    helper="$PWD/build-tools/tools/remote-exec/remote-worker-bootstrap.ts"
    if [ ! -f "$helper" ]; then
      echo "remote-worker-bootstrap: run from repo root (missing $helper)" >&2
      exit 1
    fi
    exec ${remoteTools.remote-worker-tools}/bin/zx-wrapper \
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
      if [ ! -f "$PWD/build-tools/tools/dev/bulk-move.ts" ]; then
        echo "bulk-move: run from repo root (missing build-tools/tools/dev/bulk-move.ts)" >&2
        exit 1
      fi
      exec ${pkgs.nodejs_22}/bin/node \
        --experimental-strip-types \
        --experimental-top-level-await \
        --disable-warning=ExperimentalWarning \
        --import="${pkgs.nodePackages.zx}/lib/node_modules/zx/build/globals.js" \
        --import="$PWD/build-tools/tools/dev/zx-init.mjs" \
        "$PWD/build-tools/tools/dev/bulk-move.ts" "$@"
    ''}/bin/bulk-move";
  };
  remote-worker-bootstrap = {
    type = "app";
    program = "${bootstrap}/bin/remote-worker-bootstrap";
  };
}
