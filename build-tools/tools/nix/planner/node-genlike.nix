{ pkgs, H, repoStoreRoot, artifactToolsRoot, declaredArtifactToolsRoot, artifactToolsInput, evaluationGraphPath, dependencyArtifactOf, lockInfoOfName, nodeOfName, get, srcsOf, targetNameOf }:
{ name, kind }:
let
  pnpm11 = import ../pnpm-11.nix { inherit pkgs; };
  info = lockInfoOfName name;
  n = nodeOfName name;
  declaredCmd =
    let v = if n == null then null else get n "cmd";
    in if builtins.isString v && v != "" then v else "";
  outRel =
    let v = if n == null then null else get n "out";
        fallback = targetNameOf name;
    in if builtins.isString v && v != "" then v else fallback;
  srcs = srcsOf name;
  stampedControlInputs = map H.normalizeTargetLabel (
    let v = if n == null then [ ] else get n "labels";
    in if builtins.isList v then v else [ ]
  );
  targetSrcs = builtins.filter (source:
    builtins.isString source
    && pkgs.lib.hasPrefix "//" source
    && pkgs.lib.hasInfix ":" source
    && !(builtins.elem (H.normalizeTargetLabel source) stampedControlInputs)
    && pkgs.lib.hasInfix "$(location ${source})" declaredCmd
  ) srcs;
  targetArtifacts = map (source: {
    label = source;
    artifact = dependencyArtifactOf source;
  }) targetSrcs;
  requiresArtifactTools = pkgs.lib.hasInfix "VBR_ARTIFACT_TOOLS_ROOT" declaredCmd;
  artifactToolsInputs =
    if !requiresArtifactTools then [ ]
    else if artifactToolsInput == null || artifactToolsRoot == null || declaredArtifactToolsRoot == "" || evaluationGraphPath == null then
      builtins.throw "node planner: artifact command is missing its declared tool closure input for ${name}"
    else if !(pkgs.lib.hasInfix declaredArtifactToolsRoot declaredCmd) then
      builtins.throw "node planner: artifact command tool closure does not match the evaluation bundle for ${name}"
    else [ artifactToolsInput ];
  cmdWithTools =
    if requiresArtifactTools
    then builtins.replaceStrings [ declaredArtifactToolsRoot ] [ (builtins.toString artifactToolsRoot) ] declaredCmd
    else declaredCmd;
  cmd = builtins.foldl' (current: source:
    builtins.replaceStrings
      [ "$(location ${source.label})" ]
      [ (builtins.toString source.artifact) ]
      current
  ) cmdWithTools targetArtifacts;
  cmdEscaped = pkgs.lib.escapeShellArg cmd;
  outEscaped = pkgs.lib.escapeShellArg outRel;
  buildOutEscaped = pkgs.lib.escapeShellArg (".vbr-out/" + outRel);
  resolvedSrcs = map (source:
    let matches = builtins.filter (entry: entry.label == source) targetArtifacts;
    in if matches == [] then source else builtins.toString (builtins.head matches).artifact
  ) srcs;
  srcsEscaped = pkgs.lib.escapeShellArg (pkgs.lib.concatStringsSep " " resolvedSrcs);
  kindBin = kind == "bin";
  sanitize = H.sanitizeName;
in
  if cmd == "" then builtins.throw "node planner: missing genrule cmd for ${name}"
  else pkgs.stdenvNoCC.mkDerivation ({
    pname = "node-${kind}-" + (sanitize name);
    version = sanitize info.importer;
    src = repoStoreRoot;
    nativeBuildInputs =
      [ pkgs.bash pkgs.coreutils pkgs.nodejs_22 pnpm11 ]
      ++ artifactToolsInputs
      ++ map (source: source.artifact) targetArtifacts;
    buildPhase = ''
      set -euo pipefail
      ${if requiresArtifactTools then ''
        mkdir -p .viberoots/workspace/buck
        cp ${evaluationGraphPath} .viberoots/workspace/buck/graph.json
      '' else ""}
      cd ${info.importer}
      tmpOut="$PWD/.vbr-out/${outRel}"
      mkdir -p "$(dirname "$tmpOut")"
      export OUT=${buildOutEscaped}
      export SRCS=${srcsEscaped}
      export SRCDIR="$PWD"
      export TMPDIR="$PWD/.tmp"
      mkdir -p "$TMPDIR"
      ${pkgs.bash}/bin/bash -euo pipefail -c ${cmdEscaped}
      if [ ! -e "$tmpOut" ]; then
        echo "node planner: command did not produce expected output path: ${outRel}" >&2
        exit 2
      fi
    '';
    installPhase = ''
      set -euo pipefail
      outRel=${outEscaped}
      srcPath="$PWD/.vbr-out/$outRel"
      mkdir -p "$out/$(dirname "$outRel")"
      if [ -d "$srcPath" ]; then
        cp -R "$srcPath" "$out/$outRel"
      else
        cp "$srcPath" "$out/$outRel"
      fi
      ${if kindBin then ''
        base="$(basename "$outRel")"
        mkdir -p "$out/bin"
        cp "$out/$outRel" "$out/bin/$base"
        chmod +x "$out/bin/$base" || true
      '' else ""}
    '';
  })
