# Deployment Control Plane Containerization Plan

This plan implements the containerized deployment control plane described in
[Deployment Control Plane Containerization](../designs/control-plane-containerization.md).

Reviewed context:

- The deployment control plane remains the only protected/shared deployment mutation authority.
  Containers are runtime packaging, not a second deployment authority.
- CI remains a submitter only. CI must not hold provider, Vault, Infisical, database, artifact-store,
  or reviewed-source workload credentials.
- The containerized runtime must support both a dedicated control plane for one Infisical account and
  a shared control plane that hosts deployments using multiple Infisical accounts, projects, site
  URLs, and Universal Auth identities.
- Production containerized operation is horizontally scalable in v1. Queue claims, leases, locks,
  idempotency, stage state, sessions, audit, and artifact metadata are database-backed. Large
  artifact payloads live in S3-compatible object storage.
- The portable credential contract is file-backed service credentials. Credentials must not be
  embedded in images, Nix store paths, ordinary environment files, command-line arguments, deployment
  records, diagnostics, or logs.
- The service exposes the API, a minimal same-origin read-only web UI, and a minimal authenticated
  read-only HTTP MCP endpoint. Future mutation-capable UI and MCP surfaces must reuse the same
  service authorization, idempotency, redaction, and audit primitives.

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no release state in Git, image tags, or container-local writable layers
- no shared POSIX filesystem as the correctness mechanism for production multi-replica coordination
  or artifact authority
- no global Infisical tenant, project, or credential assumption
- no browser-only authorization model, sticky-session requirement, or separate web service container
  in v1
- no mutation-capable MCP tools in v1
- no production-managed local Postgres profile in the first implementation

Verify-scope organization:

- The implementation should stay in deployment/control-plane-owned paths where the current repo
  boundaries allow it, especially:
  - `build-tools/deployments/**`
  - `build-tools/tools/deployments/**`
  - `build-tools/tools/tests/deployments/**`
  - `build-tools/tools/nix/**`
  - `docs/**`
- If a PR needs to change shared build-system paths, update this plan first and classify the PR as
  `mixed-build-system`. Do not hide shared build-system changes inside a nominally deployment-only
  PR.
- Every PR below must include tests for the functionality it adds or changes, and must update the
  relevant operator or developer documentation in the same PR.
- Each PR below must update this plan if implementation changes invalidate the remaining sequence,
  scope, or assumptions.

Build-system scope minimization:

- The only PR expected to require full mixed/build-system validation is the OCI image packaging PR.
  That PR should be kept mostly mechanical: build target, image contents, image metadata, and image
  smoke tests. Runtime behavior should land before it under deployment/control-plane-owned paths.
- Host setup should stay outside full mixed/build-system scope. The NixOS module and non-NixOS
  Compose/Podman profile should consume the reviewed image contract and test generated host wiring,
  not modify shared build-system machinery.
- Earlier runtime PRs should use existing database, service, auth, and test extension points where
  they exist. If one of those PRs truly needs shared build-system changes, update this plan first
  and split or reclassify only that unavoidable shared change.
- Do not merge the OCI image packaging, NixOS module, Compose/Podman profile, or end-to-end fixture
  into one large PR. Combining them would reduce PR count on paper but would make more host/runtime
  work ride through full mixed/build-system validation.

Sequencing with the Pleomino Infisical cutover:

- Implement this containerization plan before PR-12 in
  [Infisical Deployment Secrets Plan](infisical-plan.md). The
  first Pleomino staging and production Infisical rollout should use the containerized,
  horizontally scalable control plane rather than the current shared-host runtime.
- PR-1 owns the portable credential-directory abstraction that PR-12 needs for Infisical Universal
  Auth. When PR-12 is implemented later, it should consume this abstraction instead of introducing a
  second credential path.
- PR-12 remains responsible for Pleomino-specific Infisical IaC, deployment metadata, fake-Infisical
  Pleomino coverage, operator rollout steps, and replay/rollback guarantees.

## PR-1: Container runtime configuration and file-backed credential contract

### 1. Intent

Add the runtime configuration loader and portable file-backed credential contract that every later
containerized control-plane process will use.

### 2. Scope of changes

- Add a typed control-plane container configuration schema for:
  - `instanceId`
  - service host, port, and public URL
  - database URL credential file
  - S3-compatible artifact-store credential files
  - credential directory and default credential file patterns
  - reviewed-source SSH key and known-hosts files
  - web UI enablement and base path
  - MCP enablement and base path
  - local runtime scratch paths
- Support a mounted YAML config file at `/etc/deployment-control-plane/config.yaml`, with an
  override flag for tests and local fixtures.
- Add the portable deployment control-plane credential-directory abstraction in
  deployment/control-plane-owned tooling. This is the credential foundation that the later Pleomino
  PR-12 Infisical cutover will consume.
- Resolve credentials only from reviewed file paths under the configured credential directory or
  explicit reviewed source paths.
- Reject missing required credential files during startup validation, before accepting service or
  worker work.
- Reject credential paths that point into the repo checkout, image layer paths, Nix store paths,
  ordinary dotenv files, or process arguments.
- Keep Infisical credential lookup deployment-scoped by default:
  - `{deploymentId}-infisical-client-id`
  - `{deploymentId}-infisical-client-secret`
- Allow reviewed per-deployment credential filename overrides without introducing global Infisical
  tenant defaults.
- Add redaction helpers for config validation and startup errors so paths may be shown but file
  contents never are.

### 3. External prerequisites

- None for local tests. Production hosts will later need real database, artifact-store, reviewed
  source, and deployment credential files mounted under the configured credential directory.

### 4. Tests to be added

- Add config parser tests for default values, explicit values, invalid enum values, invalid base
  paths, and malformed YAML.
- Add startup validation tests proving required credential files fail closed when absent.
- Add credential path tests rejecting repo, Nix store, dotenv, image-layer, and argument-style
  credential sources.
- Add credential lookup tests proving default Infisical file names are derived from deployment id
  and reviewed overrides remain deployment-scoped.
- Add multi-tenant lookup tests proving two deployments can use different Infisical site URLs,
  projects, environments, and credential files on the same control-plane instance.
- Add redaction tests proving credential file contents are not included in thrown errors, structured
  diagnostics, or logs.

### 5. Docs to be added or updated

- Add a control-plane runtime configuration reference covering the YAML shape, defaults, and startup
  validation behavior.
- Document the file-backed credential contract and the default Infisical credential filename pattern.
- Update operator setup notes to make clear that CI submits to the control plane and does not mount
  workload credentials.

### 5.5. Expected regression scope

- `deployment-only`
- Keep config loading, credential resolution, redaction, and tests under deployment/control-plane
  tooling paths unless implementation proves a shared config library is the clean design.

### 6. Acceptance criteria

- A service or worker process can validate its mounted config before starting.
- Required secrets are loaded only from file-backed credential sources.
- One control-plane instance can resolve credentials for deployments using different Infisical
  accounts without global tenant defaults.
- Tests and docs describe the same config keys, defaults, and failure modes.

### 7. Risks

- The config schema could become a second source of deployment truth.
- Credential validation could accidentally log credential contents while explaining failures.

### 8. Mitigations

- Keep deployment-specific backend facts in reviewed deployment metadata and only store host runtime
  plumbing in the control-plane config.
- Centralize credential reads and redaction, and test error paths explicitly.

### 9. Consequences of not implementing this PR

Later container, NixOS, web, MCP, and worker work would each invent their own configuration and
credential handling.

### 10. Downsides for implementing this PR

It adds runtime plumbing before any container image exists.

## PR-2: Multi-replica coordination hardening

### 1. Intent

Make the existing database-backed queue, lease, lock, idempotency, stage-state, and audit primitives
the only supported coordination path for horizontally scaled service and worker replicas.

### 2. Scope of changes

- Audit control-plane submission, claim, worker execution, provider lock, stage-state, and retry
  paths for file-backed or process-local correctness assumptions.
- Harden queue claims so concurrent workers use atomic database updates and receive unique fencing
  tokens.
- Ensure claim leases expire and can be safely renewed by the current fenced worker only.
- Ensure workers lose authority when the lease expires, the fencing token changes, or the submission
  is superseded.
- Ensure provider locks are scoped by deployment/provider target and carry fencing tokens.
- Add idempotency-key support for service-side submit and future mutation entrypoints where missing.
- Ensure stage-state updates use compare-and-swap or equivalent expected-state guards.
- Ensure retry and recovery reconcile from durable database records and execution snapshots, not
  from worker-local temporary directories.
- Record audit events with request id, actor or service principal, operation, idempotency key when
  present, deployment id, result, and non-secret failure summary.
- Remove or explicitly isolate any file-lock based coordination to local fixture mode only.

### 3. External prerequisites

- None. Tests should use the repo's local database fixture or fake durable backend.

### 4. Tests to be added

- Add concurrency tests proving two workers cannot claim and execute the same submission.
- Add lease-expiry tests proving a dead worker can be replaced and the old fencing token cannot
  continue mutating state.
- Add provider-lock contention tests proving two workers cannot mutate the same deployment/provider
  target concurrently.
- Add idempotency tests proving duplicate submit or retry requests return the original durable result
  instead of creating duplicate work.
- Add stage-state compare-and-swap tests proving stale expected state fails closed.
- Add recovery tests proving restart/retry behavior uses durable database records rather than local
  temp directories.
- Add audit tests proving success and failure records include correlation ids and no secret-bearing
  fields.

### 5. Docs to be added or updated

- Document the horizontal scaling contract for service replicas, worker replicas, claims, leases,
  locks, idempotency, stage state, and audit records.
- Update operator troubleshooting docs with lease expiry and stuck-submission recovery behavior.
- Document that mounted volumes are scratch/credential surfaces only and not the production
  coordination authority.

### 5.5. Expected regression scope

- `deployment-only`
- Use existing database and deployment-control-plane extension points where possible. If a missing
  shared primitive is unavoidable, update this plan first and split or reclassify only that shared
  primitive instead of broadening the whole PR by default.

### 6. Acceptance criteria

- The control-plane worker path is safe to run with at least two worker replicas.
- Service-side idempotency and stage-state guards are durable and tested.
- No production correctness path depends on file locks or worker-local temp state.

### 7. Risks

- Tightening concurrency semantics could surface existing single-worker assumptions.
- Lease expiry behavior can be difficult to test deterministically.

### 8. Mitigations

- Add explicit clock/lease test hooks and keep provider mutations behind fenced lock helpers.
- Prefer narrow compatibility shims over weakening the multi-replica contract.

### 9. Consequences of not implementing this PR

The containerized runtime could appear to scale but still execute duplicate or stale mutations under
worker contention.

### 10. Downsides for implementing this PR

It may touch several existing control-plane paths before the image and host module exist.

## PR-3: S3-compatible artifact authority

### 1. Intent

Move production artifact payload authority to S3-compatible object storage while keeping metadata,
digests, and provenance in the database.

### 2. Scope of changes

- Add an artifact-store interface with an S3-compatible implementation.
- Store artifact payload bytes and execution-snapshot payloads by immutable object key.
- Store object key, digest, size, content type, provenance, and admitted run metadata in the
  database.
- Verify digest and provenance after upload and before worker execution.
- Avoid correctness dependencies on object listing; use direct object key reads plus recorded
  digests.
- Keep local filesystem storage only for test fixtures, local development, and temporary staging.
- Ensure object-store credentials are read through the file-backed credential contract from PR-1.
- Ensure workers scrub temporary artifact staging directories after use.
- Add retry-safe object writes that either produce the same immutable key/digest or fail closed.

### 3. External prerequisites

- None for unit/integration tests. Production use requires an S3-compatible bucket, endpoint, and
  credentials mounted as files.

### 4. Tests to be added

- Add fake S3-compatible object-store tests for put, get, digest verification, missing object, wrong
  digest, wrong size, and unavailable endpoint.
- Add admission tests proving artifact metadata is stored in the database while payload bytes are
  stored in the object store.
- Add worker execution tests proving workers fetch by object key, verify digest/provenance, and fail
  closed before provider execution on mismatch.
- Add retry tests proving repeated uploads with the same content are idempotent and conflicting
  content fails closed.
- Add credential tests proving artifact-store credentials are read from configured files and redacted
  from errors.
- Add local fixture tests proving local filesystem artifact storage is unavailable for production
  container mode unless explicitly configured for development.

### 5. Docs to be added or updated

- Document the artifact-store config keys, required credential files, object metadata, and digest
  verification behavior.
- Update operator setup docs with S3-compatible bucket requirements and least-privilege credential
  expectations.
- Document that shared POSIX filesystems are not the production artifact authority.

### 5.5. Expected regression scope

- `deployment-only`
- Use existing deployment/control-plane metadata and migration extension points where possible. If a
  shared database migration helper is genuinely required, update this plan first and isolate that
  shared change instead of broadening the artifact-store implementation by default.

### 6. Acceptance criteria

- Service and worker replicas can exchange admitted artifacts through S3-compatible storage without
  a shared POSIX filesystem.
- Workers verify payload digest and provenance before execution.
- Object-store credentials are file-backed and redacted.

### 7. Risks

- S3-compatible implementations differ in endpoint, region, and listing behavior.
- Artifact migration could blur the boundary between durable metadata and payload bytes.

### 8. Mitigations

- Depend on direct key reads and digests for correctness, not listing consistency.
- Keep database metadata authoritative and object payloads immutable.

### 9. Consequences of not implementing this PR

Horizontal service and worker scaling would still depend on local or shared filesystem artifact
state.

### 10. Downsides for implementing this PR

It adds an external production dependency and object-store failure modes to admission and worker
execution.

## PR-4: Service and worker process entrypoints

### 1. Intent

Add stable long-running process modes for the containerized runtime while preserving existing
control-plane behavior.

### 2. Scope of changes

- Add `control-plane service --config ...`.
- Add `control-plane worker --config ...`.
- Ensure both modes validate config and credentials before starting.
- Start the service as a stateless HTTP/API process bound to configured host and port.
- Start the worker as a queue consumer using the hardened database claim, lease, lock, and artifact
  store paths from PR-2 and PR-3.
- Add health and readiness endpoints for the service, database connectivity, artifact-store
  connectivity, and worker heartbeat visibility.
- Add graceful shutdown handling for service requests and worker leases.
- Ensure child process environments are scrubbed except for reviewed provider operations that need
  specific resolved credentials.
- Keep one-shot administrative modes out of the long-running process set unless they use the same
  config, credential, audit, and redaction contracts.

### 3. External prerequisites

- None for local fixtures. Production execution requires the config and credential files introduced
  by earlier PRs.

### 4. Tests to be added

- Add CLI tests for service and worker command parsing, config path overrides, invalid config, and
  missing credentials.
- Add service startup tests proving the HTTP server binds to the configured host/port and exposes
  health/readiness without leaking config secrets.
- Add worker startup tests proving it registers heartbeat state and claims work only through the
  database-backed queue.
- Add graceful shutdown tests proving workers stop renewing leases and do not continue executing
  after losing authority.
- Add environment-scrubbing tests proving child processes receive only reviewed operation-specific
  variables.
- Add service/worker integration tests with one service and two workers processing a fixture
  submission exactly once.

### 5. Docs to be added or updated

- Document the `control-plane service` and `control-plane worker` commands.
- Update operator runbooks with health, readiness, worker heartbeat, and graceful shutdown behavior.
- Document the intended one-service/two-worker minimum production topology for the containerized
  runtime.

### 5.5. Expected regression scope

- `deployment-only`
- Keep command wrappers and process runtime under deployment/control-plane tooling paths.

### 6. Acceptance criteria

- Service and worker are stable process modes suitable for one OCI image.
- Two workers can safely process the same durable queue without duplicate mutation.
- Startup, shutdown, health, readiness, and heartbeat behavior are tested and documented.

### 7. Risks

- Long-running entrypoints could bypass existing CLI validation or authorization checks.
- Graceful shutdown bugs could leave stale leases or duplicated work.

### 8. Mitigations

- Route service and worker behavior through the same reviewed helpers used by current control-plane
  flows.
- Test lease loss, shutdown, and duplicate-worker contention together.

### 9. Consequences of not implementing this PR

The OCI image and host modules would have no stable process contract to run.

### 10. Downsides for implementing this PR

It introduces daemon-style lifecycle concerns into tooling that may currently be more command
oriented.

## PR-5: Same-origin read APIs and minimal web UI

### 1. Intent

Expose a basic same-origin web UI over authenticated read APIs so operators can inspect runtime
status, queue state, and deployment detail without adding mutation controls.

### 2. Scope of changes

- Add read-only service APIs for:
  - control-plane status
  - database connectivity status
  - artifact-store connectivity status
  - worker heartbeat summary
  - recent queued/running/completed submissions
  - deployment detail for the latest non-secret run state
  - authenticated principal and non-secret grant summary
- Serve static UI assets from the service container or embedded service bundle.
- Add pages for status, queue, and deployment detail.
- Reuse the service auth/session surface that future CLI-equivalent web approvals will use.
- Store browser session, CSRF state scaffolding, and future idempotency scaffolding in the database
  where needed so service replicas stay stateless.
- Keep v1 mutation controls absent.
- Redact secret values, provider tokens, Infisical credentials, raw environment dumps, artifact
  contents, and unredacted errors from every API and UI response.
- Ensure the UI works when served behind the configured base path and reverse proxy.

### 3. External prerequisites

- None for tests. Production exposure requires host TLS and reverse proxy routing configured by the
  host or later NixOS module PR.

### 4. Tests to be added

- Add read API tests for status, queue, deployment detail, and auth context responses.
- Add authorization tests proving unauthenticated or unauthorized callers cannot read protected
  deployment state.
- Add redaction tests with secret-looking database records, provider errors, artifact metadata, and
  Infisical fields.
- Add session tests proving service replicas can validate the same durable session without sticky
  sessions.
- Add base-path tests proving UI assets and API calls work under `/` and a non-root base path.
- Add browser or HTTP-render tests proving the status, queue, and deployment detail screens load and
  do not render secret-bearing values.
- Add regression tests proving v1 UI responses expose no mutation controls or mutation endpoints.

### 5. Docs to be added or updated

- Document the web UI screens, auth/session model, redaction guarantees, and v1 read-only boundary.
- Add operator guidance for reverse proxy/TLS exposure and base-path configuration.
- Document future approval constraints so v1 code keeps the correct auth/session foundations.

### 5.5. Expected regression scope

- `deployment-only`
- Use the existing service auth/session surface and deployment-owned read models. If a shared
  auth-library change is genuinely required, update this plan first and isolate that shared change
  instead of broadening the web UI implementation by default.

### 6. Acceptance criteria

- Operators can load the web UI and inspect status, queue, and deployment detail through
  authenticated read-only APIs.
- Service replicas do not require sticky sessions.
- No secret-bearing fields or mutation controls are exposed.

### 7. Risks

- A quick UI could accidentally create a separate auth model that blocks future approval flows.
- Read APIs can become a leak channel for deployment secrets or provider errors.

### 8. Mitigations

- Reuse service-side auth/session primitives and test multi-replica session behavior.
- Centralize read-model redaction and add fixture records with secret-looking values.

### 9. Consequences of not implementing this PR

Operators would have no browser path to verify service connectivity before richer approval workflows
are added.

### 10. Downsides for implementing this PR

It adds a user-facing surface that must be maintained even though it is intentionally minimal.

## PR-6: Read-only HTTP MCP server

### 1. Intent

Expose a minimal authenticated MCP surface so agents can inspect deployment state through the same
authorization, redaction, and audit boundaries as the service API and web UI.

### 2. Scope of changes

- Add an HTTP MCP endpoint at configured `mcp.basePath`.
- Reuse the read APIs and read-model redaction from PR-5.
- Implement v1 resources/tools:
  - `deployment_control_plane_status`
  - `deployment_queue`
  - `deployment_detail`
  - `deployment_auth_context`
- Require the same production service auth model used by other remote clients.
- Allow unauthenticated stdio or local HTTP MCP only in explicit fixture/dev mode.
- Include correlation ids or request ids in MCP responses and audit records.
- Keep response shapes stable, structured, intentionally smaller than internal records, and free of
  secret-bearing fields.
- Do not expose mutation tools in v1.
- Ensure MCP can be disabled by config when a host does not expose it.

### 3. External prerequisites

- None for tests. Production exposure requires host TLS/reverse proxy routing or an explicitly
  trusted internal network path.

### 4. Tests to be added

- Add MCP contract tests for each v1 resource/tool with authorized and unauthorized callers.
- Add redaction tests proving MCP never returns secret values, provider tokens, Infisical
  credentials, artifact contents, raw environment dumps, or unredacted errors.
- Add audit/correlation tests proving each MCP request records a request id that maps to an audit
  event.
- Add disabled-mode tests proving `mcp.enabled = false` removes the production endpoint.
- Add fixture-mode tests proving local unauthenticated MCP is impossible unless explicit fixture/dev
  mode is active.
- Add no-mutation tests proving the v1 MCP surface exposes no mutation tools.

### 5. Docs to be added or updated

- Document the MCP endpoint, auth requirements, v1 resources/tools, disabled mode, and fixture-only
  unauthenticated behavior.
- Document that future mutation-capable MCP tools must reuse CLI/web grants, idempotency keys,
  payload fingerprinting, and audit records.
- Add example read-only MCP calls with redacted response shapes.

### 5.5. Expected regression scope

- `deployment-only`
- Keep MCP as a presentation layer over existing service read APIs rather than introducing a
  separate agent-only control path.

### 6. Acceptance criteria

- Agents can inspect status, queue, deployment detail, and auth context through authenticated MCP.
- MCP responses are redacted, audited, correlated, and stable.
- No mutation-capable MCP tools exist in v1.

### 7. Risks

- MCP could accidentally become a second authorization path.
- Agent-facing data could expose more than the web UI or CLI diagnostics expose.

### 8. Mitigations

- Reuse service read APIs, service auth, and shared redaction.
- Test MCP responses against secret-bearing fixture records and no-mutation contracts.

### 9. Consequences of not implementing this PR

Agent integrations would need to scrape other APIs or use ad hoc credentials to inspect deployment
state.

### 10. Downsides for implementing this PR

It adds another externally reachable protocol surface that must be versioned and audited.

## PR-7: Reproducible OCI image

### 1. Intent

Package the service, worker, UI, MCP endpoint, and reviewed runtime tools into one reproducible OCI
image with no embedded secrets or host-specific state.

### 2. Scope of changes

- Add an image build target for the deployment control plane.
- Include the pinned runtime and compiled or packaged deployment tooling needed by the service and
  worker entrypoints.
- Include Git and SSH client for reviewed-source snapshots.
- Include OpenTofu when reviewed IaC applies run through the control plane.
- Include provider-specific CLIs only when a reviewed provider path requires them.
- Include static web UI assets and MCP server code from earlier PRs.
- Exclude credentials, database passwords, SSH keys, provider tokens, Infisical client secrets,
  deployment records, local cache contents, and host-specific config.
- Run as a non-root service user where the runtime allows it.
- Add image labels or metadata for version, source revision, and digest reporting.
- Support both `control-plane service` and `control-plane worker` commands from
  the same image.
- Keep registry and repository location parameterized; do not hardcode GitHub Container Registry.

### 3. External prerequisites

- None for local image tests. Publishing requires a registry configured outside this PR.

### 4. Tests to be added

- Add image build tests proving the image contains service and worker entrypoints.
- Add container smoke tests for service health, worker startup, config mount, and credential mount
  behavior.
- Add image inspection tests or assertions proving known secret filenames, fixture secrets, database
  URLs, private keys, and local state paths are absent from image layers.
- Add non-root execution tests where supported by the local container runtime.
- Add metadata tests proving version/source/digest information is visible to status APIs without
  reading mutable image tags.
- Add reproducibility checks appropriate for the repo's build system, or document and test the
  strongest available deterministic build assertion.

### 5. Docs to be added or updated

- Document how to build the OCI image locally and how production image references should be pinned by
  digest.
- Document required mounted config, credential, records, artifact scratch, and runtime paths.
- Document that registry/repository are operator inputs and GHCR is only an example.

### 5.5. Expected regression scope

- `mixed-build-system`
- This is the only PR expected to trigger full mixed/build-system validation. Keep runtime behavior
  changes out of this PR unless they are directly required by image startup tests and cannot be
  landed cleanly in an earlier deployment-only PR.

### 6. Acceptance criteria

- One reviewed image can run service and worker modes.
- The image contains required runtime tools and no credentials or host-specific state.
- The image can be pinned by digest and reports non-secret build metadata.

### 7. Risks

- The image could become an uncontrolled mutable toolbox.
- Build packaging may accidentally capture local state or secrets.

### 8. Mitigations

- Keep the included tool list explicit and test image contents for prohibited files and strings.
- Require mounted config and credentials at runtime instead of baking host inputs into the image.

### 9. Consequences of not implementing this PR

The host modules and Compose examples would not have a reviewed runtime artifact to execute.

### 10. Downsides for implementing this PR

It introduces container build maintenance and may broaden build-system validation scope.

## PR-8: Importable NixOS container module

### 1. Intent

Provide importable Nix files so a NixOS host can run the containerized control plane with a small
host-local parameter block and sensible defaults.

### 2. Scope of changes

- Add `build-tools/tools/nix/deployment-control-plane-container-module.nix`.
- Add `build-tools/tools/nix/deployment-control-plane-container-defaults.nix` if useful for keeping
  defaults readable.
- Expose module options for:
  - enablement
  - instance id
  - image reference, registry, repository, and digest
  - public URL, bind address, port, and public hostname
  - container runtime, defaulting to Podman
  - worker replica count, defaulting to `2`
  - web UI enablement and base path
  - MCP enablement and base path
  - records, artifact staging, and runtime scratch roots
  - S3-compatible artifact-store config and credential names
  - database URL credential name
  - reviewed-source SSH key credential name
  - Infisical credential file patterns
  - extra credential files
  - optional nginx management
- Create the service user and group.
- Create persistent state and scratch directories with restrictive ownership.
- Write the non-secret mounted config file from module options.
- Mount config, credential files, records, artifact scratch, and runtime scratch into containers.
- Run one service container and `workerReplicas` worker containers from the reviewed image.
- Support systemd `LoadCredential=` where practical while keeping generic `/run/secrets/...` source
  paths compatible with SOPS-nix, agenix, and manual secret stores.
- Bind the service to loopback by default.
- Fail closed when required credential source files are absent.
- Optionally emit nginx config only when `manageNginx = true` and `publicHostName` is set.

### 3. External prerequisites

- None for module evaluation tests. A real host must provide the reviewed image and credential source
  files before enabling the module.

### 4. Tests to be added

- Add Nix evaluation tests for default options and a representative host import.
- Add tests proving Podman is the default runtime and Docker can be selected only when it preserves
  the same mounts, credentials, health checks, and loopback bind behavior.
- Add tests proving `workerReplicas = 2` emits two worker containers and one service container.
- Add tests proving credential source paths are wired through systemd credentials or equivalent
  mount semantics without placing secret values in the generated Nix store output.
- Add tests proving missing required credentials fail closed.
- Add nginx option tests proving nginx config is emitted only with both `manageNginx = true` and
  `publicHostName` set.
- Add module snapshot or assertion tests proving image registry/repository/digest are parameterized
  and GHCR is not hardcoded.

### 5. Docs to be added or updated

- Document the NixOS module options, defaults, and required host-local parameters.
- Add a copyable host import example for a one-service/two-worker deployment.
- Document Podman as the NixOS default and Docker as a compatible substrate when the same runtime
  contract is preserved.
- Document `LoadCredential=` guidance and generic secret-store compatibility without requiring
  SOPS-nix or agenix.

### 5.5. Expected regression scope

- `deployment-and-nix`
- Keep NixOS host module files under `build-tools/tools/nix/**` and avoid unrelated host
  configuration churn.

### 6. Acceptance criteria

- A NixOS host can import one module and provide a small host-local parameter block to run the
  containerized control plane.
- The module defaults to one service and two workers with Podman.
- Secrets are passed as mounted credential files, not as Nix store values or plaintext env files.

### 7. Risks

- NixOS convenience could accidentally become the only supported runtime path.
- Generated systemd/container config could expose secret values in store paths or logs.

### 8. Mitigations

- Keep the module as a host setup wrapper around the generic runtime contract.
- Test generated config for credential references rather than credential contents.

### 9. Consequences of not implementing this PR

NixOS operators would still need to hand-write fragile systemd/container wiring.

### 10. Downsides for implementing this PR

It adds NixOS module maintenance and runtime-specific test coverage.

## PR-9: Non-NixOS Compose and Podman host profile

### 1. Intent

Provide a tested non-NixOS host profile that runs the same service and two-worker topology through
Docker-compatible Compose or Podman without changing control-plane behavior.

### 2. Scope of changes

- Add a Compose-compatible example for one service container and two worker containers.
- Add a Podman-compatible invocation or compose profile when it differs from Docker-compatible
  Compose.
- Mount the same config, credential, records scratch, artifact scratch, and runtime scratch paths
  used by the NixOS module.
- Keep the service bound to loopback by default.
- Keep database and S3-compatible object storage external for production examples.
- Add a local fixture profile only for development smoke tests if needed.
- Ensure registry, repository, and image digest are placeholders or parameters, not hardcoded
  production assumptions.
- Ensure the example does not introduce plaintext env-file credential handling.

### 3. External prerequisites

- None for local fixture smoke tests. Real hosts must provide the image, external Postgres,
  S3-compatible artifact store, and credential files.

### 4. Tests to be added

- Add static validation tests for the Compose/Podman files proving service and two workers are
  present with the expected commands and mounts.
- Add smoke tests that run the profile against local fake database/object-store/credential fixtures
  when a local container runtime is available.
- Add tests proving the profile binds the service to loopback by default.
- Add tests proving no plaintext env-file or environment variable carries workload credentials.
- Add tests proving disabling MCP or web UI in the mounted config is respected by the running
  service.
- Add parity tests proving the non-NixOS profile uses the same config keys and credential filenames
  as the NixOS module.

### 5. Docs to be added or updated

- Document non-NixOS host setup, required files, required external services, and local smoke-test
  usage.
- Document Docker and Podman support boundaries and the single runtime contract they must preserve.
- Document that Compose examples are operational examples, not a separate deployment authority.

### 5.5. Expected regression scope

- `deployment-only`
- Prefer static validation plus existing local fixture smoke hooks. If repository build tooling must
  learn to run Compose smoke tests, update this plan first and isolate that shared build-system
  change instead of broadening the host-profile PR by default.

### 6. Acceptance criteria

- A non-NixOS operator has a tested Compose/Podman profile matching the same runtime contract as the
  NixOS module.
- The profile runs one service and two workers without plaintext credential env files.
- Docker and Podman behavior are documented as substrates for the same control-plane process modes.

### 7. Risks

- Docker and Podman differences could create divergent operational behavior.
- Examples can become stale if they are not exercised.

### 8. Mitigations

- Keep the profile thin and assert the exact commands, mounts, and config keys in tests.
- Prefer the same image, same config file, and same credential directory everywhere.

### 9. Consequences of not implementing this PR

The design would remain NixOS-heavy despite requiring non-NixOS compatibility.

### 10. Downsides for implementing this PR

It adds another host substrate to test and document.

## PR-10: Containerized end-to-end deployment flow

### 1. Intent

Prove the full containerized control-plane path works end to end with one service replica, two worker
replicas, external database coordination, S3-compatible artifact storage, file-backed credentials,
web UI status, and MCP inspection.

### 2. Scope of changes

- Add an end-to-end fixture deployment scenario that submits through the service and executes through
  the two-worker containerized runtime.
- Use externalized fixture services for database and S3-compatible object storage.
- Use file-backed credential fixtures for reviewed-source and deployment credentials.
- Exercise the same image, config file, service command, worker command, artifact-store path,
  credential path, web read API, and MCP read API used by production profiles.
- Verify queue claims, leases, provider locks, idempotency, artifact digest checks, audit records,
  UI redaction, and MCP redaction in one integrated scenario.
- Keep live provider or live Infisical calls optional and gated behind explicit operator
  configuration; default validation must use deterministic fixtures.
- Capture non-secret run evidence that can be used by the `pr` and `prs` workflows without exposing
  credentials.

### 3. External prerequisites

- None for default validation. Optional live smoke requires explicitly configured operator
  credentials, a reviewed image, Postgres, S3-compatible storage, and deployment credentials.

### 4. Tests to be added

- Add an end-to-end containerized flow test with one service and two workers processing a fixture
  submission exactly once.
- Add artifact verification checks proving the worker reads from S3-compatible storage and fails
  closed on digest mismatch.
- Add idempotency checks proving duplicate submit or retry requests do not create duplicate
  executions.
- Add audit checks proving request ids correlate service, worker, UI, and MCP observations.
- Add web UI checks proving status and queue pages reflect the fixture run and redact secret-bearing
  values.
- Add MCP checks proving the same fixture run is inspectable through authorized read-only MCP tools
  and no mutation tools are exposed.
- Add optional live-smoke gating tests that skip unless all required operator-controlled environment
  variables or credential files are present.

### 5. Docs to be added or updated

- Document the end-to-end fixture scenario, how to run it locally, and how to interpret failures.
- Document optional live-smoke configuration and the exact credentials required when enabled.
- Update containerized operations docs with known-good validation commands and expected non-secret
  evidence.

### 5.5. Expected regression scope

- `deployment-and-project-impact`
- If the fixture deployment requires checked-in package or target changes under
  `projects/deployments/**`, keep them narrow and explicitly tied to this scenario.

### 6. Acceptance criteria

- The containerized runtime is validated as a coherent system, not only as isolated components.
- One service and two workers can process a submission exactly once using database coordination and
  S3-compatible artifact payload storage.
- Web UI and MCP inspection work against the same run without exposing secrets or mutations.

### 7. Risks

- End-to-end validation can become slow or brittle.
- Optional live smoke can leak into default validation if gating is weak.

### 8. Mitigations

- Keep the default scenario deterministic and fixture-backed.
- Gate live smoke behind explicit operator configuration and skip clearly when absent.

### 9. Consequences of not implementing this PR

The plan would lack proof that the independently added container, scaling, artifact, UI, MCP, and
credential pieces work together.

### 10. Downsides for implementing this PR

It adds a broader integration scenario that may increase validation time.
