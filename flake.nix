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
              --import ${pkgs.writeText "zx-init.mjs" ''
                import "${pkgs.nodePackages.zx}/lib/node_modules/zx/build/globals.js";
                if (globalThis.$) {
                  // Default all template-tag calls to stdio: 'inherit'
                  const $orig = globalThis.$;
                  const isTemplateCall = (first) => Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, 'raw');
                  const $patched = (...args) => {
                    if (isTemplateCall(args[0])) {
                      return $orig({ stdio: 'inherit' })(...args);
                    }
                    return $orig(...args);
                  };
                  Object.assign($patched, $orig);
                  globalThis.$ = $patched;
                }
              ''} \
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
            echo "[devshell] configured nix experimental features"
            export PATH="$PWD/tools/bin:$PATH"
            chmod +x tools/scaffolding/scaf.ts 2>/dev/null || true
            chmod +x tools/tests/scaffolding-smoke.ts 2>/dev/null || true
          '';
          buildInputs = [
            pkgs.git pkgs.buck2 pkgs.go pkgs.pnpm pkgs.nodejs_22 zx-wrapper pkgs.jq pkgs.rsync pkgs.copier pkgs.yq
          ] ++ (if pkgs.stdenv.isLinux then [ pkgs.fuse-overlayfs ] else []);
        };
      }
    );

    packages = forAllSystems ({ zx-wrapper, pkgs }: {
      zx-wrapper = zx-wrapper;
    });
  };
}
