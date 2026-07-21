#!/usr/bin/env bash

VBR_ARTIFACT_INGRESS_SELECTORS="AR AS CC CFLAGS CLANG CP CPATH CPP CPPFLAGS CXX CXXFLAGS GCC LD LDFLAGS LIBRARY_PATH MAKEFLAGS NM RANLIB SDKROOT SSL_CERT_DIR SSL_CERT_FILE STRIP VIRTUAL_ENV XPC_FLAGS CARGO_HOME GOFLAGS GOMODCACHE GOPATH GOPROXY GOROOT GOSUMDB GOTOOLCHAIN NODE NODE_OPTIONS NODE_PATH NPM_CONFIG_PREFIX PKG_CONFIG_PATH PNPM PNPM_HOME PYTHON PYTHONHASHSEED PYTHONHOME PYTHONNOUSERSITE PYTHONPATH RUSTC RUSTFLAGS RUSTUP_HOME UV VBR_ARTIFACT_TOOLS_ROOT VIBEROOTS_FLAKE_INPUT_ROOT VIBEROOTS_ROOT VIBEROOTS_SOURCE_ROOT WORKSPACE_ROOT NIX_APPLE_SDK_VERSION NIX_BIN NIX_BINTOOLS NIX_BUILD_CORES NIX_CC NIX_CFLAGS_COMPILE NIX_CONFIG NIX_DONT_SET_RPATH NIX_DONT_SET_RPATH_FOR_BUILD NIX_ENFORCE_NO_NATIVE NIX_HARDENING_ENABLE NIX_IGNORE_LD_THROUGH_GCC NIX_LDFLAGS NIX_NO_SELF_RPATH NIX_PROFILES NIX_REMOTE NIX_SSL_CERT_DIR NIX_SSL_CERT_FILE NIX_STORE NIX_USER_PROFILE_DIR"
VBR_ARTIFACT_INGRESS_CANONICALIZED_SELECTORS="NIX_CFLAGS_COMPILE NIX_PROFILES NIX_USER_PROFILE_DIR XPC_FLAGS"

artifact_ingress_selector_is_canonicalized() {
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
      NIX_*_WRAPPER_TARGET_HOST_*)
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
  if [[ -n "${VBR_ARTIFACT_INGRESS_DIRENV_TOKEN:-}" ]]; then
    if IFS= read -r proof <&9 2>/dev/null && [[ "${proof}" == "${VBR_ARTIFACT_INGRESS_DIRENV_TOKEN}" ]]; then
      exec 9<&-
      unset VBR_ARTIFACT_INGRESS_DIRENV_TOKEN
      VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED=1
      artifact_ingress_record_devshell_selectors "${VBR_ARTIFACT_INGRESS_DIRENV_ROOT:-$(pwd -P)}"
      return 0
    fi
    exec 9<&- 2>/dev/null || true
  fi
  unset VBR_ARTIFACT_INGRESS_DIRENV_ROOT VBR_ARTIFACT_INGRESS_DIRENV_TOKEN
  unset VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED
  local direnv_bin root parent tools_root token
  root="$(pwd -P)"
  while [[ "${root}" != "/" && ! -f "${root}/.envrc" ]]; do
    parent="${root%/*}"
    root="${parent:-/}"
  done
  artifact_ingress_discard_launcher_owned_flake_input "${root}"
  artifact_ingress_capture_environment
  artifact_ingress_clear_selectors
  [[ -f "${root}/.envrc" ]] || return 0
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
  [[ "${VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED:-}" == "1" ]] || return 0
  [[ -n "${IN_NIX_SHELL:-}" && "${VBR_DEVSHELL_ARTIFACT_BASELINE:-}" == "1" ]] || return 0
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
      NIX_*_WRAPPER_TARGET_HOST_*)
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
    unset "${name}"
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
    if artifact_ingress_selector_is_canonicalized "${name}"; then
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
    if [[ "${!marker:-}" == "1" && -n "${captured}" && ( "${VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED:-}" != "1" || "${!baseline_marker:-}" != "1" || "${captured}" != "${!baseline_value:-}" ) ]]; then
      export "${name}=${captured}"
    else
      unset "${name}"
    fi
    unset "${marker}" "${value}" "${baseline_marker}" "${baseline_value}"
  done
  unset VBR_ARTIFACT_INGRESS_DIRENV_ROOT VBR_ARTIFACT_INGRESS_DIRENV_TOKEN
  unset VBR_ARTIFACT_INGRESS_DIRENV_VERIFIED
  unset VBR_ARTIFACT_INGRESS_DYNAMIC_SELECTORS
  unset VBR_DEVSHELL_ARTIFACT_BASELINE VBR_DEVSHELL_ARTIFACT_BASELINE_TRUSTED
  unset VBR_DEVSHELL_ARTIFACT_DYNAMIC_SELECTORS VBR_DEVSHELL_ARTIFACT_TOOLS_ROOT
}

artifact_ingress_tools_root() {
  local workspace_root="$1"
  local manifest="${workspace_root}/.viberoots/workspace/toolchain-paths.json"
  local in_artifact_tools="0"
  local line root="" store_name physical_root
  [[ -f "${manifest}" ]] || {
    echo "artifact build requires canonical generated tool authority at ${manifest}; run u && i" >&2
    return 1
  }
  while IFS= read -r line || [[ -n "${line}" ]]; do
    if [[ "${line}" == *'"artifactTools"'* ]]; then
      in_artifact_tools="1"
      continue
    fi
    if [[ "${in_artifact_tools}" == "1" && "${line}" =~ \"root\"[[:space:]]*:[[:space:]]*\"([^\"]+)\" ]]; then
      root="${BASH_REMATCH[1]}"
      break
    fi
  done < "${manifest}"
  store_name="${root#/nix/store/}"
  if [[ "${root}" != "/nix/store/${store_name}" || "${store_name}" == */* || ! "${store_name}" =~ ^[a-z0-9]{32}-.+$ ]]; then
    echo "canonical artifact tool authority is invalid at ${manifest}; run u && i" >&2
    return 1
  fi
  if [[ -L "${root}" || ! -d "${root}" || ! -x "${root}/bin/zx-wrapper" || ! -f "${root}/share/viberoots-source/build-tools/tools/dev/zx-init.mjs" ]]; then
    echo "canonical artifact tool authority is unavailable at ${root}; run u && i" >&2
    return 1
  fi
  physical_root="$(cd "${root}" 2>/dev/null && pwd -P || true)"
  if [[ "${physical_root}" != "${root}" ]]; then
    echo "canonical artifact tool authority does not resolve to its declared store root" >&2
    return 1
  fi
  printf '%s\n' "${root}"
}

artifact_ingress_exec() {
  local workspace_root="$1"
  local script_relative="$2"
  shift 2
  local tools_root source_root zx_init
  tools_root="$(artifact_ingress_tools_root "${workspace_root}")"
  source_root="${tools_root}/share/viberoots-source"
  zx_init="${source_root}/build-tools/tools/dev/zx-init.mjs"
  exec "${tools_root}/bin/zx-wrapper" --import "${zx_init}" \
    "${source_root}/${script_relative}" --artifact-workspace-root="${workspace_root}" "$@"
}
