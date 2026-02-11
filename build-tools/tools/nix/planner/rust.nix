{ lib }:
ctx:
let
  P = import ./lib.nix { inherit lib; get = ctx.get; };
in {
  isTarget = n:
    P.isTargetByRuleTypeOrLabel {
      ruleTypePrefixes = [ "rust_" ];
      label = "lang:rust";
    } n;

  kindOf = n:
    let
      rt = P.ruleTypeOf n;
      labels = P.labelsOf n;
      nm = P.nameOf n;
    in
      P.kindOf {
        inherit labels;
        ruleType = rt;
        name = nm;
        config = {
          labelPriorityPre = [
            { label = "kind:bin"; kind = "bin"; }
            { label = "kind:lib"; kind = "lib"; }
          ];
          ruleTypes = {
            suffixes = [
              { suffix = "_binary"; kind = "bin"; }
              { suffix = "_library"; kind = "lib"; }
            ];
          };
        };
      };

  modulesFileFor = _: null;

  mkApp = name: ctx.T.rustApp { inherit name; srcRoot = ctx.repoRoot; };
  mkLib = name: ctx.T.rustLib { inherit name; srcRoot = ctx.repoRoot; };
}
