# ADR-00006: Secrets Management Strategy

**Status:** Accepted  
**Date:** 2026-05-25  
**Authors:** viberoots team

## Context

Deployments in viberoots require access to secrets (API keys, credentials, tokens) at runtime. Several concerns shaped the design:

1. **Backend instability** — secret backend providers change over time; deployment metadata must not be coupled to a specific provider.
2. **Multiple environments** — CI, local developer machines, and production all require different resolver strategies for the same logical secret.
3. **Bootstrap circularity** — accessing a secret backend itself requires credentials; those credentials cannot live in the same backend.
4. **Build graph isolation** — Buck and Nix are hermetic artifact-producing systems; pulling live secrets into the build graph would break reproducibility and introduce a security boundary violation.
5. **Redaction** — secrets must never appear in deployment records, logs, diagnostic output, or checked-in metadata, even transiently.
6. **Provider parity** — the team operates Vault in production and Infisical as an additional supported backend; both must coexist without one replacing the other.

## Decision

### SprinkleRef: stable URI contract layer

All secret dependencies are declared via `secret_requirements` in TARGETS metadata using stable `secret://deployments/...` URIs. These URIs are logical names that never change even if the backend or path changes. SprinkleRef resolves them through an environment-specific resolver config selected at deployment time, not baked into TARGETS.

Resolver configs (`sprinkleref/base.json`, `sprinkleref/local.macos.json`, `sprinkleref/local.file.json`, `sprinkleref/ci.github.json`, `sprinkleref/ci.jenkins.json`, etc.) live outside deployment metadata. The active local config is `selected.local.json`. This separation makes the contract layer backend-neutral: the same URI resolves via Vault, Infisical, macOS Keychain, or a local fixture file depending on the resolver.

`sprinkleref --check` validates that resolver config and secret references are consistent before any deployment proceeds.

### Secret category model

Two categories govern how secrets are resolved:

- **`main`** — ordinary deployment and application secrets. Resolved via Vault or Infisical depending on the deployment's declared backend.
- **`bootstrap`** — root credentials required to reach a secret backend (e.g., Infisical Universal Auth client secrets, Vault tokens). Must resolve to a non-Infisical, non-Vault backend: macOS Keychain or restrictive local files. Bootstrap credentials may not be stored in the backend they unlock.

`--category bootstrap` is reserved exclusively for Infisical/Vault bootstrap credentials.

### Vault: default production backend

HashiCorp Vault is the default and supported production secret backend. It is configured via `VBR_VAULT_ADDR` and `VBR_VAULT_TOKEN`, using mount `secret` and default path `/deployments`. Vault bootstrap, admin, direct runtime, and replay support are non-goals and will not be implemented.

### Infisical: additional supported backend

Infisical is a supported backend added for provider parity, not as a Vault replacement. Deployments opt in via `secret_backend = "infisical/default"` in TARGETS. The only operator-visible Infisical workload credential source is Universal Auth (client ID + client secret). No personal tokens, ambient CLI sessions, client-submitted tokens, or client-submitted secret values are permitted in protected or shared flows.

Secret names in Infisical are derived deterministically in snake_case from contract IDs by default.

The initial implementation scope is: deployment-wide backend selection, direct shared secrets only, and read-only admin diagnostics. Per-requirement mixed-backend deployments and Infisical admin sync/mutation flows are non-goals.

### Fixture and test override

`VBR_DEPLOYMENT_SECRET_FIXTURE_PATH` overrides both Vault and Infisical for local and test flows. This flag is provider-neutral and will remain so. Explicit `pgmem://...` backend URLs are valid for isolated fixture tests only.

### Build graph isolation

No Buck action, Nix planner, or artifact-producing build route may contact Infisical or Vault. Secret resolution happens exclusively in live deployment side-effect paths, after the build graph has been fully evaluated.

### Credential mounting at runtime

The control plane service and workers receive credentials via mounted files, not environment variables baked into images. Infisical deployment credential files and reviewed-source SSH credentials are file-mounted at runtime.

### Redaction

No Infisical access token, Universal Auth client secret, personal token, secret value, expanded secret reference, or rendered secret-bearing config may appear in deployment records, logs, checked-in metadata, or diagnostic output at any point. Redaction logic is implemented as deployment-owned modules, not shared library code, to keep the boundary explicit.

## Consequences

### Positive

- Deployment metadata is permanently decoupled from secret backend specifics; migrating a deployment to a different backend requires only a resolver config change, not a TARGETS edit.
- The category model prevents bootstrap circular dependency by routing root credentials through a separate, non-secret-backend resolver.
- Build graph hermeticity is preserved: Nix and Buck evaluations never block on or contact live secret backends.
- Fixture override support gives developers and CI a deterministic, provider-neutral way to test secret-dependent code paths without real credentials.
- Vault and Infisical coexist as peer backends; the team is not locked into either.

### Trade-offs

- Resolver config selection is an additional operational concern: operators must ensure the correct `sprinkleref/*.json` config is active for each environment.
- The deployment-wide backend selection model means a single deployment cannot mix Vault and Infisical requirements in the first implementation; per-requirement backend selection is explicitly deferred.
- Redaction being deployment-owned (not a shared library) means each deployment path must independently maintain correct redaction coverage.

### Obligations

- All new secret requirements must be declared via `secret://deployments/...` URIs in TARGETS; ad-hoc secret references outside this contract are prohibited.
- `sprinkleref --check` must pass before any deployment proceeds.
- Bootstrap credentials must always resolve through a non-Infisical, non-Vault resolver; this must be verified in resolver config review.
- Any new secret-touching code path must include redaction for all sensitive values before those values can appear in logs, records, or diagnostic output.
- Secret resolution must never be introduced into Buck actions, Nix planners, or any build graph evaluation path.
