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
	[[ "${cwd_root}" != "${script_root}" ]] || return 0
	local cwd_tool="${cwd_root}/build-tools/tools/bin/${tool_name}"
	if [[ -f "${cwd_root}/build-tools/tools/dev/viberoots.ts" && -x "${cwd_tool}" ]]; then
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

env_mark_macos_metadata_never_index() {
	local dir="$1"
	[[ -n "${dir}" ]] || return 0
	mkdir -p "${dir}" 2>/dev/null || true
	if [[ "$(uname -s 2>/dev/null || true)" == "Darwin" ]]; then
		[[ -e "${dir}/.metadata_never_index" ]] || : > "${dir}/.metadata_never_index" 2>/dev/null || true
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
	[[ "${VBR_NIX_CACHE_HEALTH_APPLIED:-}" != "1" ]] || return 0
	export VBR_NIX_CACHE_HEALTH_APPLIED=1
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
				local cache_info_url="${substituter%/}/nix-cache-info"
				local probe_status=0
				if nix store info --store "${substituter}" --option connect-timeout 3 >/dev/null 2>&1; then
					probe_status=0
				elif command -v curl >/dev/null 2>&1; then
					if curl -fsS --connect-timeout 3 --max-time 5 "${cache_info_url}" >/dev/null 2>&1; then
						probe_status=0
					else
						probe_status="$?"
					fi
				else
					probe_status=1
				fi
				if [[ "${probe_status}" -eq 0 ]]; then
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

ensure_viberoots_current() {
	local live_root="$1"
	local current="${live_root}/.viberoots/current"
	if [[ -e "${current}/build-tools/tools/dev/zx-init.mjs" ]]; then
		return 0
	fi
	env_mark_macos_metadata_never_index "${live_root}/.viberoots"
	if [[ -L "${current}" && ! -e "${current}" ]]; then
		rm -f "${current}"
	fi
	if [[ ! -e "${current}" && ! -L "${current}" ]]; then
		local target=".."
		if [[ -f "${live_root}/viberoots/build-tools/tools/dev/zx-init.mjs" ]]; then
			target="../viberoots"
		fi
		ln -s "${target}" "${current}" 2>/dev/null || return 1
	fi
	[[ -e "${current}/build-tools/tools/dev/zx-init.mjs" ]]
}

ensure_buck_prelude() {
	local live_root="$1"
	[[ -f "${live_root}/.buckconfig" ]] || return 0
	env_apply_nix_cache_health || return 1
	ensure_viberoots_current "${live_root}" || return 1
	local prelude_path="${live_root}/.viberoots/workspace/prelude"
	local legacy_prelude_path="${live_root}/.viberoots/current/prelude"
	if grep -q '\.viberoots/current/prelude' "${live_root}/.buckconfig" 2>/dev/null; then
		prelude_path="${legacy_prelude_path}"
	fi
	local live_root_real=""
	local current_root_real=""
	live_root_real="$(cd "${live_root}" && pwd -P 2>/dev/null || true)"
	current_root_real="$(cd "${live_root}/.viberoots/current" && pwd -P 2>/dev/null || true)"
	local current_is_live_root="0"
	if [[ -n "${live_root_real}" && "${current_root_real}" == "${live_root_real}" ]]; then
		current_is_live_root="1"
	fi
	if [[ -L "${prelude_path}" && ! -e "${prelude_path}" ]]; then
		rm -f "${prelude_path}"
	fi
	if [[ -f "${prelude_path}/prelude.bzl" ]]; then
		if [[ "${current_is_live_root}" != "1" && -L "${live_root}/prelude" ]]; then
			rm -f "${live_root}/prelude"
		fi
		return 0
	fi
	command -v nix >/dev/null 2>&1 || return 1

	local cache_dir="${live_root}/.viberoots/workspace/buck/tmp/devshell-cache"
	env_mark_macos_metadata_never_index "${live_root}/.viberoots"
	env_mark_macos_metadata_never_index "${live_root}/.viberoots/workspace"
	env_mark_macos_metadata_never_index "${live_root}/.viberoots/workspace/buck"
	env_mark_macos_metadata_never_index "${live_root}/.viberoots/workspace/buck/tmp"
	env_mark_macos_metadata_never_index "${cache_dir}"
	local lock_hash=""
	if [[ -f "${live_root}/flake.lock" ]]; then
		if command -v shasum >/dev/null 2>&1; then
			lock_hash="$(shasum -a 256 "${live_root}/flake.lock" 2>/dev/null | awk '{print $1}')"
		elif command -v sha256sum >/dev/null 2>&1; then
			lock_hash="$(sha256sum "${live_root}/flake.lock" 2>/dev/null | awk '{print $1}')"
		fi
	fi
	local active_viberoots_root="${VIBEROOTS_SOURCE_ROOT:-${VIBEROOTS_ROOT:-}}"
	local selected_viberoots_input_root="${VIBEROOTS_FLAKE_INPUT_ROOT:-${active_viberoots_root}}"
	if [[ -z "${active_viberoots_root}" || ! -f "${active_viberoots_root}/flake.nix" || ! -f "${active_viberoots_root}/build-tools/tools/dev/zx-init.mjs" ]]; then
		if [[ -f "${live_root}/viberoots/build-tools/tools/dev/zx-init.mjs" ]]; then
			active_viberoots_root="${live_root}/viberoots"
		elif [[ -f "${live_root}/.viberoots/current/build-tools/tools/dev/zx-init.mjs" ]]; then
			active_viberoots_root="${live_root}/.viberoots/current"
		else
			active_viberoots_root=""
		fi
		if [[ -z "${VIBEROOTS_FLAKE_INPUT_ROOT:-}" ]]; then
			selected_viberoots_input_root="${active_viberoots_root}"
		fi
	fi
	if [[ -z "${selected_viberoots_input_root}" || ! -f "${selected_viberoots_input_root}/flake.nix" ]]; then
		selected_viberoots_input_root="${active_viberoots_root}"
	fi
	if [[ -n "${selected_viberoots_input_root}" && -f "${selected_viberoots_input_root}/flake.nix" ]]; then
		export VIBEROOTS_FLAKE_INPUT_ROOT="${selected_viberoots_input_root}"
	fi
	local selected_viberoots_input_hash=""
	if [[ -n "${selected_viberoots_input_root}" ]]; then
		if command -v shasum >/dev/null 2>&1; then
			selected_viberoots_input_hash="$(printf "%s" "${selected_viberoots_input_root}" | shasum -a 256 2>/dev/null | awk '{print $1}')"
		elif command -v sha256sum >/dev/null 2>&1; then
			selected_viberoots_input_hash="$(printf "%s" "${selected_viberoots_input_root}" | sha256sum 2>/dev/null | awk '{print $1}')"
		fi
	fi
	local lock_suffix=""
	if [[ -n "${lock_hash}" ]]; then
		lock_suffix="-${lock_hash}"
	fi
	if [[ -n "${selected_viberoots_input_hash}" ]]; then
		lock_suffix="${lock_suffix}-vbr-${selected_viberoots_input_hash}"
	fi
	local pre_cache="${cache_dir}/prelude-path${lock_suffix}"
	local pre_link="${cache_dir}/buck2-prelude${lock_suffix}"
	local pre_cached=""
	local pre_target=""
	if [[ -f "${pre_cache}" ]]; then
		pre_cached="$(cat "${pre_cache}" 2>/dev/null || true)"
	fi
	if [[ -n "${pre_cached}" && -f "${pre_cached}/prelude/prelude.bzl" ]]; then
		pre_target="${pre_cached}/prelude"
	elif [[ -f "${pre_link}/prelude/prelude.bzl" ]]; then
		pre_target="${pre_link}/prelude"
	else
		local pre_out=""
		local workspace_flake_ref="${live_root}"
		if [[ -f "${live_root}/.viberoots/workspace/flake.nix" ]]; then
			workspace_flake_ref="${live_root}/.viberoots/workspace"
		fi
		if [[ -n "${selected_viberoots_input_root}" && -f "${selected_viberoots_input_root}/flake.nix" ]]; then
			pre_out="$(VIBEROOTS_SOURCE_ROOT="${active_viberoots_root}" VIBEROOTS_FLAKE_INPUT_ROOT="${selected_viberoots_input_root}" nix build --override-input viberoots "path:${selected_viberoots_input_root}" "path:${workspace_flake_ref}#buck2-prelude" --out-link "${pre_link}" --no-write-lock-file --accept-flake-config --print-out-paths 2>/dev/null || true)"
		else
			pre_out="$(nix build "path:${workspace_flake_ref}#buck2-prelude" --out-link "${pre_link}" --no-write-lock-file --accept-flake-config --print-out-paths 2>/dev/null || true)"
		fi
		if [[ -z "${pre_out}" ]]; then
			pre_out="$(nix eval --raw --no-write-lock-file "path:${workspace_flake_ref}#inputs.buck2.outPath" 2>/dev/null || true)"
		fi
		if [[ -n "${pre_out}" && -f "${pre_out}/prelude/prelude.bzl" ]]; then
			pre_target="${pre_out}/prelude"
			printf "%s\n" "${pre_out}" > "${pre_cache}" 2>/dev/null || true
		fi
	fi
	if [[ -n "${pre_target}" ]]; then
		if [[ -L "${prelude_path}" || ! -e "${prelude_path}" ]]; then
			mkdir -p "$(dirname "${prelude_path}")"
			rm -f "${prelude_path}"
			ln -s "${pre_target}" "${prelude_path}"
			if [[ "${current_is_live_root}" != "1" && -L "${live_root}/prelude" ]]; then
				rm -f "${live_root}/prelude"
			fi
		else
			echo "error: ${prelude_path} exists but is not a valid symlink; expected prelude/prelude.bzl" 1>&2
			return 1
		fi
	fi
	[[ -f "${prelude_path}/prelude.bzl" ]]
}

devshell_inputs_stale() {
	local live_root="$1"
	local marker="${live_root}/.viberoots/workspace/viberoots-flake-input/.source-fingerprint"
	[[ -d "${live_root}/viberoots" ]] || return 1
	[[ -f "${marker}" ]] || return 0
	local file
	for file in \
		"${live_root}/.viberoots/workspace/flake.nix" \
		"${live_root}/.viberoots/workspace/flake.lock" \
		"${live_root}/viberoots/flake.nix" \
		"${live_root}/viberoots/flake.lock" \
		"${live_root}/viberoots/build-tools/tools/nix/devshell.nix" \
		"${live_root}/viberoots/build-tools/tools/lib/consumer-direnv.ts"; do
		[[ -f "${file}" && "${file}" -nt "${marker}" ]] && return 0
	done
	return 1
}

devshell_stale_reload_allowed() {
	[[ -z "${BUCK_TEST_TARGET:-}" ]] || return 1
	[[ -z "${BUCK_TEST_SRC:-}" ]] || return 1
	[[ -z "${VBR_VERIFY_LOG_FILE:-}" ]] || return 1
	[[ -z "${VBR_VERIFY_PROCESS_STATE_FILE:-}" ]] || return 1
	[[ -z "${VBR_TEST_SEED_STORE_PATH:-}" ]] || return 1
	[[ -z "${VBR_RUN_IN_TEMP_REPO:-}" ]] || return 1
	return 0
}

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
