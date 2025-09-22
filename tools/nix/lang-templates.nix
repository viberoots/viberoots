{ pkgs }:
let
  lib = pkgs.lib;
  # Require gomod2nix overlay builder; fail fast if missing
  buildGoFn = if pkgs ? buildGoApplication then pkgs.buildGoApplication
              else builtins.throw "gomod2nix overlay (buildGoApplication) is required; no vendoring fallback";
  takesOverrides = (builtins.hasAttr "overrides" (builtins.functionArgs (pkgs.buildGoApplication)));

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

  # Emit a concise warning locally when dev overrides are set; in CI we still hard-fail below.
  readDevOverrides = envName: let
    v = builtins.getEnv envName;
    dev = if v == "" then {} else builtins.fromJSON v;
  in if (builtins.getEnv "CI") != "true" && dev != {}
     then builtins.trace "[NIX_GO_DEV_OVERRIDE_JSON active] Local derivation hashes will differ; unset before sharing cache artifacts." dev
     else dev;
in
{
  goApp = { name, modulesToml, devOverrideEnv ? "NIX_GO_DEV_OVERRIDE_JSON", devOverridesMap ? {}, subdir ? ".", srcRoot ? ../.., patchDir ? ../../patches/go }:
    let
      patchesMap = patchesMapFromDir patchDir;
      devOverridesEnv = readDevOverrides devOverrideEnv;
      _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then
            builtins.throw "Dev overrides are forbidden in CI" else null;
      devOverrides = (devOverridesMap // devOverridesEnv);
      targetName = lib.elemAt (lib.splitString ":" name) 1;
      srcAbs = lib.cleanSource srcRoot;
      baseArgs = {
        pname = "go-${lib.replaceStrings ["//" ":" "/"] ["" "-" "-"] name}";
        version = "0.1.0";
        src = srcAbs;
        modules = modulesToml;
        # Build entrypoint within module root
        subPackages = [ "cmd/${targetName}" ];
      };
      args = baseArgs // ({
        # Module root is subdir with /cmd/<name> stripped
        pwd = builtins.toPath ("${srcAbs}/" + (lib.removeSuffix "/cmd/${targetName}" subdir));
        modRoot = (lib.removeSuffix "/cmd/${targetName}" subdir);
      } // (if takesOverrides then {
        overrides = module: old: old // {
          patches = (old.patches or []) ++ (patchesMap.${module} or []);
          src = devOverrides.${module} or old.src;
        };
      } else {}));
    in buildGoFn args;

  goLib = { name, modulesToml, devOverrideEnv ? "NIX_GO_DEV_OVERRIDE_JSON", subdir ? ".", srcRoot ? ../.., patchDir ? ../../patches/go }:
    let
      patchesMap = patchesMapFromDir patchDir;
      devOverridesEnv = readDevOverrides devOverrideEnv;
      _ = if (builtins.getEnv "CI") == "true" && (builtins.getEnv devOverrideEnv) != "" then
            builtins.throw "Dev overrides are forbidden in CI" else null;
      srcAbs = lib.cleanSource srcRoot;
      baseArgs = {
        pname = "golib-${lib.replaceStrings ["//" ":" "/"] ["" "-" "-"] name}";
        version = "0.1.0";
        src = srcAbs;
        modules = modulesToml;
        # Build the module root
        subPackages = [ "." ];
      };
      args = baseArgs // ({
        # Change to the library module root
        pwd = builtins.toPath ("${srcAbs}/" + subdir);
        modRoot = subdir;
      } // (if takesOverrides then {
        overrides = module: old: old // {
          patches = (old.patches or []) ++ (patchesMap.${module} or []);
          src = devOverridesEnv.${module} or old.src;
        };
      } else {}));
    in buildGoFn args;
}


