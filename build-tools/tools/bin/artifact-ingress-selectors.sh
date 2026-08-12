#!/usr/bin/env bash

artifact_ingress_selector_is_canonicalized() {
  case "$1" in
    NIX_*_FOR_TARGET|NIX_*_WRAPPER_TARGET_HOST_*|NIX_*_WRAPPER_TARGET_TARGET_*) return 0 ;;
  esac
  case " ${VBR_ARTIFACT_INGRESS_CANONICALIZED_SELECTORS} " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

artifact_ingress_record_devshell_selectors() {
  local workspace_root="${1:-$(pwd -P)}"
  local name marker value
  for name in ${VBR_ARTIFACT_INGRESS_SELECTORS}; do
    marker="VBR_DEVSHELL_ARTIFACT_WAS_SET_${name}"
    value="VBR_DEVSHELL_ARTIFACT_VALUE_${name}"
    if declare -p "${name}" >/dev/null 2>&1; then
      printf -v "${marker}" '%s' 1
      printf -v "${value}" '%s' "${!name}"
      export "${marker}" "${value}"
    else
      unset "${marker}" "${value}"
    fi
  done
  VBR_DEVSHELL_ARTIFACT_DYNAMIC_SELECTORS=""
  for name in ${!NIX_@}; do
    case "${name}" in
      NIX_DAEMON_SOCKET_PATH|NIX_REMOTE|NIX_SSL_CERT_DIR|NIX_SSL_CERT_FILE) continue ;;
      NIX_*_FOR_TARGET|NIX_*_WRAPPER_TARGET_HOST_*|NIX_*_WRAPPER_TARGET_TARGET_*)
        VBR_DEVSHELL_ARTIFACT_DYNAMIC_SELECTORS="${VBR_DEVSHELL_ARTIFACT_DYNAMIC_SELECTORS} ${name}"
        marker="VBR_DEVSHELL_ARTIFACT_WAS_SET_${name}"
        value="VBR_DEVSHELL_ARTIFACT_VALUE_${name}"
        printf -v "${marker}" '%s' 1
        printf -v "${value}" '%s' "${!name}"
        export "${marker}" "${value}"
        ;;
    esac
  done
  export VBR_DEVSHELL_ARTIFACT_DYNAMIC_SELECTORS
  VBR_DEVSHELL_ARTIFACT_TOOLS_ROOT="$(artifact_ingress_tools_root "${workspace_root}" 2>/dev/null || true)"
  export VBR_DEVSHELL_ARTIFACT_TOOLS_ROOT
  export VBR_DEVSHELL_ARTIFACT_BASELINE=1
}

artifact_ingress_discard_launcher_owned_flake_input() {
  local workspace_root="$1"
  local generated_input="${workspace_root}/.viberoots/workspace/viberoots-flake-input"
  if [[ "${VIBEROOTS_FLAKE_INPUT_ROOT:-}" == "${generated_input}" ]]; then
    unset VIBEROOTS_FLAKE_INPUT_ROOT
  fi
}

artifact_ingress_reexec_with_devshell() {
  local script="$1"
  shift
  local proof=""
  unset VBR_ARTIFACT_INGRESS_NO_ENVRC_VERIFIED
  unset VBR_ARTIFACT_INGRESS_EFFECTIVE_NETRC_FILE
  if [[ -n "${VBR_ARTIFACT_INGRESS_DIRENV_TOKEN:-}" ]]; then
    if IFS= read -r proof <&9 2>/dev/null && [[ "${proof}" == "${VBR_ARTIFACT_INGRESS_DIRENV_TOKEN}" ]]; then
      exec 9<&-
      unset VBR_ARTIFACT_INGRESS_DIRENV_TOKEN
      VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED=1
      artifact_ingress_record_devshell_selectors "${VBR_ARTIFACT_INGRESS_DIRENV_ROOT:-$(pwd -P)}"
      return 0
    fi
    { exec 9<&-; } 2>/dev/null || true
  fi
  unset VBR_ARTIFACT_INGRESS_DIRENV_ROOT VBR_ARTIFACT_INGRESS_DIRENV_TOKEN
  unset VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED
  unset VBR_NIX_CACHE_HEALTH_COMMAND_ACTIVE
  unset VBR_NIX_CACHE_HEALTH_APPLIED
  unset VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG
  unset VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS
  unset VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY
  local direnv_bin root parent tools_root token workspace_root explicit_workspace_root
  workspace_root="$(pwd -P)"
  explicit_workspace_root="${WORKSPACE_ROOT:-}"
  if [[ -n "${explicit_workspace_root}" ]]; then
    explicit_workspace_root="$(cd "${explicit_workspace_root}" 2>/dev/null && pwd -P || true)"
  fi
  if [[ -n "${explicit_workspace_root}" && -f "${explicit_workspace_root}/.envrc" ]] && {
    [[ "${workspace_root}" == "${explicit_workspace_root}" ]] ||
      [[ "${workspace_root}" == "${explicit_workspace_root}/"* ]]
  }; then
    root="${explicit_workspace_root}"
    workspace_root="${explicit_workspace_root}"
  else
    root="${workspace_root}"
    while [[ "${root}" != "/" && ! -f "${root}/.envrc" ]]; do
      parent="${root%/*}"
      root="${parent:-/}"
    done
  fi
  if [[ ! -f "${root}/.envrc" ]]; then
    artifact_ingress_capture_effective_netrc "${workspace_root}"
  fi
  artifact_ingress_discard_launcher_owned_flake_input "${root}"
  artifact_ingress_capture_environment
  artifact_ingress_clear_selectors
  if [[ ! -f "${root}/.envrc" ]]; then
    unset VBR_NIX_CACHE_HEALTH_SOURCE_CONFIG
    artifact_ingress_record_devshell_selectors "${workspace_root}"
    if [[ -n "${VBR_DEVSHELL_ARTIFACT_TOOLS_ROOT:-}" ]]; then
      VBR_ARTIFACT_INGRESS_NO_ENVRC_VERIFIED=1
      export VBR_ARTIFACT_INGRESS_NO_ENVRC_VERIFIED
    fi
    return 0
  fi
  tools_root="$(artifact_ingress_tools_root "${root}")"
  direnv_bin="${tools_root}/bin/direnv"
  [[ -x "${direnv_bin}" ]] || return 0
  token="${RANDOM}${RANDOM}-$$-${RANDOM}"
  exec 9<<<"${token}"
  VBR_ARTIFACT_INGRESS_DIRENV_ROOT="${root}" VBR_ARTIFACT_INGRESS_DIRENV_TOKEN="${token}" \
    PATH="${tools_root}/bin" \
    exec "${direnv_bin}" exec "${root}" "${script}" "$@"
}

artifact_ingress_trust_devshell_baseline() {
  local workspace_root="$1" tools_root
  unset VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED
  if [[ "${VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED:-}" == "1" ]]; then
    [[ -n "${IN_NIX_SHELL:-}" && "${VBR_DEVSHELL_ARTIFACT_BASELINE:-}" == "1" ]] || return 0
  elif [[ "${VBR_ARTIFACT_INGRESS_NO_ENVRC_VERIFIED:-}" == "1" ]]; then
    [[ -z "${IN_NIX_SHELL:-}" && "${VBR_DEVSHELL_ARTIFACT_BASELINE:-}" == "1" ]] || return 0
  else
    return 0
  fi
  tools_root="$(artifact_ingress_tools_root "${workspace_root}")"
  if [[ "${VBR_DEVSHELL_ARTIFACT_TOOLS_ROOT:-}" == "${tools_root}" ]]; then
    VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED=1
  fi
}

artifact_ingress_capture_environment() {
  local name marker value
  VBR_ARTIFACT_INGRESS_DYNAMIC_SELECTORS=""
  for name in ${VBR_ARTIFACT_INGRESS_SELECTORS}; do
    marker="VBR_ARTIFACT_INGRESS_WAS_SET_${name}"
    value="VBR_ARTIFACT_INGRESS_VALUE_${name}"
    if declare -p "${name}" >/dev/null 2>&1; then
      printf -v "${marker}" '%s' 1
      printf -v "${value}" '%s' "${!name}"
      export "${marker}" "${value}"
    else
      unset "${marker}" "${value}"
    fi
  done
  for name in ${!NIX_@}; do
    case "${name}" in
      NIX_*_FOR_TARGET|NIX_*_WRAPPER_TARGET_HOST_*|NIX_*_WRAPPER_TARGET_TARGET_*)
        VBR_ARTIFACT_INGRESS_DYNAMIC_SELECTORS="${VBR_ARTIFACT_INGRESS_DYNAMIC_SELECTORS} ${name}"
        printf -v "VBR_ARTIFACT_INGRESS_WAS_SET_${name}" '%s' 1
        printf -v "VBR_ARTIFACT_INGRESS_VALUE_${name}" '%s' "${!name}"
        export "VBR_ARTIFACT_INGRESS_WAS_SET_${name}" "VBR_ARTIFACT_INGRESS_VALUE_${name}"
        ;;
    esac
  done
  export VBR_ARTIFACT_INGRESS_DYNAMIC_SELECTORS
}

artifact_ingress_clear_selectors() {
  local name
  for name in ${VBR_ARTIFACT_INGRESS_SELECTORS} ${VBR_ARTIFACT_INGRESS_DYNAMIC_SELECTORS:-}; do
    if [[ "${name}" == "WORKSPACE_ROOT" && "${VBR_DEVSHELL_USE_GENERATED_AUTHORITY:-}" == "1" && -n "${VBR_ARTIFACT_INGRESS_VALUE_WORKSPACE_ROOT:-}" ]]; then
      export WORKSPACE_ROOT="${VBR_ARTIFACT_INGRESS_VALUE_WORKSPACE_ROOT}"
    else
      unset "${name}"
    fi
  done
}

artifact_ingress_restore_or_remove_selectors() {
  local name marker value baseline_marker baseline_value captured
  for name in ${VBR_ARTIFACT_INGRESS_SELECTORS}; do
    marker="VBR_ARTIFACT_INGRESS_WAS_SET_${name}"
    value="VBR_ARTIFACT_INGRESS_VALUE_${name}"
    baseline_marker="VBR_DEVSHELL_ARTIFACT_WAS_SET_${name}"
    baseline_value="VBR_DEVSHELL_ARTIFACT_VALUE_${name}"
    captured="${!value:-}"
    if [[ "${name}" == "NIX_CONFIG" && "${VBR_NIX_CACHE_HEALTH_APPLIED:-}" == "1" && "${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG+x}" == "x" ]] && { [[ "${captured}" == "${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG}" ]] || artifact_ingress_nix_config_matches_nested_role "${captured}"; }; then
      unset "${name}"
    elif [[ ( "${name}" == "VBR_ARTIFACT_TOOLS_ROOT" || "${name}" == "WORKSPACE_ROOT" ) && "${VBR_DEVSHELL_USE_GENERATED_AUTHORITY:-}" == "1" && "${VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED:-}" == "1" && "${!baseline_marker:-}" == "1" && -n "${!baseline_value:-}" ]]; then
      export "${name}=${!baseline_value}"
    elif artifact_ingress_selector_is_canonicalized "${name}"; then
      unset "${name}"
    elif [[ "${!marker:-}" == "1" && -n "${captured}" && ( "${VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED:-}" != "1" || "${!baseline_marker:-}" != "1" || "${captured}" != "${!baseline_value:-}" ) ]]; then
      export "${name}=${captured}"
    else
      unset "${name}"
    fi
    unset "${marker}" "${value}" "${baseline_marker}" "${baseline_value}"
  done
  for name in ${VBR_ARTIFACT_INGRESS_DYNAMIC_SELECTORS:-}; do
    marker="VBR_ARTIFACT_INGRESS_WAS_SET_${name}"
    value="VBR_ARTIFACT_INGRESS_VALUE_${name}"
    baseline_marker="VBR_DEVSHELL_ARTIFACT_WAS_SET_${name}"
    baseline_value="VBR_DEVSHELL_ARTIFACT_VALUE_${name}"
    captured="${!value:-}"
    if artifact_ingress_selector_is_canonicalized "${name}"; then
      unset "${name}"
    elif [[ "${!marker:-}" == "1" && -n "${captured}" && ( "${VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED:-}" != "1" || "${!baseline_marker:-}" != "1" || "${captured}" != "${!baseline_value:-}" ) ]]; then
      export "${name}=${captured}"
    else
      unset "${name}"
    fi
    unset "${marker}" "${value}" "${baseline_marker}" "${baseline_value}"
  done
  for name in ${!NIX_@}; do
    if artifact_ingress_selector_is_canonicalized "${name}"; then
      unset "${name}"
    fi
  done
  unset VBR_ARTIFACT_INGRESS_DIRENV_ROOT VBR_ARTIFACT_INGRESS_DIRENV_TOKEN
  unset VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED
  unset VBR_ARTIFACT_INGRESS_NO_ENVRC_VERIFIED
  unset VBR_ARTIFACT_INGRESS_EFFECTIVE_NETRC_FILE
  unset VBR_ARTIFACT_INGRESS_DYNAMIC_SELECTORS
  unset VBR_DEVSHELL_ARTIFACT_BASELINE VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED
  unset VBR_DEVSHELL_ARTIFACT_DYNAMIC_SELECTORS VBR_DEVSHELL_ARTIFACT_TOOLS_ROOT
}
