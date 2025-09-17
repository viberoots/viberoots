{ pkgs }:
let
  lib = pkgs.lib;
  nodes = builtins.fromJSON (builtins.readFile ../../tools/buck/graph.json);
  T = import ./lang-templates.nix { inherit pkgs; };
  M = if builtins.pathExists ./mapping.nix then import ./mapping.nix else {};
  D = M.dispatch or {};

  get = attrs: k: attrs.${k} or null;

  pick = n:
    let rt = get n "rule_type"; in
      if builtins.hasAttr rt D then D.${rt}
      else if lib.hasPrefix "go_" rt then {
        template = "go";
        kind = if lib.hasSuffix "_binary" rt then "bin" else "lib";
      } else null;

  modulesToml = ../../gomod2nix.toml;
  haveModules = builtins.pathExists modulesToml;

  mkGo = name: kind:
    if haveModules then (
      if kind == "bin" then T.goApp { inherit name; modulesToml = modulesToml; subdir = "."; }
      else T.goLib { inherit name; modulesToml = modulesToml; subdir = "."; }
    ) else pkgs.runCommand "stub-${lib.replaceStrings ["//" ":" "/"] ["" "-" "-"] name}" {} ''
      mkdir -p $out
      echo stub > $out/.stub
    '';

  goTargets = lib.listToAttrs (map (n:
    let name = get n "name"; k = pick n; in {
      inherit name;
      value = if k == null then pkgs.runCommand "noop-${lib.replaceStrings ["//" ":" "/"] ["" "-" "-"] name}" {} "mkdir -p $out; touch $out/.noop"
              else mkGo name k.kind;
    }
  ) nodes);

  all = pkgs.runCommand "graph-outputs" {} ''
    mkdir -p $out
    for p in ${lib.concatStringsSep " " (lib.attrValues goTargets)}; do
      ln -s "$p" "$out/" || true
    done
  '';
in
{ inherit goTargets all; }


