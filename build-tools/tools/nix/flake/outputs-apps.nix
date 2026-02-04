{ pkgs, ... }:
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
        "$PWD/build-tools/tools/dev/bulk-move.ts" "$@"
    ''}/bin/bulk-move";
  };
}


