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

Before starting either long-running process from a generated setup bundle, run the credential
preflight against that bundle:

```bash
deployment-control-plane credential-preflight \
  --bundle-dir ./cloud-control-profile \
  --out ./cloud-control-profile/credential-preflight.json
```

If your current working directory is the generated bundle, use
`deployment-control-plane credential-preflight --bundle-dir . --out ./credential-preflight.json`.
The preflight reads `credential-manifest.json` and `config.yaml`, verifies the exact file-backed
credential contract, checks `credential-map.json` for explicit reviewed backend or host credential
sources, checks safe URL-shaped credential files, rejects ambient/env-var-only credential sources,
and keeps diagnostics redacted.

Production cloud setup generates `config.yaml` from a typed runtime input file plus reviewed
provider/IaC evidence. The generated config is not a hand-edit surface for production auth or
Infisical metadata. Setup rejects default placeholders such as `https://auth.example.test`,
fixture-only evidence, and placeholder Infisical project metadata unless an explicit local/fixture
mode is selected. Generated bundle provenance is recorded in `auth-provider-profile.json`,
`credential-map.json`, and `residual-action-checklist.json` next to `config.yaml`.

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
- `VBR_CONTROL_PLANE_IMAGE_BUILD_IDENTITY`
- `VBR_CONTROL_PLANE_IMAGE_REF`
- `VBR_CONTROL_PLANE_IMAGE_DIGEST`
- `VBR_CONTROL_PLANE_IMAGE_INSPECTED_DIGEST`
- `VBR_CONTROL_PLANE_IMAGE_TAG`
- `VBR_CONTROL_PLANE_IMAGE_DIGEST_STATUS`

The reviewed image contract records a deterministic `nix-source-<hash>` build identity, not a
verified OCI digest. Registry publication evidence records the immutable registry manifest digest
after `skopeo inspect`, and host profiles pin that registry digest. Status APIs report
`verified-registry-publication` only when the host profile supplies the full publication contract:
source revision, verified image reference, build identity, pinned digest, registry-inspected digest,
publication tag, and digest status. A digest value by itself remains `build-only`.

## YAML Shape

```yaml
instanceId: mini
mode: protected-shared
processMode: fully-enabled

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
  infisicalDeployments:
    - deploymentId: pleomino-staging
      siteUrl: https://app.infisical.com
      projectId: pleomino-staging-infisical-project
      environment: production

reviewedSource:
  mode: ssh
  sshKeyFile: /run/deployment-control-plane/credentials/reviewed-source-ssh-key
  sshKnownHostsFile: /run/deployment-control-plane/credentials/reviewed-source-known-hosts

webUi:
  enabled: true
  basePath: /

mcp:
  enabled: true
  basePath: /mcp

authProvider:
  kind: generic-oidc-jwks
  issuer: https://auth.example.com
  audience:
    - deployments-control-plane
  jwksUrl: https://auth.example.com/.well-known/jwks.json
  tokenSupport: jwt
  cliLoginMode: pkce-public-callback
  callback:
    externalHost: deploy-auth.apps.example.com
    externalPath: /oidc/callback
  claims:
    userIdClaim: sub
    emailClaim: email
    roleClaim: groups
    servicePrincipalClaim: azp
  roleGroups:
    deployer:
      - deployers
    admissionReporter:
      - admission-reporters
    admin:
      - deploy-admins
  servicePrincipals:
    ci-deployer: jenkins
```

Required fields are `instanceId`, `service.publicUrl`, `service.tokenFile`,
`storage.artifactStore.bucket`, artifact-store credential files, `database.urlFile`,
`credentials.directory`, and one reviewed-source credential mode. Defaults are the values shown above for
`mode`, service host and port, local scratch roots, artifact-store kind and region, Infisical
filename patterns, reviewed-source mode, web UI, and MCP.

Reviewed source supports two mutually exclusive file-backed modes:

- SSH: `mode: ssh`, `reviewed-source-ssh-key`, and `reviewed-source-known-hosts`.
- GitHub App: `mode: github-app`, `reviewed-source-github-app-id`,
  `reviewed-source-github-app-installation-id`, and
  `reviewed-source-github-app-private-key`.

GitHub App mode exchanges the mounted app credentials for a short-lived installation token only
inside the reviewed-source fetch helper. The raw app id, installation id, private key, and token are
not accepted from production ambient environment variables.

`processMode` controls standby behavior during cloud cutover and rollback drills:

- `fully-enabled` allows both `service` and `worker` commands.
- `service-only` allows reads and status through the service while refusing worker startup.
- `worker-only` allows workers while refusing service startup.
- `fully-disabled` refuses both long-running commands.

Operators may pass `--process-mode` to a process command for a reviewed one-off override, but the
same mode gate is applied before the service binds or a worker claims queue entries.

`webUi.basePath` controls both the browser UI and the same-origin read APIs used by that UI. The
base path can be `/` or a reverse-proxy prefix such as `/deploy-control-plane`; the service strips
that prefix before routing UI assets and `/api/v1/read/*` requests.

`mcp.basePath` controls the read-only HTTP MCP endpoint. The endpoint is enabled by default at
`/mcp` and can be disabled with `mcp.enabled: false` when a host should not expose agent
inspection. See [Deployment Control Plane MCP](/Users/kiltyj/Code/viberoots/docs/control-plane-mcp.md)
for the v1 tool list, authentication requirements, audit behavior, and fixture-only unauthenticated
mode.

`authProvider` describes the identity provider that authenticates operators and service principals.
When omitted, the loader keeps the existing local OIDC identity-provider adapter defaults. Cloud
hosts should configure `generic-oidc-jwks` with a reviewed issuer, audience, JWKS URL, explicit
claim names, role/group mapping, service-principal mapping, CLI login mode, and public callback
host/path. Supabase Auth and WorkOS are valid identity-provider candidates after live review, but
they are not deployment providers and do not receive mutation authority.

Auth providers only authenticate and return claims. The deployment control-plane service remains
the authority that turns mapped claims into deployer, admission reporter, admin, or service
principal grants; workers and provider clients do not consume browser SSO sessions directly.

Cloud setup may import auth-provider profiles for local compatibility mode, Supabase Auth, WorkOS,
or an external OIDC provider. Supabase Auth and WorkOS remain structured OIDC/JWKS profile evidence
layers; they do not become deployment mutation authority. The profile must bind issuer, audience,
JWKS URL, callback registration, role/group mappings, service principals, environment, and evidence
digest to the generated runtime config.

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

Generated AWS setup bundles include `credential-map.json`, which maps each
`credential-manifest.json` entry to an explicit reviewed secret-backend reference or host credential
source. The map is evidence/import shaped by default: it records Infisical project/environment/path
evidence, Universal Auth machine identity evidence, least-privilege scope evidence, reviewed-source
SSH or GitHub App import evidence, database URL evidence tied to the selected Supabase profile and
public/private hostname, control-plane token generation/import evidence, and rotation/stale
credential posture. Secret names and access policies may be generated as write plans; secret values
must not be persisted outside the reviewed backend.

Infisical Universal Auth credentials are deployment-scoped by default:

```text
{deploymentId}-infisical-client-id
{deploymentId}-infisical-client-secret
```

Reviewed deployment metadata may override these filenames for one deployment, but overrides remain
plain filenames resolved inside `credentials.directory`. There are no global Infisical tenant,
project, site URL, environment, client id, or client secret defaults in the runtime config.
Production validation checks every entry in `credentials.infisicalDeployments`; missing,
unreadable, empty, or filename-mismatched files fail before the service or worker starts.

Credential staging evidence is generated with:

```bash
deployment-control-plane credential-staging \
  --bundle-dir ./cloud-control-profile \
  --out ./cloud-control-profile/credential-staging.json
```

The evidence is non-secret. It records the current manifest digest, credential-map digest, runtime
config digest, backend path references, generated secret write-plan ids, host credential source ids,
stale detection results, service and worker restart evidence, and host mount evidence. The host
mount evidence must name the filename set, uid/gid ownership, permissions, and target path
`/run/deployment-control-plane/credentials`. The implemented AWS profile verifies the existing
bind-mounted credential directory; it does not assume systemd `LoadCredential=`.

Credential rotation evidence is generated separately:

```bash
deployment-control-plane credential-rotation \
  --bundle-dir ./cloud-control-profile \
  --apply-rotation \
  --out ./cloud-control-profile/credential-rotation.json \
  --rotated-map-out ./cloud-control-profile/credential-map.rotated.json
```

Rotation evidence must preserve non-secret config semantics and fail closed when active stale
entries remain. Protected/shared setup and cutover consume fresh `credential-staging.json` tied to
the current `credential-manifest.json` and `credential-map.json`; optional rotation evidence is
validated when present.

Live credential backend writes are disabled unless
`VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING=1` is set and the operator also selects the explicit
`--live` command path. The live path requires a reviewed `--live-backend-profile` file and either
local inspection of `--credential-directory /run/deployment-control-plane/credentials` or a
deployment-owned `--live-host-verification-evidence` result from the reviewed remote host verifier.
The profile supplies the Infisical site, Universal Auth credential file contents, concrete project,
environment, generated secret path, deployment identity evidence, and a concrete least-privilege
scope payload covering exact secret names and create/read/update permissions. Generated secret
values are created in memory and written directly to the backend; evidence records only non-secret
selectors, scope payloads, write-plan ids, backend versions, and host filesystem metadata.

Local host verification is preferred when the staging command runs on the target host. The local
verifier inspects the real `/run/deployment-control-plane/credentials` directory and records the
filename set, uid/gid `10001`, mode `0400`, target path, and generated AWS bind-mounted directory
wiring. It does not require a remote verifier profile.

Remote host verification is accepted only with both a verifier result profile and a separate
reviewed verifier trust profile. The result profile must bind the remote evidence payload digest to
the verifier identity, reviewed source host, target credential directory, credential filename set,
and AWS bind-mount wiring proof. The trust profile must provide the reviewed Ed25519 public key
fingerprint/public key or reviewed deployment-owned verifier command digest. A result profile with
only a matching digest, `reviewed-remote-verifier`, a self-declared public key, a hand-authored
command attestation, or a `sig:*` marker is rejected.
Any trust anchor embedded inside the submitted verifier result is ignored. Persisted staging,
runbook, and cutover validation reject remote verifier evidence unless a separate reviewed trust
anchor is supplied by the validation call site.

Remote verifier trust is fresh evidence. Profiles are rejected when their review timestamp is
invalid, their expiry has passed, or the attested command provenance is stale. Regenerate remote
verification when the host identity, credential directory, filename set, or AWS bind-mounted
credential wiring changes.

Externally supplied `--secret-backend-evidence` and `--host-mount-evidence` files are reviewed proof
inputs only. They remain useful for externally supplied/imported credentials, but they do not mark a
credential-staging run as deployment-owned live backend write or deployment-owned live host
verification.
Persisted staging or rotation evidence containing both `externalReviewedBackendProof` and
`deploymentOwnedLiveBackendWrite` is rejected by setup-doctor, runbook, and cutover validators.

Credential file manifest:

| Purpose                            | Required filename                                  |
| ---------------------------------- | -------------------------------------------------- |
| Database URL                       | `control-plane-database-url`                       |
| Service bearer token               | `control-plane-token`                              |
| Artifact-store endpoint            | `artifact-store-endpoint`                          |
| Artifact-store access key id       | `artifact-store-access-key-id` in `files` mode     |
| Artifact-store secret access key   | `artifact-store-secret-access-key` in `files` mode |
| Reviewed-source SSH key            | `reviewed-source-ssh-key`                          |
| Reviewed-source known hosts        | `reviewed-source-known-hosts`                      |
| Deployment Infisical client id     | `{deploymentId}-infisical-client-id`               |
| Deployment Infisical client secret | `{deploymentId}-infisical-client-secret`           |

## Artifact Store Contract

`storage.artifactStore` points at an S3-compatible bucket and declares `provider` plus
`credentialMode`. `files` mode uses the endpoint, access key id, and secret access key files under
`credentials.directory`. `aws-instance-profile` mode is valid only for provider `aws-s3` on EC2:
the endpoint file remains non-secret runtime input, while access keys come from the reviewed IMDSv2
instance-profile path and are never written to config, evidence, records, or logs. Supabase Storage
S3, Cloudflare R2, and generic S3-compatible backends must use `files` mode.

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
`VBR_ARTIFACT_STORE_LIVE_PREFIX`. A signature or authentication failure that mentions artifact
credential
scope, `AuthorizationHeaderMalformed`, or an unexpected signing region usually means the endpoint
and configured region do not agree.

Credential staging troubleshooting:

- Failed remote verifier signature: refresh the reviewed public key profile or use the local host
  verifier on the target host.
- Remote verifier identity mismatch: compare the verifier identity in the remote evidence with the
  trust profile and reviewed host material.
- Stale remote verifier provenance: regenerate the profile so the review/expiry window covers the
  current source host, target directory, filename set, and AWS bind mount evidence.
- Mixed proof/write artifact: do not combine `--secret-backend-evidence` proof with
  `deploymentOwnedLiveBackendWrite`; rerun either proof-only staging or live staging.

Production container mode requires this object store path. Local filesystem artifact storage is only
for tests, local fixture mode, or temporary staging directories that are scrubbed after worker use.
Shared POSIX filesystems must not be used as the production artifact authority.

## Environment Boundary

Long-running service and worker processes read credentials from configured files. Production startup
fails closed when database URLs, service tokens, reviewed-source tokens, artifact-store keys,
Infisical credentials, Vault credentials, AWS/MinIO keys, AWS profile/default-chain inputs, or
provider tokens are present in ambient environment variables. Local fixture mode may opt out
explicitly for tests.

Child process environments are scrubbed of database URLs, service tokens, ambient
Vault/Infisical/provider tokens, and Kubernetes/AWS secrets by default. Provider operations may add
only reviewed operation-specific credential variables for the command they invoke.

## CI Boundary

CI submits reviewed requests to the deployment control plane. CI must not mount database,
artifact-store, provider, Vault, Infisical, reviewed-source workload, or deployment credential files.
Those credentials belong only to the protected control-plane runtime.
