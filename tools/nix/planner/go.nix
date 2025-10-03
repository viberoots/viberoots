{ lib }:
# tools/nix/planner/go.nix — language plugin for Go (import-if-exists)
# Exports a function that accepts a context from graph-generator and returns
# the Go language adapter surface used by the planner.

ctx:
let
  # Unpack required fields from the provided context
  T = ctx.T;
  get = ctx.get;
  modulesTomlFor = ctx.modulesTomlFor;
  repoRoot = ctx.repoRoot;
  localModuleOverrides = ctx.localModuleOverrides;
  pkgPathOf = ctx.pkgPathOf;
in {
  isTarget = n:
    let rt = get n "rule_type";
        lbs = get n "labels";
        hasGoRT = (rt != null) && lib.hasPrefix "go_" rt;
        hasGoLabel = (lbs != null) && builtins.elem "lang:go" lbs;
    in hasGoRT || hasGoLabel;

  kindOf = n:
    let rt = get n "rule_type";
        lbs = get n "labels";
        isBinLabel = lbs != null && builtins.elem "kind:bin" lbs;
    in if (rt != null) && lib.hasPrefix "go_" rt
         then (if lib.hasSuffix "_binary" rt then "bin" else "lib")
         else if isBinLabel then "bin" else "lib";

  modulesFileFor = name: modulesTomlFor name;

  mkApp = name: T.goApp {
    inherit name repoRoot localModuleOverrides;
    modulesToml = modulesTomlFor name;
    subdir = (pkgPathOf name);
  };

  mkLib = name: T.goLib {
    inherit name repoRoot;
    modulesToml = modulesTomlFor name;
    subdir = (pkgPathOf name);
  };
}


