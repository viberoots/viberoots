# Cloud Control Plane Design

This document describes the target design for moving viberoots deployment authority away from
mini-specific services and toward a cloud-portable control plane. The goal is not to abandon mini
immediately. The goal is to make mini run the same way a cloud host would run: as one deployment
control-plane substrate among several, with durable state and secrets outside the host.

## Goals

- Replace mini-only deployment responsibilities with cloud-portable services.
- Keep mini running as a compatible control-plane host while cloud hosting is introduced.
- Run viberoots-owned service containers from Nix-built OCI images, not mutable distro base images.
- Prefer NixOS for hosts we control directly.
- Keep deployment authority in the reviewed control-plane service and workers.
- Externalize durable state to managed Postgres and S3-compatible object storage.
- Keep deployment secrets in a reviewed secret backend, currently Infisical.
- Allow Supabase and/or WorkOS-style identity providers to replace the current local identity-provider
  role after the persistence and runtime boundaries are already cloud-shaped.
- Preserve the existing protected/shared deployment guardrails: admission revalidation, durable
  queueing, provider locks, fenced execution, stage-state compare-and-swap, audit records, and
  exact artifact replay.

## Non-Goals

- Do not make a cloud provider, container runtime, GitHub workflow, or CI job the deployment
  authority.
- Do not require full NixOS inside every OCI container.
- Do not deploy containers built from `node`, `alpine`, `ubuntu`, or other mutable upstream base
  images for viberoots-owned long-running services.
- Do not move release state into Git branches, image tags, mutable registry state, or
  container-local writable layers.
- Do not let developer laptops or CI hold provider, database, artifact-store, Infisical workload, or
  reviewed-source credentials for protected/shared deploys.
- Do not introduce Supabase Edge Functions, WorkOS, or any other hosted service as an implicit
  deployment provider without a reviewed provider-capability entry.

## Current State

Mini currently runs the deployment control plane as containerized service and worker processes. The
host is NixOS. The control-plane image is built by Nix with `dockerTools.buildLayeredImage` from
reviewed nixpkgs closures. It is not a full NixOS image with systemd inside the container, and that
is intentional.

The current image shape is:

- one reviewed OCI image
- service mode: `deployment-control-plane service --config /etc/deployment-control-plane/config.yaml`
- worker mode: `deployment-control-plane worker --config /etc/deployment-control-plane/config.yaml`
- non-root runtime user
- file-backed runtime credentials
- external Postgres-compatible database URL
- S3-compatible artifact-store configuration
- reviewed-source SSH credentials
- Infisical deployment credential files

This is already close to the desired cloud runtime contract. The remaining issue is that mini still
owns too many local responsibilities around host configuration, ingress, local operational state,
and identity-provider plumbing.

At the start of this migration, mini serves the deployment control-plane endpoint and auth callback
endpoint through nginx. It also owns local control-plane persistence and local identity-provider
state. Before a cloud host takes traffic, these responsibilities must be externalized or made
portable:

- local Postgres-backed control-plane state
- local artifact storage or artifact mirrors
- local Keycloak-style identity-provider assumptions
- nginx-only ingress assumptions for `deploy.apps.kilty.io` and `deploy-auth.apps.kilty.io`

## Container Principle

All viberoots-owned long-running runtime containers should be Nix-built OCI images.

This means:

- image contents are assembled by Nix from reviewed nixpkgs inputs and repo derivations
- image identity is pinned by immutable digest in production
- image metadata reports version, source revision, and digest
- runtime tools are explicit Nix closures
- no mutable base distro image is used
- no credentials are baked into image layers
- no host-specific config is baked into image layers

This does not mean every OCI image must boot full NixOS. A minimal Nix-built image with one process
entrypoint is the preferred shape for services. Full NixOS belongs at the host layer where we own the
host. For cloud runtimes that only accept OCI images, the portability boundary is the Nix-built OCI
image plus mounted config and mounted credential files.

Host preference:

- NixOS hosts are preferred where we control the host.
- Non-NixOS hosts are acceptable only as OCI substrates for the same Nix-built images.
- Kubernetes, Compose, Podman, Docker, Cloudflare Containers, and similar systems are runtimes, not
  deployment authorities.

The kernel and container runtime are still part of the substrate. Nix-built OCI images pin the
userspace and runtime tools, but they do not pin the host kernel, cgroups behavior, filesystem
driver, seccomp profile, DNS, clock, or container runtime implementation. Highest-control production
hosts should therefore be NixOS VMs pinned to reviewed nixpkgs/NixOS inputs. Managed OCI platforms
are acceptable only after passing substrate conformance checks.

## Target Architecture

The target control plane has the following authority boundaries:

```text
developer / CI
  -> deploy CLI
  -> HTTPS deployment control-plane service
  -> durable Postgres queue, locks, audit, submissions, stage state
  -> deployment workers
  -> S3-compatible artifact store
  -> Infisical and provider APIs
```

The service is stateless except for durable database writes. Workers are stateless except for
scratch directories. Artifact payloads and execution snapshots are immutable objects in the
artifact store. Deployment records, queue state, locks, heartbeats, stage state, and audit rows live
in Postgres.

## Hosted Identity Providers

The control plane treats Supabase Auth, WorkOS, and the current local identity provider as
interchangeable OIDC/JWKS identity substrates. Runtime configuration names the issuer, audience,
JWKS URL, supported token shape, claim names, role/group mappings, service-principal mappings, CLI
login mode, and callback host/path. Hosted providers authenticate operators and service principals;
they do not decide deployment authorization and they do not mutate deployment providers.

The control-plane service verifies tokens, maps reviewed claims into the existing submitter,
approver, admission reporter, deploy-admin, and automation-principal grants, and records the stable
audit principal. Missing issuer, wrong audience, stale JWKS keys, expired tokens, and missing role
claims fail closed. The same callback contract must work behind mini nginx, a cloud load balancer,
or another reviewed ingress as long as the external callback hostname and path match the configured
provider redirect URI.

Adjacent cache administration may use the same operator identity to issue narrowly scoped Attic
tokens after a separate reviewed workflow authorizes that action. Browser SSO sessions, hosted auth
provider credentials, deployment worker credentials, provider API credentials, and cache-service
tokens remain separate credential classes.

## Orchestration Authority

The Buck2-based deployment system may orchestrate every component in this topology only through
reviewed provider capabilities. This includes:

- the deployment control-plane service and workers
- adjacent `atticd` cache service
- AWS S3 buckets, VPC endpoints, security groups, ALB/NLB, DNS records, and EC2 host profiles
- Cloudflare DNS, TLS/WAF, rate limiting, and reviewed edge settings
- Vercel operator UI/API deployments
- Supabase managed dependency configuration and PrivateLink prerequisites where the API/support model
  allows automation
- EC2 Spot fleets for Nix remote builders and Buck2 remote-execution workers

Every protected/shared orchestration path must have a provider-capability entry before use. The entry
defines target identity, credential source, lock scope, preview/diff behavior, mutation sequence,
smoke checks, rollback procedure, replay semantics, audit evidence, and whether the action is
eligible for protected/shared deployment.

The deployment system must not use ad hoc shell scripts, laptop credentials, CI-owned provider
credentials, or undocumented dashboard state as hidden mutation authority. If a provider action still
requires manual approval or support involvement, such as parts of Supabase PrivateLink setup, the
control plane records it as a gated prerequisite with evidence rather than pretending it is fully
automated.

This orchestration authority does not make the deployment control plane a build/test scheduler.
Buck2 remains the build/test graph and action scheduler. Buck2 remote execution remains the scheduler
for distributed Buck build and test actions. Nix remains responsible for Nix store builds, remote
builder selection, and substitution. The deployment system may provision and scale worker fleets,
publish configs, validate health, and record audit evidence; it must not replace Buck2 REAPI or Nix
remote-builder semantics with a repo-specific scheduler.

Minimum production topology:

- one service replica
- two worker replicas
- external Postgres
- external S3-compatible artifact store
- file-backed credentials
- reverse proxy or managed ingress

Mini and cloud hosts should run the same image and config shape. They may differ in how the host
mounts credential files, publishes ingress, and starts containers.

The containerization task depends on Supabase project provisioning because the cloud-shaped control
plane needs an external Postgres candidate and, optionally, a Supabase Storage artifact-store
candidate. Supabase is not required to be the final artifact store, but the project provisioning
work must exist before live compatibility checks can be meaningful.

Managed dependency setup is captured in
[`docs/control-plane-managed-dependencies.md`](control-plane-managed-dependencies.md). Candidate
profiles keep provider choice explicit, validate Supabase Postgres, Supabase Storage S3, Cloudflare
R2, or another S3-compatible store before use, and record compatibility evidence without storing
secret values.

Cloud host-profile setup starts with
[`docs/cloud-control-setup.md`](cloud-control-setup.md) and the reviewed
`deployment-control-plane setup` command. The generator writes runtime config, credential
manifest, service and worker commands, validation commands, and provider-capability declarations
without embedding secret values.

This work is the prerequisite for later cloud tasks:

- Kubernetes or OpenTofu deployment of the control plane itself
- auth-provider replacement with Supabase Auth or WorkOS
- richer control-plane webapp work
- HTTP MCP expansion
- monitoring and observability
- preview deployments and per-change environments
- Pleomino Infisical cutover work that consumes the credential-directory abstraction

## Required Control-Plane Capabilities

This section describes the capabilities the cloud-portable control plane must have. It intentionally
does not prescribe an implementation sequence. A separate planning document should decompose these
capabilities into concrete work items using this design as input.

### Runtime Config And Credential Contract

The control plane reads a typed runtime configuration from
`/etc/deployment-control-plane/config.yaml`. The runtime validates config and credential inputs
before the service or workers accept work.

- credential directory abstraction
- file-backed credentials only for production
- startup validation that fails closed on missing required files
- deployment-id based Infisical credential lookup
- config validation errors that use redaction helpers

This capability establishes the credential contract consumed by the Infisical cutover and by every
container host profile.

The default deployment-scoped Infisical credential filenames are:

```text
{deploymentId}-infisical-client-id
{deploymentId}-infisical-client-secret
```

The lookup substitutes the deployment id and resolves the resulting filename inside the configured
credential directory.

### Multi-Replica Coordination

The control plane must allow multiple workers to run safely against the same durable backend.

- atomic database queue claims
- fencing tokens
- lease expiry and renewal
- provider locks scoped by deployment/provider target
- idempotency keys on submit paths
- compare-and-swap stage-state updates
- audit rows with correlation ids
- file-lock coordination isolated to local fixture mode only

Horizontal scaling is a v1 correctness requirement, not a later optimization.

### S3-Compatible Artifact Authority

Artifact authority belongs in S3-compatible object storage, not a local host filesystem.

- artifact-store interface
- S3-compatible implementation
- payload bytes written by immutable object key
- metadata, digests, and provenance stored in Postgres
- digest and provenance verification before worker execution
- retry-safe idempotent object writes
- artifact-store credentials resolved through the file-backed credential contract

The selected backend must pass live or fixture compatibility checks for `PUT`, `GET`, `HEAD`,
content type, custom metadata, and digest verification.

The default artifact-store credential filenames are:

```text
artifact-store-endpoint
artifact-store-access-key-id
artifact-store-secret-access-key
```

### Service And Worker Entrypoints

The same reviewed image exposes long-running service and worker process modes:

```bash
deployment-control-plane service --config /etc/deployment-control-plane/config.yaml
deployment-control-plane worker --config /etc/deployment-control-plane/config.yaml
```

- `/healthz`
- `/readyz`
- graceful shutdown with lease release
- worker shutdown that stops lease renewal and allows replacement workers to claim after expiry
- child process environment scrubbing

### Read APIs And Minimal Web UI

The service exposes same-origin read APIs and a minimal web UI for operator visibility.

- read-only control-plane status API
- queue state API
- worker heartbeat API
- deployment detail API
- static UI pages for status, queue, and deployment detail
- database-backed sessions so service replicas remain stateless
- no mutation controls in v1

### Read-Only HTTP MCP

The service exposes an authenticated, disableable HTTP MCP endpoint at the configured
`mcp.basePath`.

V1 resources/tools:

- `deployment_control_plane_status`
- `deployment_queue`
- `deployment_detail`
- `deployment_auth_context`

The MCP endpoint must reuse the same auth, redaction, and audit-correlation boundaries as the
service API.

### Reproducible OCI Image

The image expression at
`build-tools/tools/nix/flake/packages/deployment-control-plane-image.nix` defines the target shape:

- `pkgs.dockerTools.buildLayeredImage`
- Node 22
- git
- openssh
- opentofu
- awscli2
- kubectl
- helm
- wrangler
- non-root uid/gid `10001:10001`
- no credentials in image layers
- service and worker commands from one image
- contract derivation with required mounts and prohibited paths

The layer inspection test must check the prohibited-path threat model, including indirect captures
through bundling or Nix store closure inclusion.

### Importable NixOS Container Module

The NixOS module at
`build-tools/tools/nix/deployment-control-plane-container-module.nix`
must provide the preferred host integration for NixOS systems:

- manage the service user and group
- write the runtime config file
- stage credentials through systemd `LoadCredential=`
- run one service container and N worker containers through `virtualisation.oci-containers`
- optionally emit nginx config
- support Podman as the NixOS-idiomatic default

The module already represents much of the target design. It needs evaluation tests and host import
documentation.

### Non-NixOS Compose And Podman Profile

The non-NixOS profile documents how to run one service and two workers on an OCI substrate that is
not itself NixOS.

- same mount contract as the NixOS module
- no plaintext env-file credential handling
- static validation tests
- local fixture smoke tests
- Docker-compatible Compose and direct Podman examples when they preserve the same runtime boundary

### Containerized End-To-End Flow

The design requires an end-to-end fixture deployment through one service and two workers. The
fixture exercises:

- externalized database
- S3-compatible artifact store
- file-backed credentials
- queue claims
- leases
- provider locks
- idempotency
- artifact digest checks
- audit records
- UI redaction
- MCP redaction

Optional live-smoke should remain explicitly gated.

## Supabase Role

Supabase is a good candidate for managed control-plane dependencies, but it should not be treated as
a deployment provider by default.

Reviewed fit:

- Supabase Postgres can host the control-plane database.
- Supabase Storage may host the artifact store through its S3-compatible endpoint if compatibility
  tests pass against the current signing, metadata, `PUT`, `GET`, and `HEAD` behavior.
- Supabase Auth may become an operator identity provider after an explicit auth-provider adapter is
  implemented.

Not yet reviewed:

- Supabase Edge Functions as a deployment runtime.
- Supabase database migrations as protected/shared deployment actions.
- Supabase Storage bucket mutation as a deployment-owned provisioner.
- Supabase Auth as a drop-in replacement for the current deployment auth model.

If Supabase becomes a deployment target, it needs explicit provider capability entries. Those
entries should define target identity, locks, rollout model, smoke/release-health behavior,
provisioner support, replay semantics, and protected/shared eligibility.

For the recommended production topology, Supabase provides managed dependencies and identity
surfaces, while long-running control-plane and build-cache services run elsewhere:

- Supabase Postgres hosts durable control-plane state.
- Supabase Auth may participate in operator login through the auth-provider abstraction.
- Supabase Storage S3 remains a valid alternate control-plane artifact-store candidate after live
  conformance.
- Supabase Edge Functions do not host the deployment control-plane service, workers, or cache
  service.
- Supabase PrivateLink may provide private Postgres connectivity when the host runs in AWS, but it
  does not make Supabase Storage, Auth, Realtime, or API traffic private.

For the AWS-hosted topology, use AWS S3 as the default control-plane artifact store after the
`ControlPlaneArtifactStore` conformance suite passes. That keeps control-plane artifacts and Attic
objects on the same AWS object-store substrate, enables private S3 access through VPC endpoints, and
avoids operating two artifact-store backends. Supabase Storage S3 remains acceptable when public
HTTPS object-store traffic is acceptable, its conformance passes, and its dashboard/platform
integration is worth the extra backend.

## WorkOS Role

If WorkOS is used, it should initially be an identity provider, not a deployment provider.

A WorkOS integration should provide:

- OIDC issuer and JWKS metadata
- CLI-compatible login flow, or a brokered flow through the control-plane service
- stable user and organization identity claims
- group or role claims for deployer, admission reporter, and admin authorization
- audit-friendly principal names

The control plane should consume WorkOS through the same auth-provider abstraction used by any
future Supabase Auth integration. The deployment authorization model should not become
WorkOS-specific.

## Auth Provider Abstraction

The current auth design should be generalized before replacing the identity provider.

Runtime auth provider configuration should describe:

- issuer
- audience
- JWKS URL
- token type support
- user id claim
- email claim
- group or role claim mapping
- service principal claim mapping
- admin, deployer, and admission-reporter roles
- CLI login mode support

Initial adapters:

- current local identity provider adapter
- Supabase Auth adapter, if selected
- WorkOS adapter, if selected

The adapter must preserve:

- admission reporter authorization
- protected/shared deploy authorization
- service principal authorization
- audit rows with stable principal identity
- fail-closed behavior on missing or stale claims

## Artifact Store Requirements

The artifact store remains S3-compatible from the control-plane perspective.

Required behavior:

- immutable object writes by reviewed key
- direct object reads by key
- object metadata reads by key
- content-type preservation
- custom metadata preservation
- SHA-256 digest verification after read
- no correctness dependency on object listing

Candidate backends:

- Supabase Storage S3 endpoint
- Cloudflare R2
- AWS S3
- any other reviewed S3-compatible backend

Before selecting Supabase Storage, run a live compatibility test that writes and reads a fixture
artifact and verifies metadata through the same `ControlPlaneArtifactStore` implementation used by
workers.

Backend selection should follow the host-networking requirement:

- AWS S3 is the default candidate when the service and workers run in AWS, especially when Attic also
  uses S3 and object-store traffic should stay on private AWS network paths through VPC endpoints.
- Supabase Storage S3 is an alternate candidate when public HTTPS object-store traffic is acceptable
  and Supabase platform integration is preferable to sharing the AWS S3 substrate.
- Cloudflare R2 is the strongest alternate when egress cost, regional behavior, or Supabase Storage
  S3 conformance is unacceptable.

The artifact-store abstraction must not expose those choices to workers as different correctness
models. Provider-specific endpoint shape, signing region, path-style behavior, and metadata handling
belong in reviewed configuration and conformance evidence.

## Database Requirements

The control-plane database must support:

- durable submission rows
- queue claims and leases
- provider locks and fencing tokens
- idempotency keys
- worker heartbeats
- stage-state compare-and-swap
- audit rows
- deployment records

Supabase Postgres is a strong fit if connection management, network access, backups, and migration
operations are explicit. The control-plane service and workers should use a server-side connection
credential mounted as a file. Browser clients must never receive database credentials.

For AWS-hosted control-plane service and worker processes, the preferred private Postgres shape is
Supabase Postgres over Supabase PrivateLink when the organization has the required Supabase plan and
support path. The host must run in an AWS VPC in the same region as the Supabase project. If those
constraints are unacceptable, use the normal Supabase connection path with SSL, explicit network
restrictions where available, and file-backed credentials, or choose AWS RDS when the database must be
fully AWS-native.

## Secret Backend Requirements

Infisical should remain the default deployment secret backend for now.

The control plane should continue to use:

- deployment-scoped Universal Auth identities
- file-backed client id and client secret credentials
- worker-side secret resolution
- admission replay evidence that proves the selected secret identity

Supabase and WorkOS do not replace Infisical unless a separate secret-backend design says so.

## Mini Alignment

Mini should become a cloud-shaped control-plane host.

Target mini responsibilities:

- run the same Nix-built control-plane image as cloud
- expose ingress for `deploy.apps.kilty.io` and `deploy-auth.apps.kilty.io` while it remains primary
- mount credentials as files
- use external Postgres
- use external S3-compatible artifact storage
- keep only scratch state locally
- act as a rollback or standby host after cloud cutover

Responsibilities to remove from mini:

- authoritative control-plane database ownership
- authoritative artifact storage ownership
- local-only deployment identity-provider assumptions
- local-only secret backend assumptions
- any special deployment behavior that cannot also run on a cloud host

Mini may remain a deployment target for unrelated apps, but it should not be special as the
deployment authority.

## Cloud Host Profile

A cloud host profile should consume the same reviewed image and config contract as mini.

Required inputs:

- immutable image digest
- control-plane runtime config
- external Postgres URL credential file
- S3-compatible artifact-store endpoint and credential files
- reviewed-source SSH key or GitHub App credential files
- deployment-scoped Infisical credential files
- public ingress for the service
- auth callback ingress

Acceptable substrates:

- NixOS VM using the existing container module
- AWS EC2 using the NixOS VM or non-NixOS profile
- Kubernetes running Nix-built images
- Docker or Podman host using the non-NixOS profile
- Cloudflare Containers, if the provider supports required mounts and secret files

The substrate must preserve the runtime boundary. If a platform cannot provide file-backed secrets,
immutable image digest pinning, persistent scratch mounts, and outbound provider access, it is not a
valid control-plane host without a reviewed exception.

Recommended service mapping:

- Operator UI and request-scoped admission/read APIs may run on Vercel or another web runtime if they
  only call the protected control-plane API and never hold provider, database, artifact-store, or
  worker credentials in browser-visible state.
- Long-running deployment control-plane service and worker processes should run on EC2, ECS-on-EC2,
  Kubernetes, or another always-on container/VM substrate that preserves file-backed credentials,
  graceful shutdown, persistent scratch, and worker lease semantics.
- The adjacent remote-build cache service (`atticd`) should run on a small On-Demand EC2 instance or
  tiny EC2 Auto Scaling group in the AWS VPC when the build/test fleet also uses EC2. It is adjacent
  build infrastructure, not a deployment provider, and it must not run on Spot.
- Distributed build/test workers should use EC2 Spot fleets for Linux Nix remote builders and Buck2
  remote-execution workers. They are not deployment control-plane workers and should use separate
  worker registration, credentials, leases, and autoscaling policy.
- Cloudflare should provide DNS, TLS/WAF, rate limiting, and possibly CDN in front of read paths only
  after cache-control and auth behavior are verified. Cloudflare Workers, Vercel Functions, and
  Supabase Edge Functions are not valid hot paths for deployment mutations, cache traffic, or
  build/test execution.

## Deployment Provider Direction

Existing provider support should be used where it already matches the workload:

- static webapps: Cloudflare Pages, Vercel, or S3 static
- services and third-party services: Kubernetes
- AWS-hosted control-plane service/worker runtime: EC2 or ECS-on-EC2 host profiles, once reviewed
- mini-hosted apps: `nixos-shared-host` while mini remains a target
- containerized cloud services: Kubernetes first, Cloudflare Containers only after live mutation is
  reviewed

Future provider entries may include:

- `supabase-edge-functions`
- `supabase-db-migration`
- `supabase-storage-static`
- `cloudflare-containers-live`

Each new provider must add a provider-capability entry before protected/shared use.

The deployment control plane may orchestrate the recommended AWS/Supabase/Cloudflare/Vercel topology
when those provider-capability entries exist. The minimum required entries are:

- `aws-ec2-control-plane-host` for service/worker host profile rollout, health checks, and rollback
- `aws-attic-cache-service` for adjacent `atticd` rollout and health checks
- `aws-s3-artifact-store` for bucket, lifecycle, endpoint, and artifact-store conformance
- `aws-network-foundation` for security groups, VPC endpoints, ALB/NLB, and related DNS prerequisites
- `supabase-managed-postgres` for database connectivity and conformance evidence
- `supabase-privatelink-prerequisite` for PrivateLink setup evidence when it cannot be fully
  automated
- `cloudflare-edge` for DNS/TLS/WAF/rate-limiting changes
- `vercel-operator-ui` if the operator UI/API is deployed on Vercel
- `remote-build-worker-fleet` for build/test worker capacity registration and autoscaling policy

Concrete capability declarations for this topology are generated from the reviewed catalog used by
`deployment-control-plane setup`. Each declaration defines a non-placeholder target identity shape,
file-backed or support-mediated credential source, lock scope, redacted preview command, apply and
smoke hooks, rollback evidence, replay semantics, audit evidence, and protected/shared eligibility.
The hook commands are executable dispatch contracts, not placeholder shell snippets: `deploy
--deployment <label> --provider-capability <id>` runs the reviewed adapter for the selected phase
(`--preview`, apply by default, `--record`, `--smoke`, or `--rollback`). Each invocation records the
concrete capability id, target identity, credential source, lock scope, replay semantics, and declared
audit evidence before output can be used for readiness or cutover evidence. Protected/shared
readiness and cutover reject static audit-reference lists and require
`cloud-provider-capability-hook-evidence@1` evidence from the hook dispatcher.
The current catalog is:

- `aws-ec2-control-plane-host`: automated through reviewed AWS host-profile IaC or provider CLI
  hooks; requires EC2 runtime DB/S3 path proof and worker shutdown evidence.
- `aws-attic-cache-service`: automated adjacent cache rollout; requires `atticd` health,
  cache-object conformance, token-scope evidence, and rollback to the previous cache endpoint.
- `aws-s3-artifact-store`: automated artifact bucket, lifecycle, KMS, and VPC endpoint capability;
  requires artifact PUT/GET/HEAD metadata and digest conformance.
- `aws-network-foundation`: automated VPC, subnet, security-group, endpoint, ALB/NLB, TLS, and DNS
  capability; requires fresh ingress and DNS/TLS health evidence.
- `supabase-managed-postgres`: managed dependency capability; requires SQL feature conformance,
  TLS connectivity from the selected host, migration lock evidence, and backup/restore reference.
- `supabase-privatelink-prerequisite`: gated prerequisite; support-mediated steps are recorded as
  control-plane evidence and do not become hidden mutation authority.
- `cloudflare-edge`: automated edge prerequisite for DNS, TLS/WAF, rate limiting, and callback
  routing; Cloudflare is not deployment mutation authority.
- `vercel-operator-ui`: automated operator UI/API deployment and alias capability; Vercel remains a
  browser/API surface and not a deployment worker or mutation provider.
- `remote-build-worker-fleet`: adjacent build-system capacity capability; it must prove separate
  Buck/Nix worker authority and must not replace deployment worker scheduling.

Provider entries may be implemented directly or by invoking reviewed infrastructure tooling such as
OpenTofu, Terraform, CloudFormation, or provider CLIs. In all cases, the deployment control plane owns
admission, locks, credential scoping, audit, smoke evidence, and rollback evidence. Raw IaC state or
provider dashboards do not replace control-plane audit records.

Prefer infrastructure-as-code for every external component that can be represented safely and
maintainably. VPCs, subnets, security groups, VPC endpoints, ALB/NLB, DNS records, S3 buckets,
lifecycle policies, IAM roles, EC2 launch templates, Auto Scaling groups, and cache/control-plane host
profiles should be declared in reviewed IaC rather than assembled by hand. IaC modules must be
versioned, reviewed, previewed, and applied only through the deployment control plane or an equally
audited bootstrap path. Do not force IaC around provider steps that are not safely automatable, such
as support-mediated PrivateLink setup; record those as gated prerequisites with evidence.

## Migration Phases

### Phase 1: Prove external persistence

- Create a managed Postgres target, likely Supabase Postgres.
- Create an S3-compatible artifact-store target. For the AWS-hosted topology, prefer AWS S3 after
  conformance; keep Supabase Storage S3 and R2 as alternate candidates.
- Run compatibility tests for queue, locks, artifact metadata, and artifact replay.
- Keep mini as the only service ingress while external persistence is tested.
- This phase can begin once the credential contract, artifact-store contract, and service/worker
  process modes are available.

### Phase 2: Make mini cloud-shaped

- Point mini control-plane service and workers at external Postgres.
- Point mini at external S3-compatible artifact store.
- Keep Infisical deployment credentials file-backed.
- Keep current auth provider.
- Run staging deploys through mini and verify no protected/shared state depends on local mini
  database or local mini artifact storage.
- Avoid protected/shared deploys during live database migration unless state sync and rollback have
  been proven.

### Phase 3: Introduce cloud host

- Publish the reviewed Nix-built control-plane image by immutable digest.
- Run one service replica and two worker replicas on the cloud host. The recommended first production
  host is AWS EC2 in the same VPC used for adjacent cache/build infrastructure, using a NixOS VM or
  reviewed non-NixOS profile.
- Use the same external Postgres and artifact store.
- If using Supabase Postgres PrivateLink, place the host in the same AWS region/VPC path required by
  the Supabase PrivateLink configuration.
- Use AWS S3 through a VPC endpoint for the control-plane artifact store when the AWS-hosted topology
  is selected, unless a reviewed exception chooses Supabase Storage S3 or another compatible backend.
- Start with cloud service private or on a staging hostname.
- Verify `/healthz`, `/readyz`, worker heartbeats, read APIs, and a non-production deploy.
- This phase requires the reviewed OCI image and chosen host substrate from the implementation
  sequence.

### Phase 4: Migrate auth

- Add auth-provider abstraction.
- Implement Supabase Auth or WorkOS adapter.
- Run adapter in parallel with the current provider if possible.
- Verify CLI login, admission reporter authorization, deploy authorization, service principals, and
  audit identity.
- Cut operator auth over before cutting mutation authority if that reduces risk.

### Phase 5: Cut control-plane traffic

- Move `deploy.apps.kilty.io` and `deploy-auth.apps.kilty.io` to the cloud host.
- Keep mini as standby with the same external DB and artifact store, or disable mini workers and
  leave the service private.
- Run staging deploy, prod validation, and rollback drills.

### Phase 6: Retire mini-specific authority

- Remove local-only identity-provider assumptions.
- Remove local-only artifact and DB dependencies.
- Keep mini as a normal deployment target or standby host.
- Document cloud host restore and break-glass procedures.

## Validation Gates

Each phase should have explicit checks:

- `sprinkleref --check` has no missing deployment secrets.
- control-plane `/healthz` and `/readyz` pass.
- worker heartbeats are visible.
- database-backed sessions work across service replicas.
- artifact write/read/head fixture passes against selected object store.
- database queue and lock fixture passes against selected Postgres.
- two workers cannot claim or execute the same submission.
- stale workers lose authority after lease expiry, changed claim token, terminal submission state, or
  superseded submission state.
- provider locks reject stale fenced mutations.
- one protected/shared staging deploy succeeds.
- deploy audit row includes the expected principal.
- audit rows include request/correlation ids.
- web UI and MCP read surfaces apply the same redaction boundary as CLI/read APIs.
- provider mutation uses worker-side credentials only.
- no developer or CI environment variable supplies provider, database, artifact-store, or secret
  backend credentials.
- image layer inspection finds no credential files, dotenv files, private keys, database URLs, or
  accidental secret-bearing bundle contents.
- NixOS module evaluation tests cover option defaults, credential staging, rendered config, worker
  replica generation, and nginx gating.
- Compose/Podman profile validation proves no plaintext credential env file is used.
- rollback path is tested before removing mini fallback.

Substrate conformance for each candidate host must include:

- host kernel/container runtime can run the Nix-built image entrypoints
- mounted credential files are readable only by the container user
- mounted scratch roots have expected ownership and permissions
- outbound Git/SSH, Infisical, artifact-store, database, and provider API access works
- if AWS is selected, S3 VPC endpoint access and Supabase PrivateLink database connectivity work from
  the service and worker subnets when those features are part of the profile
- child process environment scrubbing is preserved
- graceful shutdown and replacement worker claim behavior is correct

## Risks And Trade-Offs

### Coordination Surface Area

Queue claims, leases, locks, idempotency, and stage-state compare-and-swap are production mutation
boundaries. A subtle regression can create duplicate provider mutations or stale worker authority.
The design therefore requires database-backed coordination before multi-worker cloud operation.

### S3-Compatible Backend Selection

Supabase Storage, Cloudflare R2, and AWS S3 are candidates, but compatibility must be tested against
the exact `ControlPlaneArtifactStore` behavior. If Supabase Storage does not preserve the needed
metadata or signing semantics, the migration should switch artifact storage rather than weaken the
artifact contract.

### Image Layer Content

The image contract's prohibited path and prohibited string checks are necessary but not sufficient
unless they cover indirect captures. The image tests must inspect the built layer contents and the
bundled JavaScript output for accidental inclusion of credential paths, dotenv data, private keys,
database URLs, provider tokens, or fixture secrets.

### NixOS Module Validation

The NixOS module is substantially implemented, but the design treats it as untrusted until Nix
evaluation tests prove the generated config, credential staging, worker replicas, nginx gate, and
container runtime settings.

### Graceful Shutdown Under Lease Contention

Workers must stop lease renewal during shutdown and must not continue provider mutation after losing
authority. Replacement workers must be able to claim after expiry without manual scratch cleanup.
This is a deterministic test requirement.

### Live Database Migration

Moving mini from local Postgres to external Postgres requires preserving live submissions, queue
rows, audit records, stage state, deployment records, and idempotency facts. The migration must have
a rollback plan and should avoid running protected/shared deploys during the cut unless the state
sync is proven.

### Auth Provider Cutover

The control-plane runtime must be designed to accommodate Supabase Auth or WorkOS, but replacing the
current local identity provider requires a separate auth-provider adapter and verification of CLI
login, PKCE callback handling, admission reporter authorization, deployer/admin roles, service
principals, and audit identity.

### Incremental Delivery

The design should be delivered incrementally. The cost is coordination overhead. The benefit is that
each change can be reviewed, tested, and reverted independently, and validation scope can stay narrow
until image or build-system behavior actually changes.

### Podman Default, Docker Compatibility

Podman is the NixOS-idiomatic default through `virtualisation.oci-containers`. Docker-compatible
Compose remains useful for non-NixOS hosts, but any divergence in mounts, networking, health checks,
or credential behavior must be tested instead of assumed.

### AWS Host Boundary

AWS EC2 is the recommended first production host for long-running deployment control-plane processes
when the build cache and build/test workers are also AWS-hosted. The benefit is one VPC, one security
group model, private S3 access through VPC endpoints, direct Supabase PrivateLink compatibility for
Postgres, and the option to use NixOS profiles without depending on a serverless runtime. The cost is
that AWS substrate setup becomes explicit infrastructure, not a portable SaaS default.

Do not collapse all AWS workloads into one authority model. The deployment control-plane service and
workers, adjacent `atticd` cache service, and Buck/Nix build/test workers must keep separate
credentials, registration records, logs, scaling policy, and failure domains.

### File-Backed Secrets

File-backed credentials are more operationally strict than env-var secrets. Some hosted runtimes may
not support them cleanly. Such runtimes are invalid control-plane hosts unless a reviewed exception
preserves equivalent secret handling and redaction guarantees.

### One Image For Service And Worker

One image runs both service and worker process modes. This simplifies digest pinning and host
profiles. The trade-off is that each image contains both entrypoints. The explicit command argument
and process-level authorization boundary are the accepted control.

## Build Scope Discipline

Control-plane runtime behavior should remain deployment-only in scope as much as possible:

- `build-tools/tools/deployments/**`
- `build-tools/tools/tests/deployments/**`
- `build-tools/tools/nix/**`
- relevant docs

Full image and mixed build-system validation becomes expected when the Nix-built OCI image, build
graph wiring, or shared build infrastructure changes. If a broad build-system change is required,
split it from runtime behavior changes instead of hiding it inside control-plane migration work.

If implementation experience invalidates this design, update this document before using it as input
to a delivery-planning document.

## Open Questions

- Should the first EC2 host profile be NixOS-only, or should the non-NixOS profile also generate an
  AWS systemd/Podman bundle?
- Is there any control-plane artifact workload that still benefits enough from Supabase Storage S3 to
  justify using it instead of AWS S3 in the AWS-hosted topology?
- Should operator auth move first to Supabase Auth or WorkOS?
- Should reviewed-source access move from SSH deploy key to GitHub App before cloud cutover?
- Do we want multi-region standby, or is one cloud host plus mini fallback enough for the first
  migration?

## Recommended Path

The safest path is:

1. Keep the current Nix-built OCI image model.
2. Make mini use external Postgres and S3-compatible artifact storage.
3. Keep Infisical as the deployment secret backend.
4. Add an AWS EC2 cloud host that runs the same image by immutable digest, with Supabase Postgres
   over PrivateLink when available and AWS S3 through a VPC endpoint for control-plane artifacts.
5. Add auth-provider abstraction after persistence is cloud-shaped.
6. Cut traffic to cloud only after staging deploys pass on both mini-shaped and cloud-shaped
   runtimes.

This keeps the migration incremental. Mini remains useful throughout, but its role changes from
special deployment authority to ordinary compatible host.
