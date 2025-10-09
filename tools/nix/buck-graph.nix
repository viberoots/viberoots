{ pkgs, buck2Input, preludeOut, src ? ../../. }:
let
  lib = pkgs.lib;
  # Clean snapshot of the repo for reproducible graph export
  repo = builtins.path { path = src; name = "repo"; };
  node = pkgs.nodejs_22;
  zx = pkgs.nodePackages.zx;
  buck2 = pkgs.buck2 or (import buck2Input { inherit pkgs; });
in pkgs.stdenv.mkDerivation {
  pname = "buck-graph";
  version = "0.1.0";
  src = repo;
  nativeBuildInputs = [ node zx buck2 pkgs.jq pkgs.coreutils ];
  dontConfigure = true;
  dontBuild = true;
  installPhase = ''
    set -eu
    mkdir -p "$out"
    # Work inside a writable temp copy to avoid mutating store paths
    work="$(mktemp -d)"
    cp -a "$src/." "$work/"
    chmod -R u+w "$work"
    cd "$work"

    # Ensure Buck prelude is available and .buckconfig points to it
    rm -f .buckroot || true
    printf '.\n' > .buckroot
    rm -rf prelude || true
    ln -s "${preludeOut}/prelude" prelude
    cat > .buckconfig <<'EOF'
    [buildfile]
    name = TARGETS

    [repositories]
    root = .
    prelude = ./prelude
    toolchains = ./toolchains
    repo_toolchains = ./toolchains
    fbsource = ./prelude/third-party/fbsource_stub
    fbcode = ./prelude/third-party/fbcode_stub
    config = ./prelude

    [cells]
    root = .
    prelude = ./prelude
    toolchains = ./toolchains
    repo_toolchains = ./toolchains
    fbsource = ./prelude/third-party/fbsource_stub
    fbcode = ./prelude/third-party/fbcode_stub
    config = ./prelude

    [build]
    prelude = prelude
    user_platform = prelude//platforms:default
    target_platforms = prelude//platforms:default
    EOF

    mkdir -p toolchains
    printf '[buildfile]\nname = TARGETS\n' > toolchains/.buckconfig

    # Export the configured Buck graph using the zx script in the repo snapshot
    export PATH="${buck2}/bin:$PATH"
    node \
      --experimental-strip-types \
      --experimental-top-level-await \
      --disable-warning=ExperimentalWarning \
      --import="${zx}/lib/node_modules/zx/build/globals.js" \
      "./tools/buck/export-graph.ts" --out tools/buck/graph.json

    # Copy to the derivation output
    install -Dm644 tools/buck/graph.json "$out/graph.json"
  '';
}


