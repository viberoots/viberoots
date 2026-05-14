# Deployment Control Plane Containerization

This document defines the target design for running the deployment control plane as a containerized
runtime while keeping the current NixOS/shared-host path straightforward to install. It is intended
to complement the existing `nixos-shared-host` setup, not remove it.

## Goals

- Make deployment control-plane installation less dependent on hand-written host systemd/NixOS
  service wiring.
- Keep the control plane as the only protected/shared deployment mutation authority.
- Keep CI as a submitter only; CI must not hold provider, Vault, or Infisical workload credentials.
- Support both topologies:
  - one control plane dedicated to one Infisical account
  - one shared control plane hosting deployments that use multiple Infisical accounts/projects
- Keep host setup importable on NixOS with sensible defaults and explicit parameters for values
  unique to each host.
- Keep secrets out of the repo, Nix store, image layers, process arguments, ordinary logs, and
  plaintext environment files.
- Support horizontal scaling for service and worker containers by keeping containers stateless and
  making all mutable coordination durable, idempotent, and database-backed.
- Treat horizontal scaling as a v1 requirement for the containerized runtime, not a later
  optimization.
- Establish a minimal web UI surface for the control plane so operators can verify browser
  connectivity and basic runtime status before a richer webapp is designed.
- Establish a minimal MCP server surface so agents can inspect deployment state through the same
  control-plane authorization and audit boundaries, with room to add reviewed mutation tools later.

## Non-Goals

- Do not move release state into Git, image tags, or container-local writable layers.
- Do not make Docker, Podman, or Kubernetes a deployment authority. They are runtime substrates for
  the control plane.
- Do not require every host to be NixOS. NixOS should be the easiest path where available, not the
  only supported runtime.
- Do not make one global Infisical tenant, project, or Universal Auth credential pair a platform
  assumption.
- Do not rely on a shared POSIX filesystem as the correctness mechanism for multi-replica
  coordination or artifact authority. Queue, lock, idempotency, stage-state, and artifact authority
  belong in Postgres plus S3-compatible object storage.

## Runtime Shape

Build a reproducible OCI image for the deployment control plane. The same image should support at
least two process modes:

```bash
deployment-control-plane service
deployment-control-plane worker
```

Optional administrative modes may share the image when they run under the same credential and
records policy:

```bash
deployment-control-plane admin infisical-plan
deployment-control-plane admin infisical-check
deployment-control-plane opentofu apply-reviewed-plan
```

The image should contain the pinned runtime and tools needed by protected/shared execution:

- Node runtime and compiled or packaged deployment tooling
- Git and SSH client for reviewed-source snapshots
- OpenTofu when reviewed IaC applies run through the control plane
- Provider-specific CLIs only when a reviewed provider path requires them

The image must not contain deployment credentials, Infisical client secrets, provider tokens,
database passwords, SSH private keys, or host-specific state.

Support both Podman and Docker as OCI runtimes when the same runtime contract can be preserved.
NixOS examples should prefer Podman because it integrates cleanly with systemd and
`virtualisation.oci-containers`; Docker-compatible Compose examples should remain available for
non-NixOS hosts. If a future implementation finds a real divergence, keep Podman as the NixOS
default and document Docker as a best-effort compatible substrate rather than forking control-plane
behavior.

The service and worker should run as two containers from one reviewed image:

- service container: `deployment-control-plane service`
- worker container: `deployment-control-plane worker`

Administrative operations should run either through the service API or as tightly scoped one-shot
containers from the same image. They should not require a third long-lived admin daemon.

The service container should serve a minimal web UI from the same HTTP origin as the control-plane
API. This UI is intentionally basic in v1 and exists to establish browser connectivity,
authentication/session wiring, static asset serving, and read-only API access.

The service container should also expose a minimal HTTP MCP endpoint at the configured `mcp.basePath`.
In v1 it should be read-only and should reuse the same control-plane read APIs as the web UI and CLI
diagnostics. A local stdio MCP fixture may exist for development tests, but production MCP access
should be through the authenticated service HTTP endpoint behind the same reverse proxy/TLS boundary
as the control-plane API.

## Configuration Contract

The containerized runtime should accept a mounted config file plus narrow environment variables for
non-secret bootstrap pointers. CLI flags remain useful for tests and local fixtures, but production
container startup should not depend on long imperative command lines.

Recommended config file path:

```text
/etc/deployment-control-plane/config.yaml
```

Recommended config shape:

```yaml
instanceId: mini
mode: protected-shared

service:
  host: 0.0.0.0
  port: 7780
  publicUrl: https://deploy.apps.kilty.io

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

Required host-unique parameters:

- `instanceId`
- `service.publicUrl`
- reviewed image reference or digest
- registry/repository location when the host pulls the image
- database URL secret source
- S3-compatible artifact store bucket and credential secret sources
- reviewed-source SSH key secret source when private repositories are in scope
- externally routed hostname/TLS setup

Useful defaults:

- `service.port = 7780`
- `service.host = 0.0.0.0` inside the container
- `storage.recordsRoot = /var/lib/deployment-control-plane/records`
- `storage.artifactStagingRoot = /var/lib/deployment-control-plane/artifacts`
- `storage.runtimeRoot = /var/lib/deployment-control-plane/runtime`
- `storage.artifactStore.kind = "s3-compatible"`
- `credentials.directory = /run/deployment-control-plane/credentials`
- Infisical credential file names derived from deployment id:
  `<deployment-id>-infisical-client-id` and `<deployment-id>-infisical-client-secret`
- `webUi.enabled = true`
- `webUi.basePath = "/"`
- `mcp.enabled = true`
- `mcp.basePath = "/mcp"`

## Minimal Web UI

The v1 web UI should be deliberately small. It should prove the control-plane service can serve a
browser app and that the app can call read-only control-plane APIs through the same authenticated
origin.

Required v1 screens:

- status page showing service instance id, version or image digest when available, database
  connectivity status, artifact-store connectivity status, and worker heartbeat summary
- queue page showing recent queued/running/completed submissions with deployment id, operation,
  lifecycle state, submitted time, and non-secret error summaries
- deployment detail page showing the latest non-secret run state for a selected deployment

Constraints:

- No mutation controls in v1.
- No secret values, provider tokens, Infisical credentials, artifact contents, or raw environment
  dumps.
- No client-side access to control-plane service credentials.
- No sticky session requirement. UI auth/session state must use the same durable service auth
  mechanism as API requests.
- Static assets should be served by the service container or embedded in the reviewed image, not
  mounted from mutable host paths.
- The UI must work behind the same reverse proxy/TLS setup as the API.
- The UI should degrade cleanly when optional data is unavailable; connectivity/status failures
  should be visible without leaking sensitive details.

The initial UI can be plain HTML/CSS/JS or a small bundled app. Avoid introducing a separate web
service container until there is a real need for independent scaling or deployment cadence.

## Future Web Approvals And Authorization

The web UI is read-only in v1, but it should be architected so approval and authorization workflows
can be added without replacing the auth model already used by the CLI.

Future mutation-capable UI requirements:

- Reuse the same OIDC/auth-session and grant derivation model as the CLI/control-plane service.
- Store browser auth sessions, approval state, CSRF state, and idempotency keys in Postgres so
  service replicas stay stateless and do not require sticky sessions.
- Use the existing reviewed authorization boundaries for submitter, approver, admission reporter,
  and future deploy-admin actions. The web UI must not introduce UI-only roles.
- Route all mutations through service APIs that enforce authorization server-side. The browser must
  never be trusted as the authorization boundary.
- Require CSRF protection for browser-initiated mutations, even when the API also accepts bearer
  tokens for CLI or automation clients.
- Require idempotency keys for approval, retry, cancel, promote, and other mutating actions.
- Record the acting principal, derived grants, request id, idempotency key, target deployment,
  approval payload fingerprint, and result in the audit log.
- Keep approval payloads read-only and fingerprinted before the user confirms them so the service
  can reject time-of-check/time-of-use drift.
- Keep CLI and web approval semantics equivalent. A deployment that requires approval should not
  care whether the approval was granted from CLI or web as long as the same principal/grant/payload
  checks pass.
- Keep mutation controls hidden or disabled in the UI unless the server says the authenticated
  principal has the required grant for that exact deployment/action. This is UX only; server-side
  enforcement remains mandatory.

Architectural implication for v1: implement the read-only UI against the same service auth/session
surface that future mutations will use. Avoid a separate static-site auth workaround, sticky
sessions, or a front-end-only authorization model because those would need to be undone before web
approvals can be safe.

## Minimal MCP Server

The v1 MCP server should be bare-bones and read-only. It exists to establish agent connectivity,
authorization, redaction, and audit foundations so richer deployment-management tools can be added
later without changing the trust model.

Required v1 resources/tools:

- `deployment_control_plane_status`: read service instance, version/image digest, database health,
  artifact-store health, and worker heartbeat summary
- `deployment_queue`: list recent queued/running/completed submissions with non-secret summaries
- `deployment_detail`: read the latest non-secret deployment/run state for a requested deployment id
- `deployment_auth_context`: describe the authenticated principal and non-secret grant summary
  visible to the MCP client

Constraints:

- No mutation tools in v1.
- No secret values, provider tokens, Infisical credentials, artifact contents, raw environment
  dumps, or unredacted error payloads.
- MCP tools must enforce authorization server-side. Tool descriptions are not an authorization
  boundary.
- MCP responses must be stable, structured, and intentionally smaller than internal records.
- MCP clients must receive correlation ids/request ids that map to control-plane audit records.
- MCP transport/auth must be explicit. Local unauthenticated MCP is allowed only for fixture/dev
  mode; production MCP must require the same service auth model used by other remote clients.
- The MCP server must be safe behind the same reverse proxy/TLS boundary as the control-plane API,
  or disabled by configuration when the host does not expose it.

Future mutation-capable MCP tools:

- must reuse the same reviewed submitter, approver, admission reporter, and deploy-admin grants as
  CLI and web flows
- must require idempotency keys for mutating tools
- must record acting principal, tool name, request id, idempotency key, target deployment, payload
  fingerprint, and result in audit logs
- must keep approval/promotion payloads read-only and fingerprinted before an agent confirms them
- must support dry-run/plan tools before any apply/mutate tool is added
- must never give an agent ambient provider credentials or direct Infisical/Vault secret access

Architectural implication for v1: implement MCP as another presentation layer over the same
service-side authorization, query, redaction, idempotency, and audit primitives used by CLI and web.
Avoid a separate agent-only control path.

## Volumes And State

The container filesystem must be disposable. Durable state is mounted:

- records volume: deployment records, retained uploads, admitted artifacts, replay data
- artifact staging volume: finalized artifacts before admission
- runtime volume: provider/runtime working state that must survive restarts
- config mount: non-secret instance config
- credential mount: file-backed service credentials

The database should be external to the service/worker containers. A local Postgres container is
acceptable only for development. Production design should treat the database as a separately
backed-up service.

The first production implementation should require a database URL credential and consume an
existing Postgres. A later convenience profile may manage local Postgres for local development, but
that must not be a production path.

## Horizontal Scaling Contract

The target containerized control plane should support more than one service replica and more than
one worker replica.

Service replicas:

- are stateless HTTP/API processes
- share the same external database
- write submissions, approvals, auth sessions, stage state, and audit events through database
  transactions
- use idempotency keys for submit/approve/run-action requests
- do not depend on local container filesystem state for request correctness

Worker replicas:

- poll or subscribe to the shared database-backed queue
- claim work with a lease and fencing token before executing a mutation
- renew the lease while work is active
- lose authority when the lease expires, the claim token changes, or the submission is superseded
- acquire deployment/provider lock scopes in the database before mutating external targets
- record all externally visible transitions durably before or immediately after the external
  operation according to the provider replay contract
- make provider execution idempotent by using the admitted deploy run id, provider target identity,
  and frozen execution snapshot rather than worker-local state

Database requirements:

- queue claims must be atomic and safe under concurrent workers
- locks must be scoped by deployment/provider target and carry fencing tokens
- claim leases must expire so a dead worker can be recovered
- idempotency keys must be unique within the control-plane instance and operation scope
- stage-state updates must be compare-and-swap or otherwise guarded by the admitted source/current
  state expected by the request
- retry/recovery must reconcile from durable submission and execution-snapshot records, not from a
  worker's local temp directory

Local files and mounted volumes are still useful for large artifact bytes and temporary provider
workspaces, but they should not be the source of truth for queue state, lock ownership, stage state,
approvals, or idempotency.

The existing backend already has useful primitives for this direction, including database-backed
queued submission claims, claim leases, control-plane locks, and fencing tokens. The containerized
design should harden those primitives as the only supported multi-replica coordination path and
avoid adding file-lock based coordination inside containers.

## Artifact Storage For Scale

Horizontal scaling requires every service and worker replica to access admitted artifacts and
execution snapshots consistently.

Preferred target:

- store durable records and execution metadata in Postgres
- store large artifact payloads in S3-compatible object storage or a content-addressed artifact
  store layered over S3-compatible object storage
- store only object keys, content digests, sizes, and provenance in the database
- verify digest and provenance before worker execution

Required first containerized production implementation:

- database-backed queue, locks, idempotency, and stage state remain authoritative
- S3-compatible object storage is the durable artifact payload store
- service and worker replicas do not require a shared POSIX filesystem for admitted artifacts or
  execution snapshots
- mounted volumes are limited to local runtime scratch space and file-backed service credentials

Not acceptable for horizontal scale:

- per-container local records roots
- worker-local artifact staging as the only copy of admitted artifacts
- shared POSIX filesystems as the production artifact authority
- lock files in mounted volumes as the primary concurrency control
- mutable image tags or local image cache contents as deployed artifact identity

## Statelessness Boundaries

Container replicas may keep in-memory caches only for performance. Caches must be reconstructable
from durable state and safe to drop on restart. This includes:

- Infisical access tokens exchanged from file-backed Universal Auth credentials
- provider client instances
- parsed deployment metadata
- temporary OpenTofu plugin/cache directories

The worker must scrub temporary workspaces after each run or use per-run temp directories. Any
OpenTofu plugin cache that survives across runs must be content-addressed or otherwise safe under
concurrent workers; it must not contain secrets or mutable provider state.

## Secrets And Credentials

The portable credential contract is file-backed service credentials.

Rules:

- Credentials are mounted as files under `credentials.directory`.
- Credential files are readable only by the control-plane service account inside the runtime.
- The worker maps credential files to in-memory runtime bindings only for the operation that needs
  them.
- Child process environments are scrubbed unless the child process is the reviewed operation that
  must call the external provider.
- Credentials are not placed in image layers, command-line args, plaintext env files, Nix store
  paths, deployment records, diagnostics, PR text, or ordinary logs.

For Infisical-backed deployments, default credential filenames are:

```text
<deployment-id>-infisical-client-id
<deployment-id>-infisical-client-secret
```

Reviewed overrides are allowed when a host secret store already uses different names, but lookup
must remain deployment-scoped. A shared control plane must be able to host deployments that use
different Infisical organizations, projects, site URLs, and Universal Auth identities.

For the Pleomino PR-12 cutover, the defaults are:

```text
pleomino-staging-infisical-client-id
pleomino-staging-infisical-client-secret
pleomino-prod-infisical-client-id
pleomino-prod-infisical-client-secret
```

## NixOS Host Module

Provide importable Nix files so a NixOS host can run the containerized control plane with minimal
manual configuration. The intended shape is a repo-owned module plus a small host-local import.

Proposed repo paths:

```text
build-tools/tools/nix/deployment-control-plane-container-module.nix
build-tools/tools/nix/deployment-control-plane-container-defaults.nix
```

The module should expose options like:

```nix
{
  services.viberoots.deploymentControlPlaneContainer = {
    enable = true;

    instanceId = "mini";
    image = "registry.example.com/viberoots/deployment-control-plane@sha256:REVIEWED";
    imageRegistry = null;
    imageRepository = null;
    imageDigest = null;
    publicUrl = "https://deploy.apps.kilty.io";

    port = 7780;
    bindAddress = "127.0.0.1";
    publicHostName = null;
    workerReplicas = 2;
    webUi = {
      enable = true;
      basePath = "/";
    };
    mcp = {
      enable = true;
      basePath = "/mcp";
    };

    recordsRoot = "/var/lib/deployment-control-plane/records";
    artifactStagingRoot = "/var/lib/deployment-control-plane/artifacts";
    runtimeRoot = "/var/lib/deployment-control-plane/runtime";

    artifactStore = {
      kind = "s3-compatible";
      bucket = null;
      endpointCredential = "artifact-store-endpoint";
      accessKeyIdCredential = "artifact-store-access-key-id";
      secretAccessKeyCredential = "artifact-store-secret-access-key";
    };

    credentialDirectory = "/run/deployment-control-plane/credentials";

    databaseUrlCredential = "control-plane-database-url";
    controlPlaneTokenCredential = "control-plane-token";
    githubTokenCredential = "github-token";
    reviewedSourceSshKeyCredential = "reviewed-source-ssh-key";

    infisicalCredentialFilePattern = {
      clientId = "{deploymentId}-infisical-client-id";
      clientSecret = "{deploymentId}-infisical-client-secret";
    };

    extraCredentialFiles = {};

    containerRuntime = "podman";
    manageNginx = false;
    manageLocalPostgres = false;
  };
}
```

The NixOS module should:

- create the service user and group
- create persistent state directories with restrictive ownership
- write the non-secret config file from module options
- run one service container and `workerReplicas` worker containers from the reviewed image digest
- mount records, artifacts, runtime, config, and credential directories
- support systemd credentials through `LoadCredential=` or a repo wrapper where practical
- bind the service to loopback by default
- optionally emit nginx config when `publicHostName` and `manageNginx = true` are set
- otherwise leave TLS and public routing to an explicitly configured host reverse proxy
- serve the minimal web UI from the same service origin when `webUi.enable = true`
- expose the minimal MCP server endpoint when `mcp.enable = true`
- fail closed when required credential files are missing

The module should default to Podman on NixOS. Docker may be supported by setting
`containerRuntime = "docker"` when the host uses Docker, but the module must preserve the same
mounts, credential file semantics, health checks, and loopback bind behavior.

The module should accept generic credential source paths such as `/run/secrets/...`. That keeps it
compatible with SOPS-nix, agenix, manually provisioned host secrets, and other host secret systems
without taking a dependency on one secret manager. A later helper module may add SOPS-nix or agenix
conveniences, but the core module should stay generic.

Image configuration must be parameterized. GitHub Container Registry is an acceptable documented
example, but the module must not hardcode it. Production examples should pin the image by digest.

The module should expose `workerReplicas` in v1 with default `2`. Tests must prove two workers can
poll the same queue safely before docs recommend increasing the value.

Host-local import example:

```nix
{
  imports = [
    /srv/viberoots/build-tools/tools/nix/deployment-control-plane-container-module.nix
  ];

  services.viberoots.deploymentControlPlaneContainer = {
    enable = true;
    instanceId = "mini";
    image = "registry.example.com/viberoots/deployment-control-plane@sha256:REVIEWED";
    publicUrl = "https://deploy.apps.kilty.io";
    publicHostName = "deploy.apps.kilty.io";
    manageNginx = true;
    containerRuntime = "podman";
    workerReplicas = 2;
    webUi.enable = true;
    mcp.enable = true;

    artifactStore = {
      kind = "s3-compatible";
      bucket = "deployment-control-plane-artifacts";
      endpointCredential = "artifact-store-endpoint";
      accessKeyIdCredential = "artifact-store-access-key-id";
      secretAccessKeyCredential = "artifact-store-secret-access-key";
    };

    credentials = {
      control-plane-database-url.source = "/run/secrets/deploy-control-plane-database-url";
      control-plane-token.source = "/run/secrets/deploy-control-plane-token";
      github-token.source = "/run/secrets/deploy-github-token";
      reviewed-source-ssh-key.source = "/run/secrets/deploy-reviewed-source-ssh-key";
      artifact-store-endpoint.source = "/run/secrets/deploy-artifact-store-endpoint";
      artifact-store-access-key-id.source = "/run/secrets/deploy-artifact-store-access-key-id";
      artifact-store-secret-access-key.source =
        "/run/secrets/deploy-artifact-store-secret-access-key";
      pleomino-staging-infisical-client-id.source =
        "/run/secrets/pleomino-staging-infisical-client-id";
      pleomino-staging-infisical-client-secret.source =
        "/run/secrets/pleomino-staging-infisical-client-secret";
      pleomino-prod-infisical-client-id.source =
        "/run/secrets/pleomino-prod-infisical-client-id";
      pleomino-prod-infisical-client-secret.source =
        "/run/secrets/pleomino-prod-infisical-client-secret";
    };
  };
}
```

The exact option names can change during implementation, but the user-facing outcome should remain:
one import plus a small host-local parameter block.

The NixOS module should use clean container-internal paths under `/var/lib/deployment-control-plane`
and mount host scratch volumes there. Existing NixOS/shared-host paths such as
`/var/lib/deployment-host` are not migrated by the containerization design. Existing hosts start the
containerized control plane with a fresh database/object-store state unless a separate migration plan
is written.

## Non-NixOS Host Contract

For non-NixOS hosts, provide a Compose or Podman example with the same mounted paths and credential
contract. The example is documentation and smoke-test material; the authoritative behavior remains
the runtime contract above.

Example shape:

```yaml
services:
  deployment-control-plane-service:
    image: registry.example.com/viberoots/deployment-control-plane@sha256:REVIEWED
    command: ["deployment-control-plane", "service", "--config", "/etc/deployment-control-plane/config.yaml"]
    ports:
      - "127.0.0.1:7780:7780"
    volumes:
      - ./config.yaml:/etc/deployment-control-plane/config.yaml:ro
      - records:/var/lib/deployment-control-plane/records
      - artifacts:/var/lib/deployment-control-plane/artifacts
      - runtime:/var/lib/deployment-control-plane/runtime
      - ./credentials:/run/deployment-control-plane/credentials:ro

  deployment-control-plane-worker:
    image: registry.example.com/viberoots/deployment-control-plane@sha256:REVIEWED
    command: ["deployment-control-plane", "worker", "--config", "/etc/deployment-control-plane/config.yaml"]
    volumes:
      - ./config.yaml:/etc/deployment-control-plane/config.yaml:ro
      - records:/var/lib/deployment-control-plane/records
      - artifacts:/var/lib/deployment-control-plane/artifacts
      - runtime:/var/lib/deployment-control-plane/runtime
      - ./credentials:/run/deployment-control-plane/credentials:ro

  deployment-control-plane-worker-2:
    image: registry.example.com/viberoots/deployment-control-plane@sha256:REVIEWED
    command: ["deployment-control-plane", "worker", "--config", "/etc/deployment-control-plane/config.yaml"]
    volumes:
      - ./config.yaml:/etc/deployment-control-plane/config.yaml:ro
      - records:/var/lib/deployment-control-plane/records
      - artifacts:/var/lib/deployment-control-plane/artifacts
      - runtime:/var/lib/deployment-control-plane/runtime
      - ./credentials:/run/deployment-control-plane/credentials:ro

volumes:
  records:
  artifacts:
  runtime:
```

## PR-12 Alignment

This design is compatible with the Pleomino Infisical cutover plan:

- PR-12 keeps Pleomino staging and production on control-plane-only live execution.
- PR-12 requires file-backed service credentials and rejects local, CI, plaintext env-file, process
  arg, and Nix-store secret paths.
- PR-12's default Infisical credential filenames match this document's deployment-id convention.
- PR-12's `viberoots` Infisical organization and `pleomino-deployments` project are concrete
  Pleomino inputs, not global control-plane defaults.
- The container runtime contract supports both future topologies required by PR-12: dedicated
  control plane per Infisical account and shared control plane for multiple Infisical accounts.
- The runtime must use each deployment's reviewed `infisical_runtime` metadata and credential-file
  names rather than ambient tenant defaults.
- The containerization design goes beyond PR-12 by requiring S3-compatible artifact storage and two
  worker replicas in v1. PR-12 does not need to implement those container runtime requirements.

PR-12 should implement or reuse the generic file-backed credential-directory abstraction needed for
Infisical Universal Auth. Building the OCI image, NixOS container module, and Compose/Podman examples
should land in a separate plan unless PR-12 is explicitly expanded. The important PR-12 contract is
that no Infisical credential handling is NixOS-only, environment-file-only, or tied to one global
Infisical account.

## Self Review Against PR-12

- Control-plane-only live execution: covered. The container is a runtime for the control plane, not
  a second deployment authority.
- CI credential boundary: covered. CI submits to the control plane and must not hold Infisical
  workload credentials.
- File-backed credentials: covered. The design requires mounted credential files and rejects image
  layers, args, plaintext env files, Nix store paths, records, and ordinary logs.
- Systemd/NixOS guidance: covered. The design keeps a generic file-backed contract and gives
  `LoadCredential=`/NixOS module guidance for hosts that support it.
- Importable NixOS host setup: covered. The proposed module is one import plus a small host-local
  parameter block with defaults for ports, directories, and credential filename patterns.
- Parameterized Infisical tenants: covered. The design rejects global tenant/project credentials and
  supports both dedicated and shared control-plane topologies.
- Pleomino defaults: covered. The default credential filenames match PR-12:
  `pleomino-staging-infisical-client-id`, `pleomino-staging-infisical-client-secret`,
  `pleomino-prod-infisical-client-id`, and `pleomino-prod-infisical-client-secret`.
- Deployment metadata source of truth: covered. Runtime prep uses reviewed `infisical_runtime`
  metadata rather than ambient control-plane defaults.
- Remaining scope risk: the full container runtime should be planned as its own implementation slice
  unless PR-12 is intentionally broadened. PR-12 can still proceed by implementing the portable
  credential-directory abstraction first.
- Horizontal scaling: covered as a v1 requirement for the containerization plan, not PR-12.
- Artifact storage: covered. The containerized runtime requires S3-compatible artifact storage for
  production and does not rely on shared POSIX filesystems as artifact authority.
- Sticky sessions: covered. Service replicas are stateless and auth sessions, approvals,
  idempotency, and stage state are in Postgres.
- Minimal web UI: covered. The service serves a read-only, same-origin UI for connectivity, status,
  queue visibility, and deployment detail without adding mutation controls or secret exposure.
- Future web approvals: covered. The v1 UI must use the same durable auth/session surface planned
  for future CLI-equivalent approval actions, including CSRF, idempotency, grant checks, and audit
  requirements for later mutations.
- Minimal MCP server: covered. The service exposes read-only MCP inspection tools through the same
  authorization, redaction, and audit boundaries, with future mutation tools required to reuse CLI
  and web grant/idempotency semantics.

## Sequencing With PR-12

Recommended sequencing:

1. Implement PR-12 first if the immediate goal is to move Pleomino staging and production to
   Infisical. PR-12 should include the portable file-backed credential-directory abstraction and
   should avoid systemd-only assumptions.
2. Implement containerization as a separate plan immediately after PR-12, or before PR-12 only if
   operators want the first Pleomino Infisical rollout to happen on the horizontally scalable
   containerized control plane.
3. Do not make Pleomino's Infisical backend switch wait on the full OCI/NixOS-container module
   unless the current host cannot safely provide the generic file-backed credential contract.

Rationale:

- PR-12 has a narrow deployment outcome and can validate the credential abstraction with the
  existing control-plane runtime.
- Containerization changes packaging, host setup, service lifecycle, artifact storage, horizontal
  scaling, and operational docs; it is larger than the Pleomino backend cutover.
- Keeping the portable credential contract as the shared boundary prevents rework when the
  containerized runtime lands.

## Implementation Slices

1. Add the config loader and file-backed credential directory abstraction.
2. Harden database-backed queue claims, claim leases, fencing tokens, provider locks, idempotency,
   and stage-state compare-and-swap behavior for multiple service and worker replicas.
3. Add S3-compatible artifact storage for admitted artifacts and execution payloads, with digest
   verification before worker execution.
4. Add stable `deployment-control-plane service` and `worker` entrypoints.
5. Add the minimal same-origin web UI and read-only API endpoints needed by the UI.
6. Add the minimal read-only MCP server over the same read APIs, authorization checks, redaction,
   and audit/correlation path.
7. Build a reproducible OCI image for the service/worker/runtime UI/MCP surface.
8. Add NixOS importable module files for running one service container and two worker containers by
   default.
9. Add optional NixOS nginx integration gated by `manageNginx` and `publicHostName`.
10. Add a Compose/Podman example for non-NixOS hosts with one service and two workers.
11. Add tests proving startup fails closed when required credential files are absent.
12. Add tests proving Infisical credential lookup is deployment-scoped and supports multiple
   Infisical tenants on one control plane.
13. Add tests proving two workers cannot execute the same submission or violate provider lock
    scopes under contention.
14. Add browser or HTTP tests proving the web UI loads through the service origin and redacts
    secret-bearing fields.
15. Add auth/session contract tests proving the read-only UI path uses durable service sessions and
    does not require sticky sessions or a separate browser-only auth mechanism.
16. Add MCP contract tests proving read-only tools require authorization, return redacted structured
    responses, include correlation ids, and do not expose mutation tools in v1.
17. Update PR-12 implementation to consume the generic file-backed credential contract instead of a
    NixOS-only credential path.

## Open Risks

- The image must include all tools needed for reviewed provider paths without becoming an
  uncontrolled mutable toolbox.
- OpenTofu provider/plugin caching must be deterministic and must not write secrets into retained
  state or logs.
- Host reverse proxy and TLS remain host concerns; the NixOS module should make this easy but not
  silently expose the service publicly without reviewed routing.
- Credential mount semantics differ across systemd, Docker, Podman, and Kubernetes. Tests should
  target the runtime contract, not only one substrate.
- Multi-replica service and worker behavior depends on every queue, lock, lease, stage-state, and
  idempotency path using the database-backed backend. Any remaining file-backed authority must be
  found and removed or explicitly scoped to single-replica mode.
- S3-compatible stores have subtly different consistency and endpoint behavior. The implementation
  should verify put/read/list assumptions against the chosen first backend and rely on direct object
  key reads plus digests, not eventually consistent listing, for correctness.
