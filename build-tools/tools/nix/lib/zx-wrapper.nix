# Single source of truth for the `zx-wrapper` binary used across this repo.
#
# The wrapper auto-discovers `zx-init.mjs` (the resolver hook that auto-appends `.ts` to
# relative imports) by:
#   1. honoring an explicit ZX_INIT env var when set, else
#   2. walking up from $PWD looking for build-tools/tools/dev/zx-init.mjs.
#
# This handles dev-shell invocations, shebang `#!/usr/bin/env zx-wrapper` invocations
# spawned from temp scaffolding workspaces, and `nativeBuildInputs` injection into
# nix derivations that need to spawn the wrapper from a hermetic sandbox.
{ pkgs }:
pkgs.writeShellScriptBin "zx-wrapper" ''
  set -euo pipefail
  _zx_init_import=()
  if [ -n "''${ZX_INIT:-}" ] && [ -f "''${ZX_INIT}" ]; then
    _zx_init_import=(--import="''${ZX_INIT}")
  else
    _search="''${PWD}"
    while [ "$_search" != "/" ] && [ -n "$_search" ]; do
      if [ -f "$_search/build-tools/tools/dev/zx-init.mjs" ]; then
        _zx_init_import=(--import="$_search/build-tools/tools/dev/zx-init.mjs")
        break
      fi
      _search="$(dirname "$_search")"
    done
  fi
  exec ${pkgs.nodejs_22}/bin/node \
    --experimental-strip-types \
    --experimental-top-level-await \
    --disable-warning=ExperimentalWarning \
    --import="${pkgs.nodePackages.zx}/lib/node_modules/zx/build/globals.js" \
    "''${_zx_init_import[@]}" \
    "$@"
''
