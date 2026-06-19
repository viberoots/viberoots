{ pkgs, filterRepo, nodeMods, repoRoot, repoSnapshot, viberootsRoot }:
let
  version = "0.1.0";
  runtimePackagingRevision = "cjs-bundle-3-real-wrangler-ca";
  viberootsSnapshot = builtins.path {
    path = viberootsRoot;
    name = "viberoots-control-plane-source";
    filter = filterRepo viberootsRoot;
  };
  controlPlaneSourceRoot =
    if builtins.pathExists (repoRoot + "/build-tools/tools/deployments/deployment-control-plane.ts")
    then repoSnapshot
    else viberootsSnapshot;
  sourceRevision = "source-${builtins.substring 0 12 (builtins.hashString "sha256" "${builtins.toString controlPlaneSourceRoot}:${runtimePackagingRevision}")}";
  imageBuildIdentity = "nix-source-${builtins.hashString "sha256" "${sourceRevision}:${runtimePackagingRevision}"}";
  rootNodeModules = nodeMods.node-modules;
  wranglerCli = "${rootNodeModules}/node_modules/wrangler/bin/wrangler.js";
  runtimeTools = [
    pkgs.nodejs_22
    pkgs.git
    pkgs.openssh
    pkgs.opentofu
    pkgs.awscli2
    pkgs.kubectl
    pkgs.kubernetes-helm
  ];
  pathValue = pkgs.lib.makeBinPath ([ runtime ] ++ runtimeTools);

  runtime = pkgs.stdenvNoCC.mkDerivation {
    pname = "deployment-control-plane-runtime";
    inherit version;
    src = controlPlaneSourceRoot;
    nativeBuildInputs = [ pkgs.esbuild pkgs.nodejs_22 ];
    buildPhase = ''
      set -euo pipefail
      ln -s ${rootNodeModules}/node_modules node_modules
      mkdir -p dist
      esbuild build-tools/tools/deployments/deployment-control-plane.ts \
        --platform=node \
        --target=node22 \
        --bundle \
        --format=cjs \
        --packages=bundle \
        --legal-comments=none \
        --outfile=dist/deployment-control-plane.cjs
      cat > dist/deployment-control-plane-wrapper.cjs <<'EOF'
const { runDeploymentControlPlaneCommand } = require("./deployment-control-plane.cjs");
runDeploymentControlPlaneCommand()
  .then((processHandle) => {
    if (processHandle?.url) console.log(JSON.stringify({ url: processHandle.url }, null, 2));
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, async () => {
        await processHandle?.close?.();
        process.exit(0);
      });
    }
    if ((process.argv[2] || "") === "worker" && !process.argv.includes("--help")) return new Promise(() => {});
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
EOF
      node --check dist/deployment-control-plane-wrapper.cjs
    '';
    installPhase = ''
      set -euo pipefail
      mkdir -p "$out/bin" "$out/share/deployment-control-plane"
      install -m0644 dist/deployment-control-plane.cjs \
        "$out/share/deployment-control-plane/deployment-control-plane.cjs"
      install -m0755 dist/deployment-control-plane-wrapper.cjs \
        "$out/share/deployment-control-plane/deployment-control-plane-wrapper.cjs"
      resolved_wrangler_cli="$(${pkgs.coreutils}/bin/realpath ${wranglerCli})"
      cat > "$out/bin/wrangler" <<EOF
#!${pkgs.runtimeShell}
exec ${pkgs.nodejs_22}/bin/node "$resolved_wrangler_cli" "\$@"
EOF
      chmod 0755 "$out/bin/wrangler"
      cat > "$out/bin/control-plane" <<EOF
#!${pkgs.runtimeShell}
export VBR_CONTROL_PLANE_VERSION="${version}"
export VBR_CONTROL_PLANE_SOURCE_REVISION="\''${VBR_CONTROL_PLANE_SOURCE_REVISION:-${sourceRevision}}"
export VBR_CONTROL_PLANE_IMAGE_BUILD_IDENTITY="\''${VBR_CONTROL_PLANE_IMAGE_BUILD_IDENTITY:-${imageBuildIdentity}}"
export VBR_CONTROL_PLANE_IMAGE_DIGEST_STATUS="\''${VBR_CONTROL_PLANE_IMAGE_DIGEST_STATUS:-build-only}"
export VBR_CONTROL_PLANE_IMAGE_DIGEST="\''${VBR_CONTROL_PLANE_IMAGE_DIGEST:-build-only}"
exec ${pkgs.nodejs_22}/bin/node "$out/share/deployment-control-plane/deployment-control-plane-wrapper.cjs" "\$@"
EOF
      chmod 0755 "$out/bin/control-plane"
    '';
  };
  digestContract = {
    schemaVersion = "control-plane-image-digest-contract@1";
    build = {
      inherit sourceRevision imageBuildIdentity;
    };
    publication = {
      status = "build-only";
      productionUsable = false;
      registryDigestRequired = true;
    };
  };
  contract = {
    imageName = "deployment-control-plane";
    inherit version sourceRevision imageBuildIdentity;
    inherit digestContract;
    user = "10001:10001";
    entrypoint = [ "/bin/control-plane" ];
    commands = [
      "control-plane service --config /etc/deployment-control-plane/config.yaml"
      "control-plane worker --config /etc/deployment-control-plane/config.yaml"
    ];
    includedTools = [
      "node"
      "git"
      "ssh"
      "tofu"
      "aws"
      "wrangler"
      "kubectl"
      "helm"
    ];
    requiredMounts = [
      "/etc/deployment-control-plane/config.yaml"
      "/run/deployment-control-plane/credentials"
      "/var/lib/deployment-control-plane/records"
      "/var/lib/deployment-control-plane/artifacts"
      "/var/lib/deployment-control-plane/runtime"
    ];
    prohibitedPaths = [
      "/app"
      "/opt/deployment-control-plane"
      "/root/.ssh"
      "/var/lib/deployment-control-plane/records"
      "/run/deployment-control-plane/credentials"
      ".env"
      "id_rsa"
      "control-plane-database-url"
      "artifact-store-secret-access-key"
      "infisical-client-secret"
    ];
  };

  contractJson = builtins.toJSON contract;
  contractDerivation = pkgs.writeTextDir "contract.json" contractJson;

  image = pkgs.dockerTools.buildLayeredImage {
    name = contract.imageName;
    tag = sourceRevision;
    contents = [ runtime pkgs.bashInteractive pkgs.coreutils pkgs.cacert ] ++ runtimeTools;
    config = {
      User = contract.user;
      WorkingDir = "/var/lib/deployment-control-plane";
      Entrypoint = contract.entrypoint;
      Env = [
        "PATH=${pathValue}"
        "HOME=/home/deployment-control-plane"
        "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
        "NODE_EXTRA_CA_CERTS=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
        "VBR_CONTROL_PLANE_VERSION=${version}"
        "VBR_CONTROL_PLANE_SOURCE_REVISION=${sourceRevision}"
        "VBR_CONTROL_PLANE_IMAGE_BUILD_IDENTITY=${imageBuildIdentity}"
        "VBR_CONTROL_PLANE_IMAGE_DIGEST_STATUS=build-only"
        "VBR_CONTROL_PLANE_IMAGE_DIGEST=build-only"
      ];
      Labels = {
        "org.opencontainers.image.title" = "deployment-control-plane";
        "org.opencontainers.image.version" = version;
        "org.opencontainers.image.revision" = sourceRevision;
        "org.viberoots.control-plane.image-build-identity" = imageBuildIdentity;
        "org.viberoots.control-plane.digest-contract" = "build-only";
        "org.viberoots.control-plane.registry-digest-required" = "true";
      };
    };
    extraCommands = ''
      mkdir -p etc/deployment-control-plane var/lib/deployment-control-plane run/deployment-control-plane home/deployment-control-plane
      cat > etc/passwd <<'EOF'
root:x:0:0:root:/root:/bin/sh
deployment-control-plane:x:10001:10001:deployment-control-plane:/home/deployment-control-plane:/bin/sh
EOF
      cat > etc/group <<'EOF'
root:x:0:
deployment-control-plane:x:10001:
EOF
    '';
  };
in
{
  inherit runtime image contractDerivation contractJson;
}
