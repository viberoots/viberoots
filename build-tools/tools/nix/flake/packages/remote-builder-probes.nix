{ pkgs }:
pkgs.writeTextDir "flake.nix" (
  builtins.replaceStrings
    [ "@NIXPKGS@" "@SYSTEM@" ]
    [ (toString pkgs.path) pkgs.system ]
    (builtins.readFile ./remote-builder-probes.flake.in)
)
