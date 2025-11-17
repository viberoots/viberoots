{ pkgs }:
let
  lib = pkgs.lib;

  # Split a dotted attribute path (e.g., "pkgs.foo.bar") into segments.
  segs = s: let xs = lib.splitString "." s; in if xs == [] then [] else xs;

  # Resolve an attribute by a list of segments against an attribute set.
  # Example: getAtPath pkgs ["foo" "bar"] == pkgs.foo.bar (or null if missing)
  getAtPath = attrs: parts:
    if parts == [] then attrs else (
      let k = lib.head parts; rest = lib.tail parts; in
        if (builtins.isAttrs attrs) && (builtins.hasAttr k attrs)
        then getAtPath (builtins.getAttr k attrs) rest
        else null
    );

  # Resolve a dotted attribute string against pkgs, accepting an optional "pkgs." prefix.
  # Example: resolveAttrFromPkgs "pkgs.zlib" == pkgs.zlib
  #          resolveAttrFromPkgs "zlib"      == pkgs.zlib
  resolveAttrFromPkgs = s:
    let parts0 = segs s;
        parts = if parts0 != [] && (lib.head parts0) == "pkgs" then lib.tail parts0 else parts0;
    in getAtPath pkgs parts;

  sanitizeName = s:
    lib.replaceStrings ["//" ":" "/" " "] ["" "-" "-" "-"] s;

  # Build {"importPath@version" = [ /abs/path.patch ... ]} from a flat patches/<lang>/*.patch directory.
  # Filenames encode import path with '/' -> '__' and suffix '@<version>.patch'.
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
        # To reduce local Nix eval noise, suppress the default trace unless explicitly enabled.
        # Preferred local notice lives in the prebuild guard (tools/buck/prebuild/notice.ts).
        # Set PLANNER_DEV_OVERRIDE_TRACE=1 to re-enable this Nix-level trace during troubleshooting.
        traceEnabled =
          (builtins.getEnv "CI") != "true"
          && dev != {}
          && (builtins.getEnv "PLANNER_DEV_OVERRIDE_TRACE") != "";
    in if traceEnabled
       then builtins.trace "[DEV OVERRIDES ACTIVE] ${envName} set; local derivation hashes will differ." dev
       else dev;

  guardNoDevOverridesInCI = envName:
    let v = builtins.getEnv envName; in
      if (builtins.getEnv "CI") == "true" && v != "" then
        builtins.throw "Dev overrides are forbidden in CI"
      else null;

in {
  inherit segs getAtPath resolveAttrFromPkgs sanitizeName patchesMapFromDir readDevOverrides guardNoDevOverridesInCI;
}
