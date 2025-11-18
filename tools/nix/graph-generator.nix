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
  # Shared planner helpers (label cleanup, basic lookups)
  P = import ./planner/lib.nix { inherit lib; get = get; nodes = nodesList; pkgPathOf = pkgPathOf; };
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

  # Consolidated target constructor: delegates to language adapters
  mkFor = template: name: kind:
    let L = builtins.getAttr template LANGS; in
      if kind == "bin" then L.mkApp name
      else if kind == "lib" then L.mkLib name
      else if kind == "test" && (builtins.hasAttr "mkTest" L) then L.mkTest name
      else L.mkApp name;

  mkGo = name: kind:
    mkFor "go" name kind;

  mkCpp = name: kind:
    mkFor "cpp" name kind;

  # Target selection and out paths (extracted module)
  Targets = import (manifestBase + "/planner/targets.nix") {
    inherit lib nodesList LANGS pick ensureFullLabel pkgPathOf mkGo mkCpp;
  };
  safeGoNodes = Targets.safeGoNodes;
  safeCppNodes = Targets.safeCppNodes;
  goTargetsFromGraph = Targets.goTargetsFromGraph;
  cppTargetsFromGraph = Targets.cppTargetsFromGraph;
  nodeTargetsFromGraph = Targets.nodeTargetsFromGraph;
  goOutPaths = Targets.goOutPaths;
  cppOutPaths = Targets.cppOutPaths;
  nodeOutPaths = Targets.nodeOutPaths;

  # Strict mode: require Buck graph; only build app binaries/libs in goTargets
  goTargets =
    let names = builtins.attrNames goTargetsFromGraph;
        entries = builtins.filter (e: e != null) (map (nm:
          let matches = builtins.filter (x: ensureFullLabel x == nm) safeGoNodes;
              n = if matches == [] then null else builtins.head matches;
              k = if n == null then null else pick n;
          in if k != null && (k.kind == "bin" || k.kind == "lib") then { name = nm; value = goTargetsFromGraph.${nm}; } else null
        ) names);
    in builtins.listToAttrs entries;
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
            if (k.kind == "bin" || k.kind == "lib" || k.kind == "test" || k.kind == "addon") then mkCpp selectedTargetName k.kind else mkCpp selectedTargetName "bin"
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
in
{
  inherit goTargets cppTargets cppTargetsFlat all selected;
}


