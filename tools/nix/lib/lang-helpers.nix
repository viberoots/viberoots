{ pkgs }:
let
  lib = pkgs.lib;
  nixAttrAliases =
    let attempt = builtins.tryEval (builtins.fromJSON (builtins.readFile ../../lib/nix-attr-aliases.json));
    in if attempt.success && builtins.isAttrs attempt.value then attempt.value else {};

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

  # Normalize a nixpkgs attribute path for provider naming and labeling.
  # Contract:
  # - trims
  # - lower-cases
  # - ensures "pkgs." prefix
  # - applies alias mapping from tools/lib/nix-attr-aliases.json
  # - preserves gtest compatibility (pkgs.gtest -> pkgs.googletest) even when alias map is unavailable
  normalizeNixAttr = attr:
    if !(builtins.isString attr) then "" else
    let
      s0 = lib.toLower (lib.trim attr);
      withPkgs = if s0 == "" then "" else (if lib.hasPrefix "pkgs." s0 then s0 else ("pkgs." + s0));
      aliased = if withPkgs != "" && builtins.hasAttr withPkgs nixAttrAliases then nixAttrAliases.${withPkgs} else withPkgs;
    in if aliased == "pkgs.gtest" then "pkgs.googletest" else aliased;

  decodePatchFilename = { name, normalizeVersion ? (v: v) }:
    if !(builtins.isString name) then null else
    if !(lib.hasSuffix ".patch" name) then null else
    let
      base = lib.removeSuffix ".patch" name;
      parts = lib.splitString "@" base;
      partCount = lib.length parts;
    in
      if partCount < 2
      then null
      else
        let
          rawName = lib.concatStringsSep "@" (lib.take (partCount - 1) parts);
          rawVersion = lib.last parts;
        in
          if rawName == "" || rawVersion == ""
          then null
          else
            let
              importPath = lib.replaceStrings ["__"] ["/"] rawName;
              version = normalizeVersion rawVersion;
              key = (lib.toLower importPath) + "@" + (lib.toLower version);
            in {
              inherit key;
              importPath = lib.toLower importPath;
              version = lib.toLower version;
            };

  # Build {"importPath@version" = [ /abs/path.patch ... ]} from a flat patches/<lang>/*.patch directory.
  # Filenames encode import path with '/' -> '__' and suffix '@<version>.patch'.
  patchesMapFromDir = patchDir:
    let
      names = if builtins.pathExists patchDir then builtins.attrNames (builtins.readDir patchDir) else [];
      isPatch = name: lib.hasSuffix ".patch" name;
      step = acc: name:
        let
          d = decodePatchFilename { inherit name; };
        in
          if d == null
          then acc
          else
            let
              key = d.key;
              val = (acc.${key} or []) ++ [ "${patchDir}/${name}" ];
            in acc // { "${key}" = val; };
    in builtins.foldl' step {} (lib.filter isPatch names);

  # Build a merged patches map from multiple directories, preserving per-dir list order.
  # Later directories append to earlier ones for identical keys.
  patchesMapFromDirs = dirs:
    let
      scan = dir: patchesMapFromDir dir;
      merge = a: b: pkgs.lib.foldlAttrs (acc: k: v: acc // { "${k}" = (acc.${k} or []) ++ v; }) a b;
    in pkgs.lib.foldl' merge {} (map scan dirs);

  readDevOverrides = envName:
    let
      v = builtins.getEnv envName;
      _t = if (builtins.getEnv "PLANNER_TRACE") != "" then builtins.trace ("[planner][trace] " + envName + " len=" + (toString (builtins.stringLength v))) null else null;
      parsed =
        if v == "" then {}
        else
          let attempt = builtins.tryEval (builtins.fromJSON v); in
            if attempt.success then attempt.value else {};
      # To reduce local Nix eval noise, suppress the default trace unless explicitly enabled.
      # Preferred local notice lives in the prebuild guard (tools/buck/prebuild/notice.ts).
      # Set PLANNER_DEV_OVERRIDE_TRACE=1 to re-enable this Nix-level trace during troubleshooting.
      traceEnabled =
        (builtins.getEnv "CI") != "true"
        && parsed != {}
        && (builtins.getEnv "PLANNER_DEV_OVERRIDE_TRACE") != "";
    in if traceEnabled
       then builtins.trace "[DEV OVERRIDES ACTIVE] ${envName} set; local derivation hashes will differ." parsed
       else parsed;

  guardNoDevOverridesInCI = envName:
    let v = builtins.getEnv envName; in
      if (builtins.getEnv "CI") == "true" && v != "" then
        builtins.throw "Dev overrides are forbidden in CI"
      else null;

 in rec {
  inherit segs getAtPath resolveAttrFromPkgs sanitizeName normalizeNixAttr decodePatchFilename patchesMapFromDir patchesMapFromDirs readDevOverrides guardNoDevOverridesInCI;

  /*
    Build {"importPath@version" = [ /nix/store/...-patch1 /nix/store/...-patch2 ... ]}
    by scanning a flat patches/<lang>/*.patch directory and materializing each file
    into the store for stable content-addressed inputs (used by Python).

    Options:
      - dir: absolute path to the flat directory containing *.patch files
      - normalizeVersion: function string -> string to normalize version segments
                          (default = identity; Python strips suffix after "-")
      - namePrefix: prefix used for pkgs.writeText store file names
  */
  patchesMapFromDirToStore = { dir, normalizeVersion ? (v: v), namePrefix ? "patch" }:
    let
      names = if builtins.pathExists dir then builtins.attrNames (builtins.readDir dir) else [];
      isPatch = name: lib.hasSuffix ".patch" name;
      step = acc: name:
        let
          d = decodePatchFilename { inherit name normalizeVersion; };
        in
          if d == null
          then acc
          else
            let
              key = d.key;
              content = builtins.readFile (dir + "/" + name);
              storeFile = pkgs.writeText "${namePrefix}-${key}-${name}" content;
              prev = acc.${key} or [];
            in acc // { "${key}" = prev ++ [ (builtins.toString storeFile) ]; };
    in builtins.foldl' step {} (lib.filter isPatch names);

  /*
    Convenience wrapper for importer-local patches living under:
      <srcRoot>/<subdir>/patches/<lang>
    Produces the same {"importPath@version" = [ /nix/store/... ]} map as above.
  */
  patchesMapFromImporterDirToStore = {
    srcRoot,
    subdir ? ".",
    lang,
    normalizeVersion ? (v: v),
    namePrefix ? "${lang}-patch",
  }:
    let
      rootStr = builtins.toString srcRoot;
      dir = builtins.toPath ("${rootStr}/${subdir}/patches/${lang}");
    in
      if builtins.pathExists dir
      then patchesMapFromDirToStore {
        inherit dir normalizeVersion namePrefix;
      }
      else {};
}

