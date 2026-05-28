# Deployment Control Plane Non-NixOS Host Profile

The non-NixOS profile is an operational example for running the reviewed control-plane image on a
host that provides Docker-compatible Compose or Podman. It is not a separate deployment authority:
the control-plane service remains the only protected mutation boundary, and the profile must keep
the same service and worker process contract as the NixOS module.

Profile files live in
`build-tools/tools/deployments/control-plane-host-profile/`:

- `compose.yaml` runs one service container and two worker containers.
- `config.example.yaml` is the production-shaped mounted config.
- `config.local-smoke.yaml` is a local fixture config that disables web UI and MCP exposure.
- `podman-run.example.txt` shows equivalent direct Podman commands when Compose is unavailable.
- `saas-oci-profile.yaml` describes the generic SaaS OCI substrate contract.
- `substrate-conformance.ts` checks runtime behavior that the image cannot pin.

## Required Host Inputs

Real hosts must provide:

- `VBR_CONTROL_PLANE_IMAGE_REGISTRY`, `VBR_CONTROL_PLANE_IMAGE_REPOSITORY`, and
  `VBR_CONTROL_PLANE_IMAGE_DIGEST` so the runtime image is assembled as
  `<registry>/<repository>@sha256:<digest>`
- `VBR_CONTROL_PLANE_IMAGE_BUILD_IDENTITY` so runtime status can tie the pinned registry digest
  back to the reviewed Nix image contract
- `VBR_CONTROL_PLANE_SOURCE_REVISION`, `VBR_CONTROL_PLANE_IMAGE_INSPECTED_DIGEST`, and
  `VBR_CONTROL_PLANE_IMAGE_TAG` from the reviewed registry publication evidence
- an external Postgres database URL credential file
- an S3-compatible artifact-store bucket and credential files
- a reviewed-source SSH key credential file
- a reviewed-source known-hosts credential file mounted under
  `/run/deployment-control-plane/credentials`
- host directories for records, artifact scratch, and runtime scratch
- explicit reverse proxy, TLS, and public routing outside this profile

The service is bound to `127.0.0.1:7780` by default. Publish it through an explicitly configured
host reverse proxy rather than exposing the container port directly.

## Credential Files

Credentials are mounted as files under `/run/deployment-control-plane/credentials`. The profile
does not use plaintext credential environment variables or `env_file` entries.

Required credential filenames:

```text
artifact-store-endpoint
artifact-store-access-key-id
artifact-store-secret-access-key
control-plane-database-url
reviewed-source-ssh-key
reviewed-source-known-hosts
```

Deployment-scoped Infisical credentials keep the same defaults as the NixOS profile:

```text
{deploymentId}-infisical-client-id
{deploymentId}-infisical-client-secret
```

## Runtime Boundary

Compose, Docker, and Podman are only runtime substrates. They must preserve:

- the same reviewed image pinned by digest, never a tag-only image such as `:latest`
- `deployment-control-plane service --config /etc/deployment-control-plane/config.yaml`
- `deployment-control-plane worker --config /etc/deployment-control-plane/config.yaml`
- the mounted config, credential directory, records root, artifact scratch root, and runtime root
- loopback host binding for the service
- file-backed credentials without secret values in image layers, command arguments, or env files

Podman direct commands are included for hosts that do not run Compose. Docker-compatible Compose is
valid only when it preserves the same mounts, commands, loopback bind, and credential semantics.

## SaaS Host Capability Matrix

| Substrate capability | Valid profile                                                   | Unsupported profile                |
| -------------------- | --------------------------------------------------------------- | ---------------------------------- |
| Image reference      | Digest-pinned OCI image                                         | Tag-only image selection           |
| Secrets              | Mounted files under `/run/deployment-control-plane/credentials` | Secret env vars only               |
| Scratch state        | Persistent writable mounts for records, artifacts, and runtime  | Ephemeral-only storage             |
| Ingress              | HTTPS to the service container through reviewed routing         | Direct public container port       |
| Egress               | Git, Infisical, Postgres, object storage, and provider APIs     | Closed or allowlist-missing egress |
| Shutdown             | SIGTERM/SIGINT grace period before forced stop                  | Immediate kill-only lifecycle      |

Platforms that cannot mount credential files are rejected for production control-plane hosting. They
may run unrelated workloads, but they are not a valid protected/shared control-plane substrate.

Selected SaaS OCI substrates:

| Platform                    | Applicability                                                                                                                                                                                                      | Limitation                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render Docker services      | Valid when using Docker secret files, persistent disks, digest-pinned images, and one disk per service or worker profile. Secret files must be available under the configured credential directory before startup. | Render's default filesystem is ephemeral; a persistent disk is required for each scratch root that must survive restarts.                               |
| Northflank services or jobs | Valid when using uploaded secret files, persistent volumes, digest-pinned images, and explicit service plus worker components.                                                                                     | Northflank secret files may be root-owned by default, so the profile must prove the running container user can read only the intended credential files. |
| Google Cloud Run services   | Conditionally valid only with Secret Manager volume mounts for credentials and NFS or Cloud Storage FUSE volumes for persistent scratch state.                                                                     | Plain env-var secrets or default ephemeral instance filesystems are unsupported for the protected/shared control plane.                                 |

Fly.io Machines, Railway, and tag-only app hosts are not selected production substrates for this
profile unless a future review proves they can avoid secret env vars, provide persistent scratch
ownership for the runtime user, and pass the same conformance suite.

## Substrate Conformance

Run the conformance checker from inside the candidate runtime after mounting the real production
shape, using temporary or staging credentials only:

```bash
zx-wrapper build-tools/tools/deployments/control-plane-host-profile/substrate-conformance.ts \
  --credential-dir /run/deployment-control-plane/credentials \
  --scratch-dir /var/lib/deployment-control-plane/records,/var/lib/deployment-control-plane/artifacts,/var/lib/deployment-control-plane/runtime \
  --expected-uid 10001 \
  --expected-gid 10001 \
  --platform render \
  --outbound-host github.com,app.infisical.com \
  --reference-time "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

The checker validates cgroup visibility, active seccomp mode, mounted credential-file permissions,
writable persistent scratch directories, scratch owner uid/gid, unsafe filesystem permission bits,
DNS resolution, selected SaaS platform profile, and optional clock skew. Run the same tool with
`--signal-marker <path>` as a canary command, stop the task, and confirm the marker records SIGTERM
or SIGINT before forced termination.

## Local Smoke Hook

For local fixture smoke checks, use the same image and mount `config.local-smoke.yaml` through
`VBR_CONTROL_PLANE_CONFIG`. The local smoke config keeps the service process shape intact while
disabling web UI and MCP exposure so tests can prove those config switches are honored without
changing the production example.

## End-To-End Fixture

The reviewed PR 10 E2E fixture is
`//:deployments_control_plane_container_e2e`. It builds the reviewed image, loads it into a local
Podman or Docker runtime, starts one service container and two worker containers, and uses fixture
Postgres plus S3-compatible object storage on the same container network. The test submits a
deterministic `s3-static` deployment through the service, waits for exactly one finished run, and
checks the web read API, queue view, MCP read-only tool, audit-correlated request ids, idempotency,
artifact object materialization, and redaction.

The test skips with a clear reason when no usable OCI runtime is available. The default scenario
uses fixture credentials and does not call live providers or Infisical. Optional live smoke remains
disabled unless the operator explicitly sets all `VBR_CONTROL_PLANE_LIVE_*` inputs named by the
test. SaaS substrate conformance is similarly gated by platform-specific variables such as
`VBR_CONTROL_PLANE_LIVE_RENDER_SUBSTRATE=1`,
`VBR_CONTROL_PLANE_LIVE_NORTHFLANK_SUBSTRATE=1`, or
`VBR_CONTROL_PLANE_LIVE_GOOGLE_CLOUD_RUN_SUBSTRATE=1`. Run those checks from inside the named
candidate substrate with temporary credential files, scratch mounts, expected uid/gid, and outbound
host settings using the same variable prefix.
