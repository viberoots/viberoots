{ pkgs, remote-worker-tools, viberootsRoot }:

pkgs.writeShellScriptBin "remote-worker-bootstrap" ''
  set -euo pipefail
  helper="${viberootsRoot}/build-tools/tools/remote-exec/remote-worker-bootstrap.ts"
  if [ ! -f "$helper" ]; then
    echo "remote-worker-bootstrap: viberoots source is missing $helper" >&2
    exit 1
  fi
  exec ${remote-worker-tools}/bin/zx-wrapper \
    "$helper" \
    --remote-worker-tools "${remote-worker-tools}" \
    "$@"
''
