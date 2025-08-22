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
              --import ${pkgs.nodePackages.zx}/lib/node_modules/zx/build/globals.js \
              "$@"
          '');
      in f { inherit pkgs zx-wrapper; }
    );
  in {
    devShells = forAllSystems ({ pkgs, zx-wrapper }:
      {
        default = pkgs.mkShell {
          shellHook = ''
            export NIX_CONFIG="extra-experimental-features = nix-command flakes dynamic-derivations ca-derivations recursive-nix"
            echo "[devshell] configured nix experimental features"
          '';
          buildInputs = [ pkgs.git pkgs.buck2 pkgs.go pkgs.pnpm pkgs.nodejs_22 zx-wrapper ]
            ++ (if pkgs.stdenv.isLinux then [ pkgs.fuse-overlayfs ] else []);
        };
      }
    );

    packages = forAllSystems ({ zx-wrapper, pkgs }: {
      zx-wrapper = zx-wrapper;
    });
  };
}
