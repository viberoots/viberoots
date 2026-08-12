#!/usr/bin/env bash

# A long-lived parent shell or cached direnv may retain an earlier network
# probe. Every command front door begins a fresh review. build/p use
# verified-ingress only to prove the shell authority before that review.
vbr_cache_health_scope_mode="${1:-}"
if [[ "${vbr_cache_health_scope_mode}" == "standalone" && "${VBR_NIX_CACHE_ROLE_AUTHORITY:-}" == "verify-nested-v1" && "${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG+x}" == "x" ]]; then
	if ! NIX_CONFIG="$(node -e 'const e=String(process.env.VBR_NIX_CACHE_ROLE_CONFIG_B64||""),b=Buffer.from(e,"base64");if(b.toString("base64")!==e)process.exit(1);process.stdout.write(b)' </dev/null)"; then
		echo "error: proof-bound Nix cache role config is invalid" 1>&2
		return 1 2>/dev/null || exit 1
	fi
	export NIX_CONFIG
elif [[ "${vbr_cache_health_scope_mode}" == "standalone" ]]; then
	if [[ "${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG+x}" == "x" ]]; then
		export NIX_CONFIG="${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG}"
	fi
	unset VBR_NIX_CACHE_ROLE_AUTHORITY VBR_NIX_CACHE_ROLE_REQUIRED
	unset VBR_NIX_CACHE_ROLE_OPTIONAL VBR_NIX_CACHE_ROLE_POLICY
	unset VBR_NIX_CACHE_ROLE_BINDING VBR_NIX_CACHE_ROLE_CONFIG_B64
elif [[ "${vbr_cache_health_scope_mode}" == "verified-ingress" && "${VBR_NIX_CACHE_ROLE_AUTHORITY:-}" == "verify-nested-v1" ]]; then
	if ! NIX_CONFIG="$(node -e 'const e=String(process.env.VBR_NIX_CACHE_ROLE_CONFIG_B64||""),b=Buffer.from(e,"base64");if(b.toString("base64")!==e)process.exit(1);process.stdout.write(b)' </dev/null)"; then
		echo "error: proof-bound Nix cache role config is invalid" 1>&2
		return 1 2>/dev/null || exit 1
	fi
	export NIX_CONFIG
elif [[ "${vbr_cache_health_scope_mode}" == "verified-ingress" && "${VBR_NIX_CACHE_HEALTH_APPLIED:-}" == "1" && -n "${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG:-}" ]]; then
	export NIX_CONFIG="${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG}"
	unset VBR_NIX_CACHE_ROLE_AUTHORITY VBR_NIX_CACHE_ROLE_REQUIRED
	unset VBR_NIX_CACHE_ROLE_OPTIONAL VBR_NIX_CACHE_ROLE_POLICY
	unset VBR_NIX_CACHE_ROLE_BINDING VBR_NIX_CACHE_ROLE_CONFIG_B64
elif [[ "${VBR_NIX_CACHE_ROLE_AUTHORITY:-}" != "verify-nested-v1" ]]; then
	if [[ "${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG+x}" == "x" ]]; then
		export NIX_CONFIG="${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG}"
	fi
fi
unset VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG
unset VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS
unset VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY
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
