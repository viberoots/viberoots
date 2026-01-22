{ lib
, get
, cleanLabel
, ensureStringList
, nodeOfName
}:
let
  ensureStringAttrs = ctxStr: x:
    if x == null then {}
    else if builtins.isAttrs x then x
    else builtins.throw ("cpp planner: expected " + ctxStr + " to be an attrset");

  normalizeLabelList = ctxStr: xs:
    builtins.map cleanLabel (ensureStringList ctxStr xs);

  normalizeOverrides = name: overridesRaw:
    let
      overrides0 = ensureStringAttrs ("link_closure_overrides for " + name) overridesRaw;
      keys = builtins.attrNames overrides0;
      pairs = builtins.map (k: { name = cleanLabel k; value = overrides0.${k}; }) keys;
      _ = builtins.map (p:
        if builtins.isString p.value then true
        else builtins.throw ("cpp planner: expected link_closure_overrides['" + p.name + "'] to be a string")
      ) pairs;
      names = builtins.map (p: p.name) pairs;
      uniqNames = builtins.attrNames (builtins.listToAttrs (builtins.map (n: { name = n; value = true; }) names));
      _dupes =
        if (builtins.length uniqNames) == (builtins.length names) then null
        else builtins.throw ("cpp planner: normalized link_closure_overrides has duplicate keys for " + name);
    in builtins.listToAttrs pairs;

  normalizeLinkMode = name: raw:
    let
      mode =
        if raw == null then "static"
        else if builtins.isString raw then raw
        else builtins.throw ("cpp planner: expected link_mode for " + name + " to be a string");
    in if mode == "static" || mode == "shared" then mode
       else builtins.throw ("cpp planner: invalid link_mode for " + name + ": " + mode + " (expected \"static\" or \"shared\")");

  linkModeOf = nm:
    let
      n = nodeOfName nm;
      raw0 = if n == null then null else get n "link_mode";
      raw1 = if raw0 != null then raw0 else (if n == null then null else get n "buck.link_mode");
      raw2 = if raw1 != null then raw1 else (if n == null then null else get n "link_kind");
      raw = if raw2 != null then raw2 else (if n == null then null else get n "buck.link_kind");
    in normalizeLinkMode nm raw;
in {
  inherit normalizeLabelList normalizeOverrides linkModeOf;
}
