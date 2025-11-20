{ pkgs, src ? ../../., graphJsonPath ? null, rootModulesTomlPath ? null }:
let
  lib = pkgs.lib;
  # Allow tests to override the repo root via BUCK_TEST_SRC; default to provided flake src
  buckTestSrcEnv = builtins.getEnv "BUCK_TEST_SRC";
  repoRootStr = if buckTestSrcEnv != "" then buckTestSrcEnv else builtins.toString src;
  repoRoot = builtins.toPath repoRootStr;
  traceEnabled = (builtins.getEnv "PLANNER_TRACE") != "";
  onlyCpp = (builtins.getEnv "PLANNER_ONLY_CPP") != "";
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
    then (
      let
        contents0 = builtins.readFile graphPath;
        contents = if traceEnabled
          then (builtins.trace ("[planner][trace] graph.json head: " + (builtins.substring 0 160 contents0)) contents0)
          else contents0;
      in builtins.fromJSON contents
    )
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
  # Shared planner helpers (label cleanup, basic lookups)
  P = import ./planner/lib.nix { inherit lib; get = get; nodes = nodesList; pkgPathOf = pkgPathOf; };
  # Prefer language manifests and planner plugins from the TEST repo (BUCK_TEST_SRC)
  # so zx tests that rsync a temp repo can provide cpp enablement without requiring
  # the main flake workspace to also include those files.
  manifestBase =
    let candidate = builtins.toPath (repoRootStr + "/tools/nix"); in
      if (builtins.pathExists candidate) && (builtins.pathExists (candidate + "/lang-templates.nix"))
      then candidate
      else ./.;
  # Load language templates from the chosen manifest base (temp repo when set)
  T = import (manifestBase + "/lang-templates.nix") { inherit pkgs; };
  M = if builtins.pathExists ./mapping.nix then (
        let raw = import ./mapping.nix;
            attempt = builtins.tryEval (raw {});
        in if attempt.success then attempt.value else raw
      ) else {};
  D = M.dispatch or {};
  devOverrideJSON = builtins.getEnv "NIX_GO_DEV_OVERRIDE_JSON";
  devOverrideCppJSON = builtins.getEnv "NIX_CPP_DEV_OVERRIDE_JSON";
  # CI detection and optional suppression flag for planner dev-override logs
  isCI = (builtins.getEnv "CI") == "true";
  suppressDevOverrideLog = (builtins.getEnv "PLANNER_NO_DEV_OVERRIDE_LOG") != "";
  hasGoOverride = devOverrideJSON != "";
  hasCppOverride = devOverrideCppJSON != "";

  get = attrs: k: attrs.${k} or null;
  # Use shared helpers for normalized names
  cleanLabel = P.cleanLabel;
  nameOf = P.nameOf;

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
  # Language adapters and dispatch (extracted module)
  Langs = import (manifestBase + "/planner/langs.nix") {
    inherit lib manifestBase nodesList get T M;
    ctx = ctx;
  };
  LANGS = Langs.LANGS;
  _trace_langs = if traceEnabled then builtins.trace ("[planner][trace] LANGS keys=" + (builtins.concatStringsSep "," (builtins.attrNames LANGS))) null else null;
  pick = Langs.pick;

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

  # Import C++ planner adapter directly for mk* helpers
  Cpp = import (manifestBase + "/planner/cpp.nix") { inherit lib; } {
    inherit T repoRoot;
    get = get;
    nodes = nodesList;
    pkgPathOf = pkgPathOf;
    modulesTomlFor = modulesTomlFor;
  };
  # Direct C++ constructor via planner adapter: avoid LANGS indirection
  mkCpp = name: kind:
    if kind == "bin" then Cpp.mkApp name
    else if kind == "lib" then Cpp.mkLib name
    else if kind == "test" then Cpp.mkTest name
    else if kind == "addon" then Cpp.mkAddon name
    else Cpp.mkApp name;

  # Compute C++ target set locally to avoid evaluating unrelated language paths in temp workspaces
  safeCppNodes =
    let hasLabel = n: let ls = get n "labels"; in (ls != null) && (builtins.isList ls) && builtins.elem "lang:cpp" ls;
        nmOk = n: let nm = ensureFullLabel n; in (builtins.typeOf nm == "string") && (nm != "");
        inAppsLibs = n:
          let rel = if nmOk n then (pkgPathOf (ensureFullLabel n)) else ""; in
            lib.hasPrefix "apps/" rel || lib.hasPrefix "libs/" rel;
    in builtins.filter (n: nmOk n && inAppsLibs n && hasLabel n) nodesList;
  # Lightweight C++ kind inference (mirrors planner/cpp.nix:kindOf)
  cppKindOf = n:
    let
      rt0 = get n "rule_type"; rt = if rt0 == null then "" else rt0;
      labs = get n "labels";
      nm = ensureFullLabel n;
      isPlanner = (builtins.typeOf nm == "string") && (nm != "") && lib.hasSuffix "__planner" nm;
      has = l: (labs != null) && (builtins.isList labs) && builtins.elem l labs;
    in if has "kind:test" || isPlanner then "test"
       else if has "kind:bin" then "bin"
       else if has "kind:lib" then "lib"
       else if has "kind:addon" then "addon"
       else if rt == "cxx_test" then "test"
       else if rt == "cxx_binary" then "bin"
       else if rt == "cxx_library" then (if isPlanner then "test" else "lib")
       else null;
  cppTargetsFromGraph = builtins.foldl' (acc: n:
    let nm = ensureFullLabel n; tnm = builtins.typeOf nm; k = cppKindOf n; in
      if (tnm != "string") || (nm == "") || (k == null) then acc
      else (acc // { "${nm}" = mkCpp nm k; })
  ) {} safeCppNodes;
  # Only link C++ binaries in graph outputs
  cppBinNames = builtins.filter (nm:
    let
      matches = builtins.filter (x: ensureFullLabel x == nm) safeCppNodes;
      n = if matches == [] then null else builtins.head matches;
      k = if n == null then null else (cppKindOf n);
    in k != null && k == "bin"
  ) (builtins.attrNames cppTargetsFromGraph);
  cppOutPaths = builtins.listToAttrs (map (nm: { name = nm; value = cppTargetsFromGraph.${nm}; }) cppBinNames);
  # Node targets are not needed for this flow; provide empty set
  nodeTargetsFromGraph = if onlyCpp then {} else {};
  nodeOutPaths = if onlyCpp then {} else {};

  # Strict mode: require Buck graph; only build app binaries/libs in goTargets
  # Defer Go computation entirely to avoid evaluating unrelated paths in C++-only temp workspaces
  goOutPaths =
    if onlyCpp then {}
    else (
      let
        # Minimal Go support for full planner runs
        hasGoLabel = n:
          let ls = get n "labels"; in (ls != null) && (builtins.isList ls) && builtins.elem "lang:go" ls;
        inAppsLibs = n:
          let rel = pkgPathOf (ensureFullLabel n); in lib.hasPrefix "apps/" rel || lib.hasPrefix "libs/" rel;
        safeGoNodes = builtins.filter (n:
          let nm = ensureFullLabel n; in
            (builtins.typeOf nm == "string") && (nm != "") && inAppsLibs n && hasGoLabel n
        ) nodesList;
        # Use adapter's kindOf for Go
        goKindOf = n: LANGS.go.kindOf n;
        mkGo = name: kind:
          if (kind == "bin") then LANGS.go.mkApp name else LANGS.go.mkLib name;
        goTargetsFromGraph = builtins.foldl' (acc: n:
          let nm = ensureFullLabel n; kind = goKindOf n; in
            if (kind == null) then acc else (acc // { "${nm}" = mkGo nm kind; })
        ) {} safeGoNodes;
        goBinNames = builtins.filter (nm:
          let nms = builtins.filter (x: ensureFullLabel x == nm) safeGoNodes;
              n = if nms == [] then null else builtins.head nms;
              k = if n == null then null else goKindOf n;
          in k != null && k == "bin"
        ) (builtins.attrNames goTargetsFromGraph);
      in builtins.listToAttrs (map (nm: { name = nm; value = goTargetsFromGraph.${nm}; }) goBinNames)
    );
  cppTargets = cppTargetsFromGraph;

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
        # Strip optional trailing config suffix using shared helper
        base = cleanLabel base0;
        # If label starts with a cell like "root//...", convert to "//..."
        hasCell = lib.hasInfix "//" base && !(lib.hasPrefix "//" base);
    in if hasCell then ("//" + (lib.elemAt (lib.splitString "//" base) 1)) else base;
  canon = s:
    let d = dropCell s;
    in if lib.hasPrefix "//" d then (lib.removePrefix "//" d) else d;
  selected = if selectedTargetName != "" then (
    let want = canon selectedTargetName; in
      if onlyCpp then (
        # C++ only mode: limit search to C++ nodes and build with cpp templates
        let matches = builtins.filter (n:
              let nm = canon (ensureFullLabel n);
              in nm == want
            ) safeCppNodes;
        in if matches == [] then pkgs.runCommand "missing-target-${sanitize selectedTargetName}" {} ''
          echo "missing target: ${selectedTargetName}" >&2
          exit 1
        '' else (
          let n = builtins.head matches; k = cppKindOf n; in
            if k == null then pkgs.runCommand "missing-kind-${sanitize selectedTargetName}" {} ''
              echo "missing kind for: ${selectedTargetName}" >&2
              exit 1
            '' else (
              if (k == "bin" || k == "lib" || k == "test" || k == "addon") then mkCpp selectedTargetName k else mkCpp selectedTargetName "bin"
            )
        )
      ) else (
        # Full mode: allow any language via adapter pick
        let matches = builtins.filter (n:
              let nm = canon (ensureFullLabel n);
              in nm == want
            ) nodesList;
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
                if (k.kind == "bin" || k.kind == "lib") then LANGS.go.mkApp selectedTargetName
                else if (k.kind == "tinywasm") then LANGS.go.mkTinyWasm selectedTargetName
                else LANGS.go.mkApp selectedTargetName
              ) else if k.template == "node" then (
                LANGS.node.mkApp selectedTargetName
              ) else (
                if (k.kind == "bin" || k.kind == "lib" || k.kind == "test" || k.kind == "addon") then mkCpp selectedTargetName k.kind else mkCpp selectedTargetName "bin"
              )
            )
        )
      )
  ) else pkgs.runCommand "no-target-specified" {} ''
    mkdir -p $out
    echo no-target > $out/.noop
  '';

  # Build manifest and bin links (extracted module)
  Manifest = import (manifestBase + "/planner/manifest.nix") {
    inherit pkgs lib repoRootStr devOverrideJSON devOverrideCppJSON isCI suppressDevOverrideLog
            goOutPaths cppOutPaths nodeOutPaths modulesTomlFor pkgPathOf targetNameOf sanitize;
  };
  all = Manifest.all;

  # Minimal TinyGo wasm selected builder: builds a wasm for BUCK_TARGET without requiring
  # the node to be present in the exported graph. Intended for tests and simple consumers.
  selectedWasm =
    let tgt = builtins.getEnv "BUCK_TARGET";
    in if tgt != "" then
      T.goTinyWasmLib {
        name = tgt;
        srcRoot = repoRoot;
        subdir = pkgPathOf tgt;
        wasmStaticLibs = [];
      }
    else pkgs.runCommand "no-target" {} ''
      mkdir -p $out
      echo no-target > $out/.noop
    '';
in
{
  inherit cppTargets cppTargetsFlat all selected;
  inherit selectedWasm;
}


