# ADR-00003: Auth and Identity Architecture

**Status:** Accepted
**Date:** 2026-05-25
**Authors:** viberoots team

## Context

viberoots is a monorepo that deploys services across developer laptops, CI environments, and a cloud-portable control plane. Several identity and authentication concerns must be resolved consistently across these environments:

- Workload services need credentials to access secrets backends at runtime without embedding secrets in artifacts or images.
- The deployment control plane must admit only verified, reviewer-approved releases; developer laptops and CI runners are explicitly not deployment authorities.
- Secrets references must be stable across backend changes and environments without hardcoding backend-specific paths into application code.
- Bootstrap credentials (those required to reach a secrets backend itself) cannot be stored in the same secrets backend they unlock; they require a separate resolution path.
- CI submitters must provide evidence sufficient to bind a build to a trusted source revision, verified check results, and an immutable artifact identity before the control plane will admit a release.

The team evaluated personal tokens, ambient CLI sessions, and client-submitted tokens for workload authentication and rejected all of them for shared or protected flows due to auditability, rotation, and blast-radius concerns.

## Decision

### 1. Infisical Universal Auth for workload credentials

The deployment control plane uses Infisical Universal Auth (client ID + client secret) as the only operator-visible Infisical workload credential source. Machine identities (workload identities) are provisioned per service. Personal tokens, ambient CLI sessions, and client-submitted tokens are prohibited in protected and shared flows.

### 2. SprinkleRef as the stable secret reference layer

All secret references in the repository use `secret://deployments/...` URIs (SprinkleRef). These URIs are logical names that remain backend-neutral. Resolution is driven by canonical project config in `projects/config/shared.json` plus gitignored `projects/config/local.json`; shared config maps categories, environments, and runtime hosts to backends while local config supplies individual operator values. This isolates application and deployment code from backend-specific paths.

SprinkleRef defines two categories:

- `main` — ordinary deployment and application secrets; resolved via the configured production secrets backend.
- `bootstrap` — root credentials needed to reach a secrets backend itself; must resolve via a backend that is not the backend it unlocks, commonly macOS Keychain or restrictive local files.

### 3. Vault and Infisical as supported production secrets backends

Vault and Infisical are supported production secrets backends. Backend routing is selected through reviewed deployment metadata and project config. No Vault tokens, Infisical Universal Auth client secrets, provider credentials, or rendered backend configuration are baked into images or stored in deployment records.

### 4. No credentials in artifacts, logs, or records

No Infisical access token, Universal Auth client secret, personal token, secret value, or rendered secret-bearing configuration may be persisted in deployment records, logs, checked-in metadata, or diagnostics. Credentials are mounted into containers as files at runtime; they are never baked into image layers.

### 5. Non-root runtime for control plane containers

Control plane containers run as non-root. Credentials are supplied via file mounts, not environment variable injection into the image layer or hardcoded configuration.

### 6. CI admission evidence requirements

CI submitters (Jenkins and equivalents) must provide all of the following before the control plane admits a release:

- Reviewed source revision (stable Git ref, not a mutable branch tip).
- Trusted check results bound to that revision.
- Builder identity.
- Immutable artifact identity or retained artifact reference.
- Optionally: SBOM, signature, or provenance references.
- Stable idempotency key.

Mutable image tags and laptop-local artifact paths are not valid CI artifact identities and will be rejected.

### 7. Future application-layer identity providers

Supabase and/or WorkOS-style providers are the candidate identity providers for replacing any local identity-provider role once the persistence and runtime boundaries are cloud-shaped. This is recorded as a future-state direction; it is not part of the current architecture.

## Consequences

### Positive

- Workload credentials are scoped to machine identities with explicit lifecycle management; no shared personal tokens that span multiple operators or services.
- SprinkleRef URIs decouple application and deployment code from backend topology; swapping or adding backends requires only resolver config changes, not code changes.
- The `bootstrap` category constraint ensures circular dependency is impossible: the secrets backend cannot be required to unlock itself.
- The admission evidence model ensures the control plane can reject any release that lacks a complete, auditable chain from source revision to artifact.
- Non-root containers with file-mounted credentials minimize the blast radius of a compromised container: no credentials survive in the image layer or in environment variables accessible to child processes.
- No credentials in records or logs means audit exports and diagnostics are safe to share without scrubbing.

### Trade-offs

- Universal Auth client secrets require out-of-band provisioning and rotation procedures; teams cannot rely on ambient session authentication for automation.
- The two-category (`main`/`bootstrap`) resolver model adds a configuration step for each new environment: both a `main` resolver and a `bootstrap` resolver must be declared before secrets can be resolved.
- CI submitters bear a richer evidence burden than a simple token-and-tag approach; pipelines must be instrumented to capture and forward all required admission fields.

### Obligations

- Every new Infisical-backed service workload identity must be provisioned as a machine identity; personal token use for any workload is a policy violation.
- Any resolver configuration that maps the `bootstrap` category to the backend it unlocks must be treated as a misconfiguration and corrected.
- Deployment record schemas must be reviewed for any field that could inadvertently persist a secret value or rendered secret-bearing config; such fields are prohibited.
- When the application-layer identity provider decision is made (Supabase, WorkOS, or otherwise), a follow-on ADR must record that decision and its integration constraints against this architecture.
