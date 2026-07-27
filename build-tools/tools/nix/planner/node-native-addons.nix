{ lib, pkgs, dependencyArtifactOf, depsOfName, nodeOfName, labelsOf, get }:
let
  addonNameFor = name: node:
    let
      explicit = get node "addon_name";
      labels = labelsOf node;
      hints = map (lib.removePrefix "addon_name:")
        (builtins.filter (label: lib.hasPrefix "addon_name:" label) labels);
    in if builtins.isString explicit && explicit != "" then explicit
       else if hints != [] then builtins.head hints
       else lib.last (lib.splitString ":" name);
  collect = root:
    let
      go = seen: queue:
        if queue == [] then [] else
        let
          name = builtins.head queue;
          rest = builtins.tail queue;
          node = nodeOfName name;
          labels = if node == null then [] else labelsOf node;
          next = if node == null then [] else depsOfName name;
          isAddon = builtins.elem "kind:addon" labels
            && (builtins.elem "lang:rust" labels || builtins.elem "lang:cpp" labels);
        in if builtins.hasAttr name seen then go seen rest else
          (lib.optionals isAddon [{
            inherit name;
            addonName = addonNameFor name node;
            artifact = dependencyArtifactOf name;
          }]) ++ go (seen // { "${name}" = true; }) (rest ++ next);
    in go {} (depsOfName root);
  validate = addons:
    let
      names = map (addon: addon.addonName) addons;
      unique = lib.unique names;
      invalid = builtins.filter
        (name: builtins.match "[A-Za-z_][A-Za-z0-9_-]*" name == null)
        names;
    in if invalid != [] then builtins.throw
      "node native addon staging requires names matching [A-Za-z_][A-Za-z0-9_-]*: ${builtins.toJSON invalid}"
    else if builtins.length names != builtins.length unique then builtins.throw
      "node native addon staging requires unique stable addon names; duplicates: ${builtins.toJSON names}"
    else addons;
in {
  forTarget = root: validate (collect root);
  packages = addons: map (addon: addon.artifact) (validate addons);
  stage = addons: destination: lib.concatMapStringsSep "\n" (addon: ''
    mkdir -p "${destination}"
    shopt -s nullglob
    addon_candidates=("${addon.artifact}/lib/"*.node)
    if [ "''${#addon_candidates[@]}" -ne 1 ]; then
      echo "node native addon ${addon.name}: expected exactly one .node artifact" >&2
      exit 2
    fi
    install -m0755 "''${addon_candidates[0]}" "${destination}/"${lib.escapeShellArg "${addon.addonName}.node"}
    if [ -d "${addon.artifact}/lib/runtime" ]; then
      mkdir -p "${destination}/runtime"
      while IFS= read -r -d "" runtime_source; do
        runtime_name="$(basename "$runtime_source")"
        runtime_destination="${destination}/runtime/$runtime_name"
        if [ -e "$runtime_destination" ]; then
          if ! ${pkgs.diffutils}/bin/cmp -s "$runtime_source" "$runtime_destination"; then
            echo "node native addon runtime library collision for $runtime_name while staging ${addon.name}" >&2
            exit 2
          fi
        else
          cp -P "$runtime_source" "$runtime_destination"
        fi
      done < <(find "${addon.artifact}/lib/runtime" -maxdepth 1 \
        \( -type f -o -type l \) -print0 | sort -z)
    fi
  '') (validate addons);
}
