{ lib, ctx, normalizeList }:
let
  clean = label: lib.removePrefix "root//" label;
  nodesByName = builtins.listToAttrs (map (node: {
    name = clean (ctx.get node "name");
    value = node;
  }) ctx.nodes);
  nodeFor = name:
    if builtins.hasAttr (clean name) nodesByName then nodesByName.${clean name}
    else builtins.throw "Rust runtime_deps target is absent from graph: ${name}";
  visit = seen: queue:
    if queue == [] then [] else
    let
      name = clean (builtins.head queue);
      rest = builtins.tail queue;
      node = nodeFor name;
      nested = normalizeList "runtime_deps for ${name}" (ctx.get node "runtime_deps");
    in if builtins.hasAttr name seen then visit seen rest else
      [ name ] ++ visit (seen // { "${name}" = true; }) (rest ++ nested);
in roots:
  map ctx.dependencyArtifactOf (visit {} roots)
