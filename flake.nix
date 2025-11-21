# flake.nix — devshell and zx-wrapper
{
  description = "bucknix-fresh devshell and scaffolding";

  nixConfig = {
    allowed-impure-env-vars = [
      "BUCK_GRAPH_JSON"
      "ROOT_GOMOD2NIX_TOML"
      "BUCK_TEST_SRC"
      "BUCK_TARGET"
      "NIX_GO_DEV_OVERRIDE_JSON"
      "NIX_CPP_DEV_OVERRIDE_JSON"
      "NIX_PY_DEV_OVERRIDE_JSON"
      "NIX_PY_TEST_RESOLVE_JSON"
      "PLANNER_NO_DEV_OVERRIDE_LOG"
        "PLANNER_TRACE"
      "NIX_PNPM_ALLOW_GENERATE"
      "NIX_PNPM_FETCH_TIMEOUT"
      "NIX_NODE_TEST_PATTERNS"
          "COVERAGE"
          "WORKSPACE_ROOT"
    ];
  };

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # Pin buck2 to match the upstream binary version on PATH (201beb86106f...)
    buck2.url = "github:facebook/buck2/201beb86106fecdc84e30260b0f1abb5bf576988";
    gomod2nix.url = "github:nix-community/gomod2nix";
    gomod2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, buck2, gomod2nix }:
  let
    systems = [ "aarch64-darwin" "aarch64-linux" "x86_64-linux" ];
    forAllSystems = f: nixpkgs.lib.genAttrs systems (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = let
            haveCppOverlayFile = builtins.pathExists ./tools/nix/overlays/cpp-patches.nix;
            useCppOverlay = (builtins.getEnv "NIX_CPP_USE_OVERLAY") == "1";
            cppOverlays = if (haveCppOverlayFile && useCppOverlay) then [ (import ./tools/nix/overlays/cpp-patches.nix) ] else [];
          in [
            gomod2nix.overlays.default
          ] ++ cppOverlays;
        };
        zx-wrapper = pkgs.writeShellScriptBin "zx-wrapper" ''
          set -euo pipefail
          exec ${pkgs.nodejs_22}/bin/node \
            --experimental-strip-types \
            --experimental-top-level-await \
            --disable-warning=ExperimentalWarning \
            --import="${pkgs.nodePackages.zx}/lib/node_modules/zx/build/globals.js" \
            "$@"
        '';
        devshell = import ./tools/nix/devshell.nix { inherit pkgs; buck2Input = buck2; };
        # Prefer reading lockfiles/packages from the live workspace (WORKSPACE_ROOT) if provided by the runner.
        # Fall back to the flake's source snapshot.
        liveFsRoot = let w = builtins.getEnv "WORKSPACE_ROOT"; in if w != "" then (builtins.toPath w) else ./.;
        nodeMods = import ./tools/nix/node-modules.nix {
          inherit pkgs;
          repoRoot = ./.;
          repoFsRoot = liveFsRoot;
          hashesPath = ./tools/nix/node-modules.hashes.json;
          prefetchedStorePathGlobal = null;
        };
        prelude = import ./tools/nix/buck-prelude.nix { inherit pkgs; buck2Input = buck2; };
      in f { inherit pkgs zx-wrapper nodeMods prelude system; buck2Input = buck2; }
    );
  in {
    apps = forAllSystems ({ pkgs, ... }: {
      gomod2nix = {
        type = "app";
        program = "${pkgs.gomod2nix}/bin/gomod2nix";
      };
      pnpm = {
        type = "app";
        program = "${pkgs.pnpm}/bin/pnpm";
      };
    });

    devShells = forAllSystems ({ pkgs, zx-wrapper, nodeMods, prelude, buck2Input, system, ... }:
      { default = (import ./tools/nix/devshell.nix { inherit pkgs; buck2Input = buck2Input; }).default; }
    );

    packages = forAllSystems ({ zx-wrapper, pkgs, nodeMods, prelude, buck2Input, system, ... }:
      let
        # Optional local override to inject a pre-fetched pnpm store into pnpm-store derivations
        localPnpmStore = let s = builtins.getEnv "LOCAL_PNPM_STORE"; in if s != "" then s else null;
        # Unfixed pnpm-store builder exposed via nodeMods (tracked file; safe under git snapshots)
        # Allow BUCK_GRAPH_JSON to override the graph path; only pass when path exists
        graphGen = let
          envGraph = builtins.getEnv "BUCK_GRAPH_JSON";
          graphPath = if envGraph != "" then envGraph else ./tools/buck/graph.json;
          graphArg = if (builtins.pathExists graphPath) then (builtins.path { path = graphPath; name = "graph.json"; }) else null;
        in pkgs.callPackage ./tools/nix/graph-generator.nix {
          inherit pkgs;
          # Use a stable working-tree snapshot of the entire repo
          src = builtins.path { path = ./.; name = "repo"; };
          # Explicitly include graph.json: prefer env override, else working tree file
          graphJsonPath = graphArg;
          # Allow tests to override repo-root gomod2nix.toml via env
          rootModulesTomlPath = let envRootToml = builtins.getEnv "ROOT_GOMOD2NIX_TOML"; in
            if envRootToml != "" then envRootToml else ./gomod2nix.toml;
        };
        # Ensure buck-graph.nix is included even when untracked by wrapping with builtins.path
        buckGraphFile = builtins.path { path = ./tools/nix/buck-graph.nix; name = "buck-graph.nix"; };
        buckGraph = pkgs.callPackage buckGraphFile {
          inherit pkgs;
          graphJsonPath = let envGraph = builtins.getEnv "BUCK_GRAPH_JSON"; in
            if envGraph != ""
            then (builtins.path { path = (builtins.toPath envGraph); name = "graph.json"; })
            else throw "BUCK_GRAPH_JSON not set; export the graph and pass it explicitly";
        };
        graphGenPure = pkgs.callPackage ./tools/nix/graph-generator.nix {
          inherit pkgs;
          src = builtins.path { path = ./.; name = "repo"; };
          graphJsonPath = let envGraph = builtins.getEnv "BUCK_GRAPH_JSON"; in
            if envGraph != "" then envGraph else (buckGraph + "/graph.json");
          rootModulesTomlPath = let envRootToml = builtins.getEnv "ROOT_GOMOD2NIX_TOML"; in
            if envRootToml != "" then envRootToml else ./gomod2nix.toml;
        };

        # Discover importers under apps/* and libs/* containing a pnpm-lock.yaml.
        # When NIX_PNPM_ALLOW_GENERATE=1, allow importers with just package.json so
        # temp/scaffolded projects (without an initial lockfile) can be built and
        # have their lockfile generated inside the FOD.
        # If the working tree lacks these dirs (e.g., in temp tests), fall back to the
        # flake's source snapshot to allow evaluation to see new scaffolds copied there.
        srcRoot = builtins.path { path = ./.; name = "repo"; };
        allowGenerate = (builtins.getEnv "NIX_PNPM_ALLOW_GENERATE") == "1";
        appsDirExists = builtins.pathExists ./apps || builtins.pathExists (srcRoot + "/apps");
        libsDirExists = builtins.pathExists ./libs || builtins.pathExists (srcRoot + "/libs");
        # Prefer reading from a working-tree snapshot (srcRoot) so newly created importers
        # in temp repos (untracked by git) are visible during flake evaluation. Fall back to
        # store-copied ./apps or ./libs when srcRoot paths are absent.
        appsListing = if builtins.pathExists (srcRoot + "/apps") then (builtins.readDir (srcRoot + "/apps")) else (if builtins.pathExists ./apps then (builtins.readDir ./apps) else {});
        libsListing = if builtins.pathExists (srcRoot + "/libs") then (builtins.readDir (srcRoot + "/libs")) else (if builtins.pathExists ./libs then (builtins.readDir ./libs) else {});
        appsDirs = if appsDirExists then builtins.attrNames appsListing else [];
        libsDirs = if libsDirExists then builtins.attrNames libsListing else [];
        isDir = base: name: ((builtins.readDir base).${name} or null) == "directory";
        hasLockAt = base: d: builtins.pathExists (base + ("/" + d) + "/pnpm-lock.yaml");
        hasPkgJsonAt = base: d: builtins.pathExists (base + ("/" + d) + "/package.json");
        # Include all importer directories; mkNodeModules/mkPnpmStore handle missing locks
        importerDirs = (map (d: "apps/" + d) appsDirs) ++ (map (d: "libs/" + d) libsDirs);

        perImporterNM = (builtins.listToAttrs (map (imp: {
          name = (nodeMods.sanitizeName imp);
          value = nodeMods.mkNodeModules { lockfilePath = imp + "/pnpm-lock.yaml"; importerDir = imp; };
        }) importerDirs));
        perImporterStore = (builtins.listToAttrs (map (imp: {
          name = (nodeMods.sanitizeName imp);
          value = nodeMods.mkPnpmStore { lockfilePath = imp + "/pnpm-lock.yaml"; importerDir = imp; prefetchedStorePath = localPnpmStore; };
        }) importerDirs));
        perImporterStoreUnfixed = (builtins.listToAttrs (map (imp: {
          name = (nodeMods.sanitizeName imp);
          value = nodeMods.mkPnpmStoreUnfixed { lockfilePath = imp + "/pnpm-lock.yaml"; importerDir = imp; };
        }) importerDirs));

        haveRootLock = builtins.pathExists ./pnpm-lock.yaml;
      in {
        buck2-prelude = prelude.buck2-prelude;
        zx-wrapper = zx-wrapper;
      } // {
        pnpm-store = ({} // (if haveRootLock then { default = nodeMods.mkPnpmStore { lockfilePath = "pnpm-lock.yaml"; importerDir = "."; prefetchedStorePath = localPnpmStore; }; } else {}) // perImporterStore);
        pnpm-store-unfixed = ({} // (if haveRootLock then { default = nodeMods.mkPnpmStoreUnfixed { lockfilePath = "pnpm-lock.yaml"; importerDir = "."; }; } else {}) // perImporterStoreUnfixed);
        node-modules = ({} // (if haveRootLock then { default = nodeMods.node-modules; } else {}) // perImporterNM);
      } // {
        graph-generator = graphGen.all;
        graph-generator-cppTargets = graphGen.cppTargetsFlat;
        graph-generator-selected = graphGen.selected;
        graph-generator-selected-wasm = graphGen.selectedWasm;
        buck-graph = buckGraph;
        graph-generator-pure = graphGenPure.all;
        graph-generator-pure-selected = graphGenPure.selected;
      } // (
        let
        # Node CLI single-file bundling per importer.
        # We expose one attribute per importer with sanitized name.
        sanitize = (import ./tools/nix/templates-common.nix { inherit pkgs; }).sanitizeName;
        esbuild = pkgs.esbuild;
        makeCliBundle = importerDir: let
          entry = importerDir + "/src/index.ts";
          name = builtins.baseNameOf importerDir;
        in pkgs.stdenvNoCC.mkDerivation {
          pname = "node-cli";
          version = sanitize importerDir;
          src = builtins.path { path = ./.; name = "repo"; };
          nativeBuildInputs = [ esbuild ];
          buildPhase = ''
            set -euo pipefail
            cd ${importerDir}
            export SOURCE_DATE_EPOCH=1
            outFile="${name}.bundle.js"
            ${esbuild}/bin/esbuild ${entry} \
              --platform=node \
              --target=node22 \
              --bundle \
              --format=esm \
              --sourcemap=false \
              --legal-comments=none \
              --banner:js='#!/usr/bin/env node' \
              --outfile="$outFile"
          '';
          installPhase = ''
            set -euo pipefail
            mkdir -p $out
            install -m0755 ${importerDir}/${name}.bundle.js $out/${name}.bundle.js
          '';
        };
        nodeCli = builtins.listToAttrs (map (imp: { name = sanitize imp; value = makeCliBundle imp; }) importerDirs);

        # Vite-based webapp build per importer
        makeWebapp = importerDir: let
          nm = nodeMods.mkNodeModules { lockfilePath = importerDir + "/pnpm-lock.yaml"; inherit importerDir; };
          ps = nodeMods.mkPnpmStore { lockfilePath = importerDir + "/pnpm-lock.yaml"; inherit importerDir; };
          name = builtins.baseNameOf importerDir;
        in pkgs.stdenvNoCC.mkDerivation {
          pname = "node-webapp";
          version = sanitize importerDir;
          # Snapshot the repo so we can cd into the importer directory during build.
          src = builtins.path { path = ./.; name = "repo"; };
          nativeBuildInputs = [ pkgs.nodejs_22 pkgs.esbuild pkgs.cacert pkgs.coreutils ];
          buildPhase = ''
            set -euo pipefail
            cd ${importerDir}
            export SOURCE_DATE_EPOCH=1
            # Make the hermetic node_modules available in the working dir for Node ESM resolution
            ln -s ${nm}/node_modules node_modules
            # Resolve Vite bin from the pnpm virtual store and invoke with Node
            VITE_BIN=$(ls -d node_modules/.pnpm/vite@*/node_modules/vite/bin/vite.js 2>/dev/null | head -n1 || true)
            if [ -z "$VITE_BIN" ]; then
              echo "[nix] ERROR: Vite bin not found under node_modules/.pnpm" >&2
              echo "[nix] listing node_modules (depth 3)" >&2
              find node_modules -maxdepth 3 -type d -print || true
              exit 3
            fi
            VITE_NODE_MODULES=$(dirname "$VITE_BIN")/..
            export NODE_PATH="$VITE_NODE_MODULES''${NODE_PATH:+:$NODE_PATH}"
            echo "[nix] invoking: node $VITE_BIN build"
            node "$VITE_BIN" build
          '';
          installPhase = ''
            set -euo pipefail
            mkdir -p $out
            if [ -d dist ]; then cp -R dist $out/; else echo "dist missing" >&2; exit 2; fi
          '';
        };
        nodeWebapp = builtins.listToAttrs (map (imp: { name = sanitize imp; value = makeWebapp imp; }) importerDirs);
        # Vitest-backed per-importer Node test derivation.
        # Runs tests hermetically using the importer's node_modules. If vitest is
        # not present and no files match the patterns, the derivation succeeds
        # (pass-with-no-tests semantics). If files match but vitest is missing,
        # the derivation fails with a clear message.
        makeNodeTest = importerDir: let
          nm = nodeMods.mkNodeModules { lockfilePath = importerDir + "/pnpm-lock.yaml"; inherit importerDir; };
          name = builtins.baseNameOf importerDir;
          sanitize = (import ./tools/nix/templates-common.nix { inherit pkgs; }).sanitizeName;
          # Optional: if a sibling native addon package exists at libs/<name>-native,
          # build a Node-API addon derivation and make its artifact available for tests.
          hasNative = builtins.pathExists (./. + ("/" + importerDir + "-native"));
          TAddon = import ./tools/nix/templates/cpp-node-addon.nix { inherit pkgs; };
          T = import ./tools/nix/lang-templates.nix { inherit pkgs; };
          addonName = name + "_addon";
          # If a sibling native addon exists, also build the Go c-archive from libs/<name>-go
          # and link it into the addon via nixCxxPkgs so the header/lib are available hermetically.
          goPkgDir = "libs/" + name + "-go";
          modulesTomlPath = ./. + ("/" + goPkgDir + "/gomod2nix.toml");
          carchive =
            if hasNative && builtins.pathExists (./. + ("/" + goPkgDir))
            then T.goCArchive {
              name = goPkgDir + ":carchive";
              modulesToml = modulesTomlPath;
              # Build from the module root; select concrete package path via pkgPath
              subdir = goPkgDir;
              pkgPath = "./pkg/addon";
              srcRoot = ./.;
            }
            else null;
          addonDrv = if hasNative then TAddon.cppNodeAddon {
            name = sanitize name;
            addonName = sanitize addonName;
            srcRoot = ./.;
            subdir = importerDir + "-native";
            includes = [ "include" ];
            nixCxxPkgs = builtins.filter (p: p != null) [ carchive ];
          } else null;
          defaultPatterns = ''
            test/**/*.test.ts
            test/**/*.test.js
            __tests__/**/*.test.ts
            __tests__/**/*.test.js
            src/**/*.test.ts
            src/**/*.test.js
          '';
          patternsEnv = builtins.getEnv "NIX_NODE_TEST_PATTERNS";
          patternsValue = if patternsEnv != "" then patternsEnv else (builtins.replaceStrings ["\n\n"] ["\n"] defaultPatterns);
          coverageEnv = builtins.getEnv "COVERAGE";
        in pkgs.stdenvNoCC.mkDerivation {
          pname = "node-test";
          version = sanitize importerDir;
          src = builtins.path { path = ./.; name = "repo"; };
          nativeBuildInputs = [ pkgs.nodejs_22 pkgs.esbuild pkgs.coreutils ];
          buildPhase = ''
            set -euo pipefail
            cd ${importerDir}
            export SOURCE_DATE_EPOCH=1
            # If a sibling C++ addon exists, materialize a stable path for the .node artifact
            if [ -d "../${name}-native" ]; then
              mkdir -p native
              # Copy from the pre-built addon derivation into the location expected by the loader
              cp -f ${if hasNative then "${addonDrv}/lib/${sanitize addonName}.node" else "/dev/null"} "native/${addonName}.node" 2>/dev/null || true
            fi
            # Resolve vitest bin (prefer node_modules/.bin; fallback to pnpm virtual store)
            # Prepare patterns list (newline separated)
            PATTERNS_FILE="$TMPDIR/patterns.txt"
            cat > "$PATTERNS_FILE" <<'EOF_PAT'
${patternsValue}
EOF_PAT
            # Determine whether any files match any default test globs; shell globstar may be unavailable,
            # so use find(1) for a robust check.
            FOUND=0
            if find . -type f \( -name "*.test.ts" -o -name "*.test.js" \) -print -quit | grep -q .; then
              FOUND=1
            fi
            # Coverage arguments (evaluated at flake eval time via allowed impure env)
            COVERAGE_ARGS=""
            if [ "${coverageEnv}" = "1" ]; then
              # Also emit raw V8 coverage so we can post-process to lcov if needed
              export NODE_V8_COVERAGE="coverage/raw"
              COVERAGE_ARGS="--coverage --coverage.provider=v8 --coverage.reporter=lcov --coverage.reporter=json-summary --coverage.reporter=html --coverage.reportsDirectory=coverage"
            fi
            mkdir -p report
            if [ "$FOUND" -eq 0 ]; then
              echo "[nix] no tests matched; skipping runner and passing." >&2
            else
              # Link hermetic node_modules and resolve vitest only when tests are present
              ln -s ${nm}/node_modules node_modules
              VITEST_BIN=""
              if [ -x "node_modules/.bin/vitest" ] || [ -f "node_modules/.bin/vitest" ]; then
                VITEST_BIN="node_modules/.bin/vitest"
              else
                VITEST_BIN=$(find node_modules -path "*/node_modules/vitest/*" -type f \( -name "vitest.mjs" -o -name "vitest.js" \) -print -quit 2>/dev/null || true)
              fi
              if [ -z "$VITEST_BIN" ] || [ ! -e "$VITEST_BIN" ]; then
                echo "[nix] DEBUG: vitest binary not found; listing node_modules for diagnostics" >&2
                (find node_modules -maxdepth 3 -type d -print | sort | head -n 200) || true
              fi
            if [ -n "$VITEST_BIN" ]; then
                VITEST_NODE_MODULES=$(dirname "$VITEST_BIN")/..
                NODE_PATH_SUFFIX=""
                if [ -n "$NODE_PATH" ]; then NODE_PATH_SUFFIX=":"$NODE_PATH; fi
                export NODE_PATH="$VITEST_NODE_MODULES$NODE_PATH_SUFFIX"
                echo "[nix] DEBUG pwd: $(pwd)" >&2
                echo "[nix] DEBUG vitest bin: $VITEST_BIN" >&2
                (ls -la "$VITEST_BIN" || true) >&2
                (command -v node || true) >&2
                echo "[nix] running vitest (coverage=${coverageEnv:-0})..." >&2
                # Run once with all patterns; passWithNoTests to avoid failure on empty sets
                ARGS=""
                while IFS= read -r __p; do
                  [ -n "$__p" ] || continue
                  ARGS="$ARGS \"$__p\""
                done < "$PATTERNS_FILE"
              # Try to produce a junit file under ./report
              export VITEST_JUNIT_OUTPUT="report/junit.xml"
                if [ "$(basename "$VITEST_BIN")" = "vitest" ]; then
                # .bin wrapper (node shebang)
              CMD="\"$VITEST_BIN\" run --reporter=junit --outputFile=report/junit.xml --passWithNoTests $COVERAGE_ARGS $ARGS"
                  echo "[nix] DEBUG exec: $CMD" >&2
                  eval "$CMD"
                else
              CMD="node \"$VITEST_BIN\" run --reporter=junit --outputFile=report/junit.xml --passWithNoTests $COVERAGE_ARGS $ARGS"
                  echo "[nix] DEBUG exec: $CMD" >&2
                  eval "$CMD"
                fi
              # Ensure report directory has at least a minimal junit file for downstream consumers
              if [ ! -s report/junit.xml ]; then
                echo "[nix] junit reporter did not emit a file; writing minimal placeholder" >&2
                echo "<testsuites/>" > report/junit.xml
              fi
              # If reporters didn't produce lcov/summary, synthesize them from raw V8 coverage using c8
              if [ "${coverageEnv}" = "1" ]; then
                if [ ! -f coverage/lcov.info ] || [ ! -f coverage/coverage-summary.json ]; then
                  echo "[nix] coverage: generating lcov/json-summary via c8 report (temp=coverage/raw, out=coverage)" >&2
                  c8 report --reporter=lcov --reporter=json-summary --reporter=html --report-dir=coverage --temp-directory=coverage/raw || true
                fi
              fi
              else
                echo "[nix] ERROR: vitest not found under node_modules, but tests matched patterns. Add vitest to devDependencies." >&2
                exit 3
              fi
            fi
          '';
          installPhase = ''
            set -euo pipefail
            mkdir -p "$out"
            if [ -d report ]; then cp -R report "$out/"; fi
            if [ -d coverage ]; then
              mkdir -p "$out/coverage"
              cp -R coverage/* "$out/coverage/" || true
            fi
          '';
        };
        nodeTest = builtins.listToAttrs (map (imp: { name = sanitize imp; value = makeNodeTest imp; }) importerDirs);
        in {
          node-cli = nodeCli;
          node-webapp = nodeWebapp;
          node-test = nodeTest;
        }
      ) // (
        let
          # Python per-importer environments (uv.lock-based)
          T = import ./tools/nix/lang-templates.nix { inherit pkgs; };
          sanitize = (import ./tools/nix/templates-common.nix { inherit pkgs; }).sanitizeName;
          srcRoot = builtins.path { path = ./.; name = "repo"; };
          listDirs = base:
            if builtins.pathExists base then builtins.attrNames (builtins.readDir base) else [];
          appsDirs = listDirs ./apps;
          libsDirs = listDirs ./libs;
          allImporters = (map (d: "apps/" + d) appsDirs) ++ (map (d: "libs/" + d) libsDirs);
          hasUvLock = imp:
            let p = ./. + ("/" + imp + "/uv.lock"); in builtins.pathExists p;
          pyImporters = builtins.filter hasUvLock allImporters;
          makePy = importer: groups:
            T.pyApp {
              name = importer;
              lockfile = importer + "/uv.lock";
              subdir = importer;
              srcRoot = srcRoot;
              groups = groups;
            };
          pyBase = builtins.listToAttrs (map (imp: {
            name = "py-" + (sanitize imp);
            value = makePy imp [];
          }) pyImporters);
          pyDev = builtins.listToAttrs (map (imp: {
            name = "py-" + (sanitize imp) + "-dev";
            value = makePy imp [ "dev" ];
          }) pyImporters);
          pyTest = builtins.listToAttrs (map (imp: {
            name = "py-" + (sanitize imp) + "-test";
            value = makePy imp [ "test" ];
          }) pyImporters);
        in
          pyBase // pyDev // pyTest
      )
    );

    checks = forAllSystems ({ nodeMods, ... }: {
      default = nodeMods.node-modules;
    });
  };
}
