{ pkgs }:
let
  lib = pkgs.lib;

  sanitizeName = s:
    lib.replaceStrings ["//" ":" "/" " "] ["" "-" "-" "-"] s;

  patchesMapFromDir = patchDir:
    let
      names = if builtins.pathExists patchDir then builtins.attrNames (builtins.readDir patchDir) else [];
      isPatch = name: lib.hasSuffix ".patch" name;
      decode = name:
        let base = lib.removeSuffix ".patch" name;
            at = lib.strLastIndexOf base "@";
            enc = lib.substring 0 at base;
            ver = lib.substring (at + 1) (lib.stringLength base - at - 1) base;
            importPath = lib.replaceStrings ["__"] ["/"] enc;
        in { path = lib.toLower importPath; ver = lib.toLower ver; };
      step = acc: name:
        let d = decode name;
            key = "${d.path}@${d.ver}";
            val = (acc.${key} or []) ++ [ "${patchDir}/${name}" ];
        in acc // { "${key}" = val; };
    in builtins.foldl' step {} (lib.filter isPatch names);

  readDevOverrides = envName:
    let v = builtins.getEnv envName;
        dev = if v == "" then {} else builtins.fromJSON v;
    in if (builtins.getEnv "CI") != "true" && dev != {} then
         builtins.trace "[DEV OVERRIDES ACTIVE] ${envName} set; local derivation hashes will differ." dev
       else dev;

  guardNoDevOverridesInCI = envName:
    let v = builtins.getEnv envName; in
      if (builtins.getEnv "CI") == "true" && v != "" then
        builtins.throw "Dev overrides are forbidden in CI"
      else null;

in {
  inherit sanitizeName patchesMapFromDir readDevOverrides guardNoDevOverridesInCI;
}


