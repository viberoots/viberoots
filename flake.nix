# flake.nix — PR 1 devshell and zx-wrapper
{
  description = "bucknix-fresh devshell and scaffolding";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    buck2.url = "github:facebook/buck2";
  };

  outputs = { self, nixpkgs, buck2 }:
  let
    systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-linux" ];
    forAllSystems = f: nixpkgs.lib.genAttrs systems (system:
      let
        pkgs = import nixpkgs { inherit system; };
        zx-wrapper = pkgs.writeShellScriptBin "zx-wrapper" ''
          set -euo pipefail
          exec ${pkgs.nodejs_22}/bin/node \
            --experimental-strip-types \
            --experimental-top-level-await \
            --disable-warning=ExperimentalWarning \
            --import="${pkgs.nodePackages.zx}/lib/node_modules/zx/build/globals.js" \
            "$@"
        '';


        node = pkgs.nodejs_22;
        pnpm = pkgs.pnpm;

        # Inputs for pnpm fetch (FOD): include resolution inputs to avoid missing tarballs
        storeSrc = pkgs.lib.cleanSourceWith {
          src = ./.;
          filter = path: type:
            (builtins.match ".*/pnpm-lock\\.yaml" path != null)
            || (builtins.match ".*/package\\.json" path != null)
            || (builtins.match ".*/pnpm-workspace\\.yaml" path != null)
            || (builtins.match ".*/\\.npmrc" path != null)
            || (builtins.match ".*/patches/pnpm(/.*)?" path != null);
        };

        pnpm-store = pkgs.stdenvNoCC.mkDerivation (let certs = pkgs.cacert; in {
          pname = "pnpm-store";
          version = "lock-${builtins.hashFile "sha256" ./pnpm-lock.yaml}";
          src = storeSrc;
          nativeBuildInputs = [ pkgs.nodejs_22 pkgs.pnpm ];
          outputHashMode = "recursive";
          # Temporary placeholder; updated by tools/dev/update-pnpm-hash.ts after first build attempt
          outputHash     = "sha256-BXt5+VM8x26BNYNel/U2U8k/gIyk+XDamVYykZmXWlY=";
          dontPatchShebangs = true;
          unpackPhase = ''
            runHook preUnpack
            cp -r $src source
            chmod -R u+rwX source
            cd source
            runHook postUnpack
          '';
          buildPhase = ''
            runHook preBuild
            export SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
            export NIX_SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
            export NODE_EXTRA_CA_CERTS=${certs}/etc/ssl/certs/ca-bundle.crt
            export HOME=$(pwd)/.home
            mkdir -p "$HOME"
            # Write store only under $out to keep FOD pure and content-addressed
            pnpm config set store-dir "$out/store"
            pnpm fetch --frozen-lockfile
            runHook postBuild
          '';
          # No installPhase needed; store already at $out/store
          passthru.lockHash = builtins.hashFile "sha256" ./pnpm-lock.yaml;
        });

        # Limit inputs so node-modules changes only when dependency metadata changes
        minimalSrc = pkgs.lib.cleanSourceWith {
          src = ./.;
          filter = path: type:
            (builtins.match ".*/pnpm-lock\\.yaml" path != null)
            || (builtins.match ".*/package\\.json" path != null)
            || (builtins.match ".*/pnpm-workspace\\.yaml" path != null)
            || (builtins.match ".*/\\.npmrc" path != null)
            || (builtins.match ".*/patches/pnpm(/.*)?" path != null);
        };

        node-modules = pkgs.stdenvNoCC.mkDerivation (let certs = pkgs.cacert; in {
          pname = "node-modules";
          version = "lock-${builtins.hashFile "sha256" ./pnpm-lock.yaml}";
          src = minimalSrc;
          nativeBuildInputs = [ node pnpm ];
          unpackPhase = ''
            runHook preUnpack
            cp -r $src source
            chmod -R u+rwX source
            cd source
            runHook postUnpack
          '';
          buildPhase = ''
            runHook preBuild
            export SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
            export NIX_SSL_CERT_FILE=${certs}/etc/ssl/certs/ca-bundle.crt
            export NODE_EXTRA_CA_CERTS=${certs}/etc/ssl/certs/ca-bundle.crt
            export HOME=$(pwd)/.home
            mkdir -p "$HOME"
            # Read from the fixed-output store; PNPM writes only to working dirs
            pnpm config set store-dir "${pnpm-store}/store"
            pnpm install --offline --frozen-lockfile
            runHook postBuild
          '';
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            if [ -d node_modules ]; then
              cp -R node_modules $out/
            fi
            if [ -d .pnpm ]; then
              cp -R .pnpm $out/
            fi
            runHook postInstall
          '';
          passthru.lockHash = builtins.hashFile "sha256" ./pnpm-lock.yaml;
        });
      in f { inherit pkgs zx-wrapper node pnpm pnpm-store node-modules; }
    );
  in {
    devShells = forAllSystems ({ pkgs, zx-wrapper, node-modules, ... }:
      {
        default = pkgs.mkShell {
          shellHook = ''
            # link Nix-built node_modules for IDEs/CLIs (read-only)
            if [ -e node_modules ] && [ ! -L node_modules ]; then
              echo "(devShell) existing non-symlink node_modules detected; not overwriting" >&2 || true
            else
              out_path=$(nix build .#node-modules --no-link --accept-flake-config --print-out-paths 2>/dev/null || true)
              if [ -n "$out_path" ]; then
                ln -sfn "$out_path/node_modules" node_modules || true
                if [ -d "$out_path/node_modules/.bin" ]; then
                  export PATH="$out_path/node_modules/.bin:$PATH"
                fi
              fi
            fi

            export PATH="$PWD/tools/bin:$PATH"
            # Always prepare zsh completions for any zsh spawned later (guarded until node_modules exists)
            mkdir -p .nix-zsh
            cat > .nix-zsh/.zshenv <<'EOF'
if [[ -o interactive ]]; then
  # Prompt for zsh
  PROMPT='%F{green}[nix-shell]%f %m:%~$ '
  autoload -Uz compinit
  compinit -i
  if [ -d "node_modules/zx" ]; then
    eval "$(scaf completions zsh)"
  fi
fi
EOF
            export ZDOTDIR="$PWD/.nix-zsh"
            # Also create a .zshrc for shells that ignore .zshenv for completions
            cat > .nix-zsh/.zshrc <<'EOF'
PROMPT='%F{green}[nix-shell]%f %m:%~$ '
autoload -Uz compinit
compinit -i
if [ -d "node_modules/zx" ]; then
  eval "$(scaf completions zsh)"
fi
EOF

            if [ -n "$BASH_VERSION" ]; then
              # Prompt for bash
              export PS1="\n\033[32m[nix-shell]\033[0m \h:\w$ "
              if [ -d "node_modules/zx" ]; then
                eval "$(scaf completions bash)"
              fi
              alias b=build
              alias v=verify
              alias t=verify
            fi

            # Also add aliases for zsh sessions
            if [ -n "$ZSH_VERSION" ]; then
              alias b=build
              alias v=verify
              alias t=verify
            fi

            # Pin Buck2 prelude via Nix flake input and map cell alias locally
            PRELUDE_PATH="${buck2}/prelude"
            if [ ! -f .buckconfig ]; then
              cat > .buckconfig <<EOF
[repositories]
prelude = ${buck2}/prelude
EOF
            else
              # Ensure [repositories] section exists and alias is present
              if ! grep -q "^\[repositories\]" .buckconfig; then
                printf "\n[repositories]\n" >> .buckconfig
              fi
              if ! grep -q "^prelude\s*=\s*" .buckconfig; then
                printf "prelude = %s\n" "$PRELUDE_PATH" >> .buckconfig
              fi
            fi
          '';
          buildInputs = [
            pkgs.git pkgs.buck2 pkgs.go pkgs.pnpm pkgs.nodejs_22 zx-wrapper pkgs.jq pkgs.rsync pkgs.copier pkgs.yq
            pkgs.secretspec pkgs.jc
          ] ++ (if pkgs.stdenv.isLinux then [ pkgs.fuse-overlayfs pkgs.xdg-utils ] else []);
        };
      }
    );

    packages = forAllSystems ({ zx-wrapper, pkgs, pnpm-store, node-modules, ... }: {
      zx-wrapper = zx-wrapper;
      pnpm-store = pnpm-store;
      node-modules = node-modules;
      default = node-modules;
      graph-generator = (pkgs.callPackage ./tools/nix/graph-generator.nix { inherit pkgs; }).all;
    });

    checks = forAllSystems ({ node-modules, ... }: {
      default = node-modules;
    });
  };
}
