#!/usr/bin/env bash

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

env_reviewed_config_with_netrc() {
	local reviewed_netrc="${1:-}"
	[[ -n "${reviewed_netrc}" && -f "${reviewed_netrc}" && -r "${reviewed_netrc}" ]] || reviewed_netrc=""
	printf "%s\n" "${NIX_CONFIG:-}" | awk -v netrc="${reviewed_netrc}" '
		{
			line = $0
			key = line
			sub(/[[:space:]]*=.*/, "", key)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
			if (key != "netrc-file" && line != "") print line
		}
		END { if (netrc != "") print "netrc-file = " netrc }
	'
}

env_resolve_nix_cache_roles() {
	local nix_bin="${1:-}"
	local helper="${ENV_SH_DIR}/../dev/nix-cache-role-provenance.ts"
	local node_bin=""
	node_bin="$(command -v node 2>/dev/null || true)"
	[[ -n "${nix_bin}" && -x "${nix_bin}" && -n "${node_bin}" && -f "${helper}" ]] || return 1
	local output key value
	output="$(NODE_DISABLE_COMPILE_CACHE=1 "${node_bin}" --experimental-strip-types "${helper}" "${nix_bin}" 2>/dev/null)" || return 1
	local resolved_required=""
	local resolved_optional=""
	while IFS=$'\t' read -r key value; do
		case "${key}" in
			required) resolved_required="${value:-}" ;;
			optional) resolved_optional="${value:-}" ;;
			*) return 1 ;;
		esac
	done <<<"${output}"
	printf '%s\n%s\n' "${resolved_required}" "${resolved_optional}"
}

env_nix_cache_role_sets_match() {
	local effective_required="${1:-}" effective_optional="${2:-}"
	local candidate_required="${3:-}" candidate_optional="${4:-}"
	local entry
	for entry in ${effective_required} ${effective_optional}; do
		[[ " ${candidate_required} ${candidate_optional} " == *" ${entry} "* ]] || return 1
	done
	for entry in ${candidate_required} ${candidate_optional}; do
		[[ " ${effective_required} ${effective_optional} " == *" ${entry} "* ]] || return 1
	done
	return 0
}
