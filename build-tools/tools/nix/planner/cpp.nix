{ lib }:
ctx:
let
  get = ctx.get;
  pkgPathOf = ctx.pkgPathOf;
  T = ctx.T;
  repoRoot = ctx.repoRoot;
  L = import ./lib.nix {
    inherit lib;
    get = ctx.get;
    nodes = (if builtins.hasAttr "nodes" ctx then ctx.nodes else []);
    pkgPathOf = ctx.pkgPathOf;
  };
  kindConfigs = import ./kind-configs.nix;
  cleanLabel = L.cleanLabel;
  hasLangCpp = n:
    let ls = labelsOf n; in builtins.elem "lang:cpp" ls;

  kindOf = n:
    L.kindOf {
      labels = labelsOf n;
      ruleType = L.ruleTypeOf n;
      name = nameOf n;
      config = kindConfigs.cpp;
    };

  nodes = if builtins.hasAttr "nodes" ctx then ctx.nodes else [];
  byName = L.byName;
  labelsOf = L.labelsOf;
  nameOf = L.nameOf;
  depsOf = L.depsOf;
  srcsOf = name: L.srcsOf name;
  normSrcsOf = name: srcsOf name;

  ensureStringList = ctx: xs:
    if xs == null then []
    else if builtins.isList xs && builtins.all (x: builtins.isString x) xs then xs
    else builtins.throw ("cpp planner: expected " + ctx + " to be a list of strings");

  nodeOfName = nm: if builtins.hasAttr nm byName then byName.${nm} else null;

  Helpers = import ./cpp-helpers.nix {
    inherit lib get cleanLabel ensureStringList nodeOfName kindOf labelsOf hasLangCpp;
    dedupePreserveOrder = L.dedupePreserveOrder;
    normSrcsOf = normSrcsOf;
    pkgPathOf = pkgPathOf;
    repoRoot = repoRoot;
  };

  LinkHelpers = import ./cpp-link-helpers.nix {
    inherit lib get cleanLabel ensureStringList nodeOfName;
  };

  repoGoCArchivesFor = import ./cpp-go-archives.nix {
    inherit lib L T byName srcsOf pkgPathOf;
    modulesTomlFor = ctx.modulesTomlFor;
    repoRoot = repoRoot;
  };

  labelsFromNodeAttr = Helpers.labelsFromNodeAttr;
  dedupePreserveOrder = Helpers.dedupePreserveOrder;
  ensureRepoCppLibDep = Helpers.ensureRepoCppLibDep;
  ensureRepoCppHeaderDepInfo = Helpers.ensureRepoCppHeaderDepInfo;
  patchInputsFor = Helpers.patchInputsFor;
  LC = import ./link-closure.nix { inherit lib; };
  normalizeLabelList = LinkHelpers.normalizeLabelList;
  normalizeOverrides = LinkHelpers.normalizeOverrides;
  linkModeOf = LinkHelpers.linkModeOf;

  Deps = import ./cpp-deps.nix {
    inherit lib get byName labelsFromNodeAttr dedupePreserveOrder ensureRepoCppLibDep;
    inherit ensureRepoCppHeaderDepInfo linkModeOf LC normalizeOverrides normalizeLabelList nodeOfName L;
  };

  providerAttrsFallback =
    (import ./cpp-provider-attrs-fallback.nix {
      inherit lib get nodes;
      cleanLabel = L.cleanLabel;
    }).providerAttrsFallback;

  collectNixAttrsFor = Deps.collectNixAttrsFor;
  nixAttrsFromSelf = Deps.nixAttrsFromSelf;
in
let
  Rec = rec {
    repoCppLibPkgsFor = name: builtins.map mkLib (Deps.resolveRepoCppLibDepsFor name);
    repoCppHeaderPkgsFor = name: builtins.map mkHeaders (Deps.resolveRepoCppHeaderDepsFor name);
    Targets = import ./cpp-targets.nix {
      inherit lib T byName labelsOf linkModeOf pkgPathOf repoRoot normSrcsOf patchInputsFor;
      inherit collectNixAttrsFor nixAttrsFromSelf repoCppHeaderPkgsFor repoCppLibPkgsFor;
      inherit repoGoCArchivesFor providerAttrsFallback;
      inherit (ctx) resolveNixpkgAttrs sourcePlanFor;
    };
    mkApp = Targets.mkApp;
    mkLib = Targets.mkLib;
    mkHeaders = Targets.mkHeaders;
    mkTest = Targets.mkTest;
    mkAddon = Targets.mkAddon;
  };
in {
  isTarget = L.isTargetByRuleTypeOrLabel {
    ruleTypePrefixes = [ "cxx_" ];
    ruleTypeInfixes = [ "cpp_nix_build" ];
    label = "lang:cpp";
  };
  inherit kindOf;
  inherit (Rec) mkApp mkLib mkHeaders mkTest mkAddon;
  modulesFileFor = name: "";
}
