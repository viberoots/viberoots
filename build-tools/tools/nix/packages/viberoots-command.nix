{ pkgs
, zx-wrapper
, viberootsSrc ? ../../../..
, version ? "0.0.0-dev"
, releaseTag ? "v${version}"
, artifactToolsRoot ? null
}:

pkgs.writeShellScriptBin "viberoots" ''
  set -euo pipefail
  helper="${viberootsSrc}/build-tools/tools/dev/viberoots.ts"
  if [ ! -f "$helper" ]; then
    echo "viberoots: flake source is missing $helper" >&2
    exit 1
  fi
  export VIBEROOTS_VERSION="${version}"
  export VIBEROOTS_RELEASE_TAG="${releaseTag}"
  if [ -n "''${VBR_NIX_BIN:-}" ] && [ -x "$VBR_NIX_BIN" ]; then
    :
  elif [ -x /nix/var/nix/profiles/default/bin/nix ]; then
    export VBR_NIX_BIN="/nix/var/nix/profiles/default/bin/nix"
  else
    export VBR_NIX_BIN="${pkgs.nix}/bin/nix"
  fi
  export NIX_BIN="$VBR_NIX_BIN"
  export GIT_BIN="${pkgs.git}/bin/git"
  ${pkgs.lib.optionalString (artifactToolsRoot != null) ''
    export VBR_ARTIFACT_TOOLS_ROOT="${artifactToolsRoot}"
  ''}
  export SSL_CERT_FILE="''${SSL_CERT_FILE:-${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt}"
  export NIX_SSL_CERT_FILE="''${NIX_SSL_CERT_FILE:-$SSL_CERT_FILE}"
  export NODE_EXTRA_CA_CERTS="''${NODE_EXTRA_CA_CERTS:-$SSL_CERT_FILE}"
  export PATH="${pkgs.git}/bin:${pkgs.rsync}/bin:$(dirname "$VBR_NIX_BIN"):$PATH"
  exec ${zx-wrapper}/bin/zx-wrapper \
    --import "${viberootsSrc}/build-tools/tools/dev/zx-init.mjs" \
    "$helper" "$@"
''
