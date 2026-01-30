{ lib, ctx }:
let
  T = ctx.T;
  get = ctx.get;
  repoRoot = ctx.repoRoot;
  pkgPathOf = ctx.pkgPathOf;
  L = import ./lib.nix {
    inherit lib;
    get = ctx.get;
    nodes = (ctx.nodes or []);
    pkgPathOf = ctx.pkgPathOf;
  };

  labelsOf = L.labelsOf;
  nameOf = L.nameOf;
  byName = L.byName;
  srcsOf = name: L.srcsOf name;

  depsOfName = nm:
    let
      _byNameOk =
        if builtins.isAttrs byName then null
        else builtins.throw "python planner: internal error: byName is not an attrset";
      n = if builtins.hasAttr nm byName then byName.${nm} else null;
      _nodeOk =
        if n != null && !(builtins.isAttrs n)
        then builtins.throw ("python planner: internal error: node value for '" + nm + "' is not an attrset")
        else null;
    in if n == null then [] else L.depsOf n;

  labelsOfName = nm:
    let
      _byNameOk =
        if builtins.isAttrs byName then null
        else builtins.throw "python planner: internal error: byName is not an attrset";
      n = if builtins.hasAttr nm byName then byName.${nm} else null;
      _nodeOk =
        if n != null && !(builtins.isAttrs n)
        then builtins.throw ("python planner: internal error: node value for '" + nm + "' is not an attrset")
        else null;
    in if n == null then [] else L.labelsOf n;

  lockfileFor = name:
    let
      pkgRel = pkgPathOf name;
      split = lib.splitString "/" pkgRel;
      segments = if (builtins.length split) == 0 then [] else split;
      descend = idx:
        if idx < 0 then null else
        let rel = lib.concatStringsSep "/" (lib.take (idx + 1) segments);
            cand = builtins.toPath (repoRoot + "/" + rel + "/uv.lock");
        in if builtins.pathExists cand then cand else descend (idx - 1);
      nearest = if (builtins.length segments) > 0 then descend ((builtins.length segments) - 1) else null;
    in if nearest != null then nearest
       else builtins.throw ("uv.lock missing for target " + name + "; expected at or above " + (repoRoot + "/" + pkgRel));

  lockRelFor = name:
    let abs = lockfileFor name; absStr = builtins.toString abs; rootStr = builtins.toString repoRoot;
    in if lib.hasPrefix (rootStr + "/") absStr then lib.removePrefix (rootStr + "/") absStr else absStr;

  ensureString = ctxStr: x:
    if x == null then ""
    else if builtins.isString x then x
    else builtins.throw ("python planner: expected " + ctxStr + " to be a string");

  ensureStringList = ctxStr: xs:
    if xs == null then []
    else if builtins.isList xs && builtins.all builtins.isString xs then xs
    else builtins.throw ("python planner: expected " + ctxStr + " to be a list of strings");

  ensureStringAttrs = ctxStr: x:
    if x == null then {}
    else if builtins.isAttrs x then x
    else builtins.throw ("python planner: expected " + ctxStr + " to be an attrset");

  nodeOfName = nm:
    if builtins.hasAttr nm byName then byName.${nm} else null;

  dedupePreserveOrder = xs:
    let
      step = st: x:
        if builtins.hasAttr x st.seen then st else { seen = st.seen // { "${x}" = true; }; out = st.out ++ [ x ]; };
      st0 = { seen = {}; out = []; };
    in (builtins.foldl' step st0 xs).out;

  cleanLabel = L.cleanLabel;

  normalizeLabelList = ctxStr: xs:
    builtins.map cleanLabel (dedupePreserveOrder (ensureStringList ctxStr xs));

  normalizeOverrides = name: overridesRaw:
    let
      overrides0 = ensureStringAttrs ("link_closure_overrides for " + name) overridesRaw;
      keys = builtins.attrNames overrides0;
      pairs = builtins.map (k: { name = cleanLabel k; value = overrides0.${k}; }) keys;
      _ = builtins.map (p:
        if builtins.isString p.value then true
        else builtins.throw ("python planner: expected link_closure_overrides['" + p.name + "'] to be a string")
      ) pairs;
      names = builtins.map (p: p.name) pairs;
      uniqNames = builtins.attrNames (builtins.listToAttrs (builtins.map (n: { name = n; value = true; }) names));
      _dupes =
        if (builtins.length uniqNames) == (builtins.length names) then null
        else builtins.throw ("python planner: normalized link_closure_overrides has duplicate keys for " + name);
    in builtins.listToAttrs pairs;

  isTarget = n:
    L.isTargetByRuleTypeOrLabel {
      ruleTypePrefixes = [ "python_" ];
      label = "lang:python";
    } n;

  kindOf = n:
    let
      labels = L.labelsOf n;
      ruleType = L.ruleTypeOf n;
      preRule = L.kindFromLabels labels [
        { label = "kind:wasm"; kind = "wasm"; }
        { label = "kind:pyext_wasm"; kind = "pyext_wasm"; }
        { label = "kind:pyext"; kind = "pyext"; }
        { label = "kind:test"; kind = "test"; }
      ];
      fromRule = L.kindFromRuleType ruleType {
        suffixes = [
          { suffix = "_binary"; kind = "bin"; }
          { suffix = "_test"; kind = "test"; }
        ];
      };
      postRule = L.kindFromLabels labels [ { label = "kind:bin"; kind = "bin"; } ];
    in if preRule != null then preRule
       else if fromRule != null then fromRule
       else if postRule != null then postRule
       else "lib";

  modulesFileFor = name: lockRelFor name;
in {
  inherit T get repoRoot pkgPathOf L;
  inherit labelsOf nameOf byName srcsOf depsOfName labelsOfName;
  inherit lockfileFor lockRelFor modulesFileFor;
  inherit ensureString ensureStringList ensureStringAttrs;
  inherit nodeOfName dedupePreserveOrder cleanLabel normalizeLabelList normalizeOverrides;
  inherit isTarget kindOf;
}
