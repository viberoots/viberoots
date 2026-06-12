#!/usr/bin/env bash
set -euo pipefail

# Directory of this helper script (build-tools/tools/bin)
export ENV_SH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

env_reexec_from_cwd_repo() {
	local caller_path="${BASH_SOURCE[1]:-$0}"
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
	[[ "${cwd_root}" != "${script_root}" ]] || return 0
	local cwd_tool="${cwd_root}/build-tools/tools/bin/${tool_name}"
	if [[ -x "${cwd_tool}" ]]; then
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

env_strip_nix_cache_overrides() {
	local text="${NIX_CONFIG:-}"
	[[ -n "${text}" ]] || return 0
	printf "%s\n" "${text}" | awk '
		BEGIN {
			skip["substituters"] = 1
			skip["extra-substituters"] = 1
			skip["connect-timeout"] = 1
			skip["stalled-download-timeout"] = 1
			skip["fallback"] = 1
		}
		{
			line = $0
			key = line
			sub(/[[:space:]]*=.*/, "", key)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
			if (skip[key] != 1) print line
		}
	'
}

env_apply_nix_cache_health() {
	[[ "${VBR_NIX_CACHE_POLICY:-auto}" != "off" ]] || return 0
	command -v nix >/dev/null 2>&1 || return 0

	local config
	config="$(nix config show 2>/dev/null || true)"
	[[ -n "${config}" ]] || return 0

	local required_substituters
	required_substituters="$(
		printf "%s\n" "${config}" | awk '
			{
				eq = index($0, "=")
				if (eq <= 0) next
				key = substr($0, 1, eq - 1)
				value = substr($0, eq + 1)
				gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
			}
			key == "substituters" {
				gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
				print value
			}
		'
	)"
	local optional_substituters
	optional_substituters="$(
		printf "%s\n" "${config}" | awk '
			{
				eq = index($0, "=")
				if (eq <= 0) next
				key = substr($0, 1, eq - 1)
				value = substr($0, eq + 1)
				gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
			}
			key == "extra-substituters" {
				gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
				print value
			}
		'
	)"
	[[ -n "${required_substituters}${optional_substituters}" ]] || return 0

	local available=()
	local removed=()
	local seen=" "
	local substituter
	for substituter in ${required_substituters} ${optional_substituters}; do
		[[ "${seen}" != *" ${substituter} "* ]] || continue
		seen="${seen}${substituter} "
		case "${substituter}" in
			http://*|https://*)
				if nix store info --store "${substituter}" --option connect-timeout 3 >/dev/null 2>&1; then
					available+=("${substituter}")
				else
					removed+=("${substituter}")
				fi
				;;
			*)
				available+=("${substituter}")
				;;
		esac
	done

	[[ "${#removed[@]}" -gt 0 ]] || return 0
	if [[ "${VBR_NIX_CACHE_POLICY:-auto}" == "strict" ]]; then
		echo "error: configured Nix substituter(s) unavailable: ${removed[*]}" 1>&2
		return 1
	fi

	local optional_kept=()
	for substituter in ${optional_substituters}; do
		if [[ " ${available[*]} " == *" ${substituter} "* ]]; then
			optional_kept+=("${substituter}")
		fi
	done
	local required_kept=()
	for substituter in ${required_substituters}; do
		if [[ " ${available[*]} " == *" ${substituter} "* ]]; then
			required_kept+=("${substituter}")
		fi
	done

	local retained
	retained="$(env_strip_nix_cache_overrides)"
	local required_joined="${required_kept[*]-}"
	local optional_kept_joined="${optional_kept[*]-}"
	export NIX_CONFIG="${retained}"$'\n'"substituters = ${required_joined}"$'\n'"extra-substituters = ${optional_kept_joined}"$'\n''connect-timeout = 3'$'\n''stalled-download-timeout = 10'$'\n''fallback = true'
	echo "[env] nix cache health: disabled unreachable substituter(s): ${removed[*]}" 1>&2
	echo "[env] nix cache health: using optional substituter(s): ${optional_kept_joined:-<none>}" 1>&2
}

ensure_buck_prelude() {
	local live_root="$1"
	[[ -f "${live_root}/.buckconfig" ]] || return 0
	env_apply_nix_cache_health || return 1
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

env_reexec_from_cwd_repo "$@"

# Auto-initialize paths on source if not already set, then ensure coverage dir when enabled
if [[ -z "${SCRIPT_DIR:-}" || -z "${REPO_ROOT:-}" || -z "${LIVE_ROOT:-}" ]]; then
	__ENV_INIT_CALLER="${BASH_SOURCE[1]:-$0}"
	env_init_paths "${__ENV_INIT_CALLER}"
	unset __ENV_INIT_CALLER
fi

if [[ "${COVERAGE:-}" == "1" ]]; then
	ensure_coverage_dir "${REPO_ROOT}"
fi
