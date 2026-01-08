{ pkgs, ... }:
{
  gomod2nix = {
    type = "app";
    program = "${pkgs.gomod2nix}/bin/gomod2nix";
  };
  pnpm = {
    type = "app";
    program = "${pkgs.pnpm}/bin/pnpm";
  };
}


