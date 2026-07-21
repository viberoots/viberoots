{ pkgs, H, repoStoreRoot, repoFsRoot, sharedNodeMods, lockInfoOfName, targetNameOf, name }:
let
  info = lockInfoOfName name;
  importerDir = info.importer;
  nodeMods =
    if sharedNodeMods != null then sharedNodeMods
    else builtins.trace
      "[planner/node] ctx.nodeMods not provided; using compat local node-modules import"
      (import ../node-modules.nix {
        inherit pkgs;
        repoRoot = repoStoreRoot;
        repoFsRoot = repoFsRoot;
      });
  sanitize = H.sanitizeName;
  nm = nodeMods.mkNodeModules { lockfilePath = info.lockfilePath; inherit importerDir; };
  entryRel = "src/index.ts";
  outBase = targetNameOf name;
in
  pkgs.stdenvNoCC.mkDerivation {
    pname = "node-cli-" + (sanitize name);
    version = sanitize importerDir;
    src = repoStoreRoot;
    nativeBuildInputs = [ pkgs.esbuild pkgs.nodejs_22 ];
    buildPhase = ''
      set -euo pipefail
      cd ${importerDir}
      export SOURCE_DATE_EPOCH=1
      chmod -R u+w node_modules 2>/dev/null || true
      rm -rf node_modules
      mkdir -p node_modules
      STORE_ROOT="${nm}/node_modules"
      VBR_NODE_MODULES_STORE="$STORE_ROOT" node - <<'EOF'
      const fs = require("fs");
      const path = require("path");
      const importerDir = ${builtins.toJSON importerDir};
      const cwd = process.cwd();
      const storeRoot = String(process.env.VBR_NODE_MODULES_STORE || "");
      const levels = importerDir.split("/").filter(Boolean).length;
      let repoRoot = cwd;
      for (let i = 0; i < levels; i++) repoRoot = path.dirname(repoRoot);
      const nodeModules = path.join(cwd, "node_modules");
      const pathEntryExists = (p) => {
        try {
          fs.lstatSync(p);
          return true;
        } catch {
          return false;
        }
      };
      const removePathEntry = (p) => {
        if (!pathEntryExists(p)) return;
        fs.rmSync(p, { recursive: true, force: true });
        if (pathEntryExists(p)) {
          throw new Error("[nix] failed to remove existing path before symlink: " + p);
        }
      };
      const safeLink = (target, linkPath, kind) => {
        removePathEntry(linkPath);
        try {
          fs.symlinkSync(target, linkPath, kind);
          return;
        } catch (e) {
          if (e && e.code === "EEXIST") {
            removePathEntry(linkPath);
            fs.symlinkSync(target, linkPath, kind);
            return;
          }
          throw e;
        }
      };
      let storeLinked = 0;
      if (storeRoot && fs.existsSync(storeRoot)) {
        const entries = fs.readdirSync(storeRoot, { withFileTypes: true });
        for (const ent of entries) {
          const name = ent.name;
          if (name === ".bin") continue;
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
              safeLink(target, linkPath, pkg.isDirectory() ? "dir" : "file");
              storeLinked++;
            }
            continue;
          }
          const target = path.join(storeRoot, name);
          const linkPath = path.join(nodeModules, name);
          safeLink(target, linkPath, ent.isDirectory() ? "dir" : "file");
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
          if (path.resolve(pkgDir) === path.resolve(cwd)) continue;
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
      if [ ! -f "${entryRel}" ]; then
        echo "node planner: missing entry '${entryRel}' for ${name}" >&2
        if [ -d src ]; then ls -la src >&2; fi
        exit 2
      fi
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
  }
