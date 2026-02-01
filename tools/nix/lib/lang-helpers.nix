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

  # Drop Buck's configuration suffix that appears after a space and "(...)".
  dropConfigSuffix = label:
    let s = if builtins.isString label then label else ""; in (lib.head (lib.splitString " (" s));

  # Convert labels like "root//apps/foo:svc" or "prelude//cpp:lib" to "//apps/foo:svc" or "//cpp:lib".
  dropCellPrefix = label:
    let
      s = if builtins.isString label then label else "";
      parts = lib.splitString "//" s;
    in
      if lib.hasPrefix "//" s
      then s
      else if (builtins.length parts) > 1
      then "//" + (builtins.elemAt parts 1)
      else s;

  # Normalize a Buck target label for stable keying:
  # - drop config suffix
  # - drop cell prefix
  normalizeTargetLabel = label: dropCellPrefix (dropConfigSuffix label);

  # Derive the Buck package path (without leading "//") from a target label.
  # Mirrors tools/lib/labels.ts:packagePathFromLabel.
  packagePathFromTargetLabel = label:
    let
      base = normalizeTargetLabel label;
      left = lib.elemAt (lib.splitString ":" base) 0;
      pkg = if lib.hasPrefix "//" left then lib.removePrefix "//" left else left;
    in if pkg == "" then "." else pkg;

  # Produce a safe, deterministic Nix attribute suffix from a Buck target label.
  # Mirrors tools/lib/labels.ts:sanitizeAttrNameFromLabel and //lang:nix_attr.bzl:sanitize_nix_attr_from_target_label.
  sanitizeAttrNameFromTargetLabel = label:
    let
      s = lib.toLower (normalizeTargetLabel label);
      chars = lib.stringToCharacters s;
      allowed = lib.stringToCharacters "abcdefghijklmnopqrstuvwxyz0123456789_";
      mapChar = c: if builtins.elem c allowed then c else "_";
    in "t" + (lib.concatStrings (map mapChar chars));

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

  patchesMapFromDirWith = { dir, normalizeVersion ? (v: v), materialize ? false, namePrefix ? "patch" }:
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
              val =
                if materialize
                then
                  let
                    content = builtins.readFile (dir + "/" + name);
                    storeFile = pkgs.writeText "${namePrefix}-${key}-${name}" content;
                  in builtins.toString storeFile
                else "${dir}/${name}";
              prev = acc.${key} or [];
            in acc // { "${key}" = prev ++ [ val ]; };
    in builtins.foldl' step {} (lib.filter isPatch names);

  patchesMapFromDirsWith = { dirs, normalizeVersion ? (v: v), materialize ? false, namePrefix ? "patch" }:
    let
      scan = dir: patchesMapFromDirWith { inherit dir normalizeVersion materialize namePrefix; };
      merge = a: b: pkgs.lib.foldlAttrs (acc: k: v: acc // { "${k}" = (acc.${k} or []) ++ v; }) a b;
    in pkgs.lib.foldl' merge {} (map scan dirs);

  patchesMapFromDir = patchDir:
    patchesMapFromDirWith { dir = patchDir; };

  patchesMapFromDirs = dirs:
    patchesMapFromDirsWith { inherit dirs; };

  pythonPatchesMapFromDirs = { dirs, namePrefix ? "py-patch" }:
    patchesMapFromDirsWith {
      inherit dirs namePrefix;
      normalizeVersion = (v: lib.head (lib.splitString "-" v));
      materialize = true;
    };

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
  inherit
    segs
    getAtPath
    resolveAttrFromPkgs
    sanitizeName
    dropConfigSuffix
    dropCellPrefix
    normalizeTargetLabel
    packagePathFromTargetLabel
    sanitizeAttrNameFromTargetLabel
    normalizeNixAttr
    decodePatchFilename
    patchesMapFromDirWith
    patchesMapFromDirsWith
    patchesMapFromDir
    patchesMapFromDirs
    pythonPatchesMapFromDirs
    readDevOverrides
    guardNoDevOverridesInCI;
  patchesMapFromDirToStore = { dir, normalizeVersion ? (v: v), namePrefix ? "patch" }:
    patchesMapFromDirWith { inherit dir normalizeVersion namePrefix; materialize = true; };

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
      patchesMapFromDirsWith {
        dirs = [ dir ];
        inherit normalizeVersion namePrefix;
        materialize = true;
      };
}


