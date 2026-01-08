{ self, nixpkgs, buck2, gomod2nix }:
let
  sys = import ./for-all-systems.nix { inherit nixpkgs buck2 gomod2nix; };
in
{
  apps = sys.forAllSystems (ctx: import ./outputs-apps.nix ctx);
  devShells = sys.forAllSystems (ctx: import ./outputs-devshells.nix ctx);
  packages = sys.forAllSystems (ctx: import ./outputs-packages.nix ctx);
  checks = sys.forAllSystems (ctx: import ./outputs-checks.nix ctx);
}


