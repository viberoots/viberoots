#!/usr/bin/env bash

# A long-lived parent shell or cached direnv may retain an earlier network
# probe. Every command front door begins a fresh review. build/p use
# verified-ingress only to prove the shell authority before that review.
vbr_cache_health_scope_mode="${1:-}"
unset VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG
case "${vbr_cache_health_scope_mode}" in
verified-ingress)
	# Direnv may reuse a cached shell after the network changes. The verified
	# ingress proves the shell authority, not the freshness of its cache probe.
	unset VBR_NIX_CACHE_HEALTH_APPLIED
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
