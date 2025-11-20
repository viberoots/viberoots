{ pkgs }:
args:
let
  lib = pkgs.lib;
  # Unpack with defaults
  pname = args.pname or "py-unnamed";
  version = args.version or "0.0.0";
  src = args.srcAbs or args.src or ./.;
  lockfile = args.lockfile or null;
  subdir = args.subdir or ".";
  patchesMap = args.patchesMap or {};
  devOverrides = args.devOverrides or {};
  kind = args.kind or "app";
  sanitize = s: lib.replaceStrings ["//" ":" "/" " "] ["" "-" "-" "-"] s;
in
pkgs.stdenvNoCC.mkDerivation {
  inherit pname version src;
  # Keep evaluation cheap and deterministic; we do not execute uv here.
  # This backend validates presence of uv.lock and produces a tiny derivation that
  # records build metadata. Future PRs can replace this with uv2nix wiring.

  buildPhase = ''
    set -euo pipefail
    if [ ! -f "${lockfile}" ]; then
      echo "missing lockfile: ${lockfile}" >&2
      exit 1
    fi
    echo ok > .build-ok
  '';

  installPhase = ''
    set -euo pipefail
    mkdir -p "$out"
    # Record minimal metadata for debugging and cache keys
    cat > "$out/BUILD-INFO.json" <<'JSON'
    {
      "kind": "${kind}",
      "lockfile": "${lockfile}",
      "subdir": "${subdir}"
    }
    JSON
    # Touch a predictable path so selected builds have materialized output
    touch "$out/.ok"
  '';
}

