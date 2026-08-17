{ pkgs, zx-wrapper, viberootsRoot, viberootsRuntimeRoot, viberootsSourceIdentity, viberootsNodeModules ? null }:
let
  pnpm11 = import ../../pnpm-11.nix { inherit pkgs; };
  pythonPackages = pkgs.python3Packages.overrideScope (final: prev: {
    plumbum = prev.plumbum.overridePythonAttrs (_old: {
      doCheck = false;
    });
  });
  copier = pythonPackages.copier;
  workerPaths = [
    pkgs.bash
    pkgs.cacert
    pkgs.coreutils
    pkgs.curl
    pkgs.findutils
    pkgs.gnugrep
    pkgs.gnused
    pkgs.gawk
    pkgs.gnutar
    pkgs.gzip
    pkgs.jq
    pkgs.llvmPackages.clang
    pkgs.patch
    pkgs.openssl
    pkgs.rsync
    pkgs.lsof
    pkgs.unixtools.ps
    pkgs.git
    pkgs.nodejs_22
    pkgs.python3
    pkgs.uv
    pkgs.viberootsRustToolchain
    copier
    pkgs.gomod2nix
    pkgs.nix
    pnpm11
    pkgs.prettier
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
  sourceIdentityFile = pkgs.writeText "remote-ci-tools-source-identity.json"
    (builtins.toJSON ({
      schema = "viberoots.remote-ci-tools-source-identity.v2";
    } // viberootsSourceIdentity));

  mkClosure =
    { name, paths, sourceRoot, includeSourceIdentity ? false }:
      pkgs.symlinkJoin {
        inherit name paths;
        postBuild = ''
          mkdir -p "$out/share/viberoots"
          ln -s ${sourceRoot} "$out/share/viberoots-source"
          ${pkgs.lib.optionalString (viberootsNodeModules != null) ''
            ln -s ${viberootsNodeModules}/node_modules "$out/node_modules"
          ''}
          cp ${primitiveInventoryFile} "$out/share/viberoots/remote-runtime-primitives.json"
          ${pkgs.lib.optionalString includeSourceIdentity ''
            cp ${sourceIdentityFile} "$out/share/viberoots/source-identity.json"
          ''}
        '';
      };
in
{
  remote-worker-tools = mkClosure {
    name = "remote-worker-tools";
    paths = workerPaths;
    sourceRoot = viberootsRuntimeRoot;
  };
  remote-ci-tools = mkClosure {
    name = "remote-ci-tools";
    paths = ciPaths;
    sourceRoot = viberootsRoot;
    includeSourceIdentity = true;
  };
}
