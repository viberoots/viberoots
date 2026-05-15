{ pkgs, nodeMods, repoSnapshot }:
let
  version = "0.1.0";
  sourceRevision = "source-${builtins.substring 0 12 (builtins.hashString "sha256" (builtins.toString repoSnapshot))}";
  imageDigest = "unknown";
  rootNodeModules = nodeMods.node-modules;
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
    src = repoSnapshot;
    nativeBuildInputs = [ pkgs.esbuild pkgs.nodejs_22 ];
    buildPhase = ''
      set -euo pipefail
      ln -s ${rootNodeModules}/node_modules node_modules
      mkdir -p dist
      esbuild build-tools/tools/deployments/deployment-control-plane.ts \
        --platform=node \
        --target=node22 \
        --bundle \
        --format=esm \
        --packages=bundle \
        --legal-comments=none \
        --outfile=dist/deployment-control-plane.mjs
    '';
    installPhase = ''
      set -euo pipefail
      mkdir -p "$out/bin" "$out/share/deployment-control-plane"
      install -m0755 dist/deployment-control-plane.mjs \
        "$out/share/deployment-control-plane/deployment-control-plane.mjs"
      ln -s ${rootNodeModules}/node_modules/.bin/wrangler "$out/bin/wrangler"
      cat > "$out/bin/deployment-control-plane" <<EOF
#!${pkgs.runtimeShell}
export VBR_CONTROL_PLANE_VERSION="${version}"
export VBR_CONTROL_PLANE_SOURCE_REVISION="\''${VBR_CONTROL_PLANE_SOURCE_REVISION:-${sourceRevision}}"
export VBR_CONTROL_PLANE_IMAGE_DIGEST="\''${VBR_CONTROL_PLANE_IMAGE_DIGEST:-${imageDigest}}"
exec ${pkgs.nodejs_22}/bin/node "$out/share/deployment-control-plane/deployment-control-plane.mjs" "\$@"
EOF
      chmod 0755 "$out/bin/deployment-control-plane"
    '';
  };

  contract = {
    imageName = "deployment-control-plane";
    inherit version sourceRevision imageDigest;
    user = "10001:10001";
    entrypoint = [ "/bin/deployment-control-plane" ];
    commands = [
      "deployment-control-plane service --config /etc/deployment-control-plane/config.yaml"
      "deployment-control-plane worker --config /etc/deployment-control-plane/config.yaml"
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
        "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
        "VBR_CONTROL_PLANE_VERSION=${version}"
        "VBR_CONTROL_PLANE_SOURCE_REVISION=${sourceRevision}"
        "VBR_CONTROL_PLANE_IMAGE_DIGEST=${imageDigest}"
      ];
      Labels = {
        "org.opencontainers.image.title" = "deployment-control-plane";
        "org.opencontainers.image.version" = version;
        "org.opencontainers.image.revision" = sourceRevision;
        "org.opencontainers.image.digest" = imageDigest;
      };
    };
    extraCommands = ''
      mkdir -p etc/deployment-control-plane var/lib/deployment-control-plane run/deployment-control-plane
    '';
  };
in
{
  inherit runtime image contractDerivation contractJson;
}
