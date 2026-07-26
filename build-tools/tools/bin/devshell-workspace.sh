#!/usr/bin/env bash

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
	local changed_source=""
	changed_source="$(
		find "${live_root}/viberoots" -type f -newer "${marker}" \
			-not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/.viberoots/*' \
			-not -path '*/buck-out/*' -not -path '*/coverage/*' -not -path '*/dist/*' \
			-not -name '.source-fingerprint' -print -quit 2>/dev/null || true
	)"
	[[ -z "${changed_source}" ]] || return 0
	local workspace_input
	for workspace_input in \
		"${live_root}/.viberoots/workspace/flake.nix" \
		"${live_root}/.viberoots/workspace/flake.lock"; do
		[[ -f "${workspace_input}" && "${workspace_input}" -nt "${marker}" ]] && return 0
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

nix_store_zx_wrapper() {
	local candidate
	candidate="$(command -v zx-wrapper 2>/dev/null || true)"
	case "${candidate}" in
		/nix/store/*/bin/zx-wrapper)
			[[ -x "${candidate}" ]] && printf '%s\n' "${candidate}" && return 0
			;;
	esac
	return 1
}

refresh_stale_direnv_stage0() {
	local live_root="$1"
	local source_root="${live_root}/viberoots"
	local refresh_script="${source_root}/build-tools/tools/dev/refresh-direnv-stage0.ts"
	local zx_init="${source_root}/build-tools/tools/dev/zx-init.mjs"
	local wrapper
	wrapper="$(nix_store_zx_wrapper || true)"
	if [[ -z "${wrapper}" || ! -f "${refresh_script}" || ! -f "${zx_init}" ]]; then
		echo "error: stale dev shell inputs require the current Nix-store zx-wrapper" 1>&2
		echo "repair: run viberoots post-clone, then retry the command" 1>&2
		return 1
	fi
	"${wrapper}" --import "${zx_init}" "${refresh_script}" --workspace-root "${live_root}"
}
