#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "${script_dir}/../bin/artifact-ingress-env.sh"
artifact_ingress_reexec_with_devshell "$0" "$@"
artifact_ingress_clear_selectors

# shellcheck source=/dev/null
export VBR_DEVSHELL_USE_GENERATED_AUTHORITY=1
. "${script_dir}/../bin/devshell.sh"

artifact_ingress_trust_devshell_baseline "${LIVE_ROOT}"
artifact_ingress_restore_or_remove_selectors
artifact_ingress_exec "${LIVE_ROOT}" "build-tools/tools/ci/publish-nix-cache-manifest.ts" "$@"
