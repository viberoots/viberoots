{ pkgs, buck2Input, ... }:
{
  default = (import ../devshell.nix { inherit pkgs; buck2Input = buck2Input; }).default;
}


