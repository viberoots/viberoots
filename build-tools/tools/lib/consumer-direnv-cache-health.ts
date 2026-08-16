import { nixCacheRoleHelpersStage0 } from "./consumer-direnv-cache-role-helpers";

export function nixCacheHealthStage0(): string {
  return `${nixCacheRoleHelpersStage0()}

__vbr_stage0_apply_nix_cache_health() {
  __vbr_stage0_cache_nix_args=()
  local current_policy="\${VBR_NIX_CACHE_POLICY:-auto}"
  if [[ "\${current_policy}" == "off" ]]; then
    if [[ "\${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG+x}" == "x" ]]; then
      export NIX_CONFIG="\${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG}"
    fi
    unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY
    unset VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG
    return 0
  fi
  if [[ "\${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG+x}" == "x" ]]; then
    export NIX_CONFIG="\${VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG}"
  fi
  unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY
  unset VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG
  command -v nix >/dev/null 2>&1 || return 0

  local config source_config="\${NIX_CONFIG:-}"
  if ! config="$(nix config show 2>/dev/null)"; then
    echo "error: nix config show failed during cache health evaluation" 1>&2
    unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY
    return 1
  fi
  export VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG="\${source_config}"

  local required_substituters optional_substituters netrc_file
  required_substituters="$(printf "%s\\n" "\${config}" | awk '{
    eq = index($0, "="); if (eq <= 0) next
    key = substr($0, 1, eq - 1); value = substr($0, eq + 1)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
    if (key == "substituters") { gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); print value }
  }')"
  optional_substituters="$(printf "%s\\n" "\${config}" | awk '{
    eq = index($0, "="); if (eq <= 0) next
    key = substr($0, 1, eq - 1); value = substr($0, eq + 1)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
    if (key == "extra-substituters") { gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); print value }
  }')"
  local resolved_roles
  local required_substituter_count=0
  if [[ -n "\${required_substituters}" ]]; then
    required_substituter_count="$(printf '%s\\n' "\${required_substituters}" | wc -w | tr -d '[:space:]')"
  fi
  if [[ "\${required_substituter_count}" -gt 1 && -z "\${optional_substituters}" ]]; then
    if ! resolved_roles="$(__vbr_stage0_resolve_nix_cache_roles "\${__vbr_flake_input_root:-\${VIBEROOTS_SOURCE_ROOT:-\${VIBEROOTS_ROOT:-}}}")"; then
      echo "error: flattened Nix substituters require reviewed source-role provenance" 1>&2
      return 1
    fi
    local resolved_required="\${resolved_roles%%$'\\n'*}"
    local resolved_optional="\${resolved_roles#*$'\\n'}"
    if ! __vbr_stage0_nix_cache_role_sets_match "\${required_substituters}" "\${optional_substituters}" "\${resolved_required}" "\${resolved_optional}"; then
      echo "error: reviewed Nix cache roles do not match effective substituters" 1>&2
      return 1
    fi
    required_substituters="\${resolved_required}"
    optional_substituters="\${resolved_optional}"
  fi
  netrc_file="$(printf "%s\\n" "\${config}" | awk '{
    eq = index($0, "="); if (eq <= 0) next
    key = substr($0, 1, eq - 1); value = substr($0, eq + 1)
    gsub(/^[[:space:]]+|[[:space:]]+$/, "", key)
    if (key == "netrc-file") { gsub(/^[[:space:]]+|[[:space:]]+$/, "", value); print value }
  }')"
  local reviewed_config
  reviewed_config="$(__vbr_stage0_reviewed_config_with_netrc "\${netrc_file}")"
  __vbr_stage0_cache_nix_args=(--option substituters "\${required_substituters}" --option extra-substituters "\${optional_substituters}" --option connect-timeout 3 --option stalled-download-timeout 10 --option fallback true)
  if [[ -z "\${required_substituters}\${optional_substituters}" ]]; then
    export NIX_CONFIG="\${reviewed_config}"
    export VBR_NIX_CACHE_HEALTH_APPLIED=1
    export VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG="\${NIX_CONFIG}"
    export VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS="\${required_substituters}"
    export VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS="\${optional_substituters}"
    export VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY="\${current_policy}"
    return 0
  fi

  local available=()
  local removed=()
  local removed_identities=()
  local seen=" "
  local substituter
  for substituter in \${required_substituters} \${optional_substituters}; do
    [[ "\${seen}" != *" \${substituter} "* ]] || continue
    seen="\${seen}\${substituter} "
    case "\${substituter}" in
      http://*|https://*)
        local cache_identity="\${substituter%%\\?*}"
        cache_identity="\${cache_identity%%\\#*}"
        local cache_scheme="\${cache_identity%%://*}://"
        local cache_location="\${cache_identity#*://}"
        [[ "\${cache_location%%/*}" != *@* ]] || cache_identity="\${cache_scheme}<redacted>@\${cache_location#*@}"
        local credential_url
        credential_url="$(printf '%s' "\${substituter}" | tr '[:upper:]' '[:lower:]')"
        if [[ "\${cache_location%%/*}" == *@* || "\${credential_url}" =~ [?\\&\\#](access[_-]?token|api[_-]?key|apikey|auth|authorization|credential|credentials|password|passwd|secret|sig|signature|token)= || "\${credential_url}" =~ [?\\&\\#][^?\\&\\#=]*%[0-9a-f][0-9a-f][^?\\&\\#=]*= ]]; then
          echo "error: configured Nix substituter embeds credentials in its URL; use netrc-file authentication: \${cache_identity}" 1>&2
          unset NIX_CONFIG
          unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY
          unset VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG
          __vbr_stage0_cache_nix_args=()
          return 1
        fi
        local cache_base="\${substituter%%\\?*}"
        local cache_query=""
        [[ "\${substituter}" != *\\?* ]] || cache_query="?\${substituter#*\\?}"
        local cache_info_url="\${cache_base%/}/nix-cache-info\${cache_query}"
        local probe_status=1
        if command -v curl >/dev/null 2>&1; then
          local curl_args=(-fsS --connect-timeout 3 --max-time 5)
          [[ -z "\${netrc_file}" || ! -f "\${netrc_file}" || ! -r "\${netrc_file}" ]] || curl_args+=(--netrc-file "\${netrc_file}")
          if curl "\${curl_args[@]}" "\${cache_info_url}" >/dev/null 2>&1; then
            probe_status=0
          else
            probe_status="$?"
          fi
        fi
        case "\${probe_status}" in
          0|5|6|7|16|28|35|52|55|56|92) ;;
          *)
            if [[ "\${current_policy}" == "auto" && " \${optional_substituters} " == *" \${substituter} "* && " \${required_substituters} " != *" \${substituter} "* ]]; then
              removed+=("\${substituter}")
              removed_identities+=("\${cache_identity}")
              continue
            fi
            echo "error: Nix cache probe rejected non-transport failure for \${cache_identity}: curl exit \${probe_status}" 1>&2
            unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY
            __vbr_stage0_cache_nix_args=()
            return 1
            ;;
        esac
        if [[ "\${probe_status}" -eq 0 ]]; then
          available+=("\${substituter}")
        else
          removed+=("\${substituter}")
          removed_identities+=("\${cache_identity}")
        fi
        ;;
      *) available+=("\${substituter}") ;;
    esac
  done

  if [[ "\${#removed[@]}" -eq 0 ]]; then
    export NIX_CONFIG="\${reviewed_config}"
    export VBR_NIX_CACHE_HEALTH_APPLIED=1
    export VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG="\${NIX_CONFIG}"
    export VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS="\${required_substituters}"
    export VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS="\${optional_substituters}"
    export VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY="\${current_policy}"
    return 0
  fi
  if [[ "\${current_policy}" == "strict" ]]; then
    echo "error: configured Nix substituter(s) unavailable: \${removed_identities[*]}" 1>&2
    unset VBR_NIX_CACHE_HEALTH_APPLIED VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY
    __vbr_stage0_cache_nix_args=()
    return 1
  fi

  local optional_kept=()
  local optional_kept_identities=()
  local required_kept=()
  for substituter in \${optional_substituters}; do
    if [[ " \${available[*]-} " == *" \${substituter} "* ]]; then
      optional_kept+=("\${substituter}")
      local kept_identity="\${substituter%%\\?*}"
      kept_identity="\${kept_identity%%\\#*}"
      local kept_scheme="\${kept_identity%%://*}://"
      local kept_location="\${kept_identity#*://}"
      [[ "\${kept_location%%/*}" != *@* ]] || kept_identity="\${kept_scheme}<redacted>@\${kept_location#*@}"
      optional_kept_identities+=("\${kept_identity}")
    fi
  done
  for substituter in \${required_substituters}; do
    [[ " \${available[*]-} " == *" \${substituter} "* ]] && required_kept+=("\${substituter}")
  done

  local retained required_joined optional_kept_joined
  export NIX_CONFIG="\${reviewed_config}"
  retained="$(__vbr_stage0_strip_nix_cache_overrides)"
  required_joined="\${required_kept[*]-}"
  optional_kept_joined="\${optional_kept[*]-}"
  __vbr_stage0_cache_nix_args=(--option substituters "\${required_joined}" --option extra-substituters "\${optional_kept_joined}" --option connect-timeout 3 --option stalled-download-timeout 10 --option fallback true)
  export NIX_CONFIG="\${retained}"$'\\n'"substituters = \${required_joined}"$'\\n'"extra-substituters = \${optional_kept_joined}"$'\\n''connect-timeout = 3'$'\\n''stalled-download-timeout = 10'$'\\n''fallback = true'
  export VBR_NIX_CACHE_HEALTH_APPLIED=1
  export VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG="\${NIX_CONFIG}"
  export VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS="\${required_joined}"
  export VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS="\${optional_kept_joined}"
  export VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY="\${current_policy}"
  echo "[env] nix cache health: disabled unreachable substituter(s): \${removed_identities[*]}" 1>&2
  echo "[env] nix cache health: using optional substituter(s): \${optional_kept_identities[*]:-<none>}" 1>&2
}`;
}
