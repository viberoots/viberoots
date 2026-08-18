#!/usr/bin/env bash
set -euo pipefail

# Directory of this helper script (build-tools/tools/bin)
export ENV_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

env_reexec_from_cwd_repo() {
	local caller_path="${BASH_SOURCE[1]:-$0}"
	if [[ "$(basename "$caller_path")" == "devshell.sh" && -n "${BASH_SOURCE[2]:-}" ]]; then
		caller_path="${BASH_SOURCE[2]}"
	fi
	local tool_name
	tool_name="$(basename "$caller_path")"
	local script_root
	script_root="$(cd "${ENV_SH_DIR}/../../.." && pwd)"
	local cwd_root=""
	if command -v git >/dev/null 2>&1; then
		cwd_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
	fi
	[[ -n "${cwd_root}" ]] || return 0
	cwd_root="$(cd "${cwd_root}" && pwd)"
	local cwd_source_root="${cwd_root}"
	if [[ ! -f "${cwd_source_root}/build-tools/tools/dev/viberoots.ts" && -f "${cwd_root}/viberoots/build-tools/tools/dev/viberoots.ts" ]]; then
		cwd_source_root="${cwd_root}/viberoots"
	fi
	cwd_source_root="$(cd "${cwd_source_root}" && pwd)"
	[[ "${cwd_source_root}" != "${script_root}" ]] || return 0
	local cwd_tool="${cwd_source_root}/build-tools/tools/bin/${tool_name}"
	if [[ -f "${cwd_source_root}/build-tools/tools/dev/viberoots.ts" && -x "${cwd_tool}" ]]; then
		exec "${cwd_tool}" "$@"
	fi
}

env_init_paths() {
	local script_path="$1"
	export SCRIPT_DIR="$(cd "$(dirname "$script_path")" && pwd)"
	export REPO_ROOT="${SCRIPT_DIR}/../../.."
	if command -v git >/dev/null 2>&1; then
		local git_root
		git_root="$(cd "${SCRIPT_DIR}" && git rev-parse --show-toplevel 2>/dev/null || true)"
		if [[ -n "${git_root}" ]]; then
			export REPO_ROOT="${git_root}"
		fi
	fi
	local cwd_root=""
	if command -v git >/dev/null 2>&1; then
		cwd_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
	fi
	if [[ -n "${WORKSPACE_ROOT:-}" ]]; then
		export LIVE_ROOT="${WORKSPACE_ROOT}"
	elif [[ -n "${cwd_root}" ]]; then
		export LIVE_ROOT="${cwd_root}"
	else
		export LIVE_ROOT="${REPO_ROOT}"
	fi
	if [[ -n "${LIVE_ROOT}" && "$(basename "${LIVE_ROOT}")" == "viberoots" && -f "$(dirname "${LIVE_ROOT}")/.viberoots/workspace/flake.nix" ]]; then
		export LIVE_ROOT="$(dirname "${LIVE_ROOT}")"
	fi
	if [[ -n "${LIVE_ROOT}" ]]; then
		LIVE_ROOT="$(cd "${LIVE_ROOT}" && pwd)"
	fi
	if [[ -e "${LIVE_ROOT}/.viberoots/current" && -f "${LIVE_ROOT}/.viberoots/current/build-tools/tools/dev/zx-init.mjs" ]]; then
		export VIBEROOTS_ROOT="$(cd "${LIVE_ROOT}/.viberoots/current" && pwd)"
	elif [[ -n "${VIBEROOTS_SOURCE_ROOT:-}" && -f "${VIBEROOTS_SOURCE_ROOT}/build-tools/tools/dev/zx-init.mjs" ]]; then
		export VIBEROOTS_ROOT="$(cd "${VIBEROOTS_SOURCE_ROOT}" && pwd)"
	elif [[ -n "${VIBEROOTS_ROOT:-}" && -f "${VIBEROOTS_ROOT}/build-tools/tools/dev/zx-init.mjs" ]]; then
		export VIBEROOTS_ROOT="$(cd "${VIBEROOTS_ROOT}" && pwd)"
	elif [[ -f "${LIVE_ROOT}/viberoots/build-tools/tools/dev/zx-init.mjs" ]]; then
		export VIBEROOTS_ROOT="$(cd "${LIVE_ROOT}/viberoots" && pwd)"
	else
		export VIBEROOTS_ROOT="${REPO_ROOT}"
	fi
	if [[ ! -f "${VIBEROOTS_ROOT}/build-tools/tools/dev/zx-init.mjs" ]]; then
		export VIBEROOTS_ROOT="${REPO_ROOT}"
	fi
	export VIBEROOTS_WORKSPACE="${LIVE_ROOT}/.viberoots/workspace"
}

. "${ENV_SH_DIR}/devshell-cache-config.sh"
. "${ENV_SH_DIR}/devshell-cache-health.sh"
. "${ENV_SH_DIR}/devshell-workspace.sh"

devshell_help_only() {
	[[ "${VBR_DEVSHELL_HELP_ONLY:-}" == "1" ]]
}

viberoots_ts_help_only_args() {
	local arg
	for arg in "$@"; do
		case "${arg}" in
			--help|-h|help)
				return 0
				;;
		esac
	done
	return 1
}

exec_in_dev_shell() {
	local live_root="$1"; shift
	local fastpath_enabled="${BUCK_DEV_SHELL_FASTPATH:-1}"
	local zx_init_path="${ZX_INIT:-${VIBEROOTS_ROOT}/build-tools/tools/dev/zx-init.mjs}"
	# zx-init resolver hook reachability is owned by the nix-built `zx-wrapper` itself, which
	# auto-discovers zx-init.mjs via $ZX_INIT or by walking up from $PWD. Adding it to
	# NODE_OPTIONS here would double-register the hook in every node descendant (including
	# vite/rollup/next dev servers), measurably slowing module resolution.
	local can_bypass_direnv="0"
	if [[ "${fastpath_enabled}" != "0" ]]; then
		# Safe fast-path: only bypass direnv when core runtime tools and zx bootstrap are already present.
		# Use a strict superset of tools needed by i/b/v paths.
		local missing=0
		for tool in zx-wrapper nix buck2 pnpm git; do
			if ! command -v "$tool" >/dev/null 2>&1; then
				missing=1
				break
			fi
		done
		if [[ "${missing}" == "0" && -f "${zx_init_path}" ]]; then
			can_bypass_direnv="1"
		fi
	fi
	if [[ -z "${NO_DEV_SHELL:-}" && "${VBR_DEVSHELL_STALE_RELOAD_ATTEMPTED:-}" != "1" ]] && devshell_stale_reload_allowed && devshell_inputs_stale "${live_root}"; then
		if command -v direnv >/dev/null 2>&1; then
			echo "warn dev shell inputs changed; re-running this command through direnv exec" 1>&2
			refresh_stale_direnv_stage0 "${live_root}"
			BUCK_CONFIG_LOCK=1 VBR_DEVSHELL_STALE_RELOAD_ATTEMPTED=1 exec direnv exec "$live_root" "$@"
		elif [[ -z "${IN_NIX_SHELL:-}" ]]; then
			echo "error: direnv not found on PATH; run inside the dev shell" 1>&2
			exit 127
		fi
	fi
	if [[ "${can_bypass_direnv}" == "1" ]] && ! devshell_help_only && ! ensure_buck_prelude "${live_root}"; then
		can_bypass_direnv="0"
	fi
	if [[ -n "${NO_DEV_SHELL:-}" ]]; then
		exec "$@"
	elif [[ -z "${IN_NIX_SHELL:-}" && "${can_bypass_direnv}" == "1" ]]; then
		BUCK_CONFIG_LOCK=1 exec "$@"
	elif [[ -z "${IN_NIX_SHELL:-}" ]]; then
		if ! command -v direnv >/dev/null 2>&1; then
			echo "error: direnv not found on PATH; run inside the dev shell" 1>&2
			exit 127
		fi
		BUCK_CONFIG_LOCK=1 exec direnv exec "$live_root" "$@"
	else
		if devshell_help_only; then
			exec "$@"
		fi
		if ! ensure_buck_prelude "${live_root}"; then
			echo "error: failed to materialize Buck prelude at ${live_root}/.viberoots/current/prelude/prelude.bzl" 1>&2
			exit 1
		fi
		exec "$@"
	fi
}

ensure_coverage_dir() {
	local repo_root="$1"
	if [[ "${COVERAGE:-}" == "1" ]]; then
		if [[ -z "${NODE_V8_COVERAGE:-}" ]]; then
			export NODE_V8_COVERAGE="${repo_root}/coverage/raw"
		fi
		env_mark_macos_metadata_never_index "$(dirname "${NODE_V8_COVERAGE}")"
		env_mark_macos_metadata_never_index "${NODE_V8_COVERAGE}"
	fi
}

node_ts() {
	local live_root="$1"; shift
	local target_ts="$1"; shift
	local node_bin="${NODE_BIN:-node}"
	local help_only="0"
	case "${target_ts}" in
		*/build-tools/tools/dev/viberoots.ts)
			if viberoots_ts_help_only_args "$@"; then
				help_only="1"
			fi
			;;
	esac
	# Prefer explicit ZX_INIT if provided (e.g., tests), else viberoots source path.
	local zx_init_path="${ZX_INIT:-${VIBEROOTS_ROOT}/build-tools/tools/dev/zx-init.mjs}"
	# If zx-wrapper is available, prefer it to guarantee zx globals ($) are provided
	if command -v zx-wrapper >/dev/null 2>&1; then
		VBR_DEVSHELL_HELP_ONLY="${help_only}" exec_in_dev_shell "$live_root" \
			zx-wrapper \
			--import "${zx_init_path}" \
			"$target_ts" "$@"
	else
		VBR_DEVSHELL_HELP_ONLY="${help_only}" exec_in_dev_shell "$live_root" \
			"$node_bin" \
			--experimental-top-level-await \
			--disable-warning=ExperimentalWarning \
			--experimental-strip-types \
			--import "${zx_init_path}" \
			"$target_ts" "$@"
	fi
}

run_ts() {
	# Usage: run_ts "../dev/dev-build.ts" [args...]
	local rel_path="$1"; shift || true
	local target_ts
	if [[ "${rel_path}" = /* ]]; then
		target_ts="${rel_path}"
	else
		local live_target_ts="${LIVE_ROOT}/viberoots/build-tools/tools/bin/${rel_path}"
		if [[ "${VBR_RUN_IN_TEMP_REPO:-}" == "1" && -f "${live_target_ts}" ]]; then
			target_ts="${live_target_ts}"
		else
			target_ts="${VIBEROOTS_ROOT}/build-tools/tools/bin/${rel_path}"
		fi
	fi
	node_ts "${LIVE_ROOT}" "${target_ts}" "$@"
}

env_reexec_from_cwd_repo "$@"

# Initialize paths from the wrapper currently being invoked. Parent shells can legitimately
# carry SCRIPT_DIR/REPO_ROOT/LIVE_ROOT for a different workspace.
__ENV_INIT_CALLER="${BASH_SOURCE[1]:-$0}"
env_init_paths "${__ENV_INIT_CALLER}"
unset __ENV_INIT_CALLER

if [[ "${COVERAGE:-}" == "1" ]]; then
	ensure_coverage_dir "${REPO_ROOT}"
fi
