{ pkgs, zx-wrapper, nodeMods ? null, mkNodeMods ? null, prelude, uv2nixLib, ... }:
let
  lib = pkgs.lib;
  repoRoot = ../../../../..;
  resolvedNodeMods =
    if nodeMods != null then nodeMods
    else if mkNodeMods != null then mkNodeMods { }
    else builtins.throw "packages/default.nix requires nodeMods or mkNodeMods";
  filterRepo = import ./filter-repo.nix { inherit lib; };
  repoSnapshot = builtins.path { path = repoRoot; name = "repo"; filter = filterRepo repoRoot; };

  importers = import ./importers.nix { inherit lib filterRepo repoSnapshot repoRoot; };
  graph = import ./graph.nix { inherit pkgs repoSnapshot uv2nixLib repoRoot; nodeMods = resolvedNodeMods; };

  nodeModsPkgs = import ./node-mods.nix {
    nodeMods = resolvedNodeMods;
    importerDirs = importers.importerDirs;
    haveRootLock = importers.haveRootLock;
  };

  nodeCli = import ./node-cli.nix {
    inherit pkgs filterRepo repoSnapshot repoRoot;
    nodeMods = resolvedNodeMods;
    importerDirs = importers.importerDirs;
    allowGenerate = importers.allowGenerate;
  };

  nodeWebapp = import ./node-webapp.nix {
    inherit pkgs filterRepo repoSnapshot repoRoot zx-wrapper;
    nodeMods = resolvedNodeMods;
    importerDirs = importers.importerDirs;
  };

  nodeVercelNext = import ./node-vercel-next.nix {
    inherit pkgs filterRepo repoSnapshot repoRoot nodeWebapp;
    importerDirs = importers.importerDirs;
  };

  nodeService = import ./node-service.nix {
    inherit pkgs filterRepo repoSnapshot repoRoot;
    nodeMods = resolvedNodeMods;
    importerDirs = importers.importerDirs;
  };

  nodeTest = import ./node-test.nix {
    inherit pkgs uv2nixLib repoRoot;
    nodeMods = resolvedNodeMods;
    importerDirs = importers.importerDirs;
    allowGenerate = importers.allowGenerate;
  };

  toolchains = import ./toolchains.nix { inherit pkgs; };
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
  node-vercel-next = nodeVercelNext;
  node-service = nodeService;
  node-test = nodeTest;
  py-wasi-toolchain = pyWasiToolchain;
  toolchains = toolchains;
} // python
