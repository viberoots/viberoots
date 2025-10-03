#!/usr/bin/env bash
set -euo pipefail

# Directory of this helper script (tools/bin)
export ENV_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

env_init_paths() {
	local script_path="$1"
	export SCRIPT_DIR="$(cd "$(dirname "$script_path")" && pwd)"
	export REPO_ROOT="${SCRIPT_DIR}/../.."
	export LIVE_ROOT="${WORKSPACE_ROOT:-$REPO_ROOT}"
}

exec_in_dev_shell() {
	local live_root="$1"; shift
  if [[ -n "${NO_DEV_SHELL:-}" ]]; then
    exec "$@"
  elif [[ -z "${IN_NIX_SHELL:-}" ]]; then
		if ! command -v direnv >/dev/null 2>&1; then
			echo "error: direnv not found on PATH; run inside the dev shell" 1>&2
			exit 127
		fi
		BUCK_CONFIG_LOCK=1 exec direnv exec "$live_root" "$@"
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
	# Prefer explicit ZX_INIT if provided (e.g., tests), else live_root-based path
	local zx_init_path="${ZX_INIT:-${live_root}/tools/dev/zx-init.mjs}"
	exec_in_dev_shell "$live_root" \
		"$node_bin" \
		--experimental-top-level-await \
		--disable-warning=ExperimentalWarning \
		--experimental-strip-types \
		--import "${zx_init_path}" \
		"$target_ts" "$@"
}

run_ts() {
	# Usage: run_ts "../dev/dev-build.ts" [args...]
	local rel_path="$1"; shift || true
	local target_ts="${ENV_SH_DIR}/${rel_path}"
	node_ts "${LIVE_ROOT}" "${target_ts}" "$@"
}

# Auto-initialize paths on source if not already set, then ensure coverage dir when enabled
if [[ -z "${SCRIPT_DIR:-}" || -z "${REPO_ROOT:-}" || -z "${LIVE_ROOT:-}" ]]; then
	__ENV_INIT_CALLER="${BASH_SOURCE[1]:-$0}"
	env_init_paths "${__ENV_INIT_CALLER}"
	unset __ENV_INIT_CALLER
fi

if [[ "${COVERAGE:-}" == "1" ]]; then
	ensure_coverage_dir "${REPO_ROOT}"
fi
