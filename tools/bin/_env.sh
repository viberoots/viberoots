#!/usr/bin/env bash
set -euo pipefail

env_init_paths() {
  local script_path="$1"
  export SCRIPT_DIR="$(cd "$(dirname "$script_path")" && pwd)"
  export REPO_ROOT="${SCRIPT_DIR}/../.."
  export LIVE_ROOT="${WORKSPACE_ROOT:-$REPO_ROOT}"
}

exec_in_dev_shell() {
  local live_root="$1"; shift
  if [[ -z "${IN_NIX_SHELL:-}" ]]; then
    if ! command -v direnv >/dev/null 2>&1; then
      echo "error: direnv not found on PATH; run inside the dev shell" 1>&2
      exit 127
    fi
    exec direnv exec "$live_root" "$@"
  else
    exec "$@"
  fi
}

ensure_coverage_dir() {
  local repo_root="$1"
  if [[ "${COVERAGE:-}" == "1" ]]; then
    if [[ -z "${NODE_V8_COVERAGE:-}" ]]; then
      export NODE_V8_COVERAGE="${repo_root}/coverage/raw"
    fi
    mkdir -p "${NODE_V8_COVERAGE}"
  fi
}

node_ts() {
  local live_root="$1"; shift
  local target_ts="$1"; shift
  local node_bin="${NODE_BIN:-node}"
  exec_in_dev_shell "$live_root" \
    "$node_bin" \
    --experimental-top-level-await \
    --disable-warning=ExperimentalWarning \
    --experimental-strip-types \
    --import "${live_root}/tools/dev/zx-init.mjs" \
    "$target_ts" "$@"
}
