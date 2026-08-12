#!/usr/bin/env bash

artifact_ingress_consume_nested_cache_role_authority() {
  if [[ "${VBR_NIX_CACHE_ROLE_AUTHORITY:-}" != "verify-nested-v1" ]]; then
    return 0
  fi
  unset VBR_NIX_CACHE_ROLE_REQUIRED VBR_NIX_CACHE_ROLE_OPTIONAL
  unset VBR_NIX_CACHE_ROLE_POLICY VBR_NIX_CACHE_ROLE_BINDING VBR_NIX_CACHE_ROLE_CONFIG_B64 VBR_NIX_CACHE_ROLE_AUTHORITY
}

artifact_ingress_nix_config_matches_nested_role() {
  local captured="${1:-}" decoded
  [[ "${VBR_NIX_CACHE_ROLE_AUTHORITY:-}" == "verify-nested-v1" ]] || return 1
  if ! decoded="$(node -e 'const e=String(process.env.VBR_NIX_CACHE_ROLE_CONFIG_B64||""),b=Buffer.from(e,"base64");if(b.toString("base64")!==e)process.exit(1);process.stdout.write(b)' </dev/null)"; then
    return 1
  fi
  [[ "${captured}" == "${decoded}" ]]
}

artifact_ingress_publish_reviewed_nix_cache_config() {
  unset VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG
  if [[ "${VBR_NIX_CACHE_HEALTH_APPLIED:-}" != "1" ]]; then
    unset VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS
    unset VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY
  fi
  if [[ "${VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED:-}" == "1" && "${VBR_NIX_CACHE_HEALTH_APPLIED:-}" == "1" ]]; then
    if declare -p NIX_CONFIG >/dev/null 2>&1; then
      VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG="${NIX_CONFIG}"
      export VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG
    fi
    return 0
  fi
  unset VBR_NIX_CACHE_HEALTH_APPLIED
  unset VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS
  unset VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY
}

artifact_ingress_refresh_nix_cache_health() {
  local proof_bound_role="0"
  [[ "${VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED:-}" == "1" ]] || return 0
  if [[ "${VBR_NIX_CACHE_ROLE_AUTHORITY:-}" == "verify-nested-v1" ]]; then
    if ! NIX_CONFIG="$(node -e 'const e=String(process.env.VBR_NIX_CACHE_ROLE_CONFIG_B64||""),b=Buffer.from(e,"base64");if(b.toString("base64")!==e)process.exit(1);process.stdout.write(b)' </dev/null)"; then
      echo "error: proof-bound Nix cache role config is invalid" 1>&2
      return 1
    fi
    export NIX_CONFIG
    env_apply_nix_cache_health || return 1
    proof_bound_role="1"
  elif [[ "${VBR_NIX_CACHE_HEALTH_APPLIED:-}" == "1" && -n "${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG:-}" ]]; then
    export NIX_CONFIG="${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG}"
  elif [[ -n "${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG:-}" ]]; then
    export NIX_CONFIG="${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG}"
  elif [[ "${VBR_DEVSHELL_ARTIFACT_WAS_SET_NIX_CONFIG:-}" == "1" ]]; then
    export NIX_CONFIG="${VBR_DEVSHELL_ARTIFACT_VALUE_NIX_CONFIG:-}"
  else
    unset NIX_CONFIG
  fi
  if [[ "${VBR_NIX_CACHE_ROLE_AUTHORITY:-}" != "verify-nested-v1" && -z "${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG:-}" ]] && declare -F env_strip_nix_cache_overrides >/dev/null 2>&1; then
    local retained
    retained="$(env_strip_nix_cache_overrides)"
    if [[ -n "${retained}" ]]; then
      export NIX_CONFIG="${retained}"
    else
      unset NIX_CONFIG
    fi
  fi
  if [[ -n "${VBR_ARTIFACT_INGRESS_EFFECTIVE_NETRC_FILE:-}" ]]; then
    local retained_with_netrc
    retained_with_netrc="$(
      printf "%s\n" "${NIX_CONFIG:-}" | awk '
        {
          line = $0
          key = line
          sub(/[[:space:]]*=.*/, "", key)
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
          if (key != "netrc-file" && line != "") print line
        }
      '
    )"
    if [[ -n "${retained_with_netrc}" ]]; then
      export NIX_CONFIG="${retained_with_netrc}"$'\n'"netrc-file = ${VBR_ARTIFACT_INGRESS_EFFECTIVE_NETRC_FILE}"
    else
      export NIX_CONFIG="netrc-file = ${VBR_ARTIFACT_INGRESS_EFFECTIVE_NETRC_FILE}"
    fi
  fi
  if [[ "${proof_bound_role}" == "1" ]]; then
    VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG="${NIX_CONFIG:-}"
    export VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG
    return 0
  fi
  unset VBR_NIX_CACHE_HEALTH_APPLIED
  env_apply_nix_cache_health
}

artifact_ingress_validated_effective_netrc_from_config() {
  local config="${1:-}" candidate
  candidate="$(
    printf "%s\n" "${config}" | awk '
      {
        line = $0
        key = line
        sub(/[[:space:]]*=.*/, "", key)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
        if (key == "netrc-file") {
          value = line
          sub(/^[^=]*=/, "", value)
          gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
          print value
        }
      }
    ' | tail -n 1
  )"
  [[ "${candidate}" == /* && -f "${candidate}" && -r "${candidate}" ]] || return 0
  printf '%s\n' "${candidate}"
}

artifact_ingress_capture_effective_netrc() {
  local workspace_root="$1" tools_root nix_bin config candidate
  tools_root="$(artifact_ingress_tools_root "${workspace_root}" 2>/dev/null || true)"
  nix_bin="${tools_root}/bin/nix"
  [[ -n "${tools_root}" && -x "${nix_bin}" ]] || return 0
  config="$("${nix_bin}" config show 2>/dev/null || true)"
  candidate="$(artifact_ingress_validated_effective_netrc_from_config "${config}")"
  if [[ -n "${candidate}" ]]; then
    VBR_ARTIFACT_INGRESS_EFFECTIVE_NETRC_FILE="${candidate}"
    export VBR_ARTIFACT_INGRESS_EFFECTIVE_NETRC_FILE
  fi
}
