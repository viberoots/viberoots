{ pkgs, zx-wrapper, viberootsSrc ? ../../../.., version ? "0.0.0-dev", releaseTag ? "v${version}" }:

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
  export PATH="${pkgs.git}/bin:${pkgs.nix}/bin:$PATH"
  exec ${zx-wrapper}/bin/zx-wrapper \
    --import "${viberootsSrc}/build-tools/tools/dev/zx-init.mjs" \
    "$helper" "$@"
''
