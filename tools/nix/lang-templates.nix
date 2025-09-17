{ pkgs }:
let
  lib = pkgs.lib;

  patchesMapFromDir = patchDir:
    let
      names = if builtins.pathExists patchDir then builtins.attrNames (builtins.readDir patchDir) else [];
      isPatch = name: lib.hasSuffix ".patch" name;
      toKey = name:
        let base = lib.removeSuffix ".patch" name;
            at = lib.strLastIndexOf base "@";
            enc = lib.substring 0 at base;
            ver = lib.substring (at + 1) (lib.stringLength base - at - 1) base;
            importPath = lib.replaceStrings ["__"] ["/"] enc;
        in lib.toLower "${importPath}@${ver}";
      step = acc: name:
        let key = toKey name;
            val = (acc.${key} or []) ++ [ "${patchDir}/${name}" ];
        in acc // { "${key}" = val; };
    in builtins.foldl' step {} (lib.filter isPatch names);
in
{
  goApp = { name, modulesToml, devOverrideEnv ? "NIX_GO_DEV_OVERRIDE_JSON", subdir ? ".", patchDir ? ../../patches/go }:
    let
      patchesMap = patchesMapFromDir patchDir;
      devOverrides = let v = builtins.getEnv devOverrideEnv; in if v == "" then {} else builtins.fromJSON v;
      _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then
            builtins.throw "Dev overrides are forbidden in CI" else null;
    in pkgs.buildGoApplication {
      pname = "go-${lib.replaceStrings ["//" ":" "/"] ["" "-" "-"] name}";
      version = "0.1.0";
      src = ./.;
      modules = modulesToml;
      subPackages = [ subdir ];
      overrides = module: old: old // {
        patches = (old.patches or []) ++ (patchesMap.${module} or []);
        src = devOverrides.${module} or old.src;
      };
    };

  goLib = { name, modulesToml, devOverrideEnv ? "NIX_GO_DEV_OVERRIDE_JSON", subdir ? ".", patchDir ? ../../patches/go }:
    let
      patchesMap = patchesMapFromDir patchDir;
      devOverrides = let v = builtins.getEnv devOverrideEnv; in if v == "" then {} else builtins.fromJSON v;
      _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then
            builtins.throw "Dev overrides are forbidden in CI" else null;
    in pkgs.buildGoApplication {
      pname = "golib-${lib.replaceStrings ["//" ":" "/"] ["" "-" "-"] name}";
      version = "0.1.0";
      src = ./.;
      modules = modulesToml;
      subPackages = [ subdir ];
      overrides = module: old: old // {
        patches = (old.patches or []) ++ (patchesMap.${module} or []);
        src = devOverrides.${module} or old.src;
      };
    };
}


