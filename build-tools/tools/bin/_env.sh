#!/usr/bin/env bash
set -euo pipefail

# Directory of this helper script (build-tools/tools/bin)
export ENV_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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
	export LIVE_ROOT="${WORKSPACE_ROOT:-$REPO_ROOT}"
	if [[ -n "${LIVE_ROOT}" ]]; then
		LIVE_ROOT="$(cd "${LIVE_ROOT}" && pwd)"
	fi
	if [[ ! -f "${LIVE_ROOT}/build-tools/tools/dev/zx-init.mjs" ]]; then
		export LIVE_ROOT="${REPO_ROOT}"
	fi
}

tool_path() {
	local tool="$1"
	local dir
	local old_ifs="$IFS"
	IFS=':'
	for dir in $PATH; do
		if [[ -n "${dir}" && "${dir}" == /nix/store/* && -x "${dir}/${tool}" ]]; then
			printf '%s\n' "${dir}/${tool}"
			IFS="$old_ifs"
			return 0
		fi
	done
	IFS="$old_ifs"
	command -v "$tool"
}

ensure_buck_prelude() {
	local live_root="$1"
	[[ -f "${live_root}/.buckconfig" ]] || return 0
	[[ -f "${live_root}/prelude/prelude.bzl" ]] && return 0
	command -v nix >/dev/null 2>&1 || return 1

	local cache_dir="${live_root}/buck-out/tmp/devshell-cache"
	mkdir -p "${cache_dir}" 2>/dev/null || true
	local lock_hash=""
	if [[ -f "${live_root}/flake.lock" ]]; then
		if command -v shasum >/dev/null 2>&1; then
			lock_hash="$(shasum -a 256 "${live_root}/flake.lock" 2>/dev/null | awk '{print $1}')"
		elif command -v sha256sum >/dev/null 2>&1; then
			lock_hash="$(sha256sum "${live_root}/flake.lock" 2>/dev/null | awk '{print $1}')"
		fi
	fi
	local lock_suffix=""
	if [[ -n "${lock_hash}" ]]; then
		lock_suffix="-${lock_hash}"
	fi
	local pre_cache="${cache_dir}/prelude-path${lock_suffix}"
	local pre_cached=""
	local pre_target=""
	if [[ -f "${pre_cache}" ]]; then
		pre_cached="$(cat "${pre_cache}" 2>/dev/null || true)"
	fi
	if [[ -n "${pre_cached}" && -f "${pre_cached}/prelude/prelude.bzl" ]]; then
		pre_target="${pre_cached}/prelude"
	else
		local pre_out=""
		pre_out="$(nix build "${live_root}#buck2-prelude" --no-link --accept-flake-config --print-out-paths 2>/dev/null || true)"
		if [[ -z "${pre_out}" ]]; then
			pre_out="$(nix eval --raw "${live_root}#inputs.buck2.outPath" 2>/dev/null || true)"
		fi
		if [[ -n "${pre_out}" && -f "${pre_out}/prelude/prelude.bzl" ]]; then
			pre_target="${pre_out}/prelude"
			printf "%s\n" "${pre_out}" > "${pre_cache}" 2>/dev/null || true
		fi
	fi
	if [[ -n "${pre_target}" ]]; then
		if [[ -L "${live_root}/prelude" || ! -e "${live_root}/prelude" ]]; then
			rm -f "${live_root}/prelude"
			ln -s "${pre_target}" "${live_root}/prelude"
		else
			echo "error: ${live_root}/prelude exists but is not a valid symlink; expected prelude/prelude.bzl" 1>&2
			return 1
		fi
	fi
	[[ -f "${live_root}/prelude/prelude.bzl" ]]
}

exec_in_dev_shell() {
	local live_root="$1"; shift
	local fastpath_enabled="${BUCK_DEV_SHELL_FASTPATH:-1}"
	local zx_init_path="${ZX_INIT:-${live_root}/build-tools/tools/dev/zx-init.mjs}"
	# Make the zx-init resolver hook (which auto-appends `.ts` to relative imports) reachable
	# by every `node` subprocess in this dev-shell session, including shebang `zx-wrapper`
	# invocations spawned from inside `.ts` scripts. Without this, scripts that don't go through
	# `node_ts` (e.g. tools spawned via `$\`zx-wrapper foo.ts\``) lose the hook and ESM
	# resolution fails for bare imports like `from "./foo"`.
	if [[ -f "${zx_init_path}" ]]; then
		local zx_init_url="file://${zx_init_path}"
		if [[ "${NODE_OPTIONS:-}" != *"${zx_init_url}"* ]]; then
			export NODE_OPTIONS="--import=${zx_init_url}${NODE_OPTIONS:+ ${NODE_OPTIONS}}"
		fi
	fi
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
		if [[ "${can_bypass_direnv}" == "1" ]] && ! ensure_buck_prelude "${live_root}"; then
			can_bypass_direnv="0"
		fi
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
		if ! ensure_buck_prelude "${live_root}"; then
			echo "error: failed to materialize Buck prelude at ${live_root}/prelude/prelude.bzl" 1>&2
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
		mkdir -p "${NODE_V8_COVERAGE}"
	fi
}

node_ts() {
	local live_root="$1"; shift
	local target_ts="$1"; shift
	local node_bin="${NODE_BIN:-node}"
	# Prefer explicit ZX_INIT if provided (e.g., tests), else live_root-based path
	local zx_init_path="${ZX_INIT:-${live_root}/build-tools/tools/dev/zx-init.mjs}"
  # If zx-wrapper is available, prefer it to guarantee zx globals ($) are provided
  if command -v zx-wrapper >/dev/null 2>&1; then
    exec_in_dev_shell "$live_root" \
      zx-wrapper \
      --import "${zx_init_path}" \
      "$target_ts" "$@"
  else
    exec_in_dev_shell "$live_root" \
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
