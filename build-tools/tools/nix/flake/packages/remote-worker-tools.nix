{ pkgs, zx-wrapper }:
let
  workerPaths = [
    pkgs.bash
    pkgs.coreutils
    pkgs.findutils
    pkgs.gnugrep
    pkgs.gnused
    pkgs.gawk
    pkgs.git
    pkgs.nodejs_22
    pkgs.pnpm
    pkgs.buck2
    zx-wrapper
  ];
  declaredRemoteExecutablePackages = {
  };
  declaredRemoteExecutablePaths = builtins.attrValues declaredRemoteExecutablePackages;
  ciPaths = workerPaths ++ [ pkgs.nix ] ++ declaredRemoteExecutablePaths;
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
          cp ${primitiveInventoryFile} "$out/share/viberoots/remote-runtime-primitives.json"
        '';
      };
in
{
  remote-worker-tools = mkClosure "remote-worker-tools" workerPaths;
  remote-ci-tools = mkClosure "remote-ci-tools" ciPaths;
}
