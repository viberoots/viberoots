{ pkgs, importerDirs, nodeWebapp, filterRepo, repoSnapshot, repoRoot, viberootsRoot }:
let
  sanitize = (import ../../templates-common.nix { inherit pkgs; }).sanitizeName;
  makeVercelNext =
    importerDir:
      let
        attr = sanitize importerDir;
        webapp = nodeWebapp.${attr};
      in
      pkgs.stdenvNoCC.mkDerivation {
        pname = "node-vercel-next";
        version = attr;
        src =
          let
            wr = builtins.getEnv "WORKSPACE_ROOT";
          in
          if wr != "" then (builtins.path { path = builtins.toPath wr; name = "repo"; filter = filterRepo (builtins.toPath wr); }) else repoSnapshot;
        nativeBuildInputs = [ pkgs.nodejs_22 pkgs.coreutils ];
        buildPhase = ''
          set -euo pipefail
          REPO_ROOT="$PWD"
          APP_DIR="$REPO_ROOT/${importerDir}"
          CONFIG_REL="${let v = builtins.getEnv "VBR_VERCEL_CONFIG"; in if v != "" then v else "vercel.project.json"}"
          CONFIG="$APP_DIR/$CONFIG_REL"
          DIST="$APP_DIR/dist"
          VIBEROOTS_SOURCE_ROOT="${viberootsRoot}"
          test -f "$CONFIG" || {
            echo "node-vercel-next: missing declared Vercel config: ${importerDir}/$CONFIG_REL" >&2
            exit 2
          }
          rm -rf "$DIST" vercel-prebuilt
          cp -R "${webapp}/dist" "$DIST"
          chmod -R u+w "$DIST" 2>/dev/null || true
          node --experimental-strip-types \
            --disable-warning=ExperimentalWarning \
            --import "$VIBEROOTS_SOURCE_ROOT/build-tools/tools/dev/zx-init.mjs" \
            "$VIBEROOTS_SOURCE_ROOT/build-tools/tools/vercel/next-artifact.ts" \
            --app-dir "$APP_DIR" \
            --dist-dir "$DIST" \
            --config "$CONFIG" \
            --out "$PWD/vercel-prebuilt/.vercel/output" \
            --identity-out "$PWD/vercel-prebuilt/artifact-identity.json"
          test -d vercel-prebuilt/.vercel/output
          test -f vercel-prebuilt/artifact-identity.json
        '';
        installPhase = ''
          set -euo pipefail
          mkdir -p "$out"
          cp -R vercel-prebuilt/. "$out/"
        '';
      };
in
builtins.listToAttrs (map (imp: { name = sanitize imp; value = makeVercelNext imp; }) importerDirs)
