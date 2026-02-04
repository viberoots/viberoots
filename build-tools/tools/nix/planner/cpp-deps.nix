{ lib
, get
, byName
, labelsFromNodeAttr
, dedupePreserveOrder
, ensureRepoCppLibDep
, ensureRepoCppHeaderDepInfo
, linkModeOf
, LC
, normalizeOverrides
, normalizeLabelList
, nodeOfName
, L
}:
let
  resolveRepoCppLibDepsFor = name:
    let
      consumer = nodeOfName name;
      linkDeps0 = labelsFromNodeAttr { inherit name; attr = "link_deps"; };
      linkDeps = dedupePreserveOrder linkDeps0;
      consumerLinkMode = linkModeOf name;
      defaultClosure =
        let raw = if consumer == null then null else get consumer "link_closure";
        in if raw == null then "direct"
           else if builtins.isString raw then raw
           else builtins.throw ("cpp planner: expected link_closure for " + name + " to be a string");
      overridesRaw = if consumer == null then null else get consumer "link_closure_overrides";
      overrides0 = normalizeOverrides name overridesRaw;
      overrideKeys = builtins.attrNames overrides0;
      missingOverrideKeys = builtins.filter (k: !(builtins.elem k linkDeps)) overrideKeys;
      _overrideKeysValid =
        if missingOverrideKeys == [] then null
        else builtins.throw ("cpp planner: link_closure_overrides for " + name + " contains keys not present in link_deps: " + (builtins.toString missingOverrideKeys));

      linkDepsOf = nm:
        let
          n = nodeOfName nm;
          raw = if n == null then null else get n "link_deps";
          xs = normalizeLabelList ("link_deps for " + nm) raw;
        in dedupePreserveOrder xs;

      resolved = LC.resolveLinkClosure {
        inherit byName;
        linkDepsOf = linkDepsOf;
        roots = linkDeps;
        defaultClosure = defaultClosure;
        overrides = overrides0;
      };

      ensureSharedLinkDep = consumerName: depName:
        let mode = linkModeOf depName; in
          if mode == "shared" then depName
          else builtins.throw ("cpp planner: link_mode=shared for " + consumerName + " requires shared producer " + depName + " (expected link_mode=\"shared\" on the dep)");
      enforceLinkMode =
        if consumerLinkMode == "shared"
        then builtins.map (dn: ensureSharedLinkDep name dn) resolved
        else resolved;
      validated = builtins.map (dn: ensureRepoCppLibDep name dn) enforceLinkMode;
    in validated;

  resolveRepoCppHeaderDepsFor = name:
    let
      headerDeps0 = labelsFromNodeAttr { inherit name; attr = "header_deps"; };
      headerDeps = dedupePreserveOrder headerDeps0;
      infos = builtins.map (dn: ensureRepoCppHeaderDepInfo name dn) headerDeps;
    in builtins.map (info: info.name) infos;

  isNixLabel = l: lib.hasPrefix "nixpkg:" l;
  attrFrom = l: lib.removePrefix "nixpkg:" l;

  collectNixAttrsFor = name:
    let
      labels = L.collectLabelsWithPrefix name "nixpkg:";
      attrs = map attrFrom labels;
      uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
    in builtins.sort (a: b: a < b) (uniq attrs);

  nixAttrsFromSelf = name:
    let n = if builtins.hasAttr name byName then byName.${name} else null; in
      if n == null then [] else (map attrFrom (builtins.filter isNixLabel (L.labelsOf n)));
in {
  inherit resolveRepoCppLibDepsFor resolveRepoCppHeaderDepsFor collectNixAttrsFor nixAttrsFromSelf;
}
