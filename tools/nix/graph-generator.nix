{ pkgs, src ? ../../., graphJsonPath ? null, rootModulesTomlPath ? null }:
let
  lib = pkgs.lib;
  # Allow tests to override the repo root via BUCK_TEST_SRC; default to provided flake src
  buckTestSrcEnv = builtins.getEnv "BUCK_TEST_SRC";
  repoRootStr = if buckTestSrcEnv != "" then buckTestSrcEnv else builtins.toString src;
  repoRoot = builtins.toPath repoRootStr;
  # Filtered source that includes both apps/* and libs/* so local replaces resolve
  appsLibsSrc = lib.cleanSourceWith {
    src = repoRoot;
    filter = path: type:
      let p = builtins.toString path;
          rootP = builtins.toString repoRoot;
          rel = lib.removePrefix (rootP + "/") p;
      in
      # keep the root, the top-level apps/libs directories, and anything under them
      p == rootP || rel == "apps" || rel == "libs" || lib.hasPrefix "apps/" rel || lib.hasPrefix "libs/" rel;
  };

  # Helper to read module path from a go.mod file under the repo root (pure with src)
  readModulePathLive = rel:
    let p = builtins.toPath (repoRootStr + "/" + rel); in
      if builtins.pathExists p then (
        let txt = builtins.readFile p;
            parts = lib.filter (s: lib.hasPrefix "module " s) (lib.splitString "\n" txt);
        in if parts == [] then "" else lib.removePrefix "module " (lib.head parts)
      ) else "";

  # Prefer explicit graphJsonPath; otherwise fall back to BUCK_TEST_SRC/tools/buck/graph.json
  # so test sandboxes can provide a live graph without requiring flake to import it.
  graphPath = if graphJsonPath != null then builtins.toPath graphJsonPath else (
    let cand = builtins.toPath (repoRootStr + "/tools/buck/graph.json"); in
      if builtins.pathExists cand then cand else builtins.throw "graphJsonPath not provided and repoRoot/tools/buck/graph.json missing — run tools/buck/export-graph.ts first." 
  );
  nodesRaw = if builtins.pathExists graphPath
    then builtins.fromJSON (builtins.readFile graphPath)
    else builtins.throw "graphJsonPath does not exist — run tools/buck/export-graph.ts before building.";
  nodes =
    let t = builtins.typeOf nodesRaw; in
      if t == "set" && (nodesRaw ? nodes) && (builtins.typeOf nodesRaw.nodes) == "list"
        then nodesRaw.nodes
        else nodesRaw;
  nodesList =
    let t = builtins.typeOf nodes; in
      if t == "list" then nodes
      else if t == "set" then (
        let ks = builtins.attrNames nodes; in
          map (k:
            let v = nodes.${k}; vt = builtins.typeOf v; in
              if vt == "set" then (if (v ? name) then v else (v // { name = k; }))
              else { name = k; }
          ) ks
      ) else [];
  # Prefer language manifests and planner plugins from the TEST repo (BUCK_TEST_SRC)
  # so zx tests that rsync a temp repo can provide cpp enablement without requiring
  # the main flake workspace to also include those files.
  manifestBase =
    let candidate = builtins.toPath (repoRootStr + "/tools/nix"); in
      if builtins.pathExists candidate then candidate else ./.;
  # Load language templates from the chosen manifest base (temp repo when set)
  T = import (manifestBase + "/lang-templates.nix") { inherit pkgs; };
  M = if builtins.pathExists ./mapping.nix then (
        let raw = import ./mapping.nix;
            attempt = builtins.tryEval (raw {});
        in if attempt.success then attempt.value else raw
      ) else {};
  D = M.dispatch or {};
  devOverrideJSON = builtins.getEnv "NIX_GO_DEV_OVERRIDE_JSON";

  get = attrs: k: attrs.${k} or null;
  # Buck map keys can include a config suffix like
  #   "root//apps/test-cli:test-cli (config//platforms:default#...)"
  # Strip the optional trailing " (config//...)" part using a simple split.
  cleanLabel = s:
    let parts = lib.splitString " (config//" s; in
      if (builtins.length parts) > 1 then (builtins.elemAt parts 0) else s;

  nameOf = n:
    let t = builtins.typeOf n; in
      if t == "set" then (
        if builtins.hasAttr "name" n && builtins.typeOf n.name == "string" && n.name != ""
        then cleanLabel n.name else ""
      ) else "";

  # Reconstruct full label if exporter provided only short name
  ensureFullLabel = n:
    let nm = nameOf n; in
      if (nm == "") then nm else if (lib.hasPrefix "//" nm) || lib.hasInfix ":" nm then nm else (
        let srcs = get n "srcs"; in
          if (srcs != null) && (builtins.length srcs > 0) then (
            let s = builtins.head srcs;
                dparts = lib.splitString "/" s;
                ddir = lib.concatStringsSep "/" (lib.init dparts);
                base = lib.removeSuffix ("/cmd/" + nm) ddir;
            in "//" + base + ":" + nm
          ) else nm
      );

  # Build planner context and import language plugins if present
  ctx = {
    inherit lib T repoRoot localModuleOverrides pkgPathOf pkgs;
    # Provide full nodes list so language plugins (e.g., C++) can walk deps
    nodes = nodesList;
    get = get;
    modulesTomlFor = modulesTomlFor;
  };
  # Build language adapters map by enumerating known ids from langs.json when present,
  # otherwise fall back to on-disk existence. Keep partial-clone safe behavior.
  readLangIds = let
    langsPath = manifestBase + "/langs.json";
  in if builtins.pathExists langsPath then
    let raw = builtins.fromJSON (builtins.readFile langsPath);
        arr = if (builtins.isList raw) then raw else (raw.languages or []);
    in builtins.map (l: (l.id or "")) (builtins.filter (l: (builtins.isAttrs l) && (l ? id)) arr)
  else [];

  ensureAdapter = langId:
    let p = manifestBase + ("/planner/" + langId + ".nix"); in
      if builtins.pathExists p then (import p { inherit lib; } ctx) else {
        isTarget = n: false;
        kindOf = n: null;
        modulesFileFor = name: modulesTomlFor name;
        mkApp = name: T.goApp { inherit name; modulesToml = modulesTomlFor name; repoRoot = repoRoot; subdir = (pkgPathOf name); };
        mkLib = name: T.goLib { inherit name; modulesToml = modulesTomlFor name; repoRoot = repoRoot; subdir = (pkgPathOf name); };
      };

  # Always include go for backward compatibility; and include cpp if planner/cpp.nix exists.
  langIds = let
    ids0 = readLangIds;
    withGo = if builtins.elem "go" ids0 then ids0 else (ids0 ++ [ "go" ]);
    cppPlanner = manifestBase + "/planner/cpp.nix";
    withCpp = if builtins.pathExists cppPlanner && !(builtins.elem "cpp" withGo)
      then (withGo ++ [ "cpp" ]) else withGo;
  in withCpp;

  LANGS =
    builtins.listToAttrs (map (id: { name = id; value = ensureAdapter id; }) langIds);

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

  modulesTomlDefault = if rootModulesTomlPath != null
    then builtins.toPath rootModulesTomlPath
    else builtins.toPath (repoRootStr + "/gomod2nix.toml");
  haveModulesDefault = builtins.pathExists modulesTomlDefault;
  # Prefer nearest ancestor gomod2nix.toml starting from the target package directory; otherwise require repo-root file; no inline fallback
  modulesTomlFor = name:
    let
      pkgRel = pkgPathOf name;
      # walk up from pkgRel to repo root looking for gomod2nix.toml
      split = lib.splitString "/" pkgRel;
      segments = if (builtins.length split) == 0 then [] else split;
      descend = idx:
        if idx < 0 then null else
        let rel = lib.concatStringsSep "/" (lib.take (idx + 1) segments);
            cand = builtins.toPath (repoRootStr + "/" + rel + "/gomod2nix.toml");
        in if builtins.pathExists cand then cand else descend (idx - 1);
      nearest = if (builtins.length segments) > 0 then descend ((builtins.length segments) - 1) else null;
    in if nearest != null then nearest
       else if haveModulesDefault then modulesTomlDefault
       else builtins.throw ("gomod2nix.toml missing for target " + name +
         "; expected a gomod2nix.toml in an ancestor of " + (repoRootStr + "/" + pkgRel) +
         " or repo-root " + (builtins.toString modulesTomlDefault) +
         ". Run tools/dev/install-deps.ts to generate it.");

  # Minimal local libs listing (not used for target discovery) to build a map of
  # module import path -> live source for local libs (for replaces)
  safeReadDir = p: if builtins.pathExists p then builtins.readDir p else {};
  libsDir = builtins.toPath (repoRootStr + "/libs");
  libNames = builtins.attrNames (safeReadDir libsDir);

  # Build a map of module import path -> live source for local libs (for replaces)
  localModuleOverrides =
    let
      modForLib = nm: readModulePathLive ("libs/" + nm + "/go.mod");
      entries = lib.filter (kv: (lib.elemAt kv 1) != "") (map (nm: [ nm (modForLib nm) ]) libNames);
      mk = acc: kv:
        let nm = lib.elemAt kv 0; m = lib.elemAt kv 1; p = builtins.toPath (repoRootStr + "/libs/" + nm);
        in acc // { "${m}" = p; "${m}@v0.0.0" = p; };
    in builtins.foldl' mk {} entries;

  sanitize = s: lib.replaceStrings ["//" ":" "/" " "] ["" "-" "-" "-"] s;

  baseNameOf = p:
    let parts = lib.splitString "/" p; in
      if (builtins.length parts) > 0 then lib.elemAt parts ((builtins.length parts) - 1) else p;

  pkgPathOf = name:
    let left = lib.elemAt (lib.splitString ":" name) 0;
        parts = lib.splitString "//" left;
        rel = if (builtins.length parts) > 1 then lib.elemAt parts ((builtins.length parts) - 1) else lib.removePrefix "//" left;
    in if rel == "" then "." else rel;

  targetNameOf = name:
    let parts = lib.splitString ":" name; in
      if (builtins.length parts) > 1 then lib.elemAt parts 1 else baseNameOf (pkgPathOf name);

  mkGo = name: kind:
    if kind == "bin" then LANGS.go.mkApp name else LANGS.go.mkLib name;

  mkCpp = name: kind:
    if kind == "bin" then LANGS.cpp.mkApp name
    else if kind == "lib" then LANGS.cpp.mkLib name
    else if kind == "test" then LANGS.cpp.mkTest name
    else LANGS.cpp.mkApp name;

  # Limit to Go targets only for graph-outputs historically; now include C++ in addition.
  # We still restrict to apps/* and libs/* for partial-clone safety.
  safeGoNodes = builtins.filter (n:
    let nm = ensureFullLabel n;
        okName = (builtins.typeOf nm == "string") && nm != "";
        rel = if okName then (pkgPathOf nm) else "";
        inAppsLibs = lib.hasPrefix "apps/" rel || lib.hasPrefix "libs/" rel;
    in okName && inAppsLibs && (LANGS.go.isTarget n)
  ) nodesList;

  safeCppNodes = builtins.filter (n:
    let nm = ensureFullLabel n;
        okName = (builtins.typeOf nm == "string") && nm != "";
        rel = if okName then (pkgPathOf nm) else "";
        inAppsLibs = lib.hasPrefix "apps/" rel || lib.hasPrefix "libs/" rel;
    in okName && inAppsLibs && (LANGS ? cpp) && (LANGS.cpp.isTarget n)
  ) nodesList;

  goTargetsFromGraph = builtins.foldl' (acc: n:
    let nm = ensureFullLabel n; k = pick n; tnm = builtins.typeOf nm; in
      if (tnm != "string") || (nm == "") || (k == null)
      then acc
      else (acc // { "${nm}" = mkGo nm k.kind; })
  ) {} safeGoNodes;

  # Names of targets that are binaries (used to restrict graph-outputs per PR5)
  binTargetNames = builtins.filter (nm:
    let matches = builtins.filter (x: ensureFullLabel x == nm) safeGoNodes;
        n = if matches == [] then null else builtins.head matches;
        k = if n == null then null else pick n;
    in k != null && k.kind == "bin"
  ) (builtins.attrNames goTargetsFromGraph);

  # Strict mode: require Buck graph; only build app binaries in graph-outputs
  goTargets =
    let names = builtins.attrNames goTargetsFromGraph;
        entries = builtins.filter (e: e != null) (map (nm:
          let matches = builtins.filter (x: ensureFullLabel x == nm) safeGoNodes;
              n = if matches == [] then null else builtins.head matches;
              k = if n == null then null else pick n;
          in if k != null && (k.kind == "bin" || k.kind == "lib") then { name = nm; value = goTargetsFromGraph.${nm}; } else null
        ) names);
    in builtins.listToAttrs entries;
  # Only binaries participate in graph-outputs/manifest (PR5)
  goTargetsBins = builtins.listToAttrs (map (nm: { name = nm; value = goTargetsFromGraph.${nm}; }) binTargetNames);
  # IMPORTANT: keep values as derivations here (do NOT toString) so Nix realizes them
  # when referenced in the runCommand below. Stringifying would drop inputDerivations
  # and prevent materialization, leading to missing /bin during manifest creation.
  goOutPaths = goTargetsBins;

  # C++ targets collected similarly; include bin/lib/test in attrset, but only link bins in all.out/bin
  cppTargetsFromGraph = builtins.foldl' (acc: n:
    let nm = ensureFullLabel n; k = pick n; tnm = builtins.typeOf nm; in
      if (tnm != "string") || (nm == "") || (k == null)
      then acc
      else if (k.kind == null) then acc else (acc // { "${nm}" = mkCpp nm k.kind; })
  ) {} safeCppNodes;

  cppBinNames = builtins.filter (nm:
    let matches = builtins.filter (x: ensureFullLabel x == nm) safeCppNodes;
        n = if matches == [] then null else builtins.head matches;
        k = if n == null then null else pick n;
    in k != null && k.kind == "bin"
  ) (builtins.attrNames cppTargetsFromGraph);

  cppTargets = cppTargetsFromGraph;
  # Only include C++ binary targets when building the manifest/bin links.
  # Tests and planner stubs are excluded from bin output.
  cppOutPaths = builtins.listToAttrs (
    map (nm: { name = nm; value = cppTargetsFromGraph.${nm}; }) cppBinNames
  );

  # Node CLI bundles (importer-scoped) — pluginized
  safeNodeBinNodes = builtins.filter (n:
    let nm = ensureFullLabel n;
        okName = (builtins.typeOf nm == "string") && nm != "";
        rel = if okName then (pkgPathOf nm) else "";
        inAppsLibs = lib.hasPrefix "apps/" rel || lib.hasPrefix "libs/" rel;
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

  # Provide a flake-friendly flat attrset whose keys are safe identifiers: t + [a-z0-9_]+
  sanitizeAttr = s:
    let
      chars = lib.stringToCharacters (lib.toLower s);
      allowed = lib.stringToCharacters "abcdefghijklmnopqrstuvwxyz0123456789_";
      mapChar = c: if builtins.elem c allowed then c else "_";
    in "t" + (lib.concatStrings (map mapChar chars));

  cppTargetsFlat = builtins.listToAttrs (
    let
      dropCell = lbl:
        let parts = lib.splitString "//" lbl; in
          if (builtins.length parts) > 1 && !(lib.hasPrefix "//" lbl)
          then "//" + (lib.elemAt parts 1)
          else lbl;
    in map (nm:
      { name = sanitizeAttr (dropCell nm); value = cppTargetsFromGraph.${nm}; }
    ) (builtins.attrNames cppTargetsFromGraph)
  );

  # Optional: select a single target by BUCK_TARGET for impure local builds/tests
  selectedTargetName = builtins.getEnv "BUCK_TARGET";
  dropCell = lbl:
    let base0 = ensureFullLabel { name = lbl; };
        # Strip optional trailing config suffix: " (config//platforms:...)"
        base = (lib.elemAt (lib.splitString " (config//" base0) 0);
        # If label starts with a cell like "root//...", convert to "//..."
        hasCell = lib.hasInfix "//" base && !(lib.hasPrefix "//" base);
    in if hasCell then ("//" + (lib.elemAt (lib.splitString "//" base) 1)) else base;
  canon = s:
    let d = dropCell s;
    in if lib.hasPrefix "//" d then (lib.removePrefix "//" d) else d;
  selected = if selectedTargetName != "" then (
    let want = canon selectedTargetName;
        matches = builtins.filter (n:
          let nm = canon (ensureFullLabel n);
          in nm == want
        ) (safeGoNodes ++ safeCppNodes);
    in if matches == [] then pkgs.runCommand "missing-target-${sanitize selectedTargetName}" {} ''
      echo "missing target: ${selectedTargetName}" >&2
      exit 1
    '' else (
      let n = builtins.head matches; k = pick n; in
        if k == null then pkgs.runCommand "missing-kind-${sanitize selectedTargetName}" {} ''
          echo "missing kind for: ${selectedTargetName}" >&2
          exit 1
        '' else (
          if k.template == "go" then (
            if (k.kind == "bin" || k.kind == "lib") then mkGo selectedTargetName k.kind else mkGo selectedTargetName "bin"
          ) else if k.template == "node" then (
            if (k.kind == "bin" || k.kind == "lib") then LANGS.node.mkApp selectedTargetName else LANGS.node.mkApp selectedTargetName
          ) else (
            # default to cpp when not go
            if (k.kind == "bin" || k.kind == "lib" || k.kind == "test") then mkCpp selectedTargetName k.kind else mkCpp selectedTargetName "bin"
          )
        )
    )
  ) else pkgs.runCommand "no-target-specified" {} ''
    mkdir -p $out
    echo no-target > $out/.noop
  '';

  # Ensure C++ and Go target derivations are realized by declaring them as inputs.
  allDeps = (lib.attrValues goOutPaths) ++ (lib.attrValues cppOutPaths) ++ (lib.attrValues nodeOutPaths);

  all = pkgs.runCommand "graph-outputs" { inherit allDeps; } ''
      set -eu
      mkdir -p $out
      mkdir -p $out/bin
      : > $out/manifest.json
      : > $out/build.log
      echo "repoRootStr=${repoRootStr}" >> $out/build.log
      echo "appsDir=${builtins.toString (builtins.toPath (repoRootStr + "/apps"))}" >> $out/build.log
      echo "libsDir=${builtins.toString (builtins.toPath (repoRootStr + "/libs"))}" >> $out/build.log
      echo "devOverrideJSON=${builtins.toJSON devOverrideJSON}" >> $out/build.log
      echo "goTargets keys: ${lib.concatStringsSep "," (builtins.attrNames goOutPaths)}" >> $out/build.log
      echo "cppTargets bin keys: ${lib.concatStringsSep "," (builtins.attrNames cppOutPaths)}" >> $out/build.log
      echo '[' > $out/manifest.json
      first=1
      ${lib.concatStringsSep "\n" (lib.mapAttrsToList (n: p:
        ''
          ln -s "${p}" "$out/" || true
          echo "== target: ${n} ==" >> $out/build.log
          echo "path: ${p}" >> $out/build.log
          echo "deriver: $(nix-store -q --deriver "${p}" 2>/dev/null || true)" >> $out/build.log
          echo "modulesToml: ${builtins.toString (modulesTomlFor n)}" >> $out/build.log
          echo "pkgPath: ${pkgPathOf n}" >> $out/build.log
          echo "targetName: ${targetNameOf n}" >> $out/build.log
          echo "expected subdir(bin): ${pkgPathOf n}/cmd/${targetNameOf n}" >> $out/build.log
          echo "expected srcRoot: (repo root with apps/libs)" >> $out/build.log
          echo "tree (depth 2) of out path:" >> $out/build.log
          (cd "${p}" && { ls -la || true; echo "-- bin --"; ls -la bin 2>/dev/null || true; }) >> $out/build.log || true
          bins=""
          if [ -d "${p}/bin" ]; then
            for f in "${p}/bin"/*; do
              if [ -f "$f" ] && [ -x "$f" ]; then
                if [ -z "$bins" ]; then bins="\"$f\""; else bins="$bins, \"$f\""; fi
                ln -s "$f" "$out/bin/$(basename "$f")" || true
                ln -s "$f" "$out/bin/${sanitize n}" || true
                ln -s "$f" "$out/bin/go-${sanitize n}" || true
              fi
            done
          fi
          if [ -n "$bins" ]; then
            echo "label=${n} bins=[ $bins ]" >> $out/build.log
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            echo "{ \"label\": \"${n}\", \"kind\": \"bin\", \"bins\": [ $bins ], \"aux\": [] }" >> $out/manifest.json
            first=0
          else
            echo "label=${n} bins=[]" >> $out/build.log
          fi
        ''
      ) goOutPaths)}
      ${lib.concatStringsSep "\n" (lib.mapAttrsToList (n: p:
        ''
          ln -s "${p}" "$out/" || true
          echo "== cpp target: ${n} ==" >> $out/build.log
          echo "path: ${p}" >> $out/build.log
          (cd "${p}" && { ls -la || true; echo "-- bin --"; ls -la bin 2>/dev/null || true; }) >> $out/build.log || true
          bins=""
          if [ -d "${p}/bin" ]; then
            for f in "${p}/bin"/*; do
              if [ -f "$f" ] && [ -x "$f" ]; then
                if [ -z "$bins" ]; then bins="\"$f\""; else bins="$bins, \"$f\""; fi
                ln -s "$f" "$out/bin/$(basename "$f")" || true
                ln -s "$f" "$out/bin/${sanitize n}" || true
                ln -s "$f" "$out/bin/cpp-${sanitize n}" || true
              fi
            done
          fi
          if [ -n "$bins" ]; then
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            echo "{ \"label\": \"${n}\", \"kind\": \"bin\", \"bins\": [ $bins ], \"aux\": [] }" >> $out/manifest.json
            first=0
          fi
        ''
      ) cppOutPaths)}
      ${lib.concatStringsSep "\n" (lib.mapAttrsToList (n: p:
        ''
          ln -s "${p}" "$out/" || true
          echo "== node target: ${n} ==" >> $out/build.log
          (cd "${p}" && { ls -la || true; echo "-- bin --"; ls -la bin 2>/dev/null || true; }) >> $out/build.log || true
          bins=""
          if [ -d "${p}/bin" ]; then
            for f in "${p}/bin"/*; do
              if [ -f "$f" ] && [ -x "$f" ]; then
                if [ -z "$bins" ]; then bins="\"$f\""; else bins="$bins, \"$f\""; fi
                ln -s "$f" "$out/bin/$(basename "$f")" || true
                ln -s "$f" "$out/bin/${sanitize n}" || true
                ln -s "$f" "$out/bin/node-${sanitize n}" || true
              fi
            done
          fi
          if [ -n "$bins" ]; then
            if [ "$first" -eq 0 ]; then echo "," >> $out/manifest.json; fi
            echo "{ \"label\": \"${n}\", \"kind\": \"bin\", \"bins\": [ $bins ], \"aux\": [] }" >> $out/manifest.json
            first=0
          fi
        ''
      ) nodeOutPaths)}
      echo ']' >> $out/manifest.json
    '';
in
{
  inherit goTargets cppTargets cppTargetsFlat all selected;
}


