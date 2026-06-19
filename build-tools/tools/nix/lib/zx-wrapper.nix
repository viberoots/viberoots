# Single source of truth for the `zx-wrapper` binary used across this repo.
#
# The wrapper auto-discovers `zx-init.mjs` (the resolver hook that auto-appends `.ts` to
# relative imports) by:
#   1. honoring an explicit ZX_INIT env var when set, else
#   2. walking up from $PWD looking for the active viberoots zx-init.mjs.
#
# This handles dev-shell invocations, shebang `#!/usr/bin/env zx-wrapper` invocations
# spawned from temp scaffolding workspaces, and `nativeBuildInputs` injection into
# nix derivations that need to spawn the wrapper from a hermetic sandbox.
{ pkgs }:
pkgs.writeShellScriptBin "zx-wrapper" ''
  set -euo pipefail
  _zx_init_import=()
  _viberoots_root=""
  if [ -n "''${ZX_INIT:-}" ] && [ -f "''${ZX_INIT}" ]; then
    _zx_init_import=(--import="''${ZX_INIT}")
    _viberoots_root="$(cd "$(dirname "''${ZX_INIT}")/../../.." && pwd -P)"
  else
    _search="''${PWD}"
    while [ "$_search" != "/" ] && [ -n "$_search" ]; do
      for _candidate in \
        "$_search/build-tools/tools/dev/zx-init.mjs" \
        "$_search/viberoots/build-tools/tools/dev/zx-init.mjs" \
        "$_search/.viberoots/current/build-tools/tools/dev/zx-init.mjs"; do
        if [ -f "$_candidate" ]; then
          _zx_init_import=(--import="$_candidate")
          _viberoots_root="$(cd "$(dirname "$_candidate")/../../.." && pwd -P)"
          break 2
        fi
      done
      _search="$(dirname "$_search")"
    done
  fi
  if [ "$#" -gt 0 ] && [ -n "$_viberoots_root" ]; then
    case "$1" in
      build-tools/tools/*)
        if [ ! -e "$1" ] && [ -e "$_viberoots_root/$1" ]; then
          set -- "$_viberoots_root/$1" "''${@:2}"
        fi
        ;;
    esac
  fi
  exec ${pkgs.nodejs_22}/bin/node \
    --experimental-strip-types \
    --experimental-top-level-await \
    --disable-warning=ExperimentalWarning \
    --import="${pkgs.nodePackages.zx}/lib/node_modules/zx/build/globals.js" \
    "''${_zx_init_import[@]}" \
    "$@"
''
