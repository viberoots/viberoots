{ pkgs, nodeMods, importerDirs, allowGenerate, filterRepo, repoSnapshot, repoRoot }:
let
  sanitize = (import ../../templates-common.nix { inherit pkgs; }).sanitizeName;
  esbuild = pkgs.esbuild;
  makeCliBundle =
    importerDir:
      let
        entry = "src/index.ts";
        name = builtins.baseNameOf importerDir;
        nm = nodeMods.mkNodeModules { lockfilePath = importerDir + "/pnpm-lock.yaml"; inherit importerDir; };
      in
      pkgs.stdenvNoCC.mkDerivation {
        pname = "node-cli";
        version = sanitize importerDir;
        src =
          let
            wr = builtins.getEnv "WORKSPACE_ROOT";
          in
          if wr != "" then (builtins.path { path = filterRepo (builtins.toPath wr); name = "repo"; }) else repoSnapshot;
        nativeBuildInputs = [ esbuild pkgs.nodejs_22 ];
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
          const safeLinkDir = (target, linkPath) => {
            try {
              if (fs.existsSync(linkPath)) fs.rmSync(linkPath, { recursive: true, force: true });
            } catch {}
            try {
              fs.symlinkSync(target, linkPath, "dir");
            } catch (e) {
              if (e && e.code === "EEXIST") {
                // Defensive retry for transient races on darwin filesystems.
                try {
                  fs.rmSync(linkPath, { recursive: true, force: true });
                } catch {}
                fs.symlinkSync(target, linkPath, "dir");
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
                  safeLinkDir(target, linkPath);
                  storeLinked++;
                }
                continue;
              }
              const target = path.join(storeRoot, name);
              const linkPath = path.join(nodeModules, name);
              safeLinkDir(target, linkPath);
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
          outFile="${name}.bundle.js"
          ${esbuild}/bin/esbuild ${entry} \
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
          mkdir -p $out
          install -m0755 ${name}.bundle.js $out/${name}.bundle.js
        '';
      };
in
builtins.listToAttrs (map (imp: { name = sanitize imp; value = makeCliBundle imp; }) importerDirs)


