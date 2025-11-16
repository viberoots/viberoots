{ lib, manifestBase, nodesList, ctx, get, T, M }:
let
  # Optional dispatch mapping from mapping.nix
  D = M.dispatch or {};

  # Read language IDs from langs.json when present; otherwise return []
  readLangIds =
    let
      langsPath = manifestBase + "/langs.json";
    in
      if builtins.pathExists langsPath then
        let
          raw = builtins.fromJSON (builtins.readFile langsPath);
          arr = if (builtins.isList raw) then raw else (raw.languages or []);
        in
          builtins.map (l: (l.id or "")) (builtins.filter (l: (builtins.isAttrs l) && (l ? id)) arr)
      else
        [];

  # Resolve a language adapter; default to go when the adapter is missing
  ensureAdapter = langId:
    let p = manifestBase + ("/planner/" + langId + ".nix"); in
      if builtins.pathExists p then (import p { inherit lib; } ctx) else {
        isTarget = n: false;
        kindOf = n: null;
        modulesFileFor = name: ctx.modulesTomlFor name;
        mkApp = name: T.goApp {
          inherit name;
          modulesToml = ctx.modulesTomlFor name;
          repoRoot = ctx.repoRoot;
          subdir = (ctx.pkgPathOf name);
        };
        mkLib = name: T.goLib {
          inherit name;
          modulesToml = ctx.modulesTomlFor name;
          repoRoot = ctx.repoRoot;
          subdir = (ctx.pkgPathOf name);
        };
      };

  # Build the list of language ids, always including "go"; include "cpp" when its planner exists
  langIds =
    let
      ids0 = readLangIds;
      withGo =
        if builtins.elem "go" ids0 then ids0 else (ids0 ++ [ "go" ]);
      cppPlanner = manifestBase + "/planner/cpp.nix";
      withCpp =
        if builtins.pathExists cppPlanner && !(builtins.elem "cpp" withGo)
        then (withGo ++ [ "cpp" ])
        else withGo;
    in
      withCpp;

  LANGS =
    builtins.listToAttrs (map (id: { name = id; value = ensureAdapter id; }) langIds);

  # Pick a template/kind for a node either via mapping dispatch or first matching adapter
  pick = n:
    let
      rt = get n "rule_type";
      hasDispatch = (rt != null) && builtins.hasAttr rt D;
      langKeys = builtins.attrNames LANGS;
      firstMatch =
        let matches = builtins.filter (k: (LANGS.${k}.isTarget n)) langKeys; in
          if matches == [] then null else builtins.head matches;
    in
      if hasDispatch then D.${rt}
      else if firstMatch != null then {
        template = firstMatch;
        kind = LANGS.${firstMatch}.kindOf n;
      } else null;
in {
  inherit LANGS pick;
}


