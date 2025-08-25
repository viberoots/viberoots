# flake.nix — PR 1 devshell and zx-wrapper
{
  description = "bucknix-fresh devshell and scaffolding";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
  let
    systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-linux" ];
    forAllSystems = f: nixpkgs.lib.genAttrs systems (system:
      let
        pkgs = import nixpkgs { inherit system; };
        zx-wrapper = (
          pkgs.writeShellScriptBin "zx-wrapper" ''
            exec ${pkgs.nodejs_22}/bin/node \
              --experimental-strip-types \
              --experimental-top-level-await \
              --disable-warning=ExperimentalWarning \
              --import "$PWD/tools/dev/zx-init.mjs" \
              "$@"
          '');
      in f { inherit pkgs zx-wrapper; }
    );
  in {
    devShells = forAllSystems ({ pkgs, zx-wrapper }:
      {
        default = pkgs.mkShell {
          shellHook = ''
            export NIX_CONFIG="extra-experimental-features = nix-command flakes dynamic-derivations recursive-nix"
            export PATH="$PWD/tools/bin:$PATH"
            export PS1="\n\033[32m[nix-shell]\033[0m \h:\w$ "
            if [ -n "$ZSH_VERSION" ]; then
              mkdir -p .nix-zsh
              cat > .nix-zsh/.zshrc <<'EOF'
[ -f ~/.zshrc ] && source ~/.zshrc
autoload -U compinit && compinit
eval "$(scaf completions zsh)"
EOF
              export ZDOTDIR="$PWD/.nix-zsh"
            elif [ -n "$BASH_VERSION" ]; then
              eval "$(scaf completions bash)"
            fi
          '';
          buildInputs = [
            pkgs.git pkgs.buck2 pkgs.go pkgs.pnpm pkgs.nodejs_22 zx-wrapper pkgs.jq pkgs.rsync pkgs.copier pkgs.yq
          ] ++ (if pkgs.stdenv.isLinux then [ pkgs.fuse-overlayfs pkgs.xdg-utils ] else []);
        };
      }
    );

    packages = forAllSystems ({ zx-wrapper, pkgs }: {
      zx-wrapper = zx-wrapper;
    });
  };
}
