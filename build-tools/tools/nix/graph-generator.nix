{ pkgs, src ? ../../., graphJsonPath ? null, rootModulesTomlPath ? null, uv2nixLib ? null }:
let
  lib = pkgs.lib;
  H = import ./lib/lang-helpers.nix { inherit pkgs; };
  # Allow tests to override the repo root via BUCK_TEST_SRC; default to provided flake src
  buckTestSrcEnv = builtins.getEnv "BUCK_TEST_SRC";
  repoRootStr = if buckTestSrcEnv != "" then buckTestSrcEnv else builtins.toString src;
  repoRootBase = builtins.toPath repoRootStr;
  traceEnabled = (builtins.getEnv "PLANNER_TRACE") != "";
  onlyCpp = (builtins.getEnv "PLANNER_ONLY_CPP") != "";
  # Filtered source that includes both projects/apps/* and projects/libs/* so local replaces resolve
  appsLibsSrc = lib.cleanSourceWith {
    src = repoRootBase;
    filter = path: type:
      let p = builtins.toString path;
          rootP = builtins.toString repoRootBase;
          rel = lib.removePrefix (rootP + "/") p;
      in
      # keep the root, the top-level projects/apps/libs directories, and anything under them
      p == rootP ||
      rel == "projects" ||
      rel == "projects/apps" ||
      rel == "projects/libs" ||
      lib.hasPrefix "projects/apps/" rel ||
      lib.hasPrefix "projects/libs/" rel;
  };
  repoRoot = appsLibsSrc;

  # Helper to read module path from a go.mod file under the repo root (pure with src)
  readModulePathLive = rel:
    let p = builtins.toPath (repoRootStr + "/" + rel); in
      if builtins.pathExists p then (
        let txt = builtins.readFile p;
            parts = lib.filter (s: lib.hasPrefix "module " s) (lib.splitString "\n" txt);
        in if parts == [] then "" else lib.removePrefix "module " (lib.head parts)
      ) else "";

  # Prefer explicit graphJsonPath; otherwise fall back to BUCK_TEST_SRC/build-tools/tools/buck/graph.json
  # so test sandboxes can provide a live graph without requiring flake to import it.
  graphPath = if graphJsonPath != null then builtins.toPath graphJsonPath else (
    let cand = builtins.toPath (repoRootStr + "/build-tools/tools/buck/graph.json"); in
      if builtins.pathExists cand then cand else builtins.throw "graphJsonPath not provided and repoRoot/build-tools/tools/buck/graph.json missing — run build-tools/tools/buck/export-graph.ts first." 
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
    else builtins.throw "graphJsonPath does not exist — run build-tools/tools/buck/export-graph.ts before building.";
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
    let candidate = builtins.toPath (repoRootStr + "/build-tools/tools/nix"); in
      if (builtins.pathExists candidate) && (builtins.pathExists (candidate + "/lang-templates.nix"))
      then candidate
      else ./.;
  # Load language templates from the chosen manifest base (temp repo when set)
  T = import (manifestBase + "/lang-templates.nix") { inherit pkgs uv2nixLib; };
  M = if builtins.pathExists ./mapping.nix then (
        let raw = import ./mapping.nix;
            attempt = builtins.tryEval (raw {});
        in if attempt.success then attempt.value else raw
      ) else {};
  D = M.dispatch or {};
  # Planner override env mapping (PR-5): avoid hard-coded names
  Overrides = import (manifestBase + "/planner/overrides.nix");
  devOverrideJSON =
    if builtins.hasAttr "go" Overrides
    then builtins.getEnv (builtins.getAttr "go" Overrides)
    else "";
  devOverrideCppJSON =
    if builtins.hasAttr "cpp" Overrides
    then builtins.getEnv (builtins.getAttr "cpp" Overrides)
    else "";
  devOverridePyJSON =
    if builtins.hasAttr "python" Overrides
    then builtins.getEnv (builtins.getAttr "python" Overrides)
    else "";
  overridePresentList =
    let langs = builtins.attrNames Overrides;
    in builtins.filter (lang: (builtins.getEnv (builtins.getAttr lang Overrides)) != "") langs;
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
    inherit lib T repoRoot repoRootStr localModuleOverrides pkgPathOf pkgs;
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
         ". Run build-tools/tools/dev/install-deps.ts to generate it.");

  # Minimal local libs listing (not used for target discovery) to build a map of
  # module import path -> live source for local libs (for replaces)
  safeReadDir = p: if builtins.pathExists p then builtins.readDir p else {};
  libsDir = builtins.toPath (repoRootStr + "/projects/libs");
  libNames = builtins.attrNames (safeReadDir libsDir);

  # Build a map of module import path -> live source for local libs (for replaces)
  localModuleOverrides =
    let
      modForLib = nm: readModulePathLive ("projects/libs/" + nm + "/go.mod");
      entries = lib.filter (kv: (lib.elemAt kv 1) != "") (map (nm: [ nm (modForLib nm) ]) libNames);
      mk = acc: kv:
        let nm = lib.elemAt kv 0; m = lib.elemAt kv 1; p = builtins.toPath (repoRootStr + "/projects/libs/" + nm);
        in acc // { "${m}" = p; "${m}@v0.0.0" = p; };
    in builtins.foldl' mk {} entries;

  sanitize = H.sanitizeName;

  baseNameOf = p:
    let parts = lib.splitString "/" p; in
      if (builtins.length parts) > 0 then lib.elemAt parts ((builtins.length parts) - 1) else p;

  pkgPathOf = name:
    if !(builtins.isString name) then "." else H.packagePathFromTargetLabel name;

  targetNameOf = name:
    let parts = lib.splitString ":" name; in
      if (builtins.length parts) > 1 then lib.elemAt parts 1 else baseNameOf (pkgPathOf name);

  # Registry-first C++: use LANGS.cpp for kind inference and mk* constructors.
  # Keep PLANNER_ONLY_CPP as a minimal optimization for sliced workspaces.

  # Compute C++ target set locally to avoid evaluating unrelated language paths in temp workspaces
  safeCppNodes =
    let hasLabel = n: let ls = get n "labels"; in (ls != null) && (builtins.isList ls) && builtins.elem "lang:cpp" ls;
        nmOk = n: let nm = ensureFullLabel n; in (builtins.typeOf nm == "string") && (nm != "");
        inAppsLibs = n:
          let rel = if nmOk n then (pkgPathOf (ensureFullLabel n)) else ""; in
            lib.hasPrefix "projects/apps/" rel || lib.hasPrefix "projects/libs/" rel;
    in builtins.filter (n: nmOk n && inAppsLibs n && hasLabel n) nodesList;
  cppTargetsFromGraph = builtins.foldl' (acc: n:
    let nm = ensureFullLabel n; tnm = builtins.typeOf nm; k = LANGS.cpp.kindOf n; in
      if (tnm != "string") || (nm == "") || (k == null) then acc
      else (
        acc // {
          "${nm}" =
            if k == "bin" then LANGS.cpp.mkApp nm
            else if k == "headers" then LANGS.cpp.mkHeaders nm
            else if k == "lib" then LANGS.cpp.mkLib nm
            else if k == "test" then LANGS.cpp.mkTest nm
            else if k == "addon" then LANGS.cpp.mkAddon nm
            else LANGS.cpp.mkApp nm;
        }
      )
  ) {} safeCppNodes;
  # Only link C++ binaries in graph outputs
  cppBinNames = builtins.filter (nm:
    let
      matches = builtins.filter (x: ensureFullLabel x == nm) safeCppNodes;
      n = if matches == [] then null else builtins.head matches;
      k = if n == null then null else (LANGS.cpp.kindOf n);
    in k != null && k == "bin"
  ) (builtins.attrNames cppTargetsFromGraph);
  cppOutPaths = builtins.listToAttrs (map (nm: { name = nm; value = cppTargetsFromGraph.${nm}; }) cppBinNames);
  nodeOutPaths =
    if onlyCpp then {}
    else (
      let
        hasNodeLabel = n:
          let ls = get n "labels"; in (ls != null) && (builtins.isList ls) && builtins.elem "lang:node" ls;
        inAppsLibs = n:
          let rel = pkgPathOf (ensureFullLabel n); in lib.hasPrefix "projects/apps/" rel || lib.hasPrefix "projects/libs/" rel;
        safeNodeNodes = builtins.filter (n:
          let nm = ensureFullLabel n; in
            (builtins.typeOf nm == "string") && (nm != "") && inAppsLibs n && hasNodeLabel n
        ) nodesList;
        nodeKindOf = n: LANGS.node.kindOf n;
        mkNode = name: kind:
          if (kind == "bin") then LANGS.node.mkBin name
          else if (kind == "lib") then LANGS.node.mkLib name
          else if (kind == "gen") then LANGS.node.mkGen name
          else LANGS.node.mkApp name;
        nodeTargetsFromGraph = builtins.foldl' (acc: n:
          let nm = ensureFullLabel n; kind = nodeKindOf n; in
            if (kind == null) then acc else (acc // { "${nm}" = mkNode nm kind; })
        ) {} safeNodeNodes;
        nodeRunnableNames = builtins.filter (nm:
          let nms = builtins.filter (x: ensureFullLabel x == nm) safeNodeNodes;
              n = if nms == [] then null else builtins.head nms;
              k = if n == null then null else nodeKindOf n;
          in k != null && (k == "bin" || k == "app")
        ) (builtins.attrNames nodeTargetsFromGraph);
      in builtins.listToAttrs (map (nm: { name = nm; value = nodeTargetsFromGraph.${nm}; }) nodeRunnableNames)
    );
  nodeDevImporters = builtins.listToAttrs (
    map (nm:
      let
        matches = builtins.filter (x: ensureFullLabel x == nm) nodesList;
        n = if matches == [] then null else builtins.head matches;
        labs0 = if n == null then null else (get n "labels");
        labs = if labs0 != null && builtins.isList labs0 then labs0 else [];
        lockLabs = builtins.filter (l: builtins.isString l && lib.hasPrefix "lockfile:" l) labs;
        importer =
          if lockLabs == [] then ""
          else
            let
              raw = builtins.head lockLabs;
              parts = lib.splitString "#" raw;
            in if (builtins.length parts) > 1 then builtins.elemAt parts 1 else "";
      in { name = nm; value = importer; }
    ) (builtins.attrNames nodeOutPaths)
  );

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
          let rel = pkgPathOf (ensureFullLabel n); in lib.hasPrefix "projects/apps/" rel || lib.hasPrefix "projects/libs/" rel;
        safeGoNodes = builtins.filter (n:
          let nm = ensureFullLabel n; in
            (builtins.typeOf nm == "string") && (nm != "") && inAppsLibs n && hasGoLabel n
        ) nodesList;
        # Use adapter's kindOf for Go
        goKindOf = n: LANGS.go.kindOf n;
        mkGo = name: kind:
          if (kind == "bin") then LANGS.go.mkApp name
          else if (kind == "test") then LANGS.go.mkTest name
          else if (kind == "carchive") then LANGS.go.mkCArchive name
          else LANGS.go.mkLib name;
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
  cppTargetsFlat = builtins.listToAttrs (
    map (nm: {
      name = H.sanitizeAttrNameFromTargetLabel nm;
      value = cppTargetsFromGraph.${nm};
    }) (builtins.attrNames cppTargetsFromGraph)
  );

  # Optional: select a single target by BUCK_TARGET for impure local builds/tests
  selectedTargetName = builtins.getEnv "BUCK_TARGET";
  stripLeadingDoubleSlash = s: if lib.hasPrefix "//" s then lib.removePrefix "//" s else s;
  normalizedTargetKeyFromString = s:
    stripLeadingDoubleSlash (H.normalizeTargetLabel (ensureFullLabel { name = s; }));
  normalizedTargetKeyFromNode = n:
    stripLeadingDoubleSlash (H.normalizeTargetLabel (ensureFullLabel n));
  selected = if selectedTargetName != "" then (
    let want = normalizedTargetKeyFromString selectedTargetName; in
      if onlyCpp then (
        # C++ only mode: limit search to C++ nodes and build with cpp templates
        let matches = builtins.filter (n:
              (normalizedTargetKeyFromNode n) == want
            ) safeCppNodes;
        in if matches == [] then pkgs.runCommand "missing-target-${sanitize selectedTargetName}" {} ''
          echo "missing target: ${selectedTargetName}" >&2
          exit 1
        '' else (
          let
            n = builtins.head matches;
            k = LANGS.cpp.kindOf n;
            buildLabel = H.normalizeTargetLabel (ensureFullLabel n);
          in
            if k == null then pkgs.runCommand "missing-kind-${sanitize selectedTargetName}" {} ''
              echo "missing kind for: ${selectedTargetName}" >&2
              exit 1
            '' else (
              if k == "bin" then LANGS.cpp.mkApp buildLabel
              else if k == "headers" then LANGS.cpp.mkHeaders buildLabel
              else if k == "lib" then LANGS.cpp.mkLib buildLabel
              else if k == "test" then LANGS.cpp.mkTest buildLabel
              else if k == "addon" then LANGS.cpp.mkAddon buildLabel
              else LANGS.cpp.mkApp buildLabel
            )
        )
      ) else (
        # Full mode: allow any language via adapter pick
        let matches = builtins.filter (n:
              (normalizedTargetKeyFromNode n) == want
            ) nodesList;
        in if matches == [] then pkgs.runCommand "missing-target-${sanitize selectedTargetName}" {} ''
          echo "missing target: ${selectedTargetName}" >&2
          exit 1
        '' else (
          let
            n = builtins.head matches;
            k = pick n;
            buildLabel = H.normalizeTargetLabel (ensureFullLabel n);
          in
            if k == null then pkgs.runCommand "missing-kind-${sanitize selectedTargetName}" {} ''
              echo "missing kind for: ${selectedTargetName}" >&2
              exit 1
            '' else (
              if k.template == "go" then (
              if k.kind == "bin" then LANGS.go.mkApp buildLabel
              else if k.kind == "lib" then LANGS.go.mkLib buildLabel
              else if k.kind == "test" then LANGS.go.mkTest buildLabel
              else if k.kind == "carchive" then LANGS.go.mkCArchive buildLabel
              else if (k.kind == "tinywasm") then LANGS.go.mkTinyWasm buildLabel
              else LANGS.go.mkApp buildLabel
              ) else if k.template == "node" then (
                if k.kind == "bin" then LANGS.node.mkBin buildLabel
                else if k.kind == "lib" then LANGS.node.mkLib buildLabel
                else if k.kind == "gen" then LANGS.node.mkGen buildLabel
                else LANGS.node.mkApp buildLabel
              ) else if k.template == "python" then (
                if (k.kind == "wasm") then
                  let
                    labs = get n "labels";
                    hasWasmLib = (labs != null) && (builtins.isList labs) && (builtins.elem "wasm:lib" labs);
                  in if hasWasmLib then LANGS.python.mkWasmLib buildLabel else LANGS.python.mkWasmApp buildLabel
                else if (k.kind == "pyext") then LANGS.python.mkPyExt buildLabel
                else if (k.kind == "pyext_wasm") then LANGS.python.mkPyExtWasm buildLabel
                else if (k.kind == "test") then LANGS.python.mkTest buildLabel
                else if (k.kind == "bin") then LANGS.python.mkApp buildLabel
                else if (k.kind == "lib") then LANGS.python.mkLib buildLabel
                else LANGS.python.mkLib buildLabel
              ) else if k.template == "rust" then (
                if k.kind == "bin" then LANGS.rust.mkApp buildLabel
                else LANGS.rust.mkLib buildLabel
              ) else (
                if k.kind == "bin" then LANGS.cpp.mkApp buildLabel
                else if k.kind == "headers" then LANGS.cpp.mkHeaders buildLabel
                else if k.kind == "lib" then LANGS.cpp.mkLib buildLabel
                else if k.kind == "test" then LANGS.cpp.mkTest buildLabel
                else if k.kind == "addon" then LANGS.cpp.mkAddon buildLabel
                else LANGS.cpp.mkApp buildLabel
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
    inherit pkgs lib repoRootStr devOverrideJSON devOverrideCppJSON devOverridePyJSON isCI suppressDevOverrideLog
            goOutPaths cppOutPaths nodeOutPaths modulesTomlFor pkgPathOf targetNameOf sanitize;
    nodeDevImporters = nodeDevImporters;
    overridePresentList = overridePresentList;
  };
  all = Manifest.all;

  # Minimal TinyGo wasm selected builder: builds a wasm for BUCK_TARGET without requiring
  # the node to be present in the exported graph. Intended for tests and simple consumers.
  selectedWasm =
    let tgt = builtins.getEnv "BUCK_TARGET";
        backend = builtins.getEnv "WEB_WASM_BACKEND";
        goTarget =
          if backend == "wasi_single" then "wasi"
          else "wasm";
    in if tgt != "" then
      T.goTinyWasmLib {
        name = tgt;
        srcRoot = repoRoot;
        subdir = pkgPathOf tgt;
        wasmStaticLibs = [];
        target = goTarget;
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


