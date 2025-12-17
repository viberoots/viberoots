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
  parseLock = L.parseImporterScopedLockfileLabel;
  extractLocks = L.extractLockfileLabels;

  # Discover importer directory from lockfile label on a node name
  lockInfoOfName = name:
    let
      n = if builtins.hasAttr name byName then byName.${name} else null;
      labs = if n == null then [] else labelsOf n;
      locks = extractLocks labs;
    in
      if locks == [] then
        builtins.throw "node planner: missing importer-scoped lockfile label (lockfile:<path>#<importer>) on ${name}"
      else if (builtins.length locks) != 1 then
        builtins.throw "node planner: expected exactly one lockfile:<path>#<importer> label on ${name}; got: ${builtins.toJSON locks}"
      else
        parseLock (builtins.head locks);

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
      info = lockInfoOfName name;
      importerDir = info.importer;
      # Expect importerDir/lockfilePath from lockfile label; fail deterministically if malformed.
      nm = nodeMods.mkNodeModules { lockfilePath = info.lockfilePath; inherit importerDir; };
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



