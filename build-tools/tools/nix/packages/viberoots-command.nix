{ pkgs
, zx-wrapper
, viberootsSrc ? ../../../..
, viberootsNodeModules ? null
, version ? "0.0.0-dev"
, releaseTag ? "v${version}"
}:

let
  nodePathExport =
    if viberootsNodeModules == null then ""
    else ''
      export VIBEROOTS_NODE_PATH="${viberootsNodeModules}/node_modules"
      export NODE_PATH="$VIBEROOTS_NODE_PATH''${NODE_PATH:+:$NODE_PATH}"
    '';
in

pkgs.writeShellScriptBin "viberoots" ''
  set -euo pipefail
  helper="${viberootsSrc}/build-tools/tools/dev/viberoots.ts"
  if [ ! -f "$helper" ]; then
    echo "viberoots: flake source is missing $helper" >&2
    exit 1
  fi
  export VIBEROOTS_VERSION="${version}"
  export VIBEROOTS_RELEASE_TAG="${releaseTag}"
  export NIX_BIN="${pkgs.nix}/bin/nix"
  export VBR_NIX_BIN="''${VBR_NIX_BIN:-$NIX_BIN}"
  export GIT_BIN="${pkgs.git}/bin/git"
  export SSL_CERT_FILE="''${SSL_CERT_FILE:-${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt}"
  export NIX_SSL_CERT_FILE="''${NIX_SSL_CERT_FILE:-$SSL_CERT_FILE}"
  export NODE_EXTRA_CA_CERTS="''${NODE_EXTRA_CA_CERTS:-$SSL_CERT_FILE}"
  export PATH="${pkgs.git}/bin:${pkgs.nix}/bin:$PATH"
  ${nodePathExport}
  exec ${zx-wrapper}/bin/zx-wrapper \
    --import "${viberootsSrc}/build-tools/tools/dev/zx-init.mjs" \
    "$helper" "$@"
''
