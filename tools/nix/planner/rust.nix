{ lib }:
# tools/nix/planner/rust.nix — planner plug-in (skeleton)
ctx:
{
  isTarget = n:
    let rt = ctx.get n "rule_type"; lbs = ctx.get n "labels"; in
      (rt != null) && lib.hasPrefix "rust_" rt
      || (lbs != null) && builtins.elem "lang:rust" lbs;

  kindOf = n:
    let rt = ctx.get n "rule_type"; in
      if (rt != null) && lib.hasSuffix "_binary" rt then "bin"
      else if (rt != null) && lib.hasSuffix "_library" rt then "lib" else null;

  modulesFileFor = _: null;

  mkApp = name: (ctx.T.rustApp { inherit name; srcRoot = ctx.repoRoot; });
  mkLib = name: (ctx.T.rustLib { inherit name; srcRoot = ctx.repoRoot; });
}
