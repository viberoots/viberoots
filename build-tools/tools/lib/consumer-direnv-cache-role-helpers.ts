export function nixCacheRoleHelpersStage0(): string {
  return `__vbr_stage0_strip_nix_cache_overrides() {
  local text="\${NIX_CONFIG:-}"
  [[ -n "\${text}" ]] || return 0
  printf "%s\\n" "\${text}" | awk '
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

__vbr_stage0_reviewed_config_with_netrc() {
  local reviewed_netrc="\${1:-}"
  [[ -n "\${reviewed_netrc}" && -f "\${reviewed_netrc}" && -r "\${reviewed_netrc}" ]] || reviewed_netrc=""
  printf "%s\\n" "\${NIX_CONFIG:-}" | awk -v netrc="\${reviewed_netrc}" '
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

__vbr_stage0_resolve_nix_cache_roles() {
  local source_root="\${1:-}"
  local nix_bin=""
  local node_bin=""
  nix_bin="$(command -v nix 2>/dev/null || true)"
  node_bin="$(command -v node 2>/dev/null || true)"
  if [[ -z "\${node_bin}" ]]; then
    local toolchain_paths="\${PWD}/.viberoots/workspace/toolchains/toolchain_paths.bzl"
    local artifact_tools_root=""
    if [[ -f "\${toolchain_paths}" ]]; then
      artifact_tools_root="$(awk -F '"' '/^NIX_ARTIFACT_TOOLS_ROOT = "/ { print $2; exit }' "\${toolchain_paths}")"
    fi
    if [[ "\${artifact_tools_root}" == /nix/store/* && -x "\${artifact_tools_root}/bin/node" ]]; then
      node_bin="\${artifact_tools_root}/bin/node"
    fi
  fi
  local helper=""
  local candidate
  for candidate in \
    "\${source_root}" \
    "\${VIBEROOTS_SOURCE_ROOT:-}" \
    "\${VIBEROOTS_ROOT:-}" \
    "\${PWD}/.viberoots/current" \
    "\${PWD}/.viberoots/workspace/viberoots-flake-input" \
    "\${PWD}/viberoots"
  do
    if [[ -n "\${candidate}" && -f "\${candidate}/build-tools/tools/dev/nix-cache-role-provenance.ts" ]]; then
      helper="\${candidate}/build-tools/tools/dev/nix-cache-role-provenance.ts"
      break
    fi
  done
  [[ -n "\${nix_bin}" && -x "\${nix_bin}" && -n "\${node_bin}" && -f "\${helper}" ]] || return 1
  local output key value
  output="$(NODE_DISABLE_COMPILE_CACHE=1 "\${node_bin}" --experimental-strip-types "\${helper}" "\${nix_bin}" 2>/dev/null)" || return 1
  local resolved_required=""
  local resolved_optional=""
  while IFS=$'\\t' read -r key value; do
    case "\${key}" in
      required) resolved_required="\${value:-}" ;;
      optional) resolved_optional="\${value:-}" ;;
      *) return 1 ;;
    esac
  done <<<"\${output}"
  printf '%s\\n%s\\n' "\${resolved_required}" "\${resolved_optional}"
}

__vbr_stage0_nix_cache_role_sets_match() {
  local effective_required="\${1:-}" effective_optional="\${2:-}"
  local candidate_required="\${3:-}" candidate_optional="\${4:-}"
  local entry
  for entry in \${effective_required} \${effective_optional}; do
    [[ " \${candidate_required} \${candidate_optional} " == *" \${entry} "* ]] || return 1
  done
  for entry in \${candidate_required} \${candidate_optional}; do
    [[ " \${effective_required} \${effective_optional} " == *" \${entry} "* ]] || return 1
  done
  return 0
}`;
}
