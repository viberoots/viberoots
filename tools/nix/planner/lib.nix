{ lib, get ? (attrs: k: attrs.${k} or null), nodes ? [], pkgPathOf ? (name: ".") }:
/*
  tools/nix/planner/lib.nix — Shared helpers for language planners

  Keep this module tiny and pure. It provides small utilities that many
  planners end up re-writing: label normalization, basic attribute access,
  and convenience accessors over the exported Buck nodes set.
*/

let
  # Buck labels may contain a trailing config suffix like
  #   "//apps/demo:demo_gtest__planner (config//platforms:default#hash)"
  # Normalize by stripping the suffix for stable lookups.
  cleanLabel = s:
    let parts = lib.splitString " (config//" s; in
      if (builtins.length parts) > 1 then (builtins.elemAt parts 0) else s;

  labelsOf = n:
    let labs = (get n "labels"); in
      if labs == null then [] else (if builtins.isList labs then labs else []);

  nameOf = n:
    let nm = get n "name"; in if nm == null then "" else cleanLabel nm;

  depsRaw = n:
    let ds = (get n "deps"); in if ds == null then [] else (if builtins.isList ds then ds else []);

  depsOf = n: map cleanLabel (depsRaw n);

  # Index nodes by normalized name for quick lookup
  byName = builtins.listToAttrs (
    map (n:
      let nm = nameOf n; in { name = nm; value = n; }
    ) (builtins.filter (n: (get n "name") != null && (nameOf n) != "") nodes)
  );

  # Resolve Buck-provided src paths for a node name, relative to its package subdir.
  srcsOf = name:
    let
      n = if builtins.hasAttr name byName then byName.${name} else null;
      s = if n == null then [] else (get n "srcs");
      list = if s == null then [] else (if builtins.isList s then s else []);
      pkg = pkgPathOf name;
      dropCell = p: if lib.hasPrefix "root//" p then lib.removePrefix "root//" p else p;
      dropPkg = p: if lib.hasPrefix (pkg + "/") p then lib.removePrefix (pkg + "/") p else p;
    in map (p: dropPkg (dropCell p)) list;
in {
  inherit get cleanLabel labelsOf nameOf depsOf srcsOf byName;
  # Generic DFS label collector. Starting from `name`, walk transitive deps
  # and collect unique labels that start with `prefix`. Returns a sorted list
  # of full labels (including the prefix).
  collectLabelsWithPrefix = name: prefix:
    let
      start = if builtins.hasAttr name byName then byName.${name} else null;
      step = state: dn:
        if builtins.hasAttr dn state.seen then state else
        let key = cleanLabel dn;
            n = if builtins.hasAttr key byName then byName.${key} else null;
        in if n == null then state else
          let here = builtins.filter (l: lib.hasPrefix prefix l) (labelsOf n);
              nexts = depsOf n;
              seen' = state.seen // { "${dn}" = true; };
              labels' = state.labels ++ here;
          in builtins.foldl' step { seen = seen'; labels = labels'; } nexts;
      init = if start == null then { seen = {}; labels = []; } else step { seen = {}; labels = []; } name;
      uniq = xs: builtins.attrNames (builtins.listToAttrs (map (a: { name = a; value = true; }) xs));
    in builtins.sort (a: b: a < b) (uniq init.labels);
}


