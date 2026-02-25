{ lib }:
ctx:
let
  L = import ./lib.nix {
    inherit lib;
    get = ctx.get;
    nodes = (if builtins.hasAttr "nodes" ctx then ctx.nodes else []);
    pkgPathOf = ctx.pkgPathOf;
  };
  kindConfigs = import ./kind-configs.nix;
  get = ctx.get;
  pkgs = ctx.pkgs or null;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };
  repoRoot = ctx.repoRoot;
  repoSnapshot = ctx.repoSnapshot or repoRoot;
  repoStoreRoot = ctx.repoStoreRoot or repoSnapshot;
  sharedNodeMods = ctx.nodeMods or null;
  labelsOf = L.labelsOf;
  nameOf = L.nameOf;
  byName = L.byName;
  srcsOf = L.srcsOf;
  parseLock = L.parseImporterScopedLockfileLabel;
  extractLocks = L.extractLockfileLabels;
  lockInfoOfName = name:
    let
      n = if builtins.hasAttr name byName then byName.${name} else null;
      labs = if n == null then [] else labelsOf n;
      locks = extractLocks labs;
    in
      if locks == [] then
        builtins.throw "node planner: missing importer-scoped lockfile label (lockfile:<path>#<importer>) on ${name}"
      else if (builtins.length locks) != 1 then
        builtins.throw "node planner: expected exactly one lockfile:<path>#<importer> label on ${name}; got: ${builtins.toJSON locks}"
      else
        parseLock (builtins.head locks);
  targetNameOf = n:
    let parts = lib.splitString ":" n; in
      if (builtins.length parts) > 1 then builtins.elemAt parts 1
      else (lib.baseNameOf (ctx.pkgPathOf n));
  nodeOfName = name:
    if builtins.hasAttr name byName then byName.${name} else null;
  attrStringOr = n: key: fallback:
    let v = if n == null then null else get n key;
    in if builtins.isString v && v != "" then v else fallback;
  isWebappLike = n:
    let
      rt = attrStringOr n "rule_type" "";
      cmd = attrStringOr n "cmd" "";
      labs = labelsOf n;
    in
      builtins.elem "webapp:static" labs ||
      builtins.elem "webapp:ssr" labs ||
      rt == "node_webapp" ||
      lib.hasInfix "node-webapp." cmd ||
      lib.hasInfix "--attr \"node-webapp." cmd ||
      lib.hasInfix "--attr node-webapp." cmd;
  mkGenLike = import ./node-genlike.nix {
    inherit pkgs H repoStoreRoot lockInfoOfName nodeOfName get srcsOf targetNameOf;
  };
in {
  isTarget = n:
    let labs = labelsOf n;
    in (builtins.elem "lang:node" labs);
  kindOf = n:
    let
      k = L.kindOf {
        labels = labelsOf n;
        ruleType = L.ruleTypeOf n;
        name = L.nameOf n;
        config = kindConfigs.node;
      };
    in
      if k == "app" && isWebappLike n then "webapp" else k;
  modulesFileFor = name: ctx.modulesTomlFor name;
  mkApp = name: import ./node-app.nix {
    inherit pkgs H repoStoreRoot sharedNodeMods lockInfoOfName targetNameOf name;
  };
  mkGen = name: mkGenLike { inherit name; kind = "gen"; };
  mkLib = name: mkGenLike { inherit name; kind = "lib"; };
  mkBin = name: mkGenLike { inherit name; kind = "bin"; };
  mkWebapp = name: import ./node-webapp.nix {
    inherit pkgs H repoStoreRoot sharedNodeMods lockInfoOfName nodeOfName labelsOf name;
    frameworkMissingError =
      "node planner: SSR webapp target ${name} missing framework label (framework:express|framework:next|framework:vite)";
  };
}
