{ nixpkgs, buck2, gomod2nix }:
let
  systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-linux" ];
  mk = system: import ./per-system-context.nix { inherit nixpkgs buck2 gomod2nix system; };
  forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f (mk system));
in
{
  inherit systems forAllSystems;
}


