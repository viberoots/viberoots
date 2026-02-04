{ lib
, L
, T
, byName
, srcsOf
, pkgPathOf
, modulesTomlFor
, repoRoot
}:
name:
let
  start = if builtins.hasAttr name byName then byName.${name} else null;
  direct = if start == null then [] else L.depsOf start;
  isCArchive = nm:
    let n = if builtins.hasAttr nm byName then byName.${nm} else null; in
      if n == null then false else builtins.elem "kind:carchive" (L.labelsOf n);
  pkgPathFor = nm:
    let
      srcs = srcsOf nm;
      hasPrefix = pref: builtins.any (s: lib.hasPrefix pref s) srcs;
    in if hasPrefix "pkg/addon/" then "./pkg/addon"
       else if hasPrefix "pkg/" then "./pkg"
       else ".";
  asDerivation = nm: T.goCArchive {
    name = nm;
    modulesToml = modulesTomlFor nm;
    srcRoot = repoRoot;
    subdir = pkgPathOf nm;
    # Prefer a pkgPath inferred from the target's declared srcs so both
    # scaffolded (pkg/addon) and simple (.) c-archive layouts work.
    pkgPath = pkgPathFor nm;
  };
  # Primary resolution: direct deps only
  primaries = builtins.filter isCArchive direct;
  # If no direct dep edge is present (e.g., exporter omitted it), attempt a
  # conservative sibling resolution based on conventional naming:
  #   //libs/<base>-native:<addon> → //libs/<base>-go:carchive
  # This does not change behavior when edges are present; it only helps in
  # temporary/scaffolded repos where the graph may be minimal.
  fallback =
    if primaries != [] then []
    else
      let
        pkg = pkgPathOf name;
        # Expect libs/<base>-native
        parts = lib.splitString "/" pkg;
        last = if (builtins.length parts) > 0 then builtins.elemAt parts ((builtins.length parts) - 1) else pkg;
        base =
          if lib.hasSuffix "-native" last
          then lib.removeSuffix "-native" last
          else null;
        cand =
          if base == null then null
          else ("//libs/" + base + "-go:carchive");
      in if cand != null && (builtins.hasAttr cand byName) then [ cand ] else [];
  chosen = primaries ++ fallback;
in builtins.map asDerivation chosen
