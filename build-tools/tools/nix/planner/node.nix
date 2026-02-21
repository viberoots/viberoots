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
  repoSnapshot = ctx.repoSnapshot or repoRoot;
  repoStoreRoot = ctx.repoStoreRoot or repoSnapshot;
  sharedNodeMods = ctx.nodeMods or null;

  labelsOf = L.labelsOf;
  nameOf = L.nameOf;
  byName = L.byName;
  srcsOf = L.srcsOf;
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

  targetNameOf = n:
    let parts = lib.splitString ":" n; in
      if (builtins.length parts) > 1 then builtins.elemAt parts 1
      else (lib.baseNameOf (ctx.pkgPathOf n));

  nodeOfName = name:
    if builtins.hasAttr name byName then byName.${name} else null;

  attrStringOr = n: key: fallback:
    let v = if n == null then null else get n key;
    in if builtins.isString v && v != "" then v else fallback;
  isWebappLike = n:
    let
      rt = attrStringOr n "rule_type" "";
      cmd = attrStringOr n "cmd" "";
      labs = labelsOf n;
    in
      builtins.elem "webapp:static" labs ||
      builtins.elem "webapp:ssr" labs ||
      rt == "node_webapp" ||
      lib.hasInfix "node-webapp." cmd ||
      lib.hasInfix "--attr \"node-webapp." cmd ||
      lib.hasInfix "--attr node-webapp." cmd;

  mkGenLike = { name, kind }:
    let
      info = lockInfoOfName name;
      n = nodeOfName name;
      cmd = attrStringOr n "cmd" "";
      outRel = attrStringOr n "out" (targetNameOf name);
      srcs = srcsOf name;
      cmdEscaped = lib.escapeShellArg cmd;
      outEscaped = lib.escapeShellArg outRel;
      srcsEscaped = lib.escapeShellArg (lib.concatStringsSep " " srcs);
      kindBin = kind == "bin";
      sanitize = H.sanitizeName;
    in
      if cmd == "" then builtins.throw "node planner: missing genrule cmd for ${name}"
      else pkgs.stdenvNoCC.mkDerivation {
        pname = "node-${kind}-" + (sanitize name);
        version = sanitize info.importer;
        src = repoRoot;
        nativeBuildInputs = [ pkgs.bash pkgs.coreutils pkgs.nodejs_22 pkgs.pnpm ];
        buildPhase = ''
          set -euo pipefail
          cd ${info.importer}
          tmpOut="$PWD/.bnx-out/${outRel}"
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
          srcPath="$PWD/.bnx-out/$outRel"
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
      };
in {
  # Detect Node targets by lang label
  isTarget = n:
    let labs = labelsOf n;
    in (builtins.elem "lang:node" labs);

  # Infer kind from labels (bin/lib); default null
  kindOf = n:
    let
      k = L.kindOf {
        labels = labelsOf n;
        ruleType = L.ruleTypeOf n;
        name = L.nameOf n;
        config = kindConfigs.node;
      };
    in
      if k == "app" && isWebappLike n then "webapp" else k;

  # Unused for Node; keep interface parity
  modulesFileFor = name: ctx.modulesTomlFor name;

  # Build a single-file CLI bundle using esbuild and the importer's hermetic node_modules
  mkApp = name:
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
          });
      sanitize = H.sanitizeName;
      nm = nodeMods.mkNodeModules { lockfilePath = info.lockfilePath; inherit importerDir; };
      entryRel = "src/index.ts";
      outBase = targetNameOf name;
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "node-cli-" + (sanitize name);
      version = sanitize importerDir;
      src = repoStoreRoot;
      nativeBuildInputs = [ pkgs.nodejs_22 ];
      buildPhase = ''
        set -euo pipefail
        cd ${importerDir}
        export SOURCE_DATE_EPOCH=1
        # Reset node_modules to a fresh writable directory before linking.
        # Source snapshots can carry read-only metadata files (e.g. .modules.yaml),
        # which makes in-place unlink/link updates fail.
        chmod -R u+w node_modules 2>/dev/null || true
        rm -rf node_modules
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
              // Retry once after a hard cleanup. This is deterministic and surfaces
              // a hard error if the entry cannot be removed.
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
        ESBUILD_BIN="${nm}/node_modules/.bin/esbuild"
        if [ ! -x "$ESBUILD_BIN" ]; then
          echo "node planner: missing esbuild in locked node_modules for ${importerDir}" >&2
          exit 2
        fi
        "$ESBUILD_BIN" ${entryRel} \
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

  mkGen = name: mkGenLike { inherit name; kind = "gen"; };
  mkLib = name: mkGenLike { inherit name; kind = "lib"; };
  mkBin = name: mkGenLike { inherit name; kind = "bin"; };
  mkWebapp = name:
    let
      info = lockInfoOfName name;
      importerDir = info.importer;
      n = nodeOfName name;
      labs = if n == null then [] else labelsOf n;
      hasSsr = builtins.elem "webapp:ssr" labs;
      framework =
        if builtins.elem "framework:next" labs then "next"
        else if builtins.elem "framework:express" labs then "express"
        else "";
      nodeMods =
        if sharedNodeMods != null then sharedNodeMods
        else builtins.trace
          "[planner/node] ctx.nodeMods not provided; using compat local node-modules import"
          (import ../node-modules.nix {
            inherit pkgs;
            repoRoot = repoStoreRoot;
          });
      sanitize = H.sanitizeName;
      nm = nodeMods.mkNodeModules { lockfilePath = info.lockfilePath; inherit importerDir; };
    in pkgs.stdenvNoCC.mkDerivation {
      pname = "node-webapp-" + (sanitize name);
      version = sanitize importerDir;
      src = repoStoreRoot;
      nativeBuildInputs = [ pkgs.nodejs_22 ];
      buildPhase = ''
        set -euo pipefail
        cd ${importerDir}
        export SOURCE_DATE_EPOCH=1
        stage_wasm_contract() {
          local wasm_src="$1"
          local client_root="$2"
          if [ ! -f "$wasm_src" ]; then
            return 0
          fi
          mkdir -p "$client_root/wasm-inline"
          cp -f "$wasm_src" "$client_root/top.wasm"
          local wasm_b64
          wasm_b64="$(base64 < "$wasm_src" | tr -d '\n')"
          cat > "$client_root/wasm-inline/index.js" <<EOF
export const wasmBytesBase64 = '$wasm_b64';
const decodeBase64 = (value) => {
  if (typeof atob === "function") {
    const bin = atob(value);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(value, "base64"));
  }
  throw new Error("wasm inline module: no base64 decoder available");
};
export const wasmBytes = () => decodeBase64(wasmBytesBase64);
EOF
        }
        rm -rf node_modules
        ln -s "${nm}/node_modules" node_modules
        VITE_BIN="${nm}/node_modules/.bin/vite"
        TSC_BIN="${nm}/node_modules/.bin/tsc"
        NEXT_BIN="${nm}/node_modules/.bin/next"
        ${if !hasSsr then ''
          if [ ! -x "$VITE_BIN" ]; then
            echo "node planner: missing vite in locked node_modules for ${importerDir}" >&2
            exit 2
          fi
          "$VITE_BIN" build
          test -d dist
          stage_wasm_contract "src/wasm-contract/top.wasm" "dist"
        '' else if framework == "express" then ''
          if [ ! -x "$VITE_BIN" ] || [ ! -x "$TSC_BIN" ]; then
            echo "node planner: expected vite and tsc in locked node_modules for ${importerDir}" >&2
            exit 2
          fi
          "$VITE_BIN" build --outDir dist/client
          "$VITE_BIN" build --ssr src/entry-server.ts --outDir dist/server
          "$TSC_BIN" -p tsconfig.server.json
          test -d dist/client
          test -f dist/server/index.js
          stage_wasm_contract "src/wasm-contract/top.wasm" "dist/client"
        '' else if framework == "next" then ''
          if [ ! -x "$NEXT_BIN" ] || [ ! -x "$TSC_BIN" ]; then
            echo "node planner: expected next and tsc in locked node_modules for ${importerDir}" >&2
            exit 2
          fi
          "$NEXT_BIN" build
          "$TSC_BIN" -p tsconfig.server.json
          test -d .next
          mkdir -p dist/client
          cp -R .next dist/client/.next
          if [ -d public ]; then cp -R public dist/client/public; fi
          if [ -f package.json ]; then cp package.json dist/client/package.json; fi
          if [ -f next.config.mjs ]; then cp next.config.mjs dist/client/next.config.mjs; fi
          if [ -f dist/server/index.js ]; then mv dist/server/index.js dist/server/server-main.js; fi
          cat > dist/server/index.js <<'EOF'
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
process.chdir(path.resolve(__dirname, "../client"));
await import("./server-main.js");
EOF
          test -d dist/client
          test -f dist/server/index.js
          test -f dist/server/server-main.js
          stage_wasm_contract "app/wasm-contract/top.wasm" "dist/client/public"
        '' else ''
          echo "node planner: SSR webapp target ${name} missing framework label (framework:express|framework:next)" >&2
          exit 2
        ''}
      '';
      installPhase = ''
        set -euo pipefail
        mkdir -p "$out"
        cp -R dist "$out/dist"
      '';
    };
}
