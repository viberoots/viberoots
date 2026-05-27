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
      control-plane-token.source = "/run/secrets/deploy-control-plane-token";
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
- `networkMode = "bridge"`
- `serviceHost = "0.0.0.0"`
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
- credential source files for the database URL, bearer token, reviewed-source SSH key,
  artifact-store endpoint, artifact-store access key id, and artifact-store secret access key

Credential source paths are host paths such as `/run/secrets/...`. They can come from SOPS-nix,
agenix, manually provisioned files, or another secret system. The module wires those paths through
systemd `LoadCredential=`, stages them into per-container directories owned by uid/gid `10001`, and
mounts those directories read-only into the containers. The generated non-secret config file contains
only credential file paths. Secret values must not be placed in Nix options.

Set `containerRuntime = "docker"` only on hosts where Docker preserves the same mounts, credential
file behavior, health semantics, and loopback service bind. Podman is the NixOS default because it
fits the systemd and `virtualisation.oci-containers` path directly.

Use `networkMode = "host"` only when the container must reach host-loopback dependencies such as a
local Postgres or MinIO instance. Pair host networking with `serviceHost = "127.0.0.1"` when the
control plane should remain reachable only through the host's local reverse proxy.

`manageNginx = true` only emits nginx config when `publicHostName` is set. Otherwise TLS and public
routing remain explicit host concerns.

## Mini Cloud-Shaped Profile

Mini can import `deployment-control-plane-mini-cloud-profile.nix` to keep mini as ingress while
moving authoritative state to external Postgres and S3-compatible storage:

```nix
{
  imports = [
    /srv/viberoots/build-tools/tools/nix/deployment-control-plane-mini-cloud-profile.nix
  ];

  services.viberoots.miniCloudControlPlaneProfile = {
    enable = true;
    image = "registry.example.com/platform/deployment-control-plane@sha256:REVIEWED";
    publicUrl = "https://mini.example.test";
    publicHostName = "mini.example.test";
    artifactBucket = "mini-control-plane-artifacts";
    credentials = {
      control-plane-database-url.source = "/run/secrets/external-postgres-url";
      control-plane-token.source = "/run/secrets/deploy-control-plane-token";
      reviewed-source-ssh-key.source = "/run/secrets/deploy-reviewed-source-ssh-key";
      artifact-store-endpoint.source = "/run/secrets/artifact-store-endpoint";
      artifact-store-access-key-id.source = "/run/secrets/artifact-store-access-key-id";
      artifact-store-secret-access-key.source = "/run/secrets/artifact-store-secret-access-key";
    };
  };
}
```

This profile sets `instanceId = "mini"`, uses Podman unless overridden by the base module, runs the
same service plus worker container shape as cloud hosts, and keeps local records/artifacts under
scratch/cache paths. It also enables the mini migration preflight gate by default. During the live
database cut, protected/shared submit requests must include `miniMigrationEvidence` with passed state
sync, restore, rollback, and migrated-row evidence before the service queues work. After external
persistence is enabled, mini-local database and artifact files are not authoritative.

## Mini Database Migration Runbook

Before mini points at external Postgres, capture a dry-run migration report for these durable tables:
`submissions`, `queue`, `control_plane_audit_events`, `current_stage_state`, `deploy_records`, and
`idempotency`. Include row counts, source and destination database identities, source revision, and a
timestamped operator identity.

Cutover gates:

1. Stop protected/shared deploy admission on mini.
2. Sync mini control-plane rows into external Postgres.
3. Run restore validation against the external database and object store.
4. Record rollback evidence proving the previous mini service profile can be restored.
5. Enable the mini cloud-shaped profile with the external database URL and object-store credentials.
6. Run the live-gated mini check for service health, worker heartbeat, and credential file
   permissions.
7. Re-enable protected/shared deploy admission only after the migration preflight evidence passes.

The live-gated mini validation is opt-in. Set `VBR_CONTROL_PLANE_LIVE_MINI_VALIDATION=1`,
`VBR_CONTROL_PLANE_LIVE_MINI_URL`, `VBR_CONTROL_PLANE_LIVE_MINI_TOKEN_FILE`, and
`VBR_CONTROL_PLANE_LIVE_MINI_CREDENTIAL_DIR` on mini to check `/healthz`, at least one running worker
heartbeat, and credential files owned by uid/gid `10001` with no group/world permission bits.

Rollback returns to the previous mini service profile, restores the previous database URL and
artifact state, and keeps the external database frozen for inspection until the operator either
retries the migration or formally abandons it.
