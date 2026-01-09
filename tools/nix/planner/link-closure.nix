{ lib }:
/*
  tools/nix/planner/link-closure.nix — shared, pure link-closure resolver

  This is a planner-level primitive for computing a deterministic link closure over
  a link graph (follow link_deps edges; not general deps).
*/

let
  isMode = m: m == "direct" || m == "transitive";

  ensureMode = ctx: mode:
    if isMode mode then mode
    else builtins.throw "resolveLinkClosure: unknown closure mode '${toString mode}' for ${ctx}; expected 'direct' or 'transitive'";

  ensureStringList = ctx: xs:
    if xs == null then []
    else if builtins.isList xs && builtins.all (x: builtins.isString x) xs then xs
    else builtins.throw "resolveLinkClosure: expected ${ctx} to be a list of strings";

  ensureKnownNode = byName: name:
    if builtins.hasAttr name byName then true
    else builtins.throw "resolveLinkClosure: unknown node '${name}' (missing from byName)";

  modeFor = defaultClosure: overrides: name:
    let raw = overrides.${name} or defaultClosure;
    in ensureMode "node '${name}'" raw;

  # Deterministic, stable-order DFS:
  # - visit roots in order
  # - for transitive nodes, visit link deps in order
  # - include each node at most once (first occurrence wins)
  dfs = { byName, linkDepsOf, defaultClosure, overrides, roots }:
    let
      loop = state: queue:
        if queue == [] then state.out
        else
          let
            head = builtins.head queue;
            tail = builtins.tail queue;
            name = head.name;
            mode = head.mode;
          in
            if builtins.hasAttr name state.seen then
              loop state tail
            else
              let
                _ = ensureKnownNode byName name;
                seen' = state.seen // { "${name}" = true; };
                out' = state.out ++ [ name ];
                nextNames =
                  if mode == "transitive"
                  then
                    let
                      depsRaw = linkDepsOf name;
                      deps = ensureStringList "linkDepsOf('${name}')" depsRaw;
                      _known = builtins.map (dn: ensureKnownNode byName dn) deps;
                    in deps
                  else [];
                nextQueue = builtins.map (dn: { name = dn; mode = modeFor defaultClosure overrides dn; }) nextNames;
              in loop { seen = seen'; out = out'; } (nextQueue ++ tail);
      startQueue = builtins.map (r: { name = r; mode = modeFor defaultClosure overrides r; }) roots;
    in loop { seen = {}; out = []; } startQueue;
in {
  resolveLinkClosure =
    { byName
    , linkDepsOf
    , roots
    , defaultClosure ? "direct"
    , overrides ? {}
    }:
    let
      defaultClosureChecked = ensureMode "defaultClosure" defaultClosure;
      rootsChecked = ensureStringList "roots" roots;
      overrideKeys = builtins.attrNames overrides;
      overrideModesChecked = builtins.map (k: ensureMode "override for '${k}'" (overrides.${k})) overrideKeys;
      out = dfs {
        inherit byName linkDepsOf overrides;
        defaultClosure = defaultClosureChecked;
        roots = rootsChecked;
      };
    in builtins.seq overrideModesChecked out;
}


