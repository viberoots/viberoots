{ pkgs
, zx-wrapper
, repoRoot
, viberootsRoot
, nodeMods ? null
, mkNodeMods ? null
, viberootsNodeMods ? null
, prelude
, uv2nixLib
, evaluationBundle ? null
, nixpkgsRegistry ? null
, version
, releaseTag
, ...
}:
let
  lib = pkgs.lib;
  resolvedNodeMods =
    if nodeMods != null then nodeMods
    else if mkNodeMods != null then mkNodeMods { }
    else builtins.throw "packages/default.nix requires nodeMods or mkNodeMods";
  filterRepo = import ./filter-repo.nix { inherit lib; };
  repoSnapshot = builtins.path { path = repoRoot; name = "repo"; filter = filterRepo repoRoot; };
  remoteTools = import ./remote-worker-tools.nix { inherit pkgs zx-wrapper viberootsRoot; };
  importers = import ./importers.nix { inherit lib filterRepo repoSnapshot repoRoot; };
  graph = import ./graph.nix {
    inherit pkgs repoSnapshot uv2nixLib repoRoot viberootsRoot nixpkgsRegistry evaluationBundle;
    artifactToolsRoot = remoteTools.remote-worker-tools;
    nodeMods = resolvedNodeMods;
  };

  nodeModsPkgs = import ./node-mods.nix {
    nodeMods = resolvedNodeMods;
    inherit viberootsNodeMods;
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
    inherit pkgs filterRepo repoSnapshot repoRoot viberootsRoot zx-wrapper;
    nodeMods = resolvedNodeMods;
    importerDirs = importers.importerDirs;
  };

  nodeVercelNext = import ./node-vercel-next.nix {
    inherit pkgs filterRepo repoSnapshot repoRoot viberootsRoot nodeWebapp;
    importerDirs = importers.importerDirs;
  };

  nodeService = import ./node-service.nix {
    inherit pkgs filterRepo repoSnapshot repoRoot viberootsRoot;
    nodeMods = resolvedNodeMods;
    importerDirs = importers.importerDirs;
  };

  nodeTest = import ./node-test.nix {
    inherit pkgs uv2nixLib repoRoot;
    nodeMods = resolvedNodeMods;
    importerDirs = importers.importerDirs;
    allowGenerate = importers.allowGenerate;
    coverage = if evaluationBundle == null then false else evaluationBundle.selection.coverage or false;
  };

  toolchains = import ./toolchains.nix { inherit pkgs; };
  python = import ./python.nix { inherit pkgs repoRoot uv2nixLib; };
  pyWasiToolchain = import ../../toolchains/python-wasi.nix { inherit pkgs; };
  testSeed = import ./test-seed.nix {
    inherit pkgs repoRoot evaluationBundle viberootsRoot;
  };
  controlPlaneImage = import ./deployment-control-plane-image.nix {
    inherit pkgs filterRepo repoRoot repoSnapshot viberootsRoot;
    nodeMods = if viberootsNodeMods != null then viberootsNodeMods else resolvedNodeMods;
  };
  remoteWorkerBootstrap = import ./remote-worker-bootstrap.nix {
    inherit pkgs viberootsRoot;
    inherit (remoteTools) remote-worker-tools;
  };
  viberootsCommand = import ../../packages/viberoots-command.nix {
    inherit pkgs zx-wrapper version releaseTag;
    viberootsSrc = viberootsRoot;
    artifactToolsRoot = remoteTools.remote-worker-tools;
  };
in
{
  buck2-prelude = prelude.buck2-prelude;
  zx-wrapper = zx-wrapper;
  viberoots = viberootsCommand;
  remote-worker-bootstrap = remoteWorkerBootstrap;
} // remoteTools // nodeModsPkgs // {
  graph-generator = graph.graphGen.all;
  graph-generator-cppTargets = graph.graphGen.cppTargetsFlat;
  graph-generator-selected = graph.graphGen.selected;
  graph-generator-selected-wasm = graph.graphGen.selectedWasm;
  buck-graph = graph.buckGraph;
  graph-generator-pure = graph.graphGenPure.all;
  graph-generator-pure-selected = graph.graphGenPure.selected;
  test-seed = testSeed;
  deployment-control-plane-runtime = controlPlaneImage.runtime;
  deployment-control-plane-image = controlPlaneImage.image;
  deployment-control-plane-image-contract = controlPlaneImage.contractDerivation;
  node-cli = nodeCli;
  node-webapp = nodeWebapp;
  node-vercel-next = nodeVercelNext;
  node-service = nodeService;
  node-test = nodeTest;
  py-wasi-toolchain = pyWasiToolchain;
  toolchains = toolchains;
} // python
