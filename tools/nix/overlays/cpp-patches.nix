final: prev:
let
  root = ../../..;
  patchDir = root + "/patches/cpp";
  exists = builtins.pathExists patchDir;
  dir = if exists then builtins.readDir patchDir else {};
  pkgs = final;
  lib = pkgs.lib;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };

  isPatch = n: builtins.match ".*\\.patch" n != null;

  parse = n: H.decodePatchFilename { name = n; };

  # Decode: "pkgs__gnome__glib" → "pkgs.gnome.glib"
  decodeAttr = enc:
    let slash = builtins.replaceStrings ["__"] ["/"] enc; in
    builtins.replaceStrings ["/"] ["."] slash;

  # Build { name -> [ { path, ver } ] } where name is nixpkgs attr without the pkgs. prefix
  collect =
    let names = builtins.attrNames dir; in
    builtins.foldl' (acc: file:
      let info = builtins.getAttr file dir; in
      if (info == "regular") && (isPatch file) then
        let p = parse file; in
        if p == null then acc else
          let attrFull = decodeAttr p.importPath; in
          if !(lib.hasPrefix "pkgs." attrFull) then acc else
          let name = builtins.replaceStrings ["pkgs."] [""] attrFull;
              arr = if builtins.hasAttr name acc then builtins.getAttr name acc else [];
              new = arr ++ [ { path = patchDir + "/" + file; ver = p.version; } ];
          in acc // { "${name}" = new; }
      else acc
    ) {} names;

  # For each name: keep only patches matching current version (when known), sort deterministically, apply
  applyPatchesFor = name: entries:
    let
      have = builtins.hasAttr name prev;
      curVer = if have && (builtins.hasAttr "version" (builtins.getAttr name prev))
               then (builtins.getAttr name prev).version else null;
      keep = if curVer == null then entries
             else builtins.filter (e: e.ver == curVer) entries;
      sorted = builtins.sort (a: b: a.path < b.path) keep;
      files = map (e: builtins.toPath e.path) sorted;
      patched = if have && (files != []) then final.applyPatches {
        name = "cpp-patched-${name}";
        src = (builtins.getAttr name prev).src;
        patches = files;
      } else null;
    in if patched == null then {} else {
      "${name}" = (builtins.getAttr name prev).overrideAttrs (old: { src = patched; });
      "${name}_patched_src" = patched;
    };

  names = builtins.attrNames collect;
  merged = builtins.foldl' (acc: nm: acc // (applyPatchesFor nm (builtins.getAttr nm collect))) {} names;
in merged

