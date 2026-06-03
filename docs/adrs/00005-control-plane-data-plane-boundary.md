# ADR-00005: Control Plane / Data Plane Boundary

**Status:** Accepted
**Date:** 2026-05-25
**Authors:** viberoots team

## Context

The deployment system crosses multiple trust zones: developer laptops, CI runners, a centrally-operated control plane, and several external provider APIs (Cloudflare Pages, Cloudflare Containers, NixOS shared host, Apple App Store Connect). Without an explicit boundary, authority over what is deployed, when, and to which environment would be ambiguous, enabling silent promotion of unreviewed artifacts or uncoordinated concurrent writes to shared infrastructure.

Two questions needed a clear answer:

1. Which components may mutate authoritative deployment state?
2. Which components are execution substrates that receive instructions, not peers that hold deployment authority?

## Decision

The system is split into a **control plane** and a **data plane** at a hard authority boundary.

### Control plane

The control plane is the sole deployment authority for all protected and shared deployment targets. It consists of:

- **control-plane service** — stateless HTTP service that accepts submissions, runs admission validation, and answers status and record queries. Listens on HTTPS. Exposes: `POST /api/v1/submit`, `GET /api/v1/submit`, `GET /api/v1/status`, `GET /api/v1/records`, `GET /api/v1/current-stage-state`, `GET /api/v1/stage-history`.
- **control-plane worker** — stateless background worker that pulls work from the Postgres queue and executes provider-specific publish operations.
- **Postgres** — authoritative runtime state: submissions, work queue, distributed locks, worker ownership, deploy records, stage state, and stage history.
- **S3-compatible artifact store** — immutable artifact storage for artifacts that have been admitted by the service.

Service and worker run as a single Nix-built OCI image, selected by CLI flag at startup, with a non-root runtime user and credentials mounted as files rather than baked into the image.

### Data plane

Providers (Cloudflare Pages, Cloudflare Containers, NixOS shared host services, Apple App Store Connect) are execution substrates. They receive publish operations dispatched by control-plane workers. They do not hold deployment authority and do not initiate deployments.

### Authority boundary rules

**CI** builds artifacts and submits them to the control plane. CI is a submitter, not a mutating authority alongside the control plane.

**Developer laptops** may operate `personal_dev` deployments directly. For protected and shared targets, laptops use the deploy CLI as a thin client (`build-tools/tools/bin/deploy --control-plane-url <url>`). Laptops do not hold provider API credentials, database credentials, artifact-store credentials, Infisical workload credentials, or reviewed-source credentials for protected or shared deploys.

**Workers** hold provider API credentials during execution only. Credentials are mounted as files and are never persisted in deploy records, logs, or artifacts.

**Missing `--control-plane-url` / `VBR_DEPLOY_CONTROL_PLANE_URL`** is a fail-closed configuration error for protected/shared targets. Mixing the service-routed path with local-only flags (`--records-root`, `--control-plane-database-url`) is out of contract for protected/shared use.

### State authority rules

- `GET /api/v1/current-stage-state` is the authoritative current deployed state. Git refs, mutable provider tags, and release-pointer files are not authoritative state.
- `<records-root>/control-plane/*.json` and `<records-root>/runs/*.json` files are derived audit evidence only, not runtime state. No filesystem mirror path is valid runtime state for protected/shared flows.
- `pgmem://...` backend URLs are valid only for isolated test harnesses.

### Execution snapshot immutability

Every protected/shared first-run admission freezes an immutable execution snapshot before any waiting, locking, or mutation occurs. Later execution revalidates only narrow current invariants rather than silently consuming drifted repo or provider configuration.

### Runtime portability

The control plane is designed to run identically on a NixOS host (mini) and on cloud OCI substrates (Kubernetes, Compose, Cloudflare Containers, etc.). NixOS belongs at the host layer, not inside the container. Kubernetes, Compose, Podman, and Docker are runtimes, not deployment authorities.

## Consequences

### Positive

- Authority is unambiguous: a single control plane owns protected/shared deployment state. No two components can simultaneously hold conflicting authority over a deployment target.
- Credentials for providers are scoped to worker execution time and never appear in artifacts, logs, or records.
- Execution snapshots prevent late drift: a submission that passes admission cannot silently execute against a different artifact or configuration than the one reviewed at admission time.
- Stage state (`/api/v1/current-stage-state`) provides a single queryable source of truth; callers do not need to reconcile provider state, Git refs, or filesystem files.
- The control plane image is host-agnostic and can be moved between NixOS hosts and cloud OCI substrates without contract changes.

### Trade-offs

- Developer laptops cannot directly mutate protected or shared deployment state; all such changes flow through the HTTP API. This adds a network round-trip and a dependency on control-plane availability for protected/shared deploys.
- Local filesystem records are audit evidence, not live state. Tooling that inspects them must treat them as read-only snapshots and must not write back.
- `pgmem://...` is not valid outside test harnesses; operators cannot use an in-process database for production deployments even in minimal environments.

### Obligations

- Any new deployment target classified as protected or shared must route through the control plane service. Direct provider API calls from CI or laptops for these targets are a contract violation.
- Any new provider integration must be implemented as a worker-side publish operation dispatched by the control plane, not as a parallel authority.
- Credentials for new providers must be mounted at worker runtime and must not appear in submitted artifacts, admitted records, or log output.
- Tools that surface deployment state must source it from `GET /api/v1/current-stage-state` or `GET /api/v1/records`, not from filesystem mirror files or provider-side tags.
- If the control plane URL is absent for a protected/shared target, the CLI must fail closed immediately rather than falling back to a local or direct path.
