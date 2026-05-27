# Cloud Control Plane Implementation Plan

This plan implements the cloud-portable control-plane target described in
[Cloud Control Plane Design](/Users/kiltyj/Code/viberoots/docs/cloud-control-design.md).

Reviewed context:

- The deployment control plane remains the protected/shared deployment authority. Cloud runtimes,
  object stores, databases, registries, auth providers, and CI jobs are substrates, not authorities.
- Mini should keep working, but it should become one cloud-shaped host profile instead of a special
  deployment authority with local-only state.
- Viberoots-owned long-running service containers should be Nix-built OCI images. A full NixOS host
  remains preferred when we control the host; a full NixOS userspace inside each OCI image is not the
  goal.
- Durable control-plane state belongs in managed Postgres. Artifact authority belongs in an
  S3-compatible object store. Secrets remain file-backed at runtime and Infisical remains the
  deployment secret backend unless a separate secret-backend design changes that.
- Supabase is a strong managed dependency candidate for Postgres and possibly Storage. WorkOS and
  Supabase Auth are identity-provider candidates. None of these becomes a deployment provider or
  mutation authority without explicit provider-capability work.
- Existing code already contains substantial control-plane surfaces: typed runtime config, service
  and worker commands, S3-compatible artifact-store code, durable queue and lock modules, read APIs,
  web UI routes, MCP code, a Nix-built OCI image expression, a NixOS container module, and non-NixOS
  host-profile examples. This plan hardens, validates, and connects those surfaces into an easy cloud
  setup path.

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no operational-runbook-only PRs
- no migration that requires deleting mini before a cloud host has passed the same health,
  deployment, restore, and rollback checks
- no production control-plane credential through developer laptop env vars, CI env vars, checked-in
  config, image layers, registry metadata, or browser-visible payloads
- no cloud provider specific shortcut that bypasses queue claims, leases, provider locks, fenced
  worker execution, stage-state compare-and-swap, admission revalidation, or audit records
- no broad provider rewrite while the control-plane substrate is being made portable

Verify-scope organization:

- Most implementation should stay under deployment-owned paths:
  - `build-tools/deployments/**`
  - `build-tools/tools/deployments/**`
  - `build-tools/tools/tests/deployments/**`
  - `build-tools/tools/nix/**`
  - `docs/**`
- The Nix-built image and NixOS module PRs are expected to touch Nix support files and should be
  classified as `mixed-build-system` if they affect shared flake/package wiring.
- Live checks against Supabase, R2, WorkOS, or a cloud container host must be explicitly gated and
  skipped by default. Unit and fixture tests must not depend on Pleomino, mini, Supabase, R2,
  WorkOS, or any live demo project.
- Each PR below must update this plan if implementation changes invalidate the remaining sequence,
  scope, or assumptions.
- The `Tests to be added` and `Docs to be added or updated` sections in each PR describe required
  collateral for the implementation in that same PR. They are not permission to split tests or docs
  into standalone PRs.
- If a planned PR turns out to contain only documentation, only tests, or only live operational
  steps, fold that work into the adjacent implementation PR that creates or changes the behavior.

By the end of this sequence, an operator should be able to provision managed Postgres, choose a
compatible S3 object store, publish a reviewed Nix-built image by digest, generate a host profile for
a SaaS OCI platform or NixOS host, mount credentials as files, run one service and at least two
workers, pass conformance checks, and execute a protected/shared staging deployment without mini
owning the database, artifact store, or runtime credentials.

## PR-1: Runtime config and credential contract hardening

### 1. Intent

Make the control-plane runtime contract explicit enough that mini, NixOS hosts, and SaaS OCI hosts
can all run the same image from mounted config and mounted credential files.

### 2. Scope of changes

- Audit and harden `control-plane-runtime-config*`, `control-plane-credentials*`, and process-env
  helpers against the design contract.
- Keep `/etc/deployment-control-plane/config.yaml` as the production config path.
- Require file-backed production credentials for database URL, service token, reviewed-source
  credentials, artifact-store endpoint and keys, and deployment-scoped Infisical client credentials.
- Preserve local fixture mode while making it visibly non-production.
- Validate deployment-id based Infisical credential filename patterns:
  - `{deploymentId}-infisical-client-id`
  - `{deploymentId}-infisical-client-secret`
- Validate artifact-store credential filenames:
  - `artifact-store-endpoint`
  - `artifact-store-access-key-id`
  - `artifact-store-secret-access-key`
- Ensure config validation errors use redaction helpers and never echo secret file contents,
  database URLs, tokens, access keys, or private key material.
- Fail closed if production mode receives provider, database, artifact-store, Infisical, or
  reviewed-source credentials from ambient env vars.

### 3. External prerequisites

- None. Fixture mode should supply all non-live test inputs from temp directories.

### 4. Tests to be added

- Add config parser tests for required production fields, credential file resolution, deployment-id
  Infisical substitutions, and artifact-store credential files.
- Add redaction tests for missing, malformed, and unreadable credential files.
- Add fixture-mode tests proving local/test config does not need live credentials.
- Add guardrail tests proving production config rejects ambient secret-bearing env vars.

### 5. Docs to be added or updated

- Update `docs/control-plane-runtime-configuration.md`.
- Update `docs/cloud-control-design.md` only if the contract changes.
- Add a credential-file manifest table referenced by later host-profile docs.

### 5.5. Expected regression scope

- `deployment-only`
- If runtime config hardening requires shared CLI or Nix loader changes outside deployment-owned
  paths, update this plan before expanding the PR scope.

### 6. Acceptance criteria

- A production service or worker cannot start without all required files.
- Local fixture mode remains convenient and clearly marked.
- No production credential source is accepted from laptop or CI ambient env vars.
- Error output identifies missing inputs without leaking secret values.

### 7. Risks

- Tightening startup validation could break mini before the host profile is updated.
- Redaction gaps could leak sensitive paths or values during setup failures.

### 8. Mitigations

- Keep a fixture profile and a mini compatibility fixture in tests.
- Add targeted redaction tests for every credential-bearing field.

### 9. Consequences of not implementing this PR

Later host profiles would inherit ambiguous credential behavior and cloud setup would be fragile.

### 10. Downsides for implementing this PR

Operators must prepare credential files before the service starts, even for early smoke tests.

## PR-2: External Postgres coordination conformance

### 1. Intent

Prove the control-plane database model is safe for multiple service and worker replicas using an
external Postgres-compatible backend.

### 2. Scope of changes

- Audit durable queue, submission, idempotency, provider lock, worker heartbeat, stage-state, and
  audit modules for external Postgres assumptions.
- Keep file-lock coordination isolated to local fixture mode only.
- Harden atomic queue claims, lease renewal, lease expiry, fencing tokens, provider locks, and
  stage-state compare-and-swap.
- Add explicit connection configuration and migration validation for managed Postgres.
- Ensure retry behavior is idempotent when a request or worker crashes after a durable write.
- Add database feature checks for the SQL features the control plane relies on.

### 3. External prerequisites

- None for default tests.
- Optional live smoke can use a throwaway Supabase Postgres project or another managed Postgres
  database when explicitly enabled.

### 4. Tests to be added

- Add fixture tests with two worker loops competing for the same submission.
- Add stale lease and fencing-token tests proving stale workers cannot mutate provider state.
- Add idempotency tests for duplicate submit requests and retry after process failure.
- Add stage-state compare-and-swap tests for concurrent promotion attempts.
- Add a live-gated managed Postgres conformance test that creates only temporary schema/data.

### 5. Docs to be added or updated

- Update `docs/control-plane-horizontal-scaling.md`.
- Add a managed Postgres conformance checklist to `docs/cloud-control-design.md` or a linked runtime
  operations doc.
- Document the live-gated test environment variables and how to avoid using production databases.

### 5.5. Expected regression scope

- `deployment-only`
- Keep database behavior changes under deployment control-plane modules and tests.

### 6. Acceptance criteria

- Two workers cannot claim or execute the same submission.
- Stale workers lose authority after lease expiry, claim-token mismatch, terminal submission state,
  or superseded stage state.
- The same database path works against local fixture Postgres and a live-gated managed Postgres
  backend.

### 7. Risks

- Coordination changes touch production mutation boundaries.
- Managed Postgres connection pooling or transaction behavior may differ from local fixtures.

### 8. Mitigations

- Prefer narrow, deterministic concurrency tests with explicit barriers.
- Keep live-managed checks additive and gated until the fixture suite proves behavior locally.

### 9. Consequences of not implementing this PR

Cloud workers could duplicate provider mutations or lose queue state under normal horizontal
scaling.

### 10. Downsides for implementing this PR

Database tests will become more complex and may need careful timing controls.

## PR-3: S3-compatible artifact authority conformance

### 1. Intent

Make an S3-compatible object store the authoritative artifact backend for cloud control-plane
execution.

### 2. Scope of changes

- Harden `ControlPlaneArtifactStore` and the HTTP/S3-compatible implementation.
- Store payload bytes under immutable object keys.
- Store metadata, digests, provenance, and durable references in Postgres.
- Verify artifact digests and provenance before worker execution.
- Make writes retry-safe and idempotent when the object already exists with the expected digest.
- Ensure object listing is not required for correctness.
- Support path-style and endpoint forms required by common S3-compatible providers when compatible
  with signing rules.

### 3. External prerequisites

- None for fixture tests.
- Optional live conformance can target Supabase Storage S3, Cloudflare R2, AWS S3, or another
  reviewed S3-compatible endpoint.

### 4. Tests to be added

- Add fake S3-compatible server tests for `PUT`, `GET`, `HEAD`, content type, custom metadata, and
  digest verification.
- Add duplicate-write tests for matching and mismatching digests.
- Add worker materialization tests that fail closed on missing, tampered, or metadata-mismatched
  artifacts.
- Add live-gated compatibility tests for candidate object stores, with temporary buckets or
  temporary object prefixes only.

### 5. Docs to be added or updated

- Update `docs/control-plane-containerization.md` and runtime config docs with artifact-store
  settings.
- Add a candidate object-store compatibility table.
- Document the known signing-region requirement and how to diagnose region mismatch errors.

### 5.5. Expected regression scope

- `deployment-only`
- If shared AWS/S3 helpers are introduced, update this plan before broadening scope.

### 6. Acceptance criteria

- Workers execute only artifacts whose stored bytes and provenance match durable records.
- Supabase Storage or another chosen S3-compatible backend has a recorded live conformance result
  before it is selected for production.
- No artifact correctness path relies on local mini filesystem state.

### 7. Risks

- S3-compatible providers differ on endpoint shape, region, custom metadata, and HEAD behavior.
- Retrying writes can hide corrupted object state if digest checks are weak.

### 8. Mitigations

- Treat live compatibility as a required provider-selection gate.
- Fail closed when an existing object has unexpected digest or metadata.

### 9. Consequences of not implementing this PR

Cloud workers would still depend on host-local artifact state and exact replay would not be portable.

### 10. Downsides for implementing this PR

Operators must provision and secure an object store before protected/shared cloud deploys can run.

## PR-4: Service and worker process lifecycle

### 1. Intent

Make the long-running service and worker entrypoints reliable under container orchestration.

### 2. Scope of changes

- Harden `deployment-control-plane service --config ...`.
- Harden `deployment-control-plane worker --config ...`.
- Validate `/healthz` and `/readyz` semantics for service startup, database connectivity, and
  required runtime dependencies.
- Make worker shutdown stop lease renewal and allow replacement workers to claim after expiry.
- Ensure child process environments are scrubbed before provider, Git, Nix, OpenTofu, or CLI tools
  execute.
- Add structured process logging with correlation ids and redaction.
- Ensure service and worker modes run from the same reviewed image without requiring different
  build outputs.

### 3. External prerequisites

- None. Tests should use temp workspaces, fixture databases, and fake provider endpoints.

### 4. Tests to be added

- Add process-mode smoke tests for service and worker startup from fixture config.
- Add readiness tests for missing database, missing artifact store, and healthy dependencies.
- Add graceful shutdown tests for in-flight leases.
- Add child environment scrubbing tests covering provider and artifact-store credentials.

### 5. Docs to be added or updated

- Update `docs/control-plane-containerization.md`.
- Update operations docs with health and readiness meanings.
- Document expected shutdown behavior for orchestrators.

### 5.5. Expected regression scope

- `deployment-only`

### 6. Acceptance criteria

- Service and workers start, report health, reject readiness when dependencies are missing, and shut
  down without preserving stale worker authority.
- Child process launches do not receive production credential env vars.
- One image can run both process modes by command argument.

### 7. Risks

- Health checks could become too strict and cause restart loops during transient dependency issues.
- Shutdown timing bugs could leave claimed submissions stuck until lease expiry.

### 8. Mitigations

- Keep `/healthz` for process liveness and `/readyz` for dependency readiness.
- Test shutdown with short, deterministic lease windows.

### 9. Consequences of not implementing this PR

SaaS hosts and NixOS modules would lack reliable lifecycle signals and workers could retain stale
authority during restarts.

### 10. Downsides for implementing this PR

More runtime states become visible and must be handled explicitly by operators.

## PR-5: Same-origin read APIs and minimal web UI

### 1. Intent

Give operators a stateless read surface for cloud-hosted control-plane visibility.

### 2. Scope of changes

- Harden read APIs for control-plane status, queue state, worker heartbeats, deployment detail,
  audit summaries, and artifact references.
- Keep v1 UI read-only.
- Store web sessions in the database so service replicas remain stateless.
- Apply the same redaction boundary as CLI/read APIs.
- Add cache-control, auth, and correlation-id behavior suitable for same-origin deployment UI pages.
- Ensure no provider credentials, secret values, database URLs, artifact credentials, or Infisical
  client secrets are exposed in UI or API payloads.

### 3. External prerequisites

- None.

### 4. Tests to be added

- Add API tests for each read model.
- Add redaction tests using records that contain secret-looking paths and values.
- Add session tests across simulated service replicas.
- Add static UI route tests for status, queue, and deployment detail pages.

### 5. Docs to be added or updated

- Update `docs/control-plane-web-ui.md`.
- Document API payload stability and redaction boundaries.
- Add operator troubleshooting examples based on read-only views.

### 5.5. Expected regression scope

- `deployment-only`

### 6. Acceptance criteria

- Operators can inspect service status, queue state, worker heartbeats, and deployment detail through
  read-only HTTP surfaces.
- Sessions survive service replica changes through database-backed state.
- Redaction tests cover UI and API output.

### 7. Risks

- A read-only UI can still leak sensitive operational details.
- Database-backed sessions can become another availability dependency.

### 8. Mitigations

- Keep mutation controls out of v1.
- Reuse existing read redaction helpers and fail closed on unknown sensitive fields.

### 9. Consequences of not implementing this PR

Cloud-hosted operation would require direct database access or SSH-like host access for basic
visibility.

### 10. Downsides for implementing this PR

The service gains an operator-facing HTTP surface that must be maintained and secured.

## PR-6: Read-only HTTP MCP endpoint

### 1. Intent

Expose authenticated, disableable MCP access to the same read-only control-plane state as the web UI
and read APIs.

### 2. Scope of changes

- Harden the HTTP MCP endpoint at configured `mcp.basePath`.
- Keep MCP disabled by config when operators do not need it.
- Implement or validate v1 resources/tools:
  - `deployment_control_plane_status`
  - `deployment_queue`
  - `deployment_detail`
  - `deployment_auth_context`
- Reuse service auth, redaction, audit correlation, and rate-limit boundaries.
- Ensure MCP cannot trigger deploys, approvals, credential reads, provider mutations, or artifact
  writes in v1.

### 3. External prerequisites

- None.

### 4. Tests to be added

- Add MCP protocol tests for each v1 read resource/tool.
- Add auth failure, disabled-by-config, and redaction tests.
- Add tests proving mutation-like MCP requests are unavailable or rejected.

### 5. Docs to be added or updated

- Update `docs/control-plane-mcp.md`.
- Document MCP enablement, auth, and operator use cases.
- Document that MCP v1 is read-only.

### 5.5. Expected regression scope

- `deployment-only`

### 6. Acceptance criteria

- MCP reads expose no more information than the authenticated read APIs.
- MCP can be disabled by config.
- MCP does not provide a mutation path.

### 7. Risks

- MCP expands the remote surface area.
- Tool descriptions could accidentally reveal sensitive deployment metadata.

### 8. Mitigations

- Keep v1 read-only and reuse the same redaction helpers as API/UI routes.
- Add negative tests for mutation attempts.

### 9. Consequences of not implementing this PR

Cloud operators and agents would need ad hoc API calls instead of a reviewed MCP surface.

### 10. Downsides for implementing this PR

Another authenticated endpoint must be monitored and versioned.

## PR-7: Reproducible Nix-built OCI image and registry workflow

### 1. Intent

Produce, inspect, publish, and consume the reviewed deployment control-plane image by immutable
digest.

### 2. Scope of changes

- Wire `build-tools/tools/nix/flake/packages/deployment-control-plane-image.nix` into the reviewed
  build graph if it is not already fully reachable.
- Keep `pkgs.dockerTools.buildLayeredImage` as the image builder.
- Preserve Node 22, git, openssh, opentofu, awscli2, kubectl, helm, wrangler, cacerts, non-root
  `10001:10001`, and the shared service/worker entrypoint contract.
- Add image contract inspection for required mounts, included tools, labels, entrypoint, user, and
  prohibited paths.
- Add layer scans for private keys, dotenv files, database URLs, credential filenames, Infisical
  secrets, artifact-store secrets, and accidental bundle captures.
- Add a registry publication path that records immutable digest and source revision.
- Ensure image tags are convenience references only; production host profiles consume digests.

### 3. External prerequisites

- Optional registry credentials for live publication. Default tests should build or inspect locally
  without pushing.

### 4. Tests to be added

- Add Nix build tests for the runtime derivation and image contract derivation.
- Add image smoke tests for `deployment-control-plane service --help` and `worker --help`, or the
  closest non-mutating command available.
- Add layer inspection tests for prohibited paths and secret-looking strings.
- Add live-gated push/pull/digest tests for the selected registry.

### 5. Docs to be added or updated

- Update `docs/control-plane-containerization.md`.
- Document image build, inspect, publish, and digest pinning commands.
- Document why the image is Nix-built but not a full NixOS container.

### 5.5. Expected regression scope

- `mixed-build-system`
- This PR may touch Nix flake/package wiring. Keep unrelated build-system changes out of the PR.

### 6. Acceptance criteria

- The image can be built reproducibly from reviewed inputs.
- Image inspection proves required runtime tools exist and prohibited secret paths are absent.
- A published image can be referenced by immutable digest in host profiles.

### 7. Risks

- Bundling can accidentally include local config or credential-like data.
- Registry workflows can tempt operators to deploy mutable tags.

### 8. Mitigations

- Treat layer inspection as a release gate.
- Make host profiles require digests and reject tag-only production image references.

### 9. Consequences of not implementing this PR

Cloud hosts would not have a reviewed, reproducible, digest-pinned runtime artifact.

### 10. Downsides for implementing this PR

Image build and inspection add another validation path to maintain.

## PR-8: NixOS container module validation and mini cloud-shaped profile

### 1. Intent

Make NixOS the preferred controlled-host integration and use it to align mini with the cloud
runtime contract.

### 2. Scope of changes

- Validate `build-tools/tools/nix/deployment-control-plane-container-module.nix`.
- Ensure the module manages service user/group, runtime config rendering, credential staging through
  `LoadCredential=`, one service container, N worker containers, Podman default, optional Docker
  backend, and optional nginx config.
- Require image digest or a complete reviewed image reference.
- Ensure mounted credentials are readable only by the container user.
- Add a mini host profile that points at external Postgres and S3-compatible storage while keeping
  mini as ingress until cloud cutover.
- Add live-state migration support or a reviewed migration checklist for moving mini's current
  control-plane database records into external Postgres, including submissions, queue rows, audit
  rows, stage state, deployment records, and idempotency facts.
- Add a preflight that refuses protected/shared deploys during the live database cut unless state
  sync, restore, and rollback evidence is present.
- Keep local records/artifacts on mini as scratch only after external persistence is enabled.

### 3. External prerequisites

- Optional mini access for live host validation.
- External Postgres and object store can be fixture values until PR-10 selects managed backends.

### 4. Tests to be added

- Add Nix evaluation tests for required options, defaults, missing credential assertions, rendered
  config, worker replica generation, and nginx gating.
- Add module tests for Podman and Docker option selection.
- Add static tests proving credential staging does not render secret contents into config.
- Add migration validation tests using fixture database snapshots that include live-like queue,
  audit, stage-state, deployment-record, and idempotency rows.
- Add live-gated mini validation for service health, worker heartbeats, and mounted credential file
  permissions.

### 5. Docs to be added or updated

- Update `docs/control-plane-nixos-container-module.md`.
- Add a mini cloud-shaped migration runbook.
- Document database migration, restore, and rollback gates before mini points at external Postgres.
- Document rollback to the previous mini service profile.

### 5.5. Expected regression scope

- `mixed-build-system`
- NixOS module changes may touch Nix support paths. Runtime behavior should remain in deployment
  modules.

### 6. Acceptance criteria

- The NixOS module evaluates in tests and rejects unsafe or incomplete production config.
- Mini can run the same image and config shape as cloud hosts.
- Mini database migration has a tested fixture path and a live-gated preflight before operational
  cutover.
- Mini no longer needs to own authoritative database or artifact state once external dependencies
  are supplied.

### 7. Risks

- Host module changes can disturb working mini deployment control-plane service.
- Credential staging bugs can make containers start without required files.
- A partial live database migration could strand in-flight submissions or lose audit history.

### 8. Mitigations

- Keep live mini changes behind explicit operator runbook steps.
- Validate the rendered module before switching host traffic.
- Prefer dry-run migration validation and explicit rollback evidence before enabling
  protected/shared deploys on migrated state.

### 9. Consequences of not implementing this PR

The controlled-host path would remain under-tested and mini would stay special.

### 10. Downsides for implementing this PR

NixOS module testing and mini migration add operational complexity before cloud cutover.

## PR-9: Non-NixOS and SaaS OCI host profile package

### 1. Intent

Provide a portable host-profile bundle for OCI substrates that are not NixOS, including SaaS cloud
container platforms that can preserve the runtime boundary.

### 2. Scope of changes

- Harden `build-tools/tools/deployments/control-plane-host-profile/**`.
- Provide Compose-compatible and direct Podman examples for one service and two workers.
- Add a generic SaaS OCI profile description for platforms with digest-pinned images, file-backed
  secrets, persistent scratch mounts, HTTPS ingress, and outbound access to Git, Infisical, Postgres,
  object storage, and provider APIs.
- Add substrate conformance checks for kernel/runtime behavior that the Nix-built image does not
  pin: cgroups, filesystem permissions, seccomp profile, DNS, clock skew, graceful shutdown signals,
  persistent scratch ownership, and mounted credential permissions.
- Reject or clearly mark unsupported platforms that only support secret env vars and cannot mount
  credential files.
- Keep host-profile generation free of plaintext env-file credentials.
- Add a conformance checklist that operators can run before trusting a new substrate.

### 3. External prerequisites

- None for static validation.
- Optional live substrate credentials for a gated SaaS OCI smoke run.

### 4. Tests to be added

- Add static validation tests for Compose and Podman examples.
- Add tests proving generated profiles reference image digests, mounted config, mounted credentials,
  and scratch directories.
- Add fixture smoke tests that run one service and two workers locally using the non-NixOS profile.
- Add substrate conformance tests for the portable checks that can run against local Podman/Docker
  and a live-gated SaaS OCI host.
- Add live-gated substrate conformance tests for selected SaaS OCI platforms.

### 5. Docs to be added or updated

- Update `docs/control-plane-non-nixos-host-profile.md`.
- Add a SaaS host capability matrix.
- Document minimum platform requirements and unsupported platform behavior.
- Document substrate conformance requirements that Nix-built OCI images cannot pin on their own.

### 5.5. Expected regression scope

- `deployment-only`
- If image build graph changes are needed, split them into PR-7 or update this plan.

### 6. Acceptance criteria

- A non-NixOS operator can start the service and two workers from the same image digest without
  putting credentials in env files.
- The profile explains exactly which SaaS platforms are valid substrates and why.
- The profile includes a substrate conformance check for runtime behavior outside the image's Nix
  closure.
- Local fixture smoke passes with the profile bundle.

### 7. Risks

- SaaS OCI platforms vary widely in secret-file support, persistent volume behavior, networking, and
  graceful shutdown.
- Compose examples can drift from the NixOS module contract.

### 8. Mitigations

- Make conformance checks substrate-generic and live-gated.
- Reuse the same config schema and credential manifest as the NixOS module.

### 9. Consequences of not implementing this PR

Cloud setup would remain bespoke and mini/NixOS-specific.

### 10. Downsides for implementing this PR

The project must maintain examples for host substrates it may not control directly.

## PR-10: Managed dependency profiles for Supabase Postgres and S3-compatible storage

### 1. Intent

Turn managed Postgres and object-store candidates into explicit, validated dependency profiles for
cloud control-plane setup.

### 2. Scope of changes

- Add a managed Postgres profile shape, with Supabase Postgres as the first candidate.
- Add an S3-compatible artifact-store profile shape, with Supabase Storage S3 and Cloudflare R2 as
  candidates.
- Keep provider selection explicit. Supabase Storage is acceptable only after live conformance passes
  for the same artifact-store implementation workers use.
- Add setup validation that checks database connectivity, required SQL behavior, object-store
  `PUT`/`GET`/`HEAD`, metadata, content type, digest verification, and signing region.
- Ensure managed dependency credentials are file-backed and never browser-visible.
- Record compatibility evidence without storing secret values.

### 3. External prerequisites

- Optional Supabase project for live Postgres and Storage checks.
- Optional R2 or other S3-compatible credentials for artifact-store comparison.
- No default test may require a live account.

### 4. Tests to be added

- Add fixture profile tests for managed Postgres and S3-compatible storage config.
- Add live-gated Supabase Postgres conformance tests.
- Add live-gated Supabase Storage S3 conformance tests.
- Add live-gated R2 conformance tests if selected as a comparison backend.
- Add failure tests for wrong region, wrong bucket, missing metadata support, and unreadable
  credentials.

### 5. Docs to be added or updated

- Add managed dependency setup docs linked from `docs/cloud-control-design.md`.
- Document Supabase-specific values without making Supabase a required final choice.
- Document how to capture and review compatibility evidence.

### 5.5. Expected regression scope

- `deployment-only`

### 6. Acceptance criteria

- Operators can validate managed Postgres and object-store candidates before using them for deploys.
- The chosen object store has recorded conformance evidence.
- The control plane can run with managed Postgres and managed object storage without mini-owned
  durable state.

### 7. Risks

- Supabase Storage S3 compatibility may not match the current artifact-store signer or metadata
  expectations.
- Managed database networking or pooling can fail differently than local fixture Postgres.

### 8. Mitigations

- Keep candidate compatibility tests live-gated and repeatable.
- Do not bless a candidate until the same runtime implementation passes against it.

### 9. Consequences of not implementing this PR

Cloud setup would still rely on undocumented manual choices for critical durable dependencies.

### 10. Downsides for implementing this PR

The repo gains provider-specific setup guidance for dependencies that are not deployment providers.

## PR-11: Hosted auth provider abstraction

### 1. Intent

Make deployment control-plane auth portable enough to replace the current local identity-provider
role with Supabase Auth, WorkOS, or another reviewed OIDC provider.

### 2. Scope of changes

- Add an auth-provider configuration contract for issuer, audience, JWKS URL, token support, user id
  claim, email claim, role/group claim mapping, service principal mapping, and CLI login mode.
- Preserve admission reporter authorization, protected/shared deploy authorization, service
  principal authorization, and stable audit principal identity.
- Keep the current local auth provider as an adapter.
- Add a generic OIDC/JWKS adapter that can be configured for Supabase Auth or WorkOS after live
  review.
- Keep mutation authority in the control-plane service; auth providers only authenticate and supply
  claims.
- Make auth callback ingress portable away from mini-specific nginx assumptions.
- Document that Supabase Auth and WorkOS may authorize adjacent cache-admin workflows, such as
  issuing narrowly scoped Attic tokens, but they must not become direct credentials for Nix cache
  traffic, deployment workers, or provider mutations.

### 3. External prerequisites

- None for fixture tests.
- Optional Supabase Auth or WorkOS sandbox for live-gated login and claim-mapping tests.

### 4. Tests to be added

- Add fixture JWKS/OIDC tests for token verification and claim mapping.
- Add authorization tests for deployer, admission reporter, admin, and service principal roles.
- Add audit identity tests proving stable principal names are recorded.
- Add fail-closed tests for missing issuer, stale JWKS, missing role claims, wrong audience, and
  expired tokens.
- Add live-gated Supabase Auth or WorkOS smoke tests if a sandbox is configured.

### 5. Docs to be added or updated

- Add auth-provider configuration docs.
- Update cloud-control docs to explain Supabase Auth and WorkOS as identity providers, not
  deployment providers.
- Document callback hostname requirements for cloud hosts.
- Document the separation between operator identity, deployment authority, and adjacent cache-token
  issuance.

### 5.5. Expected regression scope

- `deployment-only`

### 6. Acceptance criteria

- Existing local auth still works through an adapter.
- A generic OIDC/JWKS provider can authenticate operators and map roles in fixture tests.
- Protected/shared authorization and audit identity remain stable across adapters.
- Auth documentation makes clear that provider credentials, deployment worker credentials, and
  cache-service tokens remain separate from browser SSO sessions.

### 7. Risks

- Auth migration can accidentally weaken admission reporter or deployer authorization.
- Different hosted providers expose claims differently.

### 8. Mitigations

- Treat role mapping as explicit config, not provider-specific magic.
- Keep fail-closed tests for missing or ambiguous claims.

### 9. Consequences of not implementing this PR

Cloud control-plane hosting would still depend on mini-local identity-provider assumptions.

### 10. Downsides for implementing this PR

Auth configuration becomes more flexible and therefore needs stricter validation and documentation.

## PR-12: Cloud setup CLI and profile generator

### 1. Intent

Provide the easy setup path: a reviewed command that generates, validates, and explains a complete
cloud control-plane host profile without embedding secrets.

### 2. Scope of changes

- Add a `deployment-control-plane` or `deploy-control-plane-operator` setup subcommand for cloud
  host profile generation.
- Generate a profile bundle containing:
  - runtime config template
  - credential-file manifest
  - service and worker command definitions
  - image digest requirement
  - managed Postgres settings
  - S3-compatible artifact-store settings
  - reviewed-source credential placeholders
  - Infisical deployment credential placeholders
  - auth callback and service ingress settings
  - health, readiness, worker-heartbeat, artifact, and database validation commands
- Add an AWS EC2 host profile mode for the recommended production topology:
  - one long-running service process and N long-running deployment worker processes
  - file-backed credentials staged through the existing credential manifest
  - optional Supabase Postgres PrivateLink endpoint settings
  - AWS S3 artifact-store settings through a VPC endpoint as the default artifact path for this
    topology
  - optional Supabase Storage S3 or other S3-compatible artifact-store settings only as reviewed
    alternate backends
  - security-group, subnet, TLS/ALB-or-NLB, and DNS checklist placeholders without embedding
    provider secrets
- Add provider-capability declarations or generated placeholders for the topology components the
  deployment control plane is allowed to orchestrate:
  - `aws-ec2-control-plane-host`
  - `aws-attic-cache-service`
  - `aws-s3-artifact-store`
  - `aws-network-foundation`
  - `supabase-managed-postgres`
  - `supabase-privatelink-prerequisite`
  - `cloudflare-edge`
  - `vercel-operator-ui`
  - `remote-build-worker-fleet`
- Require each generated provider-capability declaration to state target identity, credential source,
  lock scope, preview/diff behavior, mutation sequence, smoke checks, rollback procedure, replay
  semantics, audit evidence, and protected/shared eligibility.
- Allow provider capabilities to invoke reviewed IaC or provider CLIs only through the control-plane
  admission, locking, credential, audit, and rollback model.
- Prefer reviewed infrastructure-as-code for every external component that can be represented safely:
  VPCs, subnets, security groups, VPC endpoints, ALB/NLB, DNS records, S3 buckets, lifecycle policies,
  IAM roles, EC2 launch templates, Auto Scaling groups, and cache/control-plane host profiles.
- Require IaC modules used by provider capabilities to support preview/diff, reviewed inputs,
  redacted outputs, idempotent apply where the provider supports it, rollback or restore guidance,
  and evidence capture into the control-plane audit model.
- Represent provider actions that are not safely automatable, including support-mediated setup steps,
  as gated prerequisites with recorded evidence rather than hand-waved manual state.
- Keep Vercel output limited to operator UI/API guidance for request-scoped endpoints that call the
  protected control-plane API and do not proxy deployment, cache, or build/test traffic.
- Keep Cloudflare output limited to DNS, TLS/WAF, rate limiting, and reviewed edge settings; do not
  generate Workers or Edge Functions as deployment mutation hosts.
- Support reviewed-source credential mode selection in generated profiles:
  - SSH deploy key files as the initial supported mode
  - GitHub App credential files as a reviewed optional mode when the runtime adapter exists
- Validate that a selected reviewed-source mode supplies only file-backed credentials and never
  relies on laptop or CI credentials for protected/shared deploys.
- Support NixOS module, Compose/Podman, and generic SaaS OCI output modes.
- Support an AWS-oriented NixOS VM or non-NixOS systemd/Podman output mode for EC2 hosts.
- Validate that generated profiles do not include secret values.
- Add a dry-run mode that reports missing prerequisites and next commands.

### 3. External prerequisites

- None for generation tests.
- Optional live credentials for validation commands after a profile is generated.
- Optional AWS account/VPC/subnet/security-group identifiers for live validation of generated AWS
  host profiles.
- Optional Supabase PrivateLink endpoint information when the AWS profile uses private Postgres.

### 4. Tests to be added

- Add snapshot or structural tests for each generated profile mode.
- Add snapshot or structural tests for the AWS EC2 host profile mode, including Supabase PrivateLink
  and AWS S3 VPC-endpoint placeholders.
- Add tests proving secret values are never rendered into generated files.
- Add invalid-input tests for tag-only images, missing credential filenames, unsupported host
  substrates, and env-var-only secret modes.
- Add reviewed-source credential mode tests for SSH deploy key profiles and GitHub App profile
  placeholders, including rejection of incomplete credential-file manifests.
- Add dry-run tests for missing managed dependency evidence.
- Add dry-run tests that reject AWS profiles missing required subnet/security-group/TLS/artifact-store
  evidence when those features are selected.
- Add structural tests that reject generated provider-capability declarations missing lock scope,
  credential source, smoke checks, rollback procedure, or protected/shared eligibility.
- Add tests proving provider capability commands cannot rely on ambient laptop or CI credentials.
- Add tests proving generated IaC references are explicit, reviewed, free of secret values, and wired
  to preview/apply/evidence commands rather than raw manual instructions.

### 5. Docs to be added or updated

- Add `docs/cloud-control-setup.md`.
- Update `docs/cloud-control-design.md` to point to the setup command as the operator entrypoint.
- Add a quickstart that starts from managed dependency URLs and ends at healthy service and workers.
- Add an AWS EC2 topology quickstart for Supabase Postgres over PrivateLink plus AWS S3 artifact
  storage through a VPC endpoint, and state that Supabase Storage S3 is an alternate rather than the
  default for this topology.
- Document that provider dashboards, raw IaC state, and manual support actions are evidence inputs,
  not hidden deployment authority.
- Document the IaC-first expectation and the limited cases where a manual or support-mediated
  prerequisite is acceptable.
- Document reviewed-source credential mode tradeoffs and the expected GitHub App credential files if
  that mode is selected.
- Document why Fargate, Vercel Functions, Supabase Edge Functions, and Cloudflare Workers are not the
  default substrate for long-running deployment service/worker processes.

### 5.5. Expected regression scope

- `deployment-only`

### 6. Acceptance criteria

- An operator can generate a complete host-profile bundle without reading internal code.
- Generated files contain placeholders and paths, not secret values.
- The generated profile makes reviewed-source credential mode explicit and file-backed.
- The bundle tells the operator exactly which conformance checks must pass before deployment.
- The AWS profile makes the selected boundaries explicit: Supabase Postgres over public TLS or
  PrivateLink, AWS S3 as the default artifact store, reviewed alternate S3-compatible artifact stores
  only by explicit selection, request-scoped UI/API hosting, and long-running service/worker hosting
  on EC2.
- The generated topology cannot be marked protected/shared-ready until every selected external
  component has a provider-capability declaration and validation evidence.

### 7. Risks

- A generator can hide important decisions behind defaults.
- Generated docs can drift from the NixOS module and non-NixOS examples.

### 8. Mitigations

- Require explicit managed dependency choices and image digest inputs.
- Reuse shared schema/manifest helpers from PR-1 and host-profile tests from PR-8 and PR-9.

### 9. Consequences of not implementing this PR

Cloud setup would remain a hand-assembled expert workflow instead of an approachable operator path.

### 10. Downsides for implementing this PR

The setup command becomes another public interface that must stay compatible with runtime config.

## PR-13: Containerized end-to-end cloud control-plane flow

### 1. Intent

Prove the full cloud-shaped runtime by executing a deployment through one service and two workers
with externalized database, S3-compatible artifacts, file-backed credentials, UI reads, and MCP
reads.

### 2. Scope of changes

- Add an end-to-end fixture scenario using the Nix-built image or the closest local equivalent when
  image execution is unavailable in CI.
- Run one service replica and at least two worker replicas.
- Use a Postgres-compatible fixture backend and an S3-compatible fixture server by default.
- Exercise submit, admission revalidation, queue claim, lease renewal, provider lock, artifact
  upload, artifact materialization, worker execution, stage-state compare-and-swap, audit records,
  UI redaction, and MCP redaction.
- Add optional live-smoke mode for managed Postgres, selected object store, selected auth provider,
  and a non-production deployment target.
- Add optional live-smoke mode for the AWS EC2 topology that validates service and worker processes
  from EC2 subnets, Supabase Postgres connectivity through the selected public or PrivateLink path,
  AWS S3 artifact-store access through the selected endpoint path, and DNS/TLS ingress.
- Validate that live-smoke evidence is attached to the selected provider-capability declarations
  rather than stored only in provider dashboards or IaC output.
- Ensure tests do not depend on Pleomino or any demo project.

### 3. External prerequisites

- None for default fixture E2E.
- Optional live credentials for managed dependencies and a safe non-production deployment target.
- Optional AWS EC2 host or disposable test environment for live-gated AWS topology smoke.

### 4. Tests to be added

- Add containerized fixture E2E for service plus two workers.
- Add duplicate-worker and stale-worker assertions inside the E2E.
- Add artifact tamper and missing-secret negative cases.
- Add UI and MCP redaction assertions from records produced by the same run.
- Add live-gated staging deploy smoke only after all conformance checks pass.
- Add live-gated AWS topology smoke assertions for service readiness, worker heartbeat, database
  connectivity, artifact-store read/write/head, and graceful worker shutdown.
- Add fixture tests proving provider-capability evidence is required before the E2E can claim
  protected/shared readiness.

### 5. Docs to be added or updated

- Add E2E validation docs and troubleshooting.
- Update cloud setup docs with the final validation sequence.
- Document how to run live-gated checks without touching protected/prod targets.
- Document the AWS topology validation sequence separately from generic fixture E2E so local
  validation remains account-free by default.

### 5.5. Expected regression scope

- `deployment-only`
- If fixture packages are added under `projects/**`, update this plan and classify the PR as
  `deployment-and-project-impact`. Prefer deployment-owned fixtures so demo project removal does not
  break tests.

### 6. Acceptance criteria

- A full fixture deployment runs through the cloud-shaped service and two workers.
- The E2E proves no test depends on Pleomino or another demo project.
- Live smoke is gated, documented, and safe for non-production verification.
- The AWS topology smoke, when explicitly enabled, proves the same service/worker image and runtime
  configuration work from EC2 with the selected managed Postgres and artifact-store paths.
- The E2E output distinguishes deployment control-plane orchestration from Buck2/Nix build-test
  scheduling; provisioning worker fleets is allowed, but executing Buck test actions outside Buck2 RE
  is not.

### 7. Risks

- End-to-end tests can become slow or flaky.
- Live smoke can accidentally become required for local validation.

### 8. Mitigations

- Keep fixture E2E deterministic and local by default.
- Require explicit env vars or flags for live smoke.

### 9. Consequences of not implementing this PR

The individual capabilities could pass in isolation while the cloud runtime fails as a system.

### 10. Downsides for implementing this PR

The validation suite gains a larger integration test that needs runtime maintenance.

## PR-14: Cloud cutover tooling, standby controls, and restore workflow

### 1. Intent

Make the transition from mini-primary to cloud-primary safe, reversible, and documented.

### 2. Scope of changes

- Add a cutover validation command that checks cloud health, readiness, worker heartbeats, database
  connectivity, artifact-store compatibility, auth callback reachability, UI reads, MCP reads, and
  the latest non-production deployment evidence before traffic is moved.
- Extend cutover validation for the AWS EC2 topology to check selected subnets/security groups,
  Supabase PrivateLink or public database connectivity evidence, AWS S3 VPC endpoint artifact-store
  evidence unless an alternate backend is explicitly selected, ALB/NLB/TLS/DNS health, and
  Cloudflare/Vercel edge settings when selected.
- Require selected provider-capability evidence for every external component that will be mutated or
  depended on after cutover, including adjacent `atticd` and remote build/test worker fleet
  prerequisites when they are part of the deployment topology.
- Add standby worker controls in config and CLI so mini can run service-only, worker-only,
  fully-enabled, or fully-disabled modes against the same external Postgres and artifact store.
- Add a guarded cutover command or checklist generator that refuses to proceed when validation
  evidence is missing, stale, or from the wrong host profile.
- Add restore validation for database records, artifact objects, image digest, config, credential
  manifests, and auth configuration.
- Add rollback validation tooling that proves traffic can return to mini or another host without
  changing deployment authority semantics.
- Add break-glass validation tooling that proves emergency access can inspect status, pause workers,
  and preserve audit records without bypassing deployment authority.
- Add audit evidence for cutover, rollback, and restore operations.

### 3. External prerequisites

- A cloud host that has passed PR-12 and PR-13 checks.
- DNS or ingress control for the deployment service and auth callback hostnames.
- Mini access if mini remains standby.
- If the AWS topology is selected, access to the generated AWS host profile evidence and network
  validation results.

### 4. Tests to be added

- Add fixture tests for standby worker disablement and re-enable behavior.
- Add restore validation tests from exported config and durable state references.
- Add cutover validation command tests for missing, stale, and mismatched evidence.
- Add cutover validation tests for missing or mismatched AWS topology evidence, including wrong
  region, missing S3 endpoint validation, missing PrivateLink validation when selected, and stale
  TLS/DNS checks.
- Add cutover validation tests that reject dashboard-only or raw-IaC-only state without corresponding
  control-plane provider-capability audit evidence.
- Add rollback validation tests proving standby worker controls prevent double execution.
- Add break-glass tests proving emergency controls are audited and cannot mutate providers without
  normal worker authority.
- Add live-gated staging deployment after traffic is pointed at the cloud host.

### 5. Docs to be added or updated

- Add cloud cutover and rollback runbook generated from or aligned with the validation tooling.
- Add AWS EC2 topology cutover notes covering Supabase PrivateLink, AWS S3, ALB/NLB, optional
  Cloudflare edge, and why adjacent `atticd` and build/test worker fleets remain separate systems.
- Document which parts of the topology may be fully automated, which may require gated manual
  prerequisites, and how those prerequisites are recorded before protected/shared use.
- Update mini operations docs to describe standby mode.
- Add restore, disaster-recovery, and break-glass docs for the cloud control plane.

### 5.5. Expected regression scope

- `deployment-only`
- Live host changes remain explicitly gated. The PR still includes implementation changes for
  validation commands and standby controls; it is not a runbook-only PR.

### 6. Acceptance criteria

- Cloud-primary cutover has a reviewed checklist, rollback path, and restore validation.
- Cutover validation tooling refuses stale, missing, or host-mismatched evidence.
- AWS topology cutover refuses to proceed when required network, ingress, database, or artifact-store
  evidence is missing or inconsistent with the generated profile.
- Cutover refuses to proceed if any selected external component lacks provider-capability evidence,
  audit identity, rollback procedure, or smoke evidence.
- Break-glass procedures are implemented as audited controls rather than undocumented manual
  database or host mutations.
- Mini can remain a standby host without owning authoritative durable state.
- A protected/shared staging deployment succeeds through the cloud-primary path.

### 7. Risks

- Traffic cutover can strand in-flight submissions if workers race or durable state is misread.
- DNS/auth callback changes can break operator login even when service health is green.

### 8. Mitigations

- Disable standby workers during cutover unless dual-worker operation has passed conformance.
- Require staging deployment and auth checks after DNS/ingress changes before prod use.

### 9. Consequences of not implementing this PR

The project would have cloud-capable components but no safe operational migration to cloud-primary.

### 10. Downsides for implementing this PR

Cutover discipline adds operational ceremony and requires maintaining rollback documentation.
