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
  kindConfigs = import ./kind-configs.nix;
  H = import ../lib/lang-helpers.nix { inherit pkgs; };
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
    L.kindOf {
      labels = labelsOf n;
      ruleType = L.ruleTypeOf n;
      name = L.nameOf n;
      config = kindConfigs.node;
    };

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
      sanitize = H.sanitizeName;
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "node-cli-" + (sanitize name);
      version = sanitize importerDir;
      src = repoRoot;
      nativeBuildInputs = [ pkgs.esbuild pkgs.nodejs_22 ];
      buildPhase = ''
        set -euo pipefail
        cd ${importerDir}
        export SOURCE_DATE_EPOCH=1
        mkdir -p node_modules
        STORE_ROOT="${nm}/node_modules"
        BNX_NODE_MODULES_STORE="$STORE_ROOT" node - <<'EOF'
        const fs = require("fs");
        const path = require("path");
        const importerDir = ${builtins.toJSON importerDir};
        const cwd = process.cwd();
        const storeRoot = String(process.env.BNX_NODE_MODULES_STORE || "");
        const levels = importerDir.split("/").filter(Boolean).length;
        let repoRoot = cwd;
        for (let i = 0; i < levels; i++) repoRoot = path.dirname(repoRoot);
        const nodeModules = path.join(cwd, "node_modules");
        let storeLinked = 0;
        if (storeRoot && fs.existsSync(storeRoot)) {
          const entries = fs.readdirSync(storeRoot, { withFileTypes: true });
          for (const ent of entries) {
            const name = ent.name;
            if (name.startsWith("@")) {
              const scopeStore = path.join(storeRoot, name);
              const scopeDir = path.join(nodeModules, name);
              try {
                if (fs.existsSync(scopeDir) && !fs.lstatSync(scopeDir).isDirectory()) {
                  fs.rmSync(scopeDir, { recursive: true, force: true });
                }
              } catch {}
              fs.mkdirSync(scopeDir, { recursive: true });
              const scoped = fs.readdirSync(scopeStore, { withFileTypes: true });
              for (const pkg of scoped) {
                const target = path.join(scopeStore, pkg.name);
                const linkPath = path.join(scopeDir, pkg.name);
                try {
                  fs.rmSync(linkPath, { recursive: true, force: true });
                } catch {}
                fs.symlinkSync(target, linkPath, "dir");
                storeLinked++;
              }
              continue;
            }
            const target = path.join(storeRoot, name);
            const linkPath = path.join(nodeModules, name);
            try {
              fs.rmSync(linkPath, { recursive: true, force: true });
            } catch {}
            fs.symlinkSync(target, linkPath, "dir");
            storeLinked++;
          }
        }
        console.error("[nix] linked store packages: " + String(storeLinked));
        const roots = ["projects/apps", "projects/libs"];
        let workspaceLinked = 0;
        for (const root of roots) {
          const abs = path.join(repoRoot, root);
          if (!fs.existsSync(abs)) continue;
          for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
            if (!ent.isDirectory()) continue;
            const pkgDir = path.join(abs, ent.name);
            const pkgJson = path.join(pkgDir, "package.json");
            if (!fs.existsSync(pkgJson)) continue;
            let name = "";
            try {
              name = String(JSON.parse(fs.readFileSync(pkgJson, "utf8")).name || "");
            } catch {}
            if (!name) continue;
            const linkPath = path.join(nodeModules, ...name.split("/"));
            const scopeDir = path.dirname(linkPath);
            try {
              if (fs.existsSync(scopeDir) && !fs.lstatSync(scopeDir).isDirectory()) {
                fs.rmSync(scopeDir, { recursive: true, force: true });
              }
            } catch {}
            fs.mkdirSync(scopeDir, { recursive: true });
            try {
              fs.rmSync(linkPath, { recursive: true, force: true });
            } catch {}
            fs.symlinkSync(pkgDir, linkPath, "dir");
            workspaceLinked++;
          }
        }
        console.error("[nix] linked workspace packages: " + String(workspaceLinked));
        EOF
        outFile="${outBase}"
        ${pkgs.esbuild}/bin/esbuild ${entryRel} \
          --platform=node \
          --target=node22 \
          --bundle \
          --format=esm \
          --packages=bundle \
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



