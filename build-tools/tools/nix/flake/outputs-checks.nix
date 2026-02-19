{ nodeMods ? null, mkNodeMods ? null, ... }:
let
  resolvedNodeMods =
    if nodeMods != null then nodeMods
    else if mkNodeMods != null then mkNodeMods { }
    else builtins.throw "outputs-checks.nix requires nodeMods or mkNodeMods";
in
{
  default = resolvedNodeMods.node-modules;
}


