{ pkgs, zx-wrapper, nodeMods, prelude, uv2nixLib, ... }:
let
  lib = pkgs.lib;
  repoRoot = ../../../../..;
  filterRepo = import ./filter-repo.nix { inherit lib; };
  repoSnapshot = builtins.path { path = filterRepo repoRoot; name = "repo"; };

  importers = import ./importers.nix { inherit lib filterRepo repoSnapshot repoRoot; };
  graph = import ./graph.nix { inherit pkgs repoSnapshot uv2nixLib repoRoot; };

  nodeModsPkgs = import ./node-mods.nix {
    inherit nodeMods;
    importerDirs = importers.importerDirs;
    haveRootLock = importers.haveRootLock;
  };

  nodeCli = import ./node-cli.nix {
    inherit pkgs nodeMods filterRepo repoSnapshot repoRoot;
    importerDirs = importers.importerDirs;
    allowGenerate = importers.allowGenerate;
  };

  nodeWebapp = import ./node-webapp.nix {
    inherit pkgs nodeMods repoSnapshot repoRoot;
    importerDirs = importers.importerDirs;
  };

  nodeTest = import ./node-test.nix {
    inherit pkgs nodeMods uv2nixLib repoRoot;
    importerDirs = importers.importerDirs;
    allowGenerate = importers.allowGenerate;
  };

  python = import ./python.nix { inherit pkgs repoRoot uv2nixLib; };
  pyWasiToolchain = import ../../toolchains/python-wasi.nix { inherit pkgs; };
  testSeed = import ./test-seed.nix { inherit pkgs repoRoot; };
in
{
  buck2-prelude = prelude.buck2-prelude;
  zx-wrapper = zx-wrapper;
} // nodeModsPkgs // {
  graph-generator = graph.graphGen.all;
  graph-generator-cppTargets = graph.graphGen.cppTargetsFlat;
  graph-generator-selected = graph.graphGen.selected;
  graph-generator-selected-wasm = graph.graphGen.selectedWasm;
  buck-graph = graph.buckGraph;
  graph-generator-pure = graph.graphGenPure.all;
  graph-generator-pure-selected = graph.graphGenPure.selected;
  test-seed = testSeed;
  node-cli = nodeCli;
  node-webapp = nodeWebapp;
  node-test = nodeTest;
  py-wasi-toolchain = pyWasiToolchain;
} // python


