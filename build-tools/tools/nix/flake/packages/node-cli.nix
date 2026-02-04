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
        nativeBuildInputs = [ esbuild ];
        buildPhase = ''
          set -euo pipefail
          echo "[nix] DEBUG root listing before cd" >&2
          ls -la >&2 || true
          echo "[nix] DEBUG tree (depth 2)" >&2
          find . -maxdepth 2 -type d -print >&2 || true
          cd ${importerDir}
          export SOURCE_DATE_EPOCH=1
          ${if allowGenerate then "mkdir -p node_modules" else "ln -s ${nm}/node_modules node_modules"}
          outFile="${name}.bundle.js"
          ${esbuild}/bin/esbuild ${entry} \
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
          mkdir -p $out
          install -m0755 ${name}.bundle.js $out/${name}.bundle.js
        '';
      };
in
builtins.listToAttrs (map (imp: { name = sanitize imp; value = makeCliBundle imp; }) importerDirs)


