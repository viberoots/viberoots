# Deployment Control Plane Runtime Configuration

Containerized service and worker processes read one mounted YAML file before they accept work.
Production hosts should mount it at:

```text
/etc/deployment-control-plane/config.yaml
```

Tests and local fixtures may pass an explicit config path to the loader.

## Process Commands

The container image exposes one long-running command surface:

```bash
deployment-control-plane service --config /etc/deployment-control-plane/config.yaml
deployment-control-plane worker --config /etc/deployment-control-plane/config.yaml
```

Both modes validate the mounted config, required credential files, database URL credential, and
artifact-store credential files before accepting work. The service binds to `service.host` and
`service.port`; workers consume the durable database queue and use the configured artifact store.

Service probes:

- `GET /healthz` returns process liveness, the non-secret instance id, and image metadata.
- `GET /readyz` checks database connectivity, artifact-store metadata-read connectivity, and worker
  heartbeat visibility.
- `GET /api/v1/worker-heartbeats` returns authenticated worker heartbeat summaries.

Workers write heartbeat rows while starting, running, stopping, and stopped. `SIGTERM` and
`SIGINT` trigger the same graceful shutdown path as an explicit runtime close. Shutdown stops the
poll loop, aborts the active worker run, and stops queue-claim lease renewal immediately. The worker
still waits for the current fenced execution attempt to return before the process exits, but it no
longer extends authority while waiting. Replacement workers may claim the submission only after the
last renewed lease expires and must still pass claim-token and fencing checks before mutating
provider state.

Image metadata is non-secret and comes from the reviewed image/runtime environment:

- `VBR_CONTROL_PLANE_VERSION`
- `VBR_CONTROL_PLANE_SOURCE_REVISION`
- `VBR_CONTROL_PLANE_IMAGE_DIGEST`

Operators should set `VBR_CONTROL_PLANE_IMAGE_DIGEST` from the pinned image reference used by the
host module, Compose file, or Podman invocation. Status APIs report this value so operators do not
need to infer identity from a mutable image tag.

## YAML Shape

```yaml
instanceId: mini
mode: protected-shared

service:
  host: 0.0.0.0
  port: 7780
  publicUrl: https://deploy.apps.example.com
  tokenFile: /run/deployment-control-plane/credentials/control-plane-token

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

Required fields are `instanceId`, `service.publicUrl`, `service.tokenFile`,
`storage.artifactStore.bucket`, artifact-store credential files, `database.urlFile`,
`credentials.directory`, and reviewed-source SSH files. Defaults are the values shown above for
`mode`, service host and port, local scratch roots, artifact-store kind and region, Infisical
filename patterns, web UI, and MCP.

`webUi.basePath` controls both the browser UI and the same-origin read APIs used by that UI. The
base path can be `/` or a reverse-proxy prefix such as `/deploy-control-plane`; the service strips
that prefix before routing UI assets and `/api/v1/read/*` requests.

`mcp.basePath` controls the read-only HTTP MCP endpoint. The endpoint is enabled by default at
`/mcp` and can be disabled with `mcp.enabled: false` when a host should not expose agent
inspection. See [Deployment Control Plane MCP](/Users/kiltyj/Code/viberoots/docs/control-plane-mcp.md)
for the v1 tool list, authentication requirements, audit behavior, and fixture-only unauthenticated
mode.

## Startup Validation

The loader validates shape, enum values, URL base paths, and credential path policy before service
or worker startup proceeds. Startup then checks required file-backed credentials exist as files.
Missing database URL, service token, artifact-store, reviewed-source key, or known-hosts files fail
closed.

Credential paths for database, service token, artifact-store, and Infisical secrets must be under
`credentials.directory`. Reviewed-source SSH paths are explicit reviewed paths and may live outside
that directory, such as known-hosts files under `/etc/deployment-control-plane`.

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

Credential file manifest:

| Purpose                            | Required filename                        |
| ---------------------------------- | ---------------------------------------- |
| Database URL                       | `control-plane-database-url`             |
| Service bearer token               | `control-plane-token`                    |
| Artifact-store endpoint            | `artifact-store-endpoint`                |
| Artifact-store access key id       | `artifact-store-access-key-id`           |
| Artifact-store secret access key   | `artifact-store-secret-access-key`       |
| Reviewed-source SSH key            | `reviewed-source-ssh-key`                |
| Deployment Infisical client id     | `{deploymentId}-infisical-client-id`     |
| Deployment Infisical client secret | `{deploymentId}-infisical-client-secret` |

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

Duplicate writes are accepted only when the existing object body, digest, content type, and custom
metadata already match the durable artifact record. A mismatching object or metadata record is a
closed failure, not an overwrite opportunity.

| Candidate backend        | Endpoint form                                           | Region notes                                              | Status                                                |
| ------------------------ | ------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| Supabase Storage S3      | path-style endpoint such as `/storage/v1/s3`            | use the project S3 region value                           | live conformance required before production selection |
| Cloudflare R2            | path-style account endpoint                             | usually signs with `auto`                                 | live conformance required before production selection |
| AWS S3                   | path-style endpoint or `{bucket}` virtual-host endpoint | signs with the bucket region                              | live conformance required before production selection |
| MinIO-compatible fixture | path-style endpoint                                     | local fixture region is arbitrary but signed consistently | fixture-only unless separately reviewed               |

Run the live-gated compatibility test only against temporary buckets or temporary prefixes:
`VBR_ARTIFACT_STORE_LIVE_ENDPOINT`, `VBR_ARTIFACT_STORE_LIVE_BUCKET`,
`VBR_ARTIFACT_STORE_LIVE_REGION`, `VBR_ARTIFACT_STORE_LIVE_ACCESS_KEY_ID`,
`VBR_ARTIFACT_STORE_LIVE_SECRET_ACCESS_KEY`, and optional
`VBR_ARTIFACT_STORE_LIVE_PREFIX`. A signature or authentication failure that mentions credential
scope, `AuthorizationHeaderMalformed`, or an unexpected signing region usually means the endpoint
and configured region do not agree.

Production container mode requires this object store path. Local filesystem artifact storage is only
for tests, local fixture mode, or temporary staging directories that are scrubbed after worker use.
Shared POSIX filesystems must not be used as the production artifact authority.

## Environment Boundary

Long-running service and worker processes read credentials from configured files. Production startup
fails closed when database URLs, service tokens, reviewed-source tokens, artifact-store keys,
Infisical credentials, Vault credentials, AWS/MinIO keys, or provider tokens are present in ambient
environment variables. Local fixture mode may opt out explicitly for tests.

Child process environments are scrubbed of database URLs, service tokens, ambient
Vault/Infisical/provider tokens, and Kubernetes/AWS secrets by default. Provider operations may add
only reviewed operation-specific credential variables for the command they invoke.

## CI Boundary

CI submits reviewed requests to the deployment control plane. CI must not mount database,
artifact-store, provider, Vault, Infisical, reviewed-source workload, or deployment credential files.
Those credentials belong only to the protected control-plane runtime.
