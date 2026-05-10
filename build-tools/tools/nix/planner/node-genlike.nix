{ pkgs, H, repoStoreRoot, lockInfoOfName, nodeOfName, get, srcsOf, targetNameOf }:
{ name, kind }:
let
  info = lockInfoOfName name;
  n = nodeOfName name;
  cmd =
    let v = if n == null then null else get n "cmd";
    in if builtins.isString v && v != "" then v else "";
  outRel =
    let v = if n == null then null else get n "out";
        fallback = targetNameOf name;
    in if builtins.isString v && v != "" then v else fallback;
  srcs = srcsOf name;
  cmdEscaped = pkgs.lib.escapeShellArg cmd;
  outEscaped = pkgs.lib.escapeShellArg outRel;
  srcsEscaped = pkgs.lib.escapeShellArg (pkgs.lib.concatStringsSep " " srcs);
  kindBin = kind == "bin";
  sanitize = H.sanitizeName;
in
  if cmd == "" then builtins.throw "node planner: missing genrule cmd for ${name}"
  else pkgs.stdenvNoCC.mkDerivation ({
    pname = "node-${kind}-" + (sanitize name);
    version = sanitize info.importer;
    src = repoStoreRoot;
    nativeBuildInputs = [ pkgs.bash pkgs.coreutils pkgs.nodejs_22 pkgs.pnpm ];
    buildPhase = ''
      set -euo pipefail
      cd ${info.importer}
      tmpOut="$PWD/.vbr-out/${outRel}"
      mkdir -p "$(dirname "$tmpOut")"
      export OUT="$tmpOut"
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
  } // H.darwinBashrcSandboxProfileAttrs)
