# 4. Containerize Control Plane + Move to Cloud

**Tier:** Foundation
**Priority:** 4 of 44
**Depends on:** #2 Supabase Project Provisioning
**Estimated effort:** XL
**Date:** 2026-05-25
**Summary:** Transform the deployment control plane from a self-hosted service into a cloud-portable, horizontally scalable containerized runtime, then migrate it off the legacy self-hosted control-plane host to an external cloud host.

## What

Implement `docs/history/plans/control-plane-plan.md` end to end: ten sequenced PRs that transform the deployment
control plane from a self-hosted service into a cloud-portable, horizontally scalable
containerized runtime, then migrate it to an external cloud host.

The plan document already defines the full PR sequence and acceptance criteria. Implementation work
is what remains.

**PR sequence:**

- **PR-1** — Runtime configuration loader and file-backed credential contract. Typed YAML config at
  `/etc/deployment-control-plane/config.yaml`; credential directory abstraction; startup validation
  that fails closed on missing required files; multi-tenant Infisical credential lookup by
  deployment id; redaction helpers for config validation errors.
- **PR-2** — Multi-replica coordination hardening. Atomic database queue claims with fencing tokens;
  lease expiry and renewal; provider locks scoped to deployment/provider target; idempotency keys on
  submit paths; compare-and-swap stage-state updates; audit rows with correlation ids; isolation of
  file-lock based coordination to local fixture mode only.
- **PR-3** — S3-compatible artifact authority. Artifact-store interface with an S3-compatible
  implementation; payload bytes by immutable object key; metadata, digests, and provenance in
  Postgres; digest and provenance verification before worker execution; retry-safe idempotent object
  writes; credential resolution through the PR-1 file-backed contract.
- **PR-4** — Service and worker process entrypoints. `control-plane service --config ...`
  and `control-plane worker --config ...` long-running process modes; health and readiness
  endpoints; graceful shutdown with lease release; child process environment scrubbing.
- **PR-5** — Same-origin read APIs and minimal web UI. Read-only APIs for control-plane status,
  queue state, worker heartbeats, and deployment detail; static UI pages for status, queue, and
  deployment detail; database-backed sessions so service replicas stay stateless; no mutation
  controls in v1.
- **PR-6** — Read-only HTTP MCP server. Authenticated MCP endpoint at configured `mcp.basePath`;
  four v1 resources/tools (`deployment_control_plane_status`, `deployment_queue`,
  `deployment_detail`, `deployment_auth_context`); same auth and redaction boundaries as the
  service API; audit correlation ids; disableable by config.
- **PR-7** — Reproducible OCI image. `nix build .#deployment-control-plane-image` producing a
  `pkgs.dockerTools.buildLayeredImage` with Node 22, git, openssh, opentofu, awscli2, kubectl,
  helm, and wrangler; non-root uid 10001:10001; no credentials in image layers; service and worker
  commands from the same image. The Nix expression at
  `build-tools/tools/nix/flake/packages/deployment-control-plane-image.nix` already exists and
  establishes the image shape, runtime tool list, contract derivation, and prohibited-path list —
  this PR wires it into the build graph and adds image smoke tests and layer inspection.
- **PR-8** — Importable NixOS container module. The module at
  `build-tools/tools/nix/deployment-control-plane-container-module.nix` already exists and is
  substantially complete: it manages the service user and group, writes the config file, stages
  credentials through systemd `LoadCredential=`, runs one service container and N worker containers
  via `virtualisation.oci-containers`, and optionally emits nginx config. This PR validates the
  module with Nix evaluation tests and documents the host import pattern.
- **PR-9** — Non-NixOS Compose and Podman host profile. A tested Compose-compatible example for one
  service and two workers using the same mount contract as the NixOS module; no plaintext env-file
  credential handling; static validation tests and local fixture smoke tests.
- **PR-10** — Containerized end-to-end deployment flow. Fixture deployment scenario through one
  service and two workers with externalized database, S3-compatible artifact store, and file-backed
  credentials; queue claims, leases, provider locks, idempotency, artifact digest checks, audit
  records, UI redaction, and MCP redaction exercised together; optional live-smoke gating.

**Cloud migration** runs in parallel with or immediately after PR-10 following the six-phase
sequence in `docs/history/designs/cloud-control-design.md`: prove external persistence (Supabase Postgres +
Supabase Storage or R2), make the legacy self-hosted control-plane host cloud-shaped by pointing it at external DB and artifact store,
introduce cloud host running the same image by digest, migrate auth to an abstracted provider
(Supabase Auth or WorkOS), cut traffic to the cloud host, retire the legacy self-hosted control-plane host's authority.

The legacy self-hosted control-plane host serves `the deployment control plane endpoint` and `the auth endpoint` through nginx
and keeps local Postgres, local artifact storage, and a local Keycloak identity provider. All three
must be externalized before the cloud host takes traffic.

## Why Now

Everything cloud-related is blocked on this. The containerized control plane is the prerequisite for:

- Kubernetes / OpenTofu deployment of the control plane itself
- auth provider replacement (Supabase Auth, WorkOS)
- control plane webapp (requires stateless service replicas + database-backed sessions)
- HTTP MCP surface (requires the same auth/redaction boundaries that land in PR-5 and PR-6)
- monitoring and observability (requires stable health/readiness endpoints and audit rows)
- preview deploys and per-PR environments (require horizontal worker scaling)
- the Sample webapp Infisical cutover (PR-12 in `docs/history/plans/infisical-plan.md` consumes the PR-1
  credential-directory abstraction)

Doing this first keeps every downstream task from having to re-litigate the credential contract,
coordination model, and image shape.

## Risks

**Coordination surface area.** PRs 2 through 4 touch the queue, lease, lock, idempotency, and
stage-state paths that are already in production use on the legacy self-hosted control-plane host. A subtle regression in fencing-token
logic or lease expiry could cause duplicate or stale mutations without obvious immediate failure.

**S3-compatible backend selection.** The design lists Supabase Storage, Cloudflare R2, and AWS S3
as candidates. Supabase Storage's compatibility with the `ControlPlaneArtifactStore` interface
(PUT, GET, HEAD, metadata, SHA-256 verify) has not been tested at time of writing. If it fails the
compatibility test, the cloud migration blocks on a backend switch.

**Image layer content.** The `prohibitedPaths` list in the image contract derivation currently
checks for specific strings (`id_rsa`, `.env`, `control-plane-database-url`, etc.). The layer
inspection test must cover the full threat model — indirect captures through esbuild bundling or
Nix store symlink resolution need to be verified, not assumed.

**NixOS module is substantially written but not validated.** The module file
`deployment-control-plane-container-module.nix` and defaults file
`deployment-control-plane-container-defaults.nix` represent the target design with full option
declarations and config generation. The required evaluation test coverage does not exist
yet. If the generated systemd credential staging script or the rendered config JSON has latent
bugs, they will surface only during host bring-up.

**Graceful shutdown under lease contention.** The PR-4 worker shutdown path must stop lease renewal
without leaving an expired lease that blocks a replacement worker from claiming. This is
deterministically testable but requires careful fixture design; real-time lease expiry behavior is
difficult to reproduce in unit tests.

**Local Postgres migration.** Moving the legacy self-hosted control-plane host's control-plane database to external Postgres requires
a migration of live queue rows, audit records, stage state, and submission history. A failed or
partial migration during the Phase 2 transition could leave the control plane in an inconsistent
state mid-deployment.

**Auth provider cutover (Phase 4).** Replacing the current local Keycloak identity provider with
Supabase Auth or WorkOS requires an auth-provider abstraction that does not yet exist. CLI login
flows, PKCE callback handling, admission reporter authorization, and audit principal identity all
depend on it. This is not in the ten-PR plan; it is a separate downstream task that the containerized
runtime must be designed to accommodate without re-architecture.

## Trade-offs

**Ten PRs vs. one large PR.** The plan deliberately sequences ten PRs to keep build-system
validation scope narrow. Only PR-7 (OCI image) triggers full `mixed-build-system` validation. The
rest stay within `deployment-only` paths. The cost is more total coordination overhead; the benefit
is that each PR is independently reviewable and revertable.

**Horizontal scaling as a v1 requirement vs. post-launch optimization.** The plan treats multi-replica
coordination (database queue, fencing tokens, lease expiry) as a v1 requirement, not something to
retrofit after initial containerization. This adds implementation complexity upfront but avoids a
production correctness gap when workers are first scaled beyond one replica.

**Podman as the NixOS default vs. Docker.** The module defaults to Podman via
`virtualisation.oci-containers`. This is the correct NixOS-idiomatic choice and avoids a Docker
daemon dependency on a NixOS host. Non-NixOS operators can switch to Docker through the module
option, but Docker is not the blessed path and the divergence in mount and network semantics must be
tested.

**File-backed secrets vs. environment variable injection.** The credential contract explicitly
rejects environment variable credential sources for production. This is more operationally correct
than env-based secrets but requires that every host substrate (NixOS, Kubernetes, Compose, Cloudflare
Containers) support file-mount semantics. Substrates that cannot provide this are excluded from
being valid control-plane hosts without a reviewed exception.

**Same image for service and worker vs. separate images.** One image runs both process modes. This
simplifies image maintenance and digest pinning but means the worker ships with the HTTP server
entrypoint and the service ships with the queue worker entrypoint. The tradeoff is acceptable
because neither entrypoint is reachable without the explicit `service` or `worker` argument.

## Considerations

**Existing Nix expression is a head start, not a finished artifact.** The image expression at
`build-tools/tools/nix/flake/packages/deployment-control-plane-image.nix` already assembles the
runtime derivation from esbuild, pins the tool list (Node 22, git, openssh, opentofu, awscli2,
kubectl, helm), sets the non-root user, and defines the contract derivation with required mounts and
prohibited paths. PR-7 should wire this into the build graph and add tests rather than redesigning
the image shape.

**Module files need tests, not redesign.** `deployment-control-plane-container-module.nix` already
implements credential staging via `LoadCredential=`, config file rendering via `environment.etc`,
worker replica generation via `lib.range`, and nginx proxy via `lib.mkIf`. The module is
essentially the design made concrete. PR-8 is primarily about Nix evaluation tests for the option
defaults, the credential wiring, and the nginx gate condition.

**Infisical credential file patterns are already defined.** The defaults file sets
`infisicalClientIdPattern = "{deploymentId}-infisical-client-id"` and
`infisicalClientSecretPattern = "{deploymentId}-infisical-client-secret"`. PR-1 must implement the
lookup that substitutes deployment id into these patterns and resolves the resulting filename from
the credential directory. The Sample webapp Infisical cutover (infisical-plan PR-12) will consume this
abstraction directly.

**Artifact store credential names are concrete.** The defaults file already names the three
credential files: `artifact-store-endpoint`, `artifact-store-access-key-id`,
`artifact-store-secret-access-key`. PR-3 resolves these through the PR-1 credential contract. When
selecting the cloud artifact store backend, run a live compatibility test using the
`ControlPlaneArtifactStore` interface against the candidate endpoint before committing to it.

**Keep build-system scope narrow through PR-6.** PRs 1–6 are all `deployment-only` scope, meaning
they live under `build-tools/tools/deployments/**`, `build-tools/tools/tests/deployments/**`, and
`build-tools/tools/nix/**`. Do not let runtime behavior changes bleed into PR-7's
`mixed-build-system` PR. If a shared build-system change is genuinely required by an earlier PR,
update the plan first and split the change.

**Cloud migration is not a separate task — it is the outcome.** The ten PRs deliver a cloud-portable
image and module. The six-phase cloud migration in `docs/history/designs/cloud-control-design.md` is the operational
plan for actually cutting traffic. Phases 1–2 (prove external persistence, make the legacy self-hosted control-plane host cloud-shaped)
can begin as soon as PR-3 and PR-4 land and the legacy self-hosted control-plane host's workers are pointed at an external Postgres and
artifact store. Phases 3–6 require the reviewed image from PR-7 and a chosen cloud host substrate.

**The plan is the authoritative sequence.** Each PR must update `docs/history/plans/control-plane-plan.md` if
implementation invalidates remaining scope or assumptions. Do not implement ahead of the plan without
updating it first.
