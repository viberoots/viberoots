# 15. Local Stack Deployment

**Tier:** Developer Experience
**Priority:** 15 of 44
**Depends on:** #4 Containerize Control Plane
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Define a Buck2-backed local stack target that generates Compose config from the same deployment metadata used in production, running Postgres, a lightweight S3-compatible service, and the control plane locally so developers can exercise full deployment flows without cloud access.

## What

Provide a reviewed local stack profile that lets developers run the full control-plane deployment
stack — Postgres, S3-compatible object storage, control-plane service, and one or two workers — on
their own machine without touching the shared control plane or any cloud resource.

The stack runs the same reviewed OCI image produced by control-plane-plan PR-7. It uses the same
`control-plane service --config ...` and `control-plane worker --config ...`
process modes as the NixOS module and Compose/Podman profile. The local stack is not a separate
code path; it is the PR-9 non-NixOS Compose/Podman profile wired with local fixture services
instead of external production ones.

Concrete deliverables:

- A `config.local-stack.yaml` that sets `mode: local-fixture`, binds the service to `127.0.0.1`,
  points at a local Postgres container and a local S3-compatible container, and disables web UI
  and MCP exposure to keep the dev profile minimal. The `config.local-smoke.yaml` already exists in
  `build-tools/tools/deployments/control-plane-host-profile/` for container smoke tests; the
  local-stack config extends that pattern for developer interactive use.
- A Compose-compatible `compose.local-stack.yaml` (or equivalent Podman invocations) that starts:
  - one `postgres:16-alpine` container matching the image already used by the E2E fixture test
    helpers in `build-tools/tools/tests/deployments/control-plane-container-e2e.helpers.ts`
  - one local S3-compatible container (the fake S3 server pattern already exists via
    `writeFakeS3Server` in those same test helpers; for a more interactive dev experience this
    should be a real lightweight S3-compatible server such as the one used in the E2E fixture)
  - one control-plane service container
  - one or two control-plane worker containers
  - all using `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1` to permit loopback HTTP and omit the bearer
    token requirement that would otherwise fail closed
- Fixture credential files for the artifact-store endpoint, access key, secret key, database URL
  (`pgmem://` is acceptable for unit tests but the local stack should use a real Postgres container
  for interactive development so the full queue/lease/lock/idempotency path runs), reviewed-source
  SSH key placeholder, and known-hosts placeholder.
- A short usage doc (or section added to the existing
  `docs/control-plane-non-nixos-host-profile.md`) covering how to start the local stack, how to
  point a `local_only` deploy at it, how to confirm the service is healthy via `/healthz`, and how
  to tear it down cleanly.
- Static validation tests proving the Compose file contains the expected services, mounts, and
  loopback bind, parallel to the existing PR-9 validation tests for `compose.yaml`.

What this task does not do:

- It does not add a `manageLocalPostgres` module option to the NixOS container module. The
  control-plane-plan non-goal "no production-managed local Postgres profile in the first
  implementation" applies here; local Postgres is dev scaffolding only.
- It does not change the protected/shared admission model. The local stack is `local_only`
  protection class. It does not issue bearer tokens, require Keycloak/IdP wiring, or accept
  reviewed source governance evidence.
- It does not replace the shared control plane. Shared `shared_nonprod` deploys continue to use
  the shared deployment control plane endpoint. The local stack is for individual developer iteration, not
  for shared dev targets.

## Why Now

The existing test suite runs control-plane flows against `pgmem://` (in-memory Postgres) and fake
provider backends. That is sufficient for CI and for proving individual components, but it does not
give developers a way to exercise the full control-plane container runtime interactively — including
the real Postgres-backed queue, lease, fencing-token, and artifact-store paths added in PR-2 and
PR-3 of the containerization plan.

Without a local stack:

- Developers iterating on the control-plane worker or provider paths must deploy to the shared control plane to
  observe real container runtime behavior, which creates noise on the shared host and requires SSH
  access and client profile setup.
- Task #24 (Bob dry run) surfaces friction against the shared control plane that would be easier to observe and fix
  locally first.
- Task #20 (preview deploys dev experience) benefits from developers being able to test preview
  submission and smoke locally before any shared-host run.

The local stack is the right time to add after #4 lands: the reviewed OCI image exists, the PR-9
Compose profile exists, the E2E fixture test helpers already encode the `postgres:16-alpine` plus
fake-S3 pattern. The local-stack profile is a thin composition of those reviewed pieces for
interactive developer use rather than a new design.

## Risks

**OCI runtime availability.** The local stack requires Podman or Docker. On macOS, Podman machine
or Docker Desktop must be running. The existing E2E fixture tests already skip when no OCI runtime
is detected; the local stack doc must make this prerequisite explicit and give the same skip signal
clearly so developers on machines without a container runtime know what to do rather than chasing a
confusing startup failure.

**S3-compatible server selection.** The E2E fixture uses a Node-written `fake-s3.mjs` server that
covers the subset of S3 operations needed by the test. For interactive developer use, that fake may
be too limited if a developer wants to inspect bucket contents or replay artifact upload/verify
flows manually. The local stack should select a more capable S3-compatible container image for
interactive use, while the E2E fixture continues to use the lightweight fake. The choice of image
(MinIO, or another reviewed candidate) must be explicit; it becomes a dev dependency that may need
periodic update.

**`VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1` scope.** This marker disables the bearer token requirement
and permits loopback HTTP. It is explicitly scoped to fixture/dev service mode throughout the
codebase and docs. Using it in the local stack config must be documented clearly so developers do
not accidentally carry this marker into a profile that talks to a real hosted service. The
Compose/Podman file should set it only inside the service container environment, not as a
developer-shell default.

**Postgres credential bootstrap.** The local Postgres container starts with `POSTGRES_PASSWORD=postgres`
(matching the E2E fixture). The local-stack credential file for `control-plane-database-url` must
match. If a developer modifies the password or mounts a persistent volume, the credential file must
be updated in sync. The doc should make this dependency explicit rather than leaving it as a
implicit convention.

**Not a substitute for tested fixture isolation.** The local stack runs real containers with real
Postgres state that persists across restarts unless volumes are explicitly removed. Developers
should understand that the local stack is for interactive exploration, not for deterministic
reproducible test runs. Test coverage belongs in the existing fixture-backed unit and integration
test suite, not in the local stack.

## Trade-offs

**Real Postgres vs. `pgmem://`.** The local stack uses a real Postgres container instead of the
in-memory backend used in unit tests. This is intentional: the value of a local stack over running
tests is that developers can observe the real database-backed queue, lease, lock, and idempotency
behavior added in PR-2. Using `pgmem://` in the local stack would miss this. The cost is that
developers need a running container runtime and the startup time increases.

**Thin composition vs. a purpose-built local tool.** Rather than writing a new local-stack
orchestration tool, this task reuses the Compose/Podman profile pattern already established by
PR-9. This keeps the local stack aligned with the non-NixOS host profile, means changes to the
runtime contract flow through one code path, and avoids a third way to run the control plane. The
cost is that Compose/Podman must be available; developers who prefer a single-binary local tool
do not get one here.

**Interactive S3 vs. the E2E fake.** The E2E fixture uses a lightweight fake S3 server for
deterministic, reproducible tests. For interactive developer use, a more capable S3-compatible
server image (with actual bucket and object browse UI) is more useful but introduces a heavier
dependency and a container image to manage. This task should pick one reviewed image and document
it; it should not try to support multiple S3 backends simultaneously.

**`local_only` scope.** The local stack is explicitly for `local_only` deploys. Developers who
want to test `shared_nonprod` admission flows must still use the shared control plane. This is the correct boundary:
the local stack is a developer sandbox, not a pre-production verification environment.

## Considerations

**Starting point is the E2E fixture pattern.** The E2E test helpers in
`build-tools/tools/tests/deployments/control-plane-container-e2e.helpers.ts` and
`control-plane-container-e2e-flow.helpers.ts` already encode:

- `postgres:16-alpine` with `POSTGRES_PASSWORD: "postgres"`
- a `fake-s3.mjs` Node server via `writeFakeS3Server`
- `runFixtureContainer` for both Postgres and the S3 server
- the full mount contract for service and worker containers

The local stack Compose file should be derived from the same image and environment variable
conventions rather than inventing new names. Where the E2E fixture writes fixture credential files
programmatically, the local stack should provide equivalent static files committed under
`build-tools/tools/deployments/control-plane-host-profile/local-stack/`.

**`networkMode = "host"` consideration.** The NixOS container module doc notes that
`networkMode = "host"` is appropriate "when the container must reach host-loopback dependencies
such as a local Postgres or MinIO instance." For the local stack Compose profile, all services
run on a single Compose network so host networking is not required. If a developer runs the
control-plane containers without Compose and wants to reach a separately started Postgres on
`127.0.0.1`, they need host network mode. The doc should cover both cases.

**The existing `config.local-smoke.yaml` is a starting point, not the final config.** It disables
web UI and MCP. For a developer using the local stack interactively, web UI enabled at
`http://127.0.0.1:7780` is useful for verifying queue state and submission status without CLI
invocations. The local-stack config should enable web UI (`webUi.enabled: true`) but keep MCP
disabled for simplicity. This differs from the smoke config intentionally.

**Document the `deploy` client side.** Starting the local stack is only half the picture. The doc
should also show how to submit a `local_only` deploy against the running service using the existing
`deploy` CLI with `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1` and `--control-plane-url http://127.0.0.1:7780`.
A minimal `//projects/deployments/local-stack-test:deploy` fixture target in the repo would make
this self-contained, or the doc can reference the existing `sample-webapp-dev` deployment metadata with
an explicit `--override-protection-class local_only` flag if that flag is reviewed. Either way,
the developer must be able to issue a full submit-admit-execute cycle without touching the legacy self-hosted control-plane host.

**Teardown and volume cleanup.** Compose volumes persist Postgres data across container restarts.
The doc must show the `docker compose down -v` (or Podman equivalent) command to wipe local state.
Developers who do not know about volume cleanup will accumulate stale queue state and may observe
confusing idempotency collisions between dev sessions.
