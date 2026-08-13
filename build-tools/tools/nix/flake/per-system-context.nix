{ nixpkgs
, buck2
, gomod2nix
, rust-overlay
, wasmtime-nixpkgs
, system
, workspaceSrc
, viberootsInput
, version
, releaseTag
, includeNodeMods ? false
, nixpkgsRegistryExtension ? { profiles = { }; }
}:
let
  workspaceRootPath =
    if builtins.isAttrs workspaceSrc then workspaceSrc.outPath else workspaceSrc;
  viberootsRootPath =
    if builtins.isAttrs viberootsInput then viberootsInput.outPath else viberootsInput;
  repoRoot = workspaceRootPath;
  viberootsRoot = viberootsRootPath;
  filterViberootsRuntime = import ./packages/filter-viberoots-runtime.nix { lib = nixpkgs.lib; };
  viberootsRuntimeRoot = builtins.path {
    path = viberootsRoot;
    name = "source";
    filter = filterViberootsRuntime viberootsRoot;
  };
  viberootsSourceIdentity = {
    toolSourceRevision =
      if builtins.isAttrs viberootsInput then viberootsInput.rev or "" else "";
    sourceTreeDigest =
      if builtins.isAttrs viberootsInput then viberootsInput.narHash or "" else "";
    sourceStorePath = builtins.toString viberootsRoot;
  };
  evaluationBundle = import ./evaluation-bundle.nix { inherit repoRoot; };
  rustToolchainOverlay = final: _prev:
    let
      toolchain = final.rust-bin.stable."1.88.0".minimal.override {
        extensions = [ "clippy" "llvm-tools-preview" "rust-src" "rustfmt" ];
        targets = [ "wasm32-unknown-unknown" "wasm32-wasip1" "wasm32-unknown-emscripten" ];
      };
      rustPlatform = final.makeRustPlatform {
        cargo = toolchain;
        rustc = toolchain;
      };
      cargoLlvmCov = (final.cargo-llvm-cov.override {
        inherit rustPlatform;
      }).overrideAttrs (old: {
        # The pinned package's upstream integration check hangs on Darwin after
        # successfully compiling the executable; repository tests exercise the tool.
        doCheck = false;
        meta = old.meta // {
          # The pinned nixpkgs package is marked broken with its older Rust builder.
          # This overlay rebuilds it with the repository's supported Rust 1.88 closure.
          broken = false;
        };
      });
    in {
      viberootsRustToolchain = toolchain;
      viberootsCargoLlvmCov = cargoLlvmCov;
      viberootsRustDeveloperTools = final.symlinkJoin {
        name = "viberoots-rust-developer-tools";
        paths = [
          toolchain
          final.rust-analyzer
          cargoLlvmCov
          final.llvmPackages.clang
          final.llvmPackages.lldb
          final.llvmPackages.lld
        ];
      };
      viberootsRustPlatform = rustPlatform;
    };
  pkgs = import nixpkgs {
    inherit system;
    overlays =
      let
        haveCppOverlayFile = builtins.pathExists ../overlays/cpp-patches.nix;
        useCppOverlay = (builtins.getEnv "NIX_CPP_USE_OVERLAY") == "1";
        cppOverlays =
          if (haveCppOverlayFile && useCppOverlay) then [ (import ../overlays/cpp-patches.nix) ] else [ ];
      in
      [ gomod2nix.overlays.default rust-overlay.overlays.default rustToolchainOverlay ]
      ++ cppOverlays
      ++ (if evaluationBundle == null then [ ] else [
        (_final: _prev: { viberootsEvaluationBundle = evaluationBundle; })
      ]);
  };
  wasmtimePkgs = wasmtime-nixpkgs.legacyPackages.${system};
  nixpkgsRegistry = import ../nixpkgs-source-registry.nix {
    inputs = { inherit nixpkgs; };
  };
  resolvedNixpkgsRegistry =
    nixpkgsRegistry // {
      profiles = (nixpkgsRegistry.profiles or { }) // (nixpkgsRegistryExtension.profiles or { });
    };

  zx-wrapper = import ../lib/zx-wrapper.nix { inherit pkgs; };

  devshell = import ../devshell.nix {
    inherit pkgs viberootsRoot version releaseTag;
    buck2Input = buck2;
  };

  liveFsRoot = if evaluationBundle != null then repoRoot else
    let
      w = builtins.getEnv "WORKSPACE_ROOT";
      t = builtins.getEnv "BUCK_TEST_SRC";
    in
    if w != "" then (builtins.toPath w) else (if t != "" then (builtins.toPath t) else repoRoot);

  mkNodeMods =
    { repoFsRoot ? liveFsRoot }:
    import ../node-modules.nix {
      inherit pkgs repoFsRoot;
      repoRoot = repoRoot;
      hashesPath = repoRoot + "/projects/config/node-modules.hashes.json";
      allowLiveHashMap = evaluationBundle == null;
      prefetchedStorePathGlobal =
        let
          s = builtins.getEnv "LOCAL_PNPM_STORE";
        in
        if s != "" then (builtins.toPath s) else null;
    };

  viberootsNodeMods = import ../node-modules.nix {
    inherit pkgs;
    repoRoot = viberootsRoot;
    repoFsRoot = viberootsRoot;
    hashesPath = viberootsRoot + "/build-tools/tools/nix/node-modules.hashes.json";
    allowLiveHashMap = false;
    prefetchedStorePathGlobal =
      let
        s = builtins.getEnv "LOCAL_PNPM_STORE";
      in
      if s != "" then (builtins.toPath s) else null;
  };
  viberootsNodeModules = viberootsNodeMods.node-modules;

  prelude = import ../buck-prelude.nix { inherit pkgs; buck2Input = buck2; };

  uv2nixLib =
    let
      uvPathStr = (builtins.toString viberootsRoot) + "/third_party/uv2nix/flake.nix";
      haveUv = builtins.pathExists uvPathStr;
      uvLocal = if haveUv then import (builtins.toPath uvPathStr) else null;
      uvOut = if haveUv && uvLocal != null then uvLocal.outputs { self = null; inherit nixpkgs; } else null;
      lib = if uvOut == null then null else (uvOut.lib or null);
    in
    if lib == null then null else {
      meta = lib.meta or { };
      mkEnv =
        args:
          if (lib ? mkEnvFor) then (lib.mkEnvFor pkgs) args
          else if (lib ? mkEnv) then lib.mkEnv args
          else builtins.throw "uv2nix lib is missing mkEnv/mkEnvFor";
    };
in
{
  inherit pkgs wasmtimePkgs system zx-wrapper devshell prelude uv2nixLib evaluationBundle liveFsRoot mkNodeMods repoRoot viberootsRoot viberootsRuntimeRoot viberootsNodeMods viberootsSourceIdentity version releaseTag;
  nixpkgsRegistry = resolvedNixpkgsRegistry;
  buck2Input = buck2;
} // (if includeNodeMods then { nodeMods = mkNodeMods { }; } else { })
