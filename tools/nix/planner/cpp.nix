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
  cleanLabel = L.cleanLabel;
  hasLangCpp = n:
    let ls = labelsOf n; in builtins.elem "lang:cpp" ls;

  kindOf = n:
    let
      rt = L.ruleTypeOf n;
      labs = labelsOf n;
      nm = nameOf n;
      isPlanner = (nm != null) && (lib.hasSuffix "__planner" nm);
      fromLabels = L.kindFromLabels labs [
        { label = "kind:test"; kind = "test"; }
        { label = "kind:bin"; kind = "bin"; }
        { label = "kind:headers"; kind = "headers"; }
        { label = "kind:lib"; kind = "lib"; }
        { label = "kind:addon"; kind = "addon"; }
      ];
      fromRule = L.kindFromRuleType rt {
        equals = [
          { ruleType = "cxx_test"; kind = "test"; }
          { ruleType = "cxx_binary"; kind = "bin"; }
          { ruleType = "cxx_library"; kind = "lib"; }
        ];
      };
    in if isPlanner then "test"
      else if fromLabels != null then fromLabels
      else fromRule;

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

  Phase1 = import ./cpp-phase1-helpers.nix {
    inherit lib get cleanLabel ensureStringList nodeOfName kindOf labelsOf hasLangCpp;
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

  labelsFromNodeAttr = Phase1.labelsFromNodeAttr;
  dedupePreserveOrder = Phase1.dedupePreserveOrder;
  ensureRepoCppLibDep = Phase1.ensureRepoCppLibDep;
  ensureRepoCppHeaderDepInfo = Phase1.ensureRepoCppHeaderDepInfo;
  patchInputsFor = Phase1.patchInputsFor;
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
