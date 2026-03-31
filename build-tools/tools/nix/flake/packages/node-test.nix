{ pkgs, nodeMods, importerDirs, allowGenerate, repoRoot, uv2nixLib }:
let
  sanitize = (import ../../templates-common.nix { inherit pkgs; }).sanitizeName;
  TAddon = import ../../templates/cpp-node-addon.nix { inherit pkgs; };
  T = import ../../lang-templates.nix { inherit pkgs uv2nixLib; };

  makeNodeTest =
    importerDir:
      let
        importerAbs = repoRoot + ("/" + importerDir);
        importerIgnoredEntries = [
          "node_modules"
          "dist"
          "build"
          ".vite"
          ".next"
          ".turbo"
          ".cache"
          ".direnv"
          ".pnpm-store"
          ".pnpm-home"
          "coverage"
          "report"
          "buck-out"
        ];
        importerSnap = builtins.path {
          path = importerAbs;
          name = "importer";
          filter =
            path: _type:
            let
              base = builtins.baseNameOf (toString path);
            in
            !(
              builtins.elem base importerIgnoredEntries
              || base == "pnpm-workspace.yaml"
              || builtins.match "\\.node_modules\\.lockfile-guard\\..*" base != null
            );
        };

        hasTestFiles =
          let
            ignored = [ "node_modules" "dist" "build" ".vite" ];
            isTestName = name: (builtins.match ".*\\.test\\.ts$" name != null) || (builtins.match ".*\\.test\\.js$" name != null);
            walk =
              dir:
                let
                  entries = builtins.readDir dir;
                in
                builtins.any
                  (n:
                    let
                      ty = entries.${n};
                      p = dir + ("/" + n);
                    in
                    if ty == "directory" then
                      (if builtins.elem n ignored then false else walk p)
                    else if ty == "regular" then
                      isTestName n
                    else
                      false)
                  (builtins.attrNames entries);
          in
          if builtins.pathExists importerAbs then walk importerAbs else false;

        importerOnlySrc = pkgs.runCommand "node-test-src-${sanitize importerDir}" { } ''
          set -euo pipefail
          mkdir -p "$out/${importerDir}"
          cp -R ${importerSnap}/. "$out/${importerDir}/"
          chmod -R u+rwX "$out"
        '';

        importerLockAbs = repoRoot + ("/" + importerDir + "/pnpm-lock.yaml");
        haveImporterLock = builtins.pathExists importerLockAbs;
        name = builtins.baseNameOf importerDir;

        hasNative = builtins.pathExists (repoRoot + ("/" + importerDir + "-native"));
        addonName = name + "_addon";
        goPkgDir = "projects/libs/" + name + "-go";
        modulesTomlPath = repoRoot + ("/" + goPkgDir + "/gomod2nix.toml");
        carchive =
          if hasNative && builtins.pathExists (repoRoot + ("/" + goPkgDir)) then
            T.goCArchive {
              name = goPkgDir + ":carchive";
              modulesToml = modulesTomlPath;
              subdir = goPkgDir;
              pkgPath = "./pkg/addon";
              srcRoot = repoRoot;
              patchDirs =
                let p = repoRoot + ("/" + goPkgDir + "/patches/go"); in
                if builtins.pathExists p then [ (builtins.toPath p) ] else [];
            }
          else
            null;
        addonDrv =
          if hasNative then
            TAddon.cppNodeAddon {
              name = sanitize name;
              addonName = sanitize addonName;
              srcRoot = repoRoot;
              subdir = importerDir + "-native";
              includes = [ "include" ];
              nixCxxPkgs = builtins.filter (p: p != null) [ carchive ];
            }
          else
            null;

        patternsEnv = builtins.getEnv "NIX_NODE_TEST_PATTERNS";
        patternsValue = patternsEnv;
        coverageEnv = builtins.getEnv "COVERAGE";
      in
      if (!hasTestFiles) then
        pkgs.stdenvNoCC.mkDerivation {
          pname = "node-test";
          version = sanitize importerDir;
          src = importerOnlySrc;
          nativeBuildInputs = [ pkgs.coreutils ];
          buildPhase = ''
            set -euo pipefail
            cd ${importerDir}
            mkdir -p report
            echo "[nix] no tests matched; skipping runner and passing." >&2
            echo "{\"status\":\"no-tests\"}" > report/summary.json
          '';
          installPhase = ''
            set -euo pipefail
            mkdir -p "$out"
            cp -R report "$out/"
          '';
        }
      else
        let
          lockTxt = if haveImporterLock then builtins.readFile importerLockAbs else "";
          lockHasVitest = haveImporterLock && (builtins.match ".*vitest.*" lockTxt != null);

          nodeTestMissingVitest = pkgs.stdenvNoCC.mkDerivation {
            pname = "node-test";
            version = sanitize importerDir;
            src = importerOnlySrc;
            nativeBuildInputs = [ pkgs.coreutils ];
            buildPhase = ''
              set -euo pipefail
              echo "[nix] ERROR: tests exist but vitest is not present in ${importerDir}/pnpm-lock.yaml." >&2
              echo "[nix] Add vitest to devDependencies and re-generate the lockfile." >&2
              exit 3
            '';
            installPhase = ''
              set -euo pipefail
              mkdir -p "$out"
            '';
          };

          nmDrv = nodeMods.mkNodeModules { lockfilePath = importerDir + "/pnpm-lock.yaml"; inherit importerDir; };
          nmPath = if allowGenerate && (!haveImporterLock) then "" else "${nmDrv}";
          addonSrc = if hasNative then "${addonDrv}/lib/${sanitize addonName}.node" else "";
        in
        if (!lockHasVitest) then
          nodeTestMissingVitest
        else
          pkgs.stdenvNoCC.mkDerivation {
            pname = "node-test";
            version = sanitize importerDir;
            src = importerOnlySrc;
            nativeBuildInputs = [ pkgs.nodejs_22 pkgs.esbuild pkgs.coreutils ];
            buildPhase = ''
              set -euo pipefail
              export IMPORTER_DIR="${importerDir}"
              export NM_PATH="${nmPath}"
              export HAS_NATIVE="${if hasNative then "1" else ""}"
              export ADDON_NAME="${addonName}"
              export ADDON_SRC="${addonSrc}"
              export COVERAGE_ENV="${coverageEnv}"
              export PATTERNS_VALUE='${builtins.toJSON patternsValue}'
              ${builtins.readFile ./node-test-buildPhase.sh}
            '';
            installPhase = ''
              set -euo pipefail
              mkdir -p "$out"
              if [ -d report ]; then cp -R report "$out/"; fi
              if [ -d coverage ] && [ -n "$(ls -A coverage 2>/dev/null || true)" ]; then
                mkdir -p "$out/coverage"
                cp -R coverage/* "$out/coverage/"
              fi
            '';
          };
in
builtins.listToAttrs (map (imp: { name = sanitize imp; value = makeNodeTest imp; }) importerDirs)
