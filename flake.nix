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
          # Prefer a prefetched pnpm store path when provided via env by the runner
          prefetchedStorePathGlobal = let s = builtins.getEnv "LOCAL_PNPM_STORE"; in if s != "" then (builtins.toPath s) else null;
        };
        prelude = import ./tools/nix/buck-prelude.nix { inherit pkgs; buck2Input = buck2; };
        uv2nixLib =
          let
            uvPath = ./third_party/uv2nix/flake.nix;
            haveUv = builtins.pathExists uvPath;
            uvLocal = if haveUv then import uvPath else null;
            uvOut = if haveUv && uvLocal != null then uvLocal.outputs { self = null; inherit nixpkgs; } else null;
            lib = if uvOut == null then null else (uvOut.lib or null);
          in
            if lib == null then null else {
              meta = lib.meta or {};
              mkEnv = args:
                if (lib ? mkEnvFor) then (lib.mkEnvFor pkgs) args
                else if (lib ? mkEnv) then lib.mkEnv args
                else builtins.throw "uv2nix lib is missing mkEnv/mkEnvFor";
            };
      in f { inherit pkgs zx-wrapper nodeMods prelude system uv2nixLib; buck2Input = buck2; }
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

    packages = forAllSystems ({ zx-wrapper, pkgs, nodeMods, prelude, buck2Input, system, uv2nixLib, ... }:
      let
        lib = pkgs.lib;
        # Exclude volatile, test-generated dirs from repo snapshots to avoid races during coverage writes
        filterRepo = path:
          builtins.filterSource
            (p: _type:
              let s = builtins.toString p;
              in !(
                lib.hasInfix "/coverage/" s || lib.hasSuffix "/coverage" s ||
                lib.hasInfix "/buck-out/" s || lib.hasSuffix "/buck-out" s ||
                lib.hasInfix "/.buck/" s    || lib.hasSuffix "/.buck" s ||
                lib.hasInfix "/test-logs/" s || lib.hasSuffix "/test-logs" s ||
                lib.hasInfix "/.clinic/" s ||
                lib.hasInfix "/node_modules/" s || lib.hasSuffix "/node_modules" s ||
                lib.hasInfix "/.pnpm/" s || lib.hasSuffix "/.pnpm" s ||
                lib.hasInfix "/.pnpm-store/" s || lib.hasSuffix "/.pnpm-store" s ||
                lib.hasInfix "/.git/" s || lib.hasSuffix "/.git" s ||
                lib.hasInfix "/.direnv/" s || lib.hasSuffix "/.direnv" s ||
                lib.hasInfix "/.cache/" s || lib.hasSuffix "/.cache" s ||
                lib.hasInfix "/result/" s || lib.hasSuffix "/result" s ||
                lib.hasInfix "/.envrc" s || lib.hasSuffix "/.envrc" s
              )
            )
            path;
        repoSnapshot = builtins.path { path = filterRepo ./.; name = "repo"; };
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
          # Use a filtered, stable working-tree snapshot of the entire repo
          src = repoSnapshot;
          # Explicitly include graph.json: prefer env override, else working tree file
          graphJsonPath = graphArg;
          # Allow tests to override repo-root gomod2nix.toml via env
          rootModulesTomlPath = let envRootToml = builtins.getEnv "ROOT_GOMOD2NIX_TOML"; in
            if envRootToml != "" then envRootToml else ./gomod2nix.toml;
          uv2nixLib = uv2nixLib;
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
          src = repoSnapshot;
          graphJsonPath = let envGraph = builtins.getEnv "BUCK_GRAPH_JSON"; in
            if envGraph != "" then envGraph else (buckGraph + "/graph.json");
          rootModulesTomlPath = let envRootToml = builtins.getEnv "ROOT_GOMOD2NIX_TOML"; in
            if envRootToml != "" then envRootToml else ./gomod2nix.toml;
          uv2nixLib = uv2nixLib;
        };

        # Discover importers under apps/* and libs/* containing a pnpm-lock.yaml.
        # When NIX_PNPM_ALLOW_GENERATE=1, allow importers with just package.json so
        # temp/scaffolded projects (without an initial lockfile) can be built and
        # have their lockfile generated inside the FOD.
        # If the working tree lacks these dirs (e.g., in temp tests), prefer WORKSPACE_ROOT
        # so evaluation sees newly scaffolded importers in the temp repo; otherwise fall back.
        srcRoot = let wr = builtins.getEnv "WORKSPACE_ROOT"; in
          if wr != "" then (builtins.path { path = filterRepo (builtins.toPath wr); name = "repo"; })
          else repoSnapshot;
        allowGenerate = (builtins.getEnv "NIX_PNPM_ALLOW_GENERATE") == "1";
        appsDirExists = builtins.pathExists ./apps || builtins.pathExists (srcRoot + "/apps") || (
          let wr = builtins.getEnv "WORKSPACE_ROOT"; in (wr != "" && builtins.pathExists (builtins.toPath wr + "/apps"))
        );
        libsDirExists = builtins.pathExists ./libs || builtins.pathExists (srcRoot + "/libs") || (
          let wr = builtins.getEnv "WORKSPACE_ROOT"; in (wr != "" && builtins.pathExists (builtins.toPath wr + "/libs"))
        );
        # Prefer live filesystem (WORKSPACE_ROOT) when set so newly scaffolded importers
        # are discoverable immediately; else prefer srcRoot snapshot; else fall back to ./.
        appsListing =
          let wr = builtins.getEnv "WORKSPACE_ROOT"; in
            if builtins.pathExists ./apps then (builtins.readDir ./apps)
            else if (wr != "" && builtins.pathExists (builtins.toPath wr + "/apps")) then (builtins.readDir (builtins.toPath wr + "/apps"))
            else if builtins.pathExists (srcRoot + "/apps") then (builtins.readDir (srcRoot + "/apps"))
            else {};
        libsListing =
          let wr = builtins.getEnv "WORKSPACE_ROOT"; in
            if builtins.pathExists ./libs then (builtins.readDir ./libs)
            else if (wr != "" && builtins.pathExists (builtins.toPath wr + "/libs")) then (builtins.readDir (builtins.toPath wr + "/libs"))
            else if builtins.pathExists (srcRoot + "/libs") then (builtins.readDir (srcRoot + "/libs"))
            else {};
        appsDirs = if appsDirExists then builtins.attrNames appsListing else [];
        libsDirs = if libsDirExists then builtins.attrNames libsListing else [];
        isDir = base: name: ((builtins.readDir base).${name} or null) == "directory";
        hasLockAt = base: d: builtins.pathExists (base + ("/" + d) + "/pnpm-lock.yaml");
        hasPkgJsonAt = base: d: builtins.pathExists (base + ("/" + d) + "/package.json");
        # Include all importer directories; mkNodeModules/mkPnpmStore handle missing locks
        # Discover importers under apps/* and libs/* (no repo-scoped test importers; tests may scaffold in temp workspaces)
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
          # Resolve entry relative to the importer; buildPhase cd's into importerDir
          entry = "src/index.ts";
          name = builtins.baseNameOf importerDir;
          nm = nodeMods.mkNodeModules { lockfilePath = importerDir + "/pnpm-lock.yaml"; inherit importerDir; };
        in pkgs.stdenvNoCC.mkDerivation {
          pname = "node-cli";
          version = sanitize importerDir;
          # Prefer WORKSPACE_ROOT when provided (temp repos) with filtering to avoid volatile dirs
          src = let wr = builtins.getEnv "WORKSPACE_ROOT"; in
                if wr != "" then (builtins.path { path = filterRepo (builtins.toPath wr); name = "repo"; })
                else repoSnapshot;
          nativeBuildInputs = [ esbuild ];
          buildPhase = ''
            set -euo pipefail
            echo "[nix] DEBUG root listing before cd" >&2
            ls -la >&2 || true
            echo "[nix] DEBUG tree (depth 2)" >&2
            find . -maxdepth 2 -type d -print >&2 || true
            cd ${importerDir}
            export SOURCE_DATE_EPOCH=1
            # Ensure workspace deps are available to the bundler via Node resolution
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
        nodeCli = builtins.listToAttrs (map (imp: { name = sanitize imp; value = makeCliBundle imp; }) importerDirs);

        # Vite-based webapp build per importer
        makeWebapp = importerDir: let
          nm = nodeMods.mkNodeModules { lockfilePath = importerDir + "/pnpm-lock.yaml"; inherit importerDir; };
          ps = nodeMods.mkPnpmStore { lockfilePath = importerDir + "/pnpm-lock.yaml"; inherit importerDir; };
          name = builtins.baseNameOf importerDir;
        in pkgs.stdenvNoCC.mkDerivation {
          pname = "node-webapp";
          version = sanitize importerDir;
          # Snapshot the repo from this flake path; tests pass WORKSPACE_ROOT separately where needed
          src = builtins.path { path = ./.; name = "repo"; };
          nativeBuildInputs = [ pkgs.nodejs_22 pkgs.esbuild pkgs.cacert pkgs.coreutils ];
          buildPhase = ''
            set -euo pipefail
            echo "[nix] DEBUG root listing before cd" >&2
            ls -la >&2 || true
            echo "[nix] DEBUG tree (depth 3)" >&2
            find . -maxdepth 3 -type d -print >&2 || true
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
          # Build a minimal source that contains ONLY the importer subtree, staged under the same path.
          # Resolve importer path relative to the flake being evaluated (temp repo for tests)
          importerAbs = ./. + ("/" + importerDir);
          importerSnap = builtins.path { path = importerAbs; name = "importer"; };
          # IMPORTANT: Avoid unconditional dependencies on node-modules for "no-tests" importers.
          # Nix derivations have *static* dependencies: if we embed a node-modules store path in the
          # build script, Nix will realize it even if the script exits early. So we decide at eval
          # time whether any test files exist in the importer subtree and only depend on node-modules
          # when we truly need to run vitest.
          hasTestFiles =
            let
              ignored = [ "node_modules" "dist" "build" ".vite" ];
              isTestName = name:
                (builtins.match ".*\\.test\\.ts$" name != null) ||
                (builtins.match ".*\\.test\\.js$" name != null);
              walk = dir:
                let entries = builtins.readDir dir;
                in builtins.any
                  (n:
                    let ty = entries.${n};
                        p = dir + ("/" + n);
                    in if ty == "directory" then
                      (if builtins.elem n ignored then false else walk p)
                    else if ty == "regular" then
                      isTestName n
                    else
                      false
                  )
                  (builtins.attrNames entries);
            in
              # Missing importers are filtered elsewhere; treat absent dirs as "no tests".
              if builtins.pathExists importerAbs then walk importerAbs else false;
          importerOnlySrc = pkgs.runCommand "node-test-src-${sanitize importerDir}" {} ''
            set -euo pipefail
            mkdir -p "$out/${importerDir}"
            # Copy the importer subtree contents into the intended importerDir, not as a nested "importer/" directory.
            cp -R ${importerSnap}/. "$out/${importerDir}/"
            chmod -R u+rwX "$out"
          '';
          importerLockAbs = ./. + ("/" + importerDir + "/pnpm-lock.yaml");
          haveImporterLock = builtins.pathExists importerLockAbs;
          name = builtins.baseNameOf importerDir;
          sanitize = (import ./tools/nix/templates-common.nix { inherit pkgs; }).sanitizeName;
          # Optional: if a sibling native addon package exists at libs/<name>-native,
          # build a Node-API addon derivation and make its artifact available for tests.
          hasNative = builtins.pathExists (./. + ("/" + importerDir + "-native"));
          TAddon = import ./tools/nix/templates/cpp-node-addon.nix { inherit pkgs; };
          T = import ./tools/nix/lang-templates.nix { inherit pkgs uv2nixLib; };
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
            **/*.test.ts
            **/*.test.js
          '';
          patternsEnv = builtins.getEnv "NIX_NODE_TEST_PATTERNS";
          patternsValue = if patternsEnv != "" then patternsEnv else (builtins.replaceStrings ["\n\n"] ["\n"] defaultPatterns);
          coverageEnv = builtins.getEnv "COVERAGE";
        in if (!hasTestFiles) then pkgs.stdenvNoCC.mkDerivation {
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
        } else
        let
          # Fast-fail: if tests exist but vitest is not present in the lockfile, do NOT realize
          # node-modules (expensive) just to discover that vitest is missing at runtime.
          #
          # This is safe because if vitest is installed for the importer, pnpm-lock.yaml will
          # include it. Absence implies "vitest cannot be resolved deterministically".
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
          # Keep allow-generate semantics, but NEVER ignore a lockfile that exists.
          # When allow-generate is enabled and the importer lockfile is absent, avoid
          # referencing node-modules at eval time; if tests are present, we fail clearly.
          nmPath = if allowGenerate && (!haveImporterLock) then "" else "${nmDrv}";
        in if (!lockHasVitest) then nodeTestMissingVitest else pkgs.stdenvNoCC.mkDerivation {
          pname = "node-test";
          version = sanitize importerDir;
          # Use importer-only snapshot to avoid copying the entire repo into the sandbox
          src = importerOnlySrc;
          nativeBuildInputs = [ pkgs.nodejs_22 pkgs.esbuild pkgs.coreutils ];
          buildPhase = ''
            set -euo pipefail
            cd ${importerDir}
            export SOURCE_DATE_EPOCH=1
            # If a sibling C++ addon exists, materialize a stable path for the .node artifact
            if [ -n "${if hasNative then "1" else ""}" ]; then
              mkdir -p native
              # Copy from the pre-built addon derivation into the location expected by the loader
              cp -f ${if hasNative then "${addonDrv}/lib/${sanitize addonName}.node" else "/nonexistent"} "native/${addonName}.node" 2>/dev/null || true
            fi
            # Resolve vitest bin (prefer node_modules/.bin; fallback to pnpm virtual store)
            # Prepare patterns list (newline separated)
            PATTERNS_FILE="$TMPDIR/patterns.txt"
            cat > "$PATTERNS_FILE" <<'EOF_PAT'
${patternsValue}
EOF_PAT
            # Determine whether the *importer source tree* contains any test files.
            # IMPORTANT: do NOT scan node_modules (it may contain many *.test.* files, which would
            # incorrectly enable vitest for "no-tests" importers and massively slow down builds).
            FOUND=0
            if find . \
              -path "./node_modules" -prune -o \
              -path "./dist" -prune -o \
              -path "./build" -prune -o \
              -path "./.vite" -prune -o \
              -type f \( -name "*.test.ts" -o -name "*.test.js" \) -print -quit | grep -q .; then
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
              if [ -z "${nmPath}" ]; then
                echo "[nix] ERROR: tests matched patterns but ${importerDir}/pnpm-lock.yaml is missing." >&2
                echo "[nix] Generate and commit a lockfile (or disable tests) so vitest can be installed deterministically." >&2
                exit 3
              fi
              ln -s ${nmPath}/node_modules node_modules
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
                # Vite/Vitest default cacheDir is node_modules/.vite, but our node_modules is a
                # symlink to a read-only Nix store path. Provide a tiny config that redirects the
                # cache into the writable build directory.
                VITE_CFG="$TMPDIR/bnx-vite-config.mjs"
                # Keep this config dependency-free: vitest loads it as ESM, and ESM resolution
                # does not consult NODE_PATH. A plain object avoids importing vitest/vite packages.
                cat > "$VITE_CFG" <<'EOF_VITE_CFG'
export default {
  cacheDir: ".vite",
  // Avoid expensive dependency prebundling in hermetic sandboxes. This can consume a lot of
  // memory/CPU and has caused hung/OS-killed vitest runs in CI-like environments.
  optimizeDeps: { disabled: true },
};
EOF_VITE_CFG
                echo "[nix] DEBUG pwd: $(pwd)" >&2
                echo "[nix] DEBUG vitest bin: $VITEST_BIN" >&2
                (ls -la "$VITEST_BIN" || true) >&2
                (command -v node || true) >&2
                echo "[nix] running vitest (coverage=${coverageEnv:-0})..." >&2
                # Run vitest once; passWithNoTests to avoid failure on empty sets.
                # Note: vitest positional args are treated as name filters (not file globs), so we
                # do not pass patterns as CLI args here.
              # Try to produce a junit file under ./report
              export VITEST_JUNIT_OUTPUT="report/junit.xml"
              # Force non-interactive CI semantics. Some vitest/vite stacks can otherwise
              # keep the process alive waiting for watch/TTY behavior.
              export CI=1
              export VITEST_WATCH=false
              # Prevent macOS from SIGKILL'ing the builder under memory pressure by capping Node's heap.
              # The scaffolded vitest suites here are tiny; they should not need a multi-GB heap.
              export NODE_OPTIONS="--max-old-space-size=1536 ''${NODE_OPTIONS:-}"
                # Guard against hung test runners: if vitest doesn't exit, fail fast and let Nix clean up.
                # Use a generous timeout to cover native-addon startup without risking indefinite _nixbld leaks.
                # Keep well below Buck zx_test timeouts; if vitest hangs, fail fast so nix-daemon
                # doesn't keep _nixbld builders alive for minutes/hours.
                VITEST_TIMEOUT_SECS=420
                if [ "$(basename "$VITEST_BIN")" = "vitest" ]; then
                  # .bin wrapper (node shebang)
                  echo "[nix] DEBUG exec: timeout -k 15s ''${VITEST_TIMEOUT_SECS}s $VITEST_BIN run ..." >&2
                  timeout -k 15s ''${VITEST_TIMEOUT_SECS}s "$VITEST_BIN" run \
                    --pool forks \
                    --maxWorkers 1 \
                    --minWorkers 1 \
                    --no-file-parallelism \
                    --config "$VITE_CFG" \
                    --reporter=junit \
                    --outputFile=report/junit.xml \
                    --passWithNoTests \
                    $COVERAGE_ARGS
                else
                  echo "[nix] DEBUG exec: timeout -k 15s ''${VITEST_TIMEOUT_SECS}s node $VITEST_BIN run ..." >&2
                  timeout -k 15s ''${VITEST_TIMEOUT_SECS}s node "$VITEST_BIN" run \
                    --pool forks \
                    --maxWorkers 1 \
                    --minWorkers 1 \
                    --no-file-parallelism \
                    --config "$VITE_CFG" \
                    --reporter=junit \
                    --outputFile=report/junit.xml \
                    --passWithNoTests \
                    $COVERAGE_ARGS
                fi
              # Ensure report directory has at least a minimal junit file for downstream consumers
              if [ ! -s report/junit.xml ]; then
                echo "[nix] junit reporter did not emit a file; writing minimal placeholder" >&2
                echo "<testsuites/>" > report/junit.xml
              fi
              # Coverage artifacts must be present and non-empty when COVERAGE=1.
              # Primary path: vitest writes coverage directly.
              if [ "${coverageEnv}" = "1" ]; then
                if [ ! -s coverage/lcov.info ] || [ ! -s coverage/coverage-summary.json ]; then
                  echo "[nix] ERROR: coverage requested but expected reports were not produced (lcov.info / coverage-summary.json)" >&2
                  echo "[nix] Ensure the importer has @vitest/coverage-v8 installed, and that vitest is run with '--coverage --coverage.provider=v8'." >&2
                  (ls -la coverage || true) >&2
                  exit 3
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
            if [ -d coverage ] && [ -n "$(ls -A coverage 2>/dev/null || true)" ]; then
              mkdir -p "$out/coverage"
              cp -R coverage/* "$out/coverage/"
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
        # Python per-importer environments (uv.lock-based).
        # Primary: uv2nixLib available. Fallback: deterministic stub exposing py-wheelhouse-* attrs.
        if uv2nixLib == null then
          let
            sanitize = (import ./tools/nix/templates-common.nix { inherit pkgs; }).sanitizeName;
            srcRoot = let wr = builtins.getEnv "WORKSPACE_ROOT"; in if wr != "" then (builtins.toPath wr) else ./.;
            listDirs = base: if builtins.pathExists base then builtins.attrNames (builtins.readDir base) else [];
            appsDirs = listDirs (srcRoot + "/apps");
            libsDirs = listDirs (srcRoot + "/libs");
            allImporters = (map (d: "apps/" + d) appsDirs) ++ (map (d: "libs/" + d) libsDirs);
            mkWheelhouseStub = importer:
              let lockAbs = builtins.toPath (builtins.toString srcRoot + "/" + importer + "/uv.lock");
                  lockIn = if builtins.pathExists lockAbs then (builtins.path { path = lockAbs; name = "uv.lock"; }) else null;
              in pkgs.stdenvNoCC.mkDerivation {
                pname = "py-wheelhouse";
                version = sanitize importer;
                src = ./.;
                dontUnpack = true;
                buildPhase = ''
                  set -euo pipefail
                  mkdir -p out
                  ${if lockIn != null then "cp ${lockIn} out/uv.lock" else ": > out/uv.lock"}
                '';
                installPhase = ''
                  set -euo pipefail
                  mkdir -p "$out/site"
                  cp -R out/. "$out/site/" || true
                '';
              };
            pyWheelhouse = builtins.listToAttrs (map (imp: {
              name = "py-wheelhouse-" + (sanitize imp);
              value = mkWheelhouseStub imp;
            }) (builtins.filter (imp: builtins.pathExists (builtins.toPath (builtins.toString srcRoot + "/" + imp + "/uv.lock"))) allImporters));
          in pyWheelhouse
        else
          let
            T = import ./tools/nix/lang-templates.nix { inherit pkgs uv2nixLib; };
            sanitize = (import ./tools/nix/templates-common.nix { inherit pkgs; }).sanitizeName;
            # Prefer the live flake root (./.) for temp repos; consider WORKSPACE_ROOT only as a secondary source.
            srcRoot = ./.;
            wrEnv = builtins.getEnv "WORKSPACE_ROOT";
            srcRootEnv = if wrEnv != "" then (builtins.toPath wrEnv) else null;
            listDirs = base:
              if builtins.pathExists base then builtins.attrNames (builtins.readDir base) else [];
            # Prefer WORKSPACE_ROOT-backed listing; fall back to flake snapshot.
            # Use builtins.toString/builtins.toPath to avoid path/string concat pitfalls.
            srcRootStr = builtins.toString srcRoot;
            # Also consider live PWD when WORKSPACE_ROOT is not propagated (tests override env)
            pwdEnv = builtins.getEnv "PWD";
            srcRootPwd = if pwdEnv != "" then (builtins.toPath pwdEnv) else null;
            srcRootPwdStr = if srcRootPwd == null then "" else (builtins.toString srcRootPwd);
            appsPath = builtins.toPath (srcRootStr + "/apps");
            libsPath = builtins.toPath (srcRootStr + "/libs");
            appsEnvPath = if srcRootEnv != null then builtins.toPath ((builtins.toString srcRootEnv) + "/apps") else null;
            libsEnvPath = if srcRootEnv != null then builtins.toPath ((builtins.toString srcRootEnv) + "/libs") else null;
            appsPwdPath = if srcRootPwd != null then builtins.toPath (srcRootPwdStr + "/apps") else null;
            libsPwdPath = if srcRootPwd != null then builtins.toPath (srcRootPwdStr + "/libs") else null;
            appsDirsBase = if builtins.pathExists appsPath then (listDirs appsPath) else (listDirs ./apps);
            libsDirsBase = if builtins.pathExists libsPath then (listDirs libsPath) else (listDirs ./libs);
            appsDirsEnv = if (appsEnvPath != null && builtins.pathExists appsEnvPath) then (listDirs appsEnvPath) else [];
            libsDirsEnv = if (libsEnvPath != null && builtins.pathExists libsEnvPath) then (listDirs libsEnvPath) else [];
            appsDirsPwd = if (appsPwdPath != null && builtins.pathExists appsPwdPath) then (listDirs appsPwdPath) else [];
            libsDirsPwd = if (libsPwdPath != null && builtins.pathExists libsPwdPath) then (listDirs libsPwdPath) else [];
            # Union (dedup) importer directory names discovered via srcRoot and PWD
            appsDirs = pkgs.lib.unique (appsDirsBase ++ appsDirsEnv ++ appsDirsPwd);
            libsDirs = pkgs.lib.unique (libsDirsBase ++ libsDirsEnv ++ libsDirsPwd);
            allImporters = (map (d: "apps/" + d) appsDirs) ++ (map (d: "libs/" + d) libsDirs);
            hasUvLock = imp:
              let
                pSrc = builtins.toPath (srcRootStr + ("/" + imp + "/uv.lock"));
                pEnv = if srcRootEnv == null then null else builtins.toPath ((builtins.toString srcRootEnv) + ("/" + imp + "/uv.lock"));
                pPwd = if srcRootPwd == null then null else builtins.toPath (srcRootPwdStr + ("/" + imp + "/uv.lock"));
              in (builtins.pathExists pSrc) || (pEnv != null && builtins.pathExists pEnv) || (pPwd != null && builtins.pathExists pPwd);
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
            let
              makeWheelhouse = importer:
                T.pyWheelhouse {
                  name = importer;
                  lockfile = importer + "/uv.lock";
                  subdir = importer;
                  srcRoot = srcRoot;
                };
              pyWheelhouse = builtins.listToAttrs (map (imp: {
                name = "py-wheelhouse-" + (sanitize imp);
                value = makeWheelhouse imp;
              }) pyImporters);
              # Fallback: if no importers were detected under uv2nix, expose stub wheelhouse attrs
              # so temp flakes (without WORKSPACE_ROOT env propagation) still provide py-wheelhouse-*.
              # This mirrors the non-uv2nix stub behavior but only for wheelhouse attrs.
              stubWheelhouse =
                let
                  importerLocks =
                    builtins.filter
                      (imp:
                        (builtins.pathExists (builtins.toPath (srcRootStr + ("/" + imp + "/uv.lock"))))
                        || (srcRootEnv != null && builtins.pathExists (builtins.toPath ((builtins.toString srcRootEnv) + ("/" + imp + "/uv.lock"))))
                        || (srcRootPwd != null && builtins.pathExists (builtins.toPath (srcRootPwdStr + ("/" + imp + "/uv.lock"))))
                      )
                      allImporters;
                  mkWheelhouseStub = importer:
                    let
                      lockAbs =
                        if srcRootPwd != null && builtins.pathExists (builtins.toPath (srcRootPwdStr + ("/" + importer + "/uv.lock")))
                        then (builtins.toPath (srcRootPwdStr + ("/" + importer + "/uv.lock")))
                        else if srcRootEnv != null && builtins.pathExists (builtins.toPath ((builtins.toString srcRootEnv) + ("/" + importer + "/uv.lock")))
                        then (builtins.toPath ((builtins.toString srcRootEnv) + ("/" + importer + "/uv.lock")))
                        else (builtins.toPath (srcRootStr + ("/" + importer + "/uv.lock")));
                      lockIn = if builtins.pathExists lockAbs then (builtins.path { path = lockAbs; name = "uv.lock"; }) else null;
                    in pkgs.stdenvNoCC.mkDerivation {
                      pname = "py-wheelhouse";
                      version = sanitize importer;
                      src = ./.;
                      dontUnpack = true;
                      buildPhase = ''
                        set -euo pipefail
                        mkdir -p out
                        ${if lockIn != null then "cp ${lockIn} out/uv.lock" else ": > out/uv.lock"}
                      '';
                      installPhase = ''
                        set -euo pipefail
                        mkdir -p "$out/site"
                        cp -R out/. "$out/site/" || true
                      '';
                    };
                in
                  if (builtins.length pyImporters) > 0 then {}
                  else (builtins.listToAttrs (map (imp: {
                    name = "py-wheelhouse-" + (sanitize imp);
                    value = mkWheelhouseStub imp;
                  }) importerLocks));
            in pyBase // pyDev // pyTest // pyWheelhouse // stubWheelhouse
      )
    );

    checks = forAllSystems ({ nodeMods, ... }: {
      default = nodeMods.node-modules;
    });
  };
}
