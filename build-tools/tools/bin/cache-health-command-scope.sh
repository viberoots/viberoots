#!/usr/bin/env bash

# A long-lived parent shell may retain the result of an earlier network probe.
# Only build/p call this in verified-ingress mode, after the artifact ingress
# function has returned from its FD-authenticated direnv re-entry. All other
# command front doors use standalone mode and always begin a fresh review.
vbr_cache_health_scope_mode="${1:-}"
unset VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG
case "${vbr_cache_health_scope_mode}" in
verified-ingress)
	if [[ "${VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED:-}" != "1" ]]; then
		unset VBR_NIX_CACHE_HEALTH_APPLIED
	fi
	;;
standalone)
	unset VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED
	unset VBR_NIX_CACHE_HEALTH_APPLIED
	;;
*)
	echo "error: cache health command scope requires verified-ingress or standalone mode" 1>&2
	unset vbr_cache_health_scope_mode
	return 64 2>/dev/null || exit 64
	;;
esac
export VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE=1
unset vbr_cache_health_scope_mode
