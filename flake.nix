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
      "NIX_PNPM_ALLOW_GENERATE"
      "NIX_PNPM_FETCH_TIMEOUT"
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
            haveCppOverlay = builtins.pathExists ./tools/nix/overlays/cpp-patches.nix;
          in [
            gomod2nix.overlays.default
          ] ++ (if haveCppOverlay then [ (import ./tools/nix/overlays/cpp-patches.nix) ] else []);
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
        nodeMods = import ./tools/nix/node-modules.nix { inherit pkgs; repoRoot = ./.; hashesPath = ./tools/nix/node-modules.hashes.json; prefetchedStorePathGlobal = null; };
        prelude = import ./tools/nix/buck-prelude.nix { inherit pkgs; buck2Input = buck2; };
      in f { inherit pkgs zx-wrapper nodeMods prelude system; buck2Input = buck2; }
    );
  in {
    devShells = forAllSystems ({ pkgs, zx-wrapper, nodeMods, prelude, buck2Input, system, ... }:
      { default = (import ./tools/nix/devshell.nix { inherit pkgs; buck2Input = buck2Input; }).default; }
    );

    packages = forAllSystems ({ zx-wrapper, pkgs, nodeMods, prelude, buck2Input, system, ... }:
      let
        # Optional local override to inject a pre-fetched pnpm store into pnpm-store derivations
        localPnpmStore = let s = builtins.getEnv "LOCAL_PNPM_STORE"; in if s != "" then s else null;
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
        appsListing = if builtins.pathExists ./apps then (builtins.readDir ./apps) else (if builtins.pathExists (srcRoot + "/apps") then (builtins.readDir (srcRoot + "/apps")) else {});
        libsListing = if builtins.pathExists ./libs then (builtins.readDir ./libs) else (if builtins.pathExists (srcRoot + "/libs") then (builtins.readDir (srcRoot + "/libs")) else {});
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

        haveRootLock = builtins.pathExists ./pnpm-lock.yaml;
      in {
        buck2-prelude = prelude.buck2-prelude;
        zx-wrapper = zx-wrapper;
      } // {
        pnpm-store = ({} // (if haveRootLock then { default = nodeMods.mkPnpmStore { lockfilePath = "pnpm-lock.yaml"; importerDir = "."; prefetchedStorePath = localPnpmStore; }; } else {}) // perImporterStore);
        node-modules = ({} // (if haveRootLock then { default = nodeMods.node-modules; } else {}) // perImporterNM);
      } // {
        graph-generator = graphGen.all;
        graph-generator-cppTargets = graphGen.cppTargetsFlat;
        graph-generator-selected = graphGen.selected;
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
        in {
          node-cli = nodeCli;
          node-webapp = nodeWebapp;
        }
      )
    );

    checks = forAllSystems ({ nodeMods, ... }: {
      default = nodeMods.node-modules;
    });
  };
}
