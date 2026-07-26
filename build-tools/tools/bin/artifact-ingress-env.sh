#!/usr/bin/env bash

VBR_ARTIFACT_INGRESS_SELECTORS="AR AS CC CFLAGS CLANG CP CPATH CPP CPPFLAGS CXX CXXFLAGS GCC LD LDFLAGS LIBRARY_PATH MAKEFLAGS NM RANLIB SDKROOT SSL_CERT_DIR SSL_CERT_FILE STRIP VIRTUAL_ENV XPC_FLAGS CARGO_HOME GOFLAGS GOMODCACHE GOPATH GOPROXY GOROOT GOSUMDB GOTOOLCHAIN NODE NODE_OPTIONS NODE_PATH NPM_CONFIG_PREFIX PKG_CONFIG_PATH PNPM PNPM_HOME PYTHON PYTHONHASHSEED PYTHONHOME PYTHONNOUSERSITE PYTHONPATH RUSTC RUSTFLAGS RUSTUP_HOME UV VBR_ARTIFACT_TOOLS_ROOT VIBEROOTS_FLAKE_INPUT_ROOT VIBEROOTS_ROOT VIBEROOTS_SOURCE_ROOT WORKSPACE_ROOT NIX_APPLE_SDK_VERSION NIX_BIN NIX_BINTOOLS NIX_BUILD_CORES NIX_CC NIX_CFLAGS_COMPILE NIX_CONFIG NIX_DONT_SET_RPATH NIX_DONT_SET_RPATH_FOR_BUILD NIX_ENFORCE_NO_NATIVE NIX_HARDENING_ENABLE NIX_IGNORE_LD_THROUGH_GCC NIX_LDFLAGS NIX_NO_SELF_RPATH NIX_PROFILES NIX_REMOTE NIX_SSL_CERT_DIR NIX_SSL_CERT_FILE NIX_STORE NIX_USER_PROFILE_DIR"
VBR_ARTIFACT_INGRESS_CANONICALIZED_SELECTORS="NIX_CFLAGS_COMPILE NIX_PROFILES NIX_USER_PROFILE_DIR XPC_FLAGS"

VBR_ARTIFACT_INGRESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${VBR_ARTIFACT_INGRESS_DIR}/artifact-ingress-selectors.sh"
. "${VBR_ARTIFACT_INGRESS_DIR}/artifact-ingress-cache.sh"
unset VBR_ARTIFACT_INGRESS_DIR

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
  local tools_root source_root zx_init token reviewed_config_fd proof_payload
  tools_root="$(artifact_ingress_tools_root "${workspace_root}")"
  source_root="${tools_root}/share/viberoots-source"
  zx_init="${source_root}/build-tools/tools/dev/zx-init.mjs"
  unset VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN
  if [[ "${VBR_NIX_CACHE_HEALTH_APPLIED:-}" == "1" ]]; then
    case "${VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY:-}" in auto|strict) ;; *) return 1 ;; esac
    [[ "${VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS:-}" != *$'\n'* ]] || return 1
    [[ "${VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS:-}" != *$'\n'* ]] || return 1
    token="${RANDOM}${RANDOM}-$$-${RANDOM}"
    proof_payload="vbr-nix-cache-review@1"$'\n'"${token}"$'\n'"${VBR_NIX_CACHE_HEALTH_REVIEWED_POLICY}"$'\n'"${VBR_NIX_CACHE_HEALTH_REVIEWED_REQUIRED_SUBSTITUTERS:-}"$'\n'"${VBR_NIX_CACHE_HEALTH_REVIEWED_OPTIONAL_SUBSTITUTERS:-}"$'\n'"${VBR_NIX_CACHE_HEALTH_REVIEWED_CONFIG:-}"
    exec {reviewed_config_fd}<<<"${proof_payload}"
    VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD="${reviewed_config_fd}"
    VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN="${token}"
    export VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_FD VBR_ARTIFACT_INGRESS_REVIEWED_CONFIG_TOKEN
  fi
  exec "${tools_root}/bin/zx-wrapper" --import "${zx_init}" \
    "${source_root}/${script_relative}" --artifact-workspace-root="${workspace_root}" "$@"
}
