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
        nodeMods = import ./tools/nix/node-modules.nix { inherit pkgs; repoRoot = ./.; hashesPath = ./tools/nix/node-modules.hashes.json; };
        prelude = import ./tools/nix/buck-prelude.nix { inherit pkgs; buck2Input = buck2; };
      in f { inherit pkgs zx-wrapper nodeMods prelude system; buck2Input = buck2; }
    );
  in {
    devShells = forAllSystems ({ pkgs, zx-wrapper, nodeMods, prelude, buck2Input, system, ... }:
      { default = (import ./tools/nix/devshell.nix { inherit pkgs; buck2Input = buck2Input; }).default; }
    );

    packages = forAllSystems ({ zx-wrapper, pkgs, nodeMods, prelude, buck2Input, system, ... }:
      let
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

        # Discover importers under apps/* and libs/* containing a pnpm-lock.yaml
        appsDirs = if builtins.pathExists ./apps then builtins.attrNames (builtins.readDir ./apps) else [];
        libsDirs = if builtins.pathExists ./libs then builtins.attrNames (builtins.readDir ./libs) else [];
        isDir = base: name: ((builtins.readDir base).${name} or null) == "directory";
        appsWithLock = builtins.filter (d: isDir ./apps d && builtins.pathExists (./apps + ("/" + d) + "/pnpm-lock.yaml")) appsDirs;
        libsWithLock = builtins.filter (d: isDir ./libs d && builtins.pathExists (./libs + ("/" + d) + "/pnpm-lock.yaml")) libsDirs;
        importerDirs = (map (d: "apps/" + d) appsWithLock) ++ (map (d: "libs/" + d) libsWithLock);

        perImporter = builtins.listToAttrs (map (imp: {
          name = (nodeMods.sanitizeName ("node-modules." + imp));
          value = nodeMods.mkNodeModules { lockfilePath = imp + "/pnpm-lock.yaml"; importerDir = imp; };
        }) importerDirs);
        perImporterStore = builtins.listToAttrs (map (imp: {
          name = (nodeMods.sanitizeName ("pnpm-store." + imp));
          value = nodeMods.mkPnpmStore { lockfilePath = imp + "/pnpm-lock.yaml"; importerDir = imp; };
        }) importerDirs);
      in {
        buck2-prelude = prelude.buck2-prelude;
        zx-wrapper = zx-wrapper;
        pnpm-store = nodeMods.pnpm-store;
        node-modules = nodeMods.node-modules;
        default = nodeMods.node-modules;
        graph-generator = graphGen.all;
        graph-generator-cppTargets = graphGen.cppTargetsFlat;
        graph-generator-selected = graphGen.selected;
        buck-graph = buckGraph;
        graph-generator-pure = graphGenPure.all;
        graph-generator-pure-selected = graphGenPure.selected;
      } // perImporter // perImporterStore
    );

    checks = forAllSystems ({ nodeMods, ... }: {
      default = nodeMods.node-modules;
    });
  };
}
