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

## Required Host Inputs

Real hosts must provide:

- an immutable reviewed image reference through `VBR_CONTROL_PLANE_IMAGE`
- a matching `VBR_CONTROL_PLANE_IMAGE_DIGEST` for status reporting
- an external Postgres database URL credential file
- an S3-compatible artifact-store bucket and credential files
- a reviewed-source SSH key credential file
- a reviewed-source known-hosts file mounted at `/etc/deployment-control-plane/github-known-hosts`
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
```

Deployment-scoped Infisical credentials keep the same defaults as the NixOS profile:

```text
{deploymentId}-infisical-client-id
{deploymentId}-infisical-client-secret
```

## Runtime Boundary

Compose, Docker, and Podman are only runtime substrates. They must preserve:

- the same reviewed image
- `deployment-control-plane service --config /etc/deployment-control-plane/config.yaml`
- `deployment-control-plane worker --config /etc/deployment-control-plane/config.yaml`
- the mounted config, credential directory, records root, artifact scratch root, and runtime root
- loopback host binding for the service
- file-backed credentials without secret values in image layers, command arguments, or env files

Podman direct commands are included for hosts that do not run Compose. Docker-compatible Compose is
valid only when it preserves the same mounts, commands, loopback bind, and credential semantics.

## Local Smoke Hook

For local fixture smoke checks, use the same image and mount `config.local-smoke.yaml` through
`VBR_CONTROL_PLANE_CONFIG`. The local smoke config keeps the service process shape intact while
disabling web UI and MCP exposure so tests can prove those config switches are honored without
changing the production example.

PR 10 remains responsible for the full containerized end-to-end deployment flow with the control
plane running through Podman or an equivalent OCI runtime. This profile is the host wiring that
those E2E tests should consume rather than replacing with a second control-plane behavior path.
