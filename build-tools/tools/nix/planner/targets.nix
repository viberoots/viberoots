{ lib
, nodesList
, LANGS
, pick
, ensureFullLabel
, pkgPathOf
, mkGo
, mkCpp
}:
let
  traceEnabled = (builtins.getEnv "PLANNER_TRACE") != "";
  _trace_nodes_len = if traceEnabled then builtins.trace ("[planner][trace] nodesList.length=" + (toString (builtins.length nodesList))) null else null;
  # Select Go nodes limited to projects/apps/* and projects/libs/*
  safeGoNodes =
  let xs = builtins.filter (n:
    let
      nm = ensureFullLabel n;
      okName = (builtins.typeOf nm == "string") && nm != "";
      rel = if okName then (pkgPathOf nm) else "";
      inAppsLibs = lib.hasPrefix "projects/apps/" rel || lib.hasPrefix "projects/libs/" rel;
    in okName && inAppsLibs && (LANGS.go.isTarget n)
  ) nodesList; in if traceEnabled then builtins.trace ("[planner][trace] safeGoNodes=" + (toString (builtins.length xs))) xs else xs;

  # Select C++ nodes limited to projects/apps/* and projects/libs/*
  safeCppNodes =
  let ys = builtins.filter (n:
    let
      nm = ensureFullLabel n;
      okName = (builtins.typeOf nm == "string") && nm != "";
      rel = if okName then (pkgPathOf nm) else "";
      inAppsLibs = lib.hasPrefix "projects/apps/" rel || lib.hasPrefix "projects/libs/" rel;
      hasCpp = (LANGS ? cpp);
    in okName && inAppsLibs && hasCpp && (LANGS.cpp.isTarget n)
  ) nodesList; in if traceEnabled then builtins.trace ("[planner][trace] safeCppNodes=" + (toString (builtins.length ys))) ys else ys;

  # Construct Go targets
  goTargetsFromGraph = builtins.foldl' (acc: n:
    let nm = ensureFullLabel n; k = pick n; tnm = builtins.typeOf nm; in
      if (tnm != "string") || (nm == "") || (k == null)
      then acc
      else (acc // { "${nm}" = mkGo nm k.kind; })
  ) {} safeGoNodes;

  # Names of Go binary targets
  binTargetNames = builtins.filter (nm:
    let
      matches = builtins.filter (x: ensureFullLabel x == nm) safeGoNodes;
      n = if matches == [] then null else builtins.head matches;
      k = if n == null then null else pick n;
    in k != null && k.kind == "bin"
  ) (builtins.attrNames goTargetsFromGraph);

  # Keep derivations materialized for binary targets in graph outputs
  goTargetsBins = builtins.listToAttrs (map (nm: { name = nm; value = goTargetsFromGraph.${nm}; }) binTargetNames);
  goOutPaths = goTargetsBins;

  # Construct C++ targets
  cppTargetsFromGraph = builtins.foldl' (acc: n:
    let nm = ensureFullLabel n; k = pick n; tnm = builtins.typeOf nm; in
      if (tnm != "string") || (nm == "") || (k == null)
      then acc
      else if (k.kind == null) then acc else (acc // { "${nm}" = mkCpp nm k.kind; })
  ) {} safeCppNodes;

  # Names of C++ binary targets
  cppBinNames = builtins.filter (nm:
    let
      matches = builtins.filter (x: ensureFullLabel x == nm) safeCppNodes;
      n = if matches == [] then null else builtins.head matches;
      k = if n == null then null else pick n;
    in k != null && k.kind == "bin"
  ) (builtins.attrNames cppTargetsFromGraph);

  # Only link C++ binaries in graph outputs
  cppOutPaths = builtins.listToAttrs (map (nm: { name = nm; value = cppTargetsFromGraph.${nm}; }) cppBinNames);

  # Node CLI bundles (importer-scoped) — pluginized; only bins are considered
  safeNodeBinNodes = builtins.filter (n:
    let
      nm = ensureFullLabel n;
      okName = (builtins.typeOf nm == "string") && nm != "";
      rel = if okName then (pkgPathOf nm) else "";
      inAppsLibs = lib.hasPrefix "projects/apps/" rel || lib.hasPrefix "projects/libs/" rel;
      isNode = (LANGS ? node) && (LANGS.node.isTarget n);
      kind = if isNode then (LANGS.node.kindOf n) else null;
    in okName && inAppsLibs && isNode && (kind == "bin")
  ) nodesList;

  nodeTargetsFromGraph = builtins.foldl' (acc: n:
    let nm = ensureFullLabel n; tnm = builtins.typeOf nm; in
      if (tnm != "string") || (nm == "")
      then acc
      else (acc // { "${nm}" = LANGS.node.mkApp nm; })
  ) {} safeNodeBinNodes;

  nodeOutPaths = nodeTargetsFromGraph;
in {
  inherit
    safeCppNodes
    cppTargetsFromGraph
    nodeTargetsFromGraph
    cppOutPaths
    nodeOutPaths;
}


