{ lib, manifestBase, nodesList, ctx, get, T, M }:
let
  # Optional dispatch mapping from mapping.nix
  D = M.dispatch or {};
  traceEnabled = (builtins.getEnv "PLANNER_TRACE") != "";

  # Read language IDs from langs.json when present; otherwise return []
  readLangIds =
    let
      langsPath = manifestBase + "/langs.json";
    in
      if builtins.pathExists langsPath then
        let
          contents = builtins.readFile langsPath;
          _t = if traceEnabled then builtins.trace ("[planner][trace] langs.json head: " + (builtins.substring 0 100 contents)) null else null;
          # Heuristic: only attempt JSON parse when the first non-whitespace char is '{'
          # and there is at least one double-quote character in the buffer.
          firstNonWs = s:
            let
              chars = lib.stringToCharacters s;
              isWs = c: c == " " || c == "\t" || c == "\n" || c == "\r";
              dropWs = cs:
                if cs == [] then []
                else if isWs (builtins.head cs) then dropWs (builtins.tail cs) else cs;
              trimmed = dropWs chars;
            in if trimmed == [] then "" else (builtins.head trimmed);
          looksJson = (firstNonWs contents) == "{" && lib.hasInfix "\"" contents;
          raw =
            if looksJson then
              let attempt = builtins.tryEval (builtins.fromJSON contents); in
                if attempt.success then attempt.value else []
            else [];
          # Support either:
          # - Array of objects with .id
          # - { languages = [ { id = "cpp"; } ... ] }
          # - { enabled = [ "cpp", "go" ] }
          arr0 =
            if (builtins.isList raw) then raw
            else if (builtins.isAttrs raw) && (raw ? languages) then raw.languages
            else if (builtins.isAttrs raw) && (raw ? enabled) then (map (s: { id = s; }) raw.enabled)
            else [];
          arr = builtins.filter (l: (builtins.isAttrs l) && (l ? id)) arr0;
        in
          builtins.map (l: (l.id or "")) arr
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
      onlyCpp = (builtins.getEnv "PLANNER_ONLY_CPP") != "";
      ids0 = readLangIds;
      withGo =
        if onlyCpp then ids0 else (if builtins.elem "go" ids0 then ids0 else (ids0 ++ [ "go" ]));
      cppPlanner = manifestBase + "/planner/cpp.nix";
      withCpp =
        if builtins.pathExists cppPlanner && !(builtins.elem "cpp" withGo)
        then (withGo ++ [ "cpp" ])
        else withGo;
      pyPlanner = manifestBase + "/planner/python.nix";
      withPy =
        if builtins.pathExists pyPlanner && !(builtins.elem "python" withCpp)
        then (withCpp ++ [ "python" ])
        else withCpp;
    in
      withPy;

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


