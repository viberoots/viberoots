export function viberootsInputStage0(generatedMarker: string, rsyncExcludes: string): string {
  return `__vbr_stage0_filtered_viberoots_input() {
  local src="\${1:-}"
  [[ -n "\${src}" && -f "\${src}/flake.nix" ]] || return 1
  local src_real
  src_real="$(cd "\${src}" && pwd -P 2>/dev/null || true)"
  [[ -n "\${src_real}" ]] || return 1
  local local_real=""
  [[ -d "\${PWD}/viberoots" ]] && local_real="$(cd "\${PWD}/viberoots" && pwd -P 2>/dev/null || true)"
  [[ -n "\${local_real}" && "\${src_real}" == "\${local_real}" ]] || return 1
  command -v rsync >/dev/null 2>&1 || return 1

  local dst="\${PWD}/.viberoots/workspace/viberoots-flake-input"
  mkdir -p "\${dst}" || return 1
  : > "\${PWD}/.viberoots/workspace/.metadata_never_index" 2>/dev/null || true
  : > "\${dst}/.metadata_never_index" 2>/dev/null || true
  rsync -a --delete --delete-excluded \\
${rsyncExcludes}\
    --exclude /.git --exclude /node_modules --exclude /.viberoots \\
    --exclude /.pnpm-store --exclude /.pnpm-home --exclude /coverage \\
    --exclude /.clinic --exclude /.turbo --exclude /.cache --exclude /dist --exclude /build/ \\
    --exclude /.vite --exclude /.next --exclude /.wasm-producer \\
    --exclude '.node_modules.lockfile-guard.*' --exclude '.*.tmp' \\
    --exclude '.*.ts.??????' --exclude '.*.tsx.??????' \\
    --exclude '.*.js.??????' --exclude '.*.mjs.??????' \\
    --exclude result --exclude 'result-*' \\
    "\${src_real}/" "\${dst}/" >/dev/null 2>&1 || return 1
  [[ -f "\${dst}/flake.nix" ]] || return 1; : > "\${dst}/.source-fingerprint" 2>/dev/null || true
  printf '%s\\n' "\${dst}"
}

__vbr_stage0_align_workspace_flake_input() {
  local flake="\${PWD}/.viberoots/workspace/flake.nix"
  local desired='    viberoots.url = "path:./viberoots-flake-input";'
  [[ -f "\${flake}" && -f "\${PWD}/.viberoots/workspace/viberoots-flake-input/flake.nix" ]] || return 0
  grep -Fq '# ${generatedMarker}' "\${flake}" 2>/dev/null || return 0
  grep -Fq "\${desired}" "\${flake}" 2>/dev/null && return 0
  local tmp="\${flake}.$$.$RANDOM.tmp"
  awk -v desired="\${desired}" '
    /^[[:space:]]*viberoots\\.url[[:space:]]*=/ { print desired; next }
    { print }
  ' "\${flake}" > "\${tmp}" && mv "\${tmp}" "\${flake}" && : > "\${PWD}/.viberoots/workspace/viberoots-flake-input/.source-fingerprint" 2>/dev/null || rm -f "\${tmp}"
}

__vbr_stage0_prune_workspace_flake_generated_roots() {
  local root="\${PWD}/.viberoots/workspace"
  [[ -d "\${root}" ]] || return 0
  local rel
  for rel in backups cache codex-test-logs install-cache nix-xdg-cache pr-logs xdg-cache; do
    rm -rf -- "\${root}/\${rel}" 2>/dev/null || true
  done
  rm -f -- "\${root}/exact-env-smoke.out" "\${root}/host-path" 2>/dev/null || true
}`;
}
