{ nixpkgs
, buck2
, gomod2nix
, workspaceSrc
, viberootsInput
, workspaceName ? "workspace"
, version
, releaseTag
}:
let
  sys = import ./for-all-systems.nix {
    inherit nixpkgs buck2 gomod2nix workspaceSrc viberootsInput version releaseTag;
  };
in
{
  lib = {
    inherit version releaseTag workspaceName;
    viberootsSourcePath = builtins.toString viberootsInput.outPath;
  };
  apps = sys.forAllSystemsLight (ctx: import ./outputs-apps.nix ctx);
  devShells = sys.forAllSystemsLight (ctx: import ./outputs-devshells.nix ctx);
  packages = sys.forAllSystemsHeavy (ctx: import ./outputs-packages.nix ctx);
  checks = sys.forAllSystemsHeavy (ctx: import ./outputs-checks.nix ctx);
}
