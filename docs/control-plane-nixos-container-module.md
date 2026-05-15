# Deployment Control Plane NixOS Container Module

NixOS hosts can import the repo-owned module and provide a small host-local configuration block:

```nix
{
  imports = [
    /srv/viberoots/build-tools/tools/nix/deployment-control-plane-container-module.nix
  ];

  services.viberoots.deploymentControlPlaneContainer = {
    enable = true;
    instanceId = "mini";
    image = "registry.example.com/platform/deployment-control-plane@sha256:REVIEWED";
    publicUrl = "https://deploy.example.test";
    publicHostName = "deploy.example.test";
    manageNginx = true;

    artifactStore.bucket = "deployment-control-plane-artifacts";

    credentials = {
      control-plane-database-url.source = "/run/secrets/deploy-control-plane-database-url";
      reviewed-source-ssh-key.source = "/run/secrets/deploy-reviewed-source-ssh-key";
      artifact-store-endpoint.source = "/run/secrets/deploy-artifact-store-endpoint";
      artifact-store-access-key-id.source =
        "/run/secrets/deploy-artifact-store-access-key-id";
      artifact-store-secret-access-key.source =
        "/run/secrets/deploy-artifact-store-secret-access-key";
      pleomino-staging-infisical-client-id.source =
        "/run/secrets/pleomino-staging-infisical-client-id";
      pleomino-staging-infisical-client-secret.source =
        "/run/secrets/pleomino-staging-infisical-client-secret";
    };
  };
}
```

Defaults:

- `containerRuntime = "podman"`
- `workerReplicas = 2`
- `bindAddress = "127.0.0.1"`
- `port = 7780`
- `webUi.enable = true`, `webUi.basePath = "/"`
- `mcp.enable = true`, `mcp.basePath = "/mcp"`
- scratch and state roots live under `/var/lib/deployment-control-plane`
- credentials are mounted at `/run/deployment-control-plane/credentials`

The image can be supplied as a complete immutable reference with `image`, or assembled from
`imageRegistry`, `imageRepository`, and `imageDigest`. The module does not hardcode a registry.

Required host-local parameters:

- `instanceId`
- `publicUrl`
- reviewed immutable image reference or registry/repository/digest parts
- `artifactStore.bucket`
- credential source files for the database URL, reviewed-source SSH key, artifact-store endpoint,
  artifact-store access key id, and artifact-store secret access key

Credential source paths are host paths such as `/run/secrets/...`. They can come from SOPS-nix,
agenix, manually provisioned files, or another secret system. The module wires those paths through
systemd `LoadCredential=` and read-only container mounts, and writes only credential file paths to
the generated non-secret config file. Secret values must not be placed in Nix options.

Set `containerRuntime = "docker"` only on hosts where Docker preserves the same mounts, credential
file behavior, health semantics, and loopback service bind. Podman is the NixOS default because it
fits the systemd and `virtualisation.oci-containers` path directly.

`manageNginx = true` only emits nginx config when `publicHostName` is set. Otherwise TLS and public
routing remain explicit host concerns.
