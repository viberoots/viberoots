{ pkgs, zx-wrapper, viberootsRoot }:
let
  pnpm11 = import ../../pnpm-11.nix { inherit pkgs; };
  workerPaths = [
    pkgs.bash
    pkgs.cacert
    pkgs.coreutils
    pkgs.findutils
    pkgs.gnugrep
    pkgs.gnused
    pkgs.gawk
    pkgs.rsync
    pkgs.git
    pkgs.nodejs_22
    pkgs.python3
    pkgs.uv
    pkgs.nix
    pnpm11
    pkgs.yq
    pkgs.buck2
    pkgs.direnv
    zx-wrapper
  ];
  declaredRemoteExecutablePackages = {
    attic = pkgs.attic-client;
    cachix = pkgs.cachix;
  };
  declaredRemoteExecutablePaths = builtins.attrValues declaredRemoteExecutablePackages;
  ciPaths = workerPaths ++ declaredRemoteExecutablePaths;
  primitiveInventory = builtins.toJSON {
    allowedPrimitives = [
      "kernel-sandbox-support"
      "disk-capacity"
      "network-reachability"
      "mounted-credentials-or-workload-identity"
      "trust-anchors"
      "clock"
      "minimal-nix-bootstrap"
    ];
    forbiddenExecutablePrimitives = [
      "ssh"
      "workload-identity-cli"
      "artifact-upload-cli"
      "metrics-cli"
      "logging-cli"
      "provider-cli"
      "cache-publisher-cli"
      "worker-registration-cli"
    ];
  };
  primitiveInventoryFile = pkgs.writeText "remote-runtime-primitives.json" primitiveInventory;

  mkClosure =
    name: paths:
      pkgs.symlinkJoin {
        inherit name paths;
        postBuild = ''
          mkdir -p "$out/share/viberoots"
          ln -s ${viberootsRoot} "$out/share/viberoots-source"
          cp ${primitiveInventoryFile} "$out/share/viberoots/remote-runtime-primitives.json"
        '';
      };
in
{
  remote-worker-tools = mkClosure "remote-worker-tools" workerPaths;
  remote-ci-tools = mkClosure "remote-ci-tools" ciPaths;
}
