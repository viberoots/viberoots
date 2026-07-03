{ lib }:
ctx:
let
  T = ctx.T;
  get = ctx.get;
  modulesTomlFor = ctx.modulesTomlFor;
  repoRoot = ctx.repoRoot;
  localModuleOverrides = ctx.localModuleOverrides;
  pkgPathOf = ctx.pkgPathOf;
  L = import ./lib.nix {
    inherit lib;
    get = ctx.get;
    nodes = (ctx.nodes or []);
    pkgPathOf = ctx.pkgPathOf;
  };
  kindConfigs = import ./kind-configs.nix;
  byName = L.byName;
  LC = import ./link-closure.nix { inherit lib; };
  GoWasm = import ./go-wasm.nix { inherit lib; };
  depsOfName = nm:
    let n = if builtins.hasAttr nm byName then byName.${nm} else null;
    in if n == null then [] else L.depsOf n;
  labelsOfName = nm:
    let n = if builtins.hasAttr nm byName then byName.${nm} else null;
    in if n == null then [] else L.labelsOf n;
  nodeOfName = nm:
    if builtins.hasAttr nm byName then byName.${nm}
    else builtins.throw "go planner: unknown node '${nm}' (missing from byName)";
  ensureStringList = ctxStr: xs:
    if xs == null then []
    else if builtins.isList xs && builtins.all (x: builtins.isString x) xs then xs
    else builtins.throw "go planner: expected ${ctxStr} to be a list of strings";
  ensureStringAttrs = ctxStr: x:
    if x == null then {}
    else if builtins.isAttrs x then x
    else builtins.throw "go planner: expected ${ctxStr} to be an attrset";
  normalizeLabelList = ctxStr: xs:
    builtins.map L.cleanLabel (ensureStringList ctxStr xs);
  normalizeOverrides = name: overridesRaw:
    let
      overrides0 = ensureStringAttrs "link_closure_overrides for '${name}'" overridesRaw;
      keys = builtins.attrNames overrides0;
      pairs = builtins.map (k: { name = L.cleanLabel k; value = overrides0.${k}; }) keys;
      _ = builtins.map (p:
        if builtins.isString p.value then true
        else builtins.throw "go planner: expected link_closure_overrides['${p.name}'] to be a string"
      ) pairs;
      names = builtins.map (p: p.name) pairs;
      uniqNames = builtins.attrNames (builtins.listToAttrs (builtins.map (n: { name = n; value = true; }) names));
      _dupes =
        if (builtins.length uniqNames) == (builtins.length names) then null
        else builtins.throw "go planner: normalized link_closure_overrides has duplicate keys for '${name}'";
    in builtins.listToAttrs pairs;
  dedupePreserveOrder = L.dedupePreserveOrder;
  nodeForSourcePlan = name: if builtins.hasAttr name byName then byName.${name} else {};
  collectNixCgoAttrsFor = name:
    let
      attrFrom = l: lib.removePrefix "nixpkg:" l;
      labels = L.collectLabelsWithPrefix name "nixpkg:";
      attrs = map attrFrom labels;
      uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
    in builtins.sort (a: b: a < b) (uniq attrs);
  resolveNixCgoPkgsFor = name: attrs:
    let
      records = ctx.resolveNixpkgAttrs {
        target = nodeForSourcePlan name;
        attrs = attrs;
      };
      missing = builtins.filter (r: r.package == null) records;
      missingText = builtins.concatStringsSep ", " (map (r: r.attr + " from " + r.profile_name) missing);
    in
      if missing == [] then map (r: r.package) records
      else builtins.throw (
        "go planner (cgo): unresolved nixpkg attrs for " + name + ": " + missingText
      );
  isCppNode = nm:
    let n = if builtins.hasAttr nm byName then byName.${nm} else null;
        rt0 = if n == null then null else (get n "rule_type");
        rt = if rt0 == null then "" else rt0;
        labs = labelsOfName nm;
    in (rt != null && (lib.hasPrefix "cxx_" rt || lib.hasInfix "cpp_nix_build" rt)) || (labs != null && builtins.elem "lang:cpp" labs);
  isCppLib = nm:
    let n = if builtins.hasAttr nm byName then byName.${nm} else null;
        rt0 = if n == null then null else (get n "rule_type");
        rt = if rt0 == null then "" else rt0;
        labs = labelsOfName nm;
    in (labs != null && builtins.elem "kind:lib" labs) || (rt == "cxx_library");
  isCgoEnabled = nm:
    let labs = labelsOfName nm;
    in labs != null && builtins.elem "cgo:enabled" labs;
  linkClosureRawFor = name:
    let
      n = nodeOfName name;
      raw0 = get n "link_closure";
      raw = if raw0 != null then raw0 else (get n "buck.link_closure");
    in if raw == null then null
       else if builtins.isString raw then raw
       else builtins.throw "go planner: expected link_closure for '${name}' to be a string";
  linkClosureOverridesRawFor = name:
    let
      n = nodeOfName name;
      raw0 = get n "link_closure_overrides";
    in if raw0 != null then raw0 else (get n "buck.link_closure_overrides");
  linkDepsOf = nm:
    let
      n = nodeOfName nm;
      raw0 = get n "link_deps";
      raw = if raw0 != null then raw0 else (get n "buck.link_deps");
      xs = normalizeLabelList "link_deps for '${nm}'" raw;
    in dedupePreserveOrder xs;
  ensureSupportedCgoProducer = consumer: dep:
    let
      expected = "lang:cpp, kind:lib";
      got = builtins.toString (labelsOfName dep);
      ok = (isCppNode dep && isCppLib dep);
    in if ok then dep
       else builtins.throw "go planner (cgo): ${consumer} link_closure dep '${dep}' is unsupported; expected labels ${expected}; got labels ${got}";
  repoCgoPkgsFor = name:
    let
      directDeps = depsOfName name;
      cppLibDeps = builtins.filter (dn: isCppNode dn && isCppLib dn) directDeps;
      roots = dedupePreserveOrder cppLibDeps;
      linkClosure = linkClosureRawFor name;
      overridesRaw = linkClosureOverridesRawFor name;
      overrides = normalizeOverrides name overridesRaw;
      overrideKeys = builtins.attrNames overrides;
      _overridesRequireClosure =
        if linkClosure == null && overrideKeys != [] then
          builtins.throw "go planner (cgo): link_closure_overrides requires link_closure for '${name}'"
        else null;
      _closureRequiresRoots =
        if linkClosure != null && roots == [] then
          builtins.throw "go planner (cgo): link_closure for '${name}' requires repo_cgo_deps (no C++ roots found)"
        else null;
      _closureRequiresCgo =
        if linkClosure != null && !(isCgoEnabled name) then
          builtins.throw "go planner (cgo): link_closure for '${name}' requires a cgo-enabled target"
        else null;
      missingOverrideKeys = builtins.filter (k: !(builtins.elem k roots)) overrideKeys;
      _overrideKeysValid =
        if missingOverrideKeys == [] then null
        else builtins.throw "go planner (cgo): link_closure_overrides for '${name}' contains keys not present in repo_cgo_deps: ${builtins.toString missingOverrideKeys}";
      resolved =
        if linkClosure == null then roots
        else LC.resolveLinkClosure {
          inherit byName;
          linkDepsOf = linkDepsOf;
          roots = roots;
          defaultClosure = linkClosure;
          overrides = overrides;
        };
      validated = builtins.map (dep: ensureSupportedCgoProducer name dep) resolved;
    in builtins.map (dn: T.cppLib { name = dn; srcRoot = repoRoot; subdir = (pkgPathOf dn); }) validated;
  wasm = GoWasm {
    inherit T get repoRoot pkgPathOf byName L LC normalizeLabelList normalizeOverrides;
    inherit dedupePreserveOrder labelsOfName nodeOfName;
  };
  patchDirsAbsFor = name:
    let
      srcs = L.srcsOf name;
      patchDirsLocalRel = builtins.sort (a: b: a < b) (
        builtins.attrNames (builtins.listToAttrs (
          map (p:
            let parts = lib.splitString "/" p;
                dir = if (builtins.length parts) > 1 then lib.concatStringsSep "/" (lib.init parts) else ".";
            in { name = dir; value = true; }
          ) (builtins.filter (s: lib.hasSuffix ".patch" s) srcs)
        ))
      );
    in map (d: builtins.toPath (repoRoot + "/" + (pkgPathOf name) + "/" + d)) patchDirsLocalRel;
  pkgPathForCArchive = name:
    let
      srcs = L.srcsOf name;
      goSrcs = builtins.filter (s: lib.hasSuffix ".go" s) srcs;
      dirs = builtins.map (s:
        let parts = lib.splitString "/" s;
        in if (builtins.length parts) > 1 then lib.concatStringsSep "/" (lib.init parts) else "."
      ) goSrcs;
      underPkg = builtins.filter (d: d == "pkg" || lib.hasPrefix "pkg/" d) dirs;
      pickLongest = ds:
        if ds == [] then null
        else builtins.head (builtins.sort (a: b: (builtins.stringLength a) > (builtins.stringLength b)) ds);
      chosen = if underPkg != [] then pickLongest underPkg else pickLongest dirs;
    in if chosen == null || chosen == "." then "."
       else if lib.hasPrefix "./" chosen then chosen
       else "./" + chosen;
  cgoArgsFor = name:
    let nixCgoAttrs = collectNixCgoAttrsFor name; in {
      nixCgoAttrs = [];
      nixCgoPkgs = resolveNixCgoPkgsFor name nixCgoAttrs;
      repoCgoPkgs = repoCgoPkgsFor name;
    };
in {
  isTarget = L.isTargetByRuleTypeOrLabel {
    ruleTypePrefixes = [ "go_" ];
    label = "lang:go";
  };
  kindOf = n:
    L.kindOf {
      labels = L.labelsOf n;
      ruleType = L.ruleTypeOf n;
      name = L.nameOf n;
      config = kindConfigs.go;
  };
  modulesFileFor = name: modulesTomlFor name;
  mkApp = name:
    T.goApp ({
      inherit name;
      modulesToml = modulesTomlFor name;
      devOverridesMap = localModuleOverrides;
      srcRoot = repoRoot;
      subdir = (pkgPathOf name);
      patchDirs = patchDirsAbsFor name;
    } // cgoArgsFor name);
  mkLib = name:
    T.goLib ({
      inherit name;
      modulesToml = modulesTomlFor name;
      srcRoot = repoRoot;
      subdir = (pkgPathOf name);
      patchDirs = patchDirsAbsFor name;
    } // cgoArgsFor name);
  mkTest = name:
    T.goTest ({
      inherit name;
      modulesToml = modulesTomlFor name;
      devOverridesMap = localModuleOverrides;
      srcRoot = repoRoot;
      subdir = (pkgPathOf name);
      patchDirs = patchDirsAbsFor name;
      srcList = L.srcsOf name;
    } // cgoArgsFor name);
  mkCArchive = name:
    T.goCArchive ({
      inherit name;
      modulesToml = modulesTomlFor name;
      srcRoot = repoRoot;
      subdir = (pkgPathOf name);
      pkgPath = pkgPathForCArchive name;
      patchDirs = patchDirsAbsFor name;
    } // cgoArgsFor name);
  mkTinyWasm = wasm.mkTinyWasm;
}
