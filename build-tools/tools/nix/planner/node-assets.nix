{ lib, pkgs, H, repoStoreRoot, importerDir, dependencyArtifactOf, name, labels, viberootsStoreRoot }:
let
  prefix = "node-asset-v5|";
  assetLabels = builtins.filter (label: lib.hasPrefix prefix label) labels;
  rawLabelPath = root: source: sourcePath:
    if sourcePath == "" || lib.hasPrefix "/" sourcePath ||
       builtins.elem ".." (lib.splitString "/" sourcePath)
    then builtins.throw "node planner: labeled raw-file asset lacks a contained provider source_path on ${name}: ${source}"
    else builtins.toPath "${root}/${sourcePath}";
  parse = label:
    let
      fields = lib.splitString "|" (lib.removePrefix prefix label);
      field = index:
        if builtins.length fields > index then builtins.elemAt fields index else "";
      source = field 0;
      destination = field 1;
      kind = field 4;
      sourcePath = field 5;
      outputPath = field 6;
      isWasm = kind == "wasm";
      isViberootsSource = lib.hasPrefix "@viberoots//" source;
      isOtherCellSource = lib.hasPrefix "@" source && !isViberootsSource;
      isSameCellLabel = lib.hasPrefix "//" source;
      artifact =
        if isOtherCellSource
        then builtins.throw "node planner: unsupported asset cell label on ${name}: ${source}"
        else if isWasm && isSameCellLabel
        then dependencyArtifactOf (H.normalizeTargetLabel source)
        else if isWasm && isViberootsSource
        then builtins.throw "node planner: cross-cell wasm assets require a typed dependency artifact on ${name}: ${source}"
        else if isSameCellLabel && sourcePath != ""
        then rawLabelPath repoStoreRoot source sourcePath
        else if isSameCellLabel
        then
          let dependencyArtifact = dependencyArtifactOf (H.normalizeTargetLabel source);
          in if dependencyArtifact == null || outputPath == "" ||
                lib.hasPrefix "/" outputPath || builtins.elem ".." (lib.splitString "/" outputPath)
             then builtins.throw "node planner: generated file asset lacks a contained output_path on ${name}: ${source}"
             else builtins.toPath "${dependencyArtifact}/${outputPath}"
        else if isViberootsSource
        then rawLabelPath viberootsStoreRoot source sourcePath
        else builtins.toPath "${repoStoreRoot}/${importerDir}/${source}";
    in if builtins.length fields != 8 || source == "" || destination == "" ||
          !(builtins.elem kind [ "file" "wasm" ])
       then builtins.throw "node planner: malformed node_asset_stage metadata on ${name}: ${label}"
       else if lib.hasPrefix "/" destination || builtins.elem ".." (lib.splitString "/" destination)
       then builtins.throw "node planner: asset destination escapes staged output on ${name}: ${destination}"
       else if artifact == null
       then builtins.throw "node planner: missing dependency artifact for ${source} on ${name}"
       else {
         inherit source destination artifact isWasm;
         artifactName = field 2;
         artifactGlob = field 3;
       };
  stage = asset: ''
    asset_root=${lib.escapeShellArg (builtins.toString asset.artifact)}
    asset_matches="$TMPDIR/node-asset-matches"
    : > "$asset_matches"
    ${if asset.isWasm then ''
      ${pkgs.findutils}/bin/find "$asset_root" -type f -name ${lib.escapeShellArg (
        if asset.artifactName != "" then asset.artifactName
        else if asset.artifactGlob != "" then asset.artifactGlob
        else "*.wasm"
      )} -print | LC_ALL=C sort > "$asset_matches"
    '' else ''
      test -f "$asset_root" ||
        { echo "node planner: raw asset ${asset.source} is not a file" >&2; exit 2; }
      printf '%s\n' "$asset_root" > "$asset_matches"
    ''}
    asset_count="$(wc -l < "$asset_matches" | tr -d '[:space:]')"
    test "$asset_count" = 1 || {
      echo "node planner: asset ${asset.source} expected exactly one reviewed artifact; found $asset_count" >&2
      cat "$asset_matches" >&2
      exit 2
    }
    IFS= read -r asset_source < "$asset_matches"
    ${lib.optionalString asset.isWasm ''
      case "$asset_source" in *.wasm) ;;
        *) echo "node planner: resolved asset has the wrong file type: $asset_source" >&2; exit 2 ;;
      esac
      asset_magic="$(LC_ALL=C od -An -tx1 -N4 "$asset_source" 2>/dev/null | tr -d '[:space:]')"
      test "$asset_magic" = "0061736d" ||
        { echo "node planner: resolved asset is invalid WebAssembly: $asset_source" >&2; exit 2; }
    ''}
    asset_destination="dist/${asset.destination}"
    asset_dist_root="$(${pkgs.coreutils}/bin/realpath -m dist)"
    asset_destination_real="$(${pkgs.coreutils}/bin/realpath -m "$asset_destination")"
    case "$asset_destination_real" in
      "$asset_dist_root"/*) ;;
      *) echo "node planner: asset destination escaped dist: ${asset.destination}" >&2; exit 2 ;;
    esac
    test ! -e "$asset_destination" ||
      { echo "node planner: asset destination collision: ${asset.destination}" >&2; exit 2; }
    mkdir -p "$(dirname "$asset_destination")"
    cp -f "$asset_source" "$asset_destination"
  '';
in lib.concatMapStringsSep "\n" stage (map parse assetLabels)
