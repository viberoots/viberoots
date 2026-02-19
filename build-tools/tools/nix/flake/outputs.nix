{ self, nixpkgs, buck2, gomod2nix }:
let
  sys = import ./for-all-systems.nix { inherit nixpkgs buck2 gomod2nix; };
in
{
  apps = sys.forAllSystemsLight (ctx: import ./outputs-apps.nix ctx);
  devShells = sys.forAllSystemsLight (ctx: import ./outputs-devshells.nix ctx);
  packages = sys.forAllSystemsHeavy (ctx: import ./outputs-packages.nix ctx);
  checks = sys.forAllSystemsHeavy (ctx: import ./outputs-checks.nix ctx);
}


