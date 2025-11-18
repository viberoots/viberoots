{ lib }:
ctx:
let
  # Shared helpers
  L = import ./lib.nix {
    inherit lib;
    get = ctx.get;
    nodes = (if builtins.hasAttr "nodes" ctx then ctx.nodes else []);
    pkgPathOf = ctx.pkgPathOf;
  };
  get = ctx.get;
  pkgs = ctx.pkgs or null;
  repoRoot = ctx.repoRoot;

  labelsOf = L.labelsOf;
  nameOf = L.nameOf;
  byName = L.byName;

  # Discover importer directory from lockfile label on a node name
  importerOfName = name:
    let
      n = if builtins.hasAttr name byName then byName.${name} else null;
      labs = if n == null then [] else labelsOf n;
      locks = builtins.filter (l: lib.hasPrefix "lockfile:" l) labs;
    in if locks == [] then null else (
      let rest = lib.removePrefix "lockfile:" (builtins.head locks);
          parts = lib.splitString "#" rest;
      in if (builtins.length parts) >= 2 then (builtins.elemAt parts 1) else null
    );

  # Local node-modules utilities (hermetic pnpm store + node_modules)
  nodeMods = import ../node-modules.nix {
    inherit pkgs;
    repoRoot = repoRoot;
  };

  targetNameOf = n:
    let parts = lib.splitString ":" n; in
      if (builtins.length parts) > 1 then builtins.elemAt parts 1
      else (lib.baseNameOf (ctx.pkgPathOf n));
in {
  # Detect Node targets by lang label
  isTarget = n:
    let labs = labelsOf n;
    in (builtins.elem "lang:node" labs);

  # Infer kind from labels (bin/lib); default null
  kindOf = n:
    let labs = labelsOf n;
    in if builtins.elem "kind:bin" labs then "bin"
       else if builtins.elem "kind:lib" labs then "lib"
       else null;

  # Unused for Node; keep interface parity
  modulesFileFor = name: ctx.modulesTomlFor name;

  # Build a single-file CLI bundle using esbuild and the importer's hermetic node_modules
  mkApp = name:
    let
      importerDir = importerOfName name;
      # Expect importerDir from lockfile label; caller should filter to those nodes only.
      nm = nodeMods.mkNodeModules { lockfilePath = importerDir + "/pnpm-lock.yaml"; inherit importerDir; };
      entryRel = "src/index.ts";
      outBase = targetNameOf name;
      sanitize = s: lib.replaceStrings [ "//" ":" "/" " " ] [ "" "-" "-" "-" ] s;
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "node-cli-" + (sanitize name);
      version = sanitize importerDir;
      src = repoRoot;
      nativeBuildInputs = [ pkgs.esbuild pkgs.nodejs_22 ];
      buildPhase = ''
        set -euo pipefail
        cd ${importerDir}
        export SOURCE_DATE_EPOCH=1
        export NODE_PATH=${nm}/node_modules
        outFile="${outBase}"
        ${pkgs.esbuild}/bin/esbuild ${entryRel} \
          --platform=node \
          --target=node22 \
          --bundle \
          --format=esm \
          --legal-comments=none \
          --banner:js='#!/usr/bin/env node' \
          --outfile="$outFile"
      '';
      installPhase = ''
        set -euo pipefail
        mkdir -p $out/bin
        install -m0755 ${outBase} $out/bin/${outBase}
      '';
    };
}



