# 1. Infisical Secrets Provider

**Tier:** Foundation
**Priority:** 1 of 44
**Depends on:** none (in progress)
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Complete the Infisical backend integration so deployments use Infisical as the secrets backend, with Universal Auth workload credentials and SprinkleRef backend-neutral references.

## What

Add Infisical as a peer deployment secrets backend alongside Infisical. Deployments opt in by
setting `secret_backend = "infisical/default"` in `TARGETS` metadata alongside non-secret Infisical
routing data (`infisical_runtime`, `infisical_secret_mappings`). The change is entirely additive:
all existing Infisical-backed deployments continue to work with no changes. Infisical is not a
replacement or migration forcing function.

The backend is implemented through the `SprinkleRef` contract layer. Secret requirements continue to
be declared through `secret_requirements` as `secret://deployments/...` contract IDs. The only
workload credential source for Infisical is Universal Auth (machine identity client ID and client
secret read from reviewed environment variable names declared in `infisical_runtime`). No personal
tokens, ambient Infisical CLI sessions, client-submitted tokens, or client-submitted secret values
are accepted.

`VBR_DEPLOYMENT_SECRET_FIXTURE_PATH` remains the provider-neutral override for local and test
flows, and overrides both backends. Protected/shared workers reject it by default and accept it only
when `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1` explicitly marks a local fixture service run.

**What is already implemented** (based on existing source files and recent git history):

- `deployment-secret-infisical-credentials.ts` — Universal Auth login, in-memory token cache, site
  URL normalization, and redaction helpers for client secrets and access tokens.
- `deployment-secret-infisical-client.ts` — Low-level HTTP reads against `GET /api/v4/secrets/{secretName}` and supporting API calls for projects, environments, and machine identity project access.
- `deployment-secret-infisical-selectors.ts` and `deployment-secret-infisical-replay-identity.ts`
  — Selector derivation from `infisical_runtime` plus optional `infisical_secret_mappings` path/name
  overrides, and backend-qualified admitted reference construction.
- `deployment-secret-infisical-admission-read.ts` — Admission-time metadata reads with
  `viewSecretValue=false`.
- `deployment-secret-infisical.ts` — `resolveDeploymentInfisicalAdmittedReferences()` and
  `createDeploymentInfisicalSecretBackend()` implementing the adapter behind the generic runtime.
- `deployment-secret-infisical-runtime-worker.ts` — Worker-side credential activation.
- `deployment-secret-profile.ts` — Allowed key validation for `infisical_runtime` fields.
- `sprinkleref-infisical.ts` — `SprinkleRefInfisicalStore`, the SprinkleRef store implementation
  backed by Infisical Universal Auth, used for repo-level secret management outside deploy flows.
- `infisical-bootstrap.ts` and `infisical-bootstrap-reset-local.ts` — IaC bootstrap tooling for
  initializing the Infisical project, resolver profiles, machine identities, and deployment fan-out.
- Comprehensive test coverage: fake Infisical HTTP server, admission, runtime acquire, replay,
  redaction, credentials, paths, evidence, e2e front-door, migration/replay, worker fixture,
  guardrails, SprinkleRef store, bootstrap IaC, and OpenTofu adoption tests.

**What appears to still be in progress** (based on git status showing unstaged modifications):

- Active fixes to `infisical-bootstrap.ts` and surrounding IaC flows — recent commits address
  adopted project metadata handoff, bootstrap identity grants on adopted projects, reading project
  environments for adoption, decoupling install readiness from demo family, and narrowing adopted
  metadata handoff. These suggest the adoption/onboarding path for existing Infisical projects is
  being hardened.
- `deployment-secret-infisical-client.ts` has unstaged changes, indicating live API shape or
  response parsing is still being adjusted.
- `sprinkleref-infisical.ts` has unstaged changes alongside `sprinkleref-check*.ts` files,
  suggesting the SprinkleRef check command's handling of Infisical-backed refs is being refined.
- Several deployment infrastructure files (`cloudflare-pages-publisher.ts`,
  `nixos-shared-host-reviewed-source-snapshot.ts`, NixOS container Nix files) have unstaged
  changes, likely reflecting provider integration and control-plane snapshot wiring for
  Infisical-backed protected/shared deployments.
- The plan document (`infisical-plan.md`) describes PRs 9–11 as end-of-range conformance passes
  covering API shape corrections (v4 endpoint, `viewSecretValue` query param discipline), fixture
  service mode for protected/shared workers, and `secret_path_prefix` selector derivation — these
  correspond to the area most likely still being finished.

## Why Now

This is foundational work. The `SprinkleRef` secret contract layer is already in place, and Infisical
is the production backend today. Without Infisical support, any deployment that needs to store
secrets in Infisical must either bypass the contract layer or wait for this work. The task also
blocks `05-auth-provisioning-iac.md`, which may need to use Infisical to store auth secrets produced
by its IaC runs. Getting the backend dispatch, admitted reference semantics, and replay model
correct now prevents every downstream provider from having to handle the Infisical / Infisical
distinction explicitly.

## Risks

- **API drift.** Infisical's hosted and self-hosted APIs can diverge across versions. The design
  pins to `GET /api/v4/secrets/{secretName}` with specific query params; the fake Infisical server
  in tests must enforce that shape or conformance can regress silently.
- **Adoption path brittleness.** The bootstrap IaC for adopting an existing Infisical project
  (vs. creating fresh) is the most recently modified part of the implementation. The last several
  commits are all fixing adoption metadata handoff, suggesting this path is the least settled.
- **Replay correctness.** The invariant that a Infisical-admitted run replays against Infisical even after
  the deployment switches to Infisical (and vice versa) is subtle. Any change that touches admitted
  reference serialization or replay selection must preserve this.
- **Token and secret leakage.** Universal Auth client secrets and Infisical access tokens must never
  appear in records, logs, snapshots, diagnostics, or thrown errors. Centralized redaction helpers
  exist, but every new error path must route through them.
- **Protected/shared worker boundary.** The distinction between fixture mode accepted
  (`VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1`) and rejected (production) must be enforced uniformly across
  all worker entry points. Any provider or worker addition that creates a new secret-resolution entry
  point must go through the generic runtime helper, not the Infisical adapter directly.

## Trade-offs

- **Universal Auth only.** Limiting the first release to Universal Auth (machine identity) as the
  sole Infisical workload credential source keeps the surface minimal and avoids ambient CLI session
  or personal token leakage. The cost is that operators must provision machine identities before any
  live Infisical-backed deployment can run.
- **No `sync` command.** Infisical project, environment, machine identity, membership, and
  placeholder creation is intentionally left as an operator-owned external task. The tooling provides
  read-only `deploy admin infisical plan` and `deploy admin infisical check` only. This keeps the
  repo from becoming a shadow Infisical admin plane, but means operators cannot fully bootstrap from
  this repo alone without manual Infisical setup steps.
- **Deployment-wide backend selection.** The first release does not support per-requirement mixed
  backends in a single deployment. A deployment is either fully Infisical or fully Infisical. This
  simplifies admission and replay but means a deployment cannot split some secrets to Infisical while
  keeping others in Infisical.
- **No imported secret/reference expansion.** `expandSecretReferences=false` and
  `includeImports=false` are sent on every Infisical secret read. Cross-secret reference expansion
  would add significant complexity to admitted reference semantics.

## Considerations

- The `infisical_runtime` allowed key set (enforced in `deployment-secret-profile.ts`) is the gate
  against secret-looking keys entering reviewed deployment metadata. Any new runtime field must be
  added to `ALLOWED_INFISICAL_RUNTIME_KEYS` explicitly and must not carry secret material.
- `SprinkleRefInfisicalStore` (`sprinkleref-infisical.ts`) is the store used by the `sprinkleref`
  CLI for repo-level secret management. Its `--category bootstrap` path resolves credentials from
  a non-Infisical backend (macOS Keychain or local file) to avoid a circular dependency where
  Infisical credentials are themselves stored in Infisical.
- The `infisical-bootstrap.ts` IaC tool is a separate operator-facing script from the deployment
  secret runtime. It handles one-time project provisioning, resolver profile materialization, and
  deployment fan-out. It is not invoked during normal deploy flows.
- Admitted Infisical references freeze non-secret replay data (`projectId`, `environment`,
  `secretPath`, `secretName`, `resolvedVersion`, `referenceId`, `backendRef`, `selectorRef`).
  No secret value, token, or expanded reference is stored in any admission record or execution
  snapshot. This must be verified whenever the admitted reference schema is changed.
- The `deploy auth explain-infisical-identity` and `deploy admin infisical check` commands are
  read-only diagnostics that operators can run safely before a first live deployment. The check
  command calls Infisical with `viewSecretValue=false` throughout.
- Once this work stabilizes, task `05-auth-provisioning-iac` should evaluate whether its produced
  auth secrets (WorkOS client secrets, Supabase service keys, etc.) should be routed to Infisical,
  which would make this backend directly on the critical path for that task.
