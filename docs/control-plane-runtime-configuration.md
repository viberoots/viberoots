# Deployment Control Plane Runtime Configuration

Containerized service and worker processes read one mounted YAML file before they accept work.
Production hosts should mount it at:

```text
/etc/deployment-control-plane/config.yaml
```

Tests and local fixtures may pass an explicit config path to the loader.

## YAML Shape

```yaml
instanceId: mini
mode: protected-shared

service:
  host: 0.0.0.0
  port: 7780
  publicUrl: https://deploy.apps.example.com

storage:
  recordsRoot: /var/lib/deployment-control-plane/records
  artifactStagingRoot: /var/lib/deployment-control-plane/artifacts
  runtimeRoot: /var/lib/deployment-control-plane/runtime
  artifactStore:
    kind: s3-compatible
    bucket: deployment-control-plane-artifacts
    region: auto
    endpointFile: /run/deployment-control-plane/credentials/artifact-store-endpoint
    accessKeyIdFile: /run/deployment-control-plane/credentials/artifact-store-access-key-id
    secretAccessKeyFile: /run/deployment-control-plane/credentials/artifact-store-secret-access-key

database:
  urlFile: /run/deployment-control-plane/credentials/control-plane-database-url

credentials:
  directory: /run/deployment-control-plane/credentials
  defaults:
    infisicalClientIdFilePattern: "{deploymentId}-infisical-client-id"
    infisicalClientSecretFilePattern: "{deploymentId}-infisical-client-secret"

reviewedSource:
  sshKeyFile: /run/deployment-control-plane/credentials/reviewed-source-ssh-key
  sshKnownHostsFile: /etc/deployment-control-plane/github-known-hosts

webUi:
  enabled: true
  basePath: /

mcp:
  enabled: true
  basePath: /mcp
```

Required fields are `instanceId`, `service.publicUrl`, `storage.artifactStore.bucket`,
artifact-store credential files, `database.urlFile`, `credentials.directory`, and reviewed-source
SSH files. Defaults are the values shown above for `mode`, service host and port, local scratch
roots, artifact-store kind and region, Infisical filename patterns, web UI, and MCP.

## Startup Validation

The loader validates shape, enum values, URL base paths, and credential path policy before service
or worker startup proceeds. Startup then checks required file-backed credentials exist as files.
Missing database URL, artifact-store, reviewed-source key, or known-hosts files fail closed.

Credential paths for database and artifact-store secrets must be under `credentials.directory`.
Reviewed-source SSH paths are explicit reviewed paths and may live outside that directory, such as
known-hosts files under `/etc/deployment-control-plane`.

Credential paths are rejected when they point into:

- the repo checkout
- `/nix/store`
- ordinary dotenv files
- image-layer locations such as `/app` or `/opt/deployment-control-plane`
- command-line argument strings

## Credential Directory Contract

The credential directory is the only portable secret surface for container runtime credentials.
Secrets are file-backed and are never supplied through image contents, Nix store paths, ordinary
environment files, command-line arguments, deployment records, diagnostics, or logs.

Infisical Universal Auth credentials are deployment-scoped by default:

```text
{deploymentId}-infisical-client-id
{deploymentId}-infisical-client-secret
```

Reviewed deployment metadata may override these filenames for one deployment, but overrides remain
plain filenames resolved inside `credentials.directory`. There are no global Infisical tenant,
project, site URL, environment, client id, or client secret defaults in the runtime config.

## Artifact Store Contract

`storage.artifactStore` points at an S3-compatible bucket. The endpoint, access key id, and secret
access key are file-backed credentials resolved through `credentials.directory`; the config may name
the bucket and region, but it does not embed secret values.

Artifact-store credentials should be scoped to the configured bucket and the control-plane artifact
key prefix used by this instance. Normal operation needs object writes, direct object reads, and
object metadata reads for keys the control plane records in the database. Broad bucket
administration, bucket creation/deletion, policy management, cross-bucket access, and list-wide
permissions are not required for service or worker correctness.

Admitted artifact payloads and execution-snapshot payloads are written by immutable object key. The
database stores the object key, bucket, digest, byte size, content type, provenance fields, and
admitted run metadata. Workers read objects by direct key and verify the recorded digest, size, and
provenance before materializing a temporary execution copy. Object listing is not a correctness
mechanism.

Production container mode requires this object store path. Local filesystem artifact storage is only
for tests, local fixture mode, or temporary staging directories that are scrubbed after worker use.
Shared POSIX filesystems must not be used as the production artifact authority.

## CI Boundary

CI submits reviewed requests to the deployment control plane. CI must not mount database,
artifact-store, provider, Vault, Infisical, reviewed-source workload, or deployment credential files.
Those credentials belong only to the protected control-plane runtime.
