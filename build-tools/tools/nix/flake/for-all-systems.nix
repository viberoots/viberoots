{ nixpkgs, buck2, gomod2nix, workspaceSrc, viberootsInput, version, releaseTag }:
let
  systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-linux" ];
  mk =
    system: includeNodeMods:
      import ./per-system-context.nix {
        inherit nixpkgs buck2 gomod2nix system includeNodeMods workspaceSrc viberootsInput version releaseTag;
      };
  forAllSystemsLight = f: nixpkgs.lib.genAttrs systems (system: f (mk system false));
  forAllSystemsHeavy = f: nixpkgs.lib.genAttrs systems (system: f (mk system true));
in
{
  inherit systems forAllSystemsLight forAllSystemsHeavy;
}
