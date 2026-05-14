# Infisical Deployment Secrets Design

This document proposes how to add Infisical as a deployment secrets provider
alongside Vault.

The goal is provider parity, not provider replacement:

- existing Vault-backed deployments keep working
- new or migrated deployments may use Infisical
- provider code continues to consume secrets through the `SprinkleRef` and
  deployment secret runtime abstraction
- deployment metadata and replay records keep stable non-secret references, not
  secret values

## Source Context

This proposal is based on the current deployment and secret model documented in:

- [Deployment And Secrets API](deployment-secrets-api.md)
- [Secrets Usage](secrets-usage.md)
- [Deployments Design](deployments-design.md)
- [Deployments Usage](deployments-usage.md)
- [Build System Design](../build-tools/docs/build-system-design.md)

It also uses Infisical's public API model as of May 11, 2026:

- Universal Auth exchanges a machine identity client id and client secret for a
  short-lived API access token through `/api/v1/auth/universal-auth/login`.
- Secret retrieval is available through `GET /api/v4/secrets/{secretName}` with
  `projectId`, `environment`, `secretPath`, optional `version`, and
  `viewSecretValue` query parameters.
- Secret read responses include non-secret identity fields such as `id`,
  `version`, `environment`, `secretPath`, timestamps, metadata, and the
  secret-bearing `secretValue`.

Those Infisical API details belong inside the Infisical backend adapter. Provider
publishers, provisioners, smoke runners, release actions, and deployment
admission code should continue to talk to the repo-level secret runtime.

## Non-Goals

- Do not replace Vault or delete Vault-specific bootstrap, admin, or runtime
  flows.
- Do not make deployment provider code call Infisical or Vault directly.
- Do not persist Infisical access tokens, Universal Auth client secrets,
  secret values, expanded secret references, or rendered secret-bearing config
  in deployment records.
- Do not use ambient provider credentials or ambient Infisical CLI sessions as
  the deployment secret source.
- Do not introduce a second secret declaration surface parallel to
  `secret_requirements`.

## Current Shape

The current implementation already has most of the right internal layering:

- `deployment-sprinkle-ref.ts` defines `DeploymentSecretReference`,
  `DeploymentSecretAdmittedReference`, and backend-qualified `referenceId`
  strings.
- `deployment-secret-runtime.ts` defines a generic `DeploymentSecretBackend`
  interface with `acquire(...)` and optional `renew(...)`.
- `deployment-secret-vault.ts` adapts Vault and the local/test fixture into that
  generic runtime.
- `deployment-secret-admission.ts` currently delegates admission reference
  resolution to Vault.
- Provider code mostly calls `createVaultDeploymentSecretRuntime(...)`, then
  `runtime.enterStep("publish")`, `runtime.enterStep("provision")`, or another
  reviewed lifecycle step.

The main abstraction gap is naming: the runtime is generic, but the public helper
and several type names still say Vault. Infisical should be added by making the
backend selection explicit while preserving Vault-compatible helper aliases for
existing callers.

## Target Model

The repo should model three layers:

1. `SprinkleRef` contract layer
   Deployment metadata declares stable `secret://deployments/...` contract ids
   in `secret_requirements`.

2. Admitted reference layer
   Admission freezes the backend, target scope, backend-native selector, exact
   version when available, refresh mode, credential class, and resolution time.

3. Backend adapter layer
   Vault and Infisical each translate a `SprinkleRef` contract into backend API
   calls and return `DeploymentSecretMaterial` to the generic runtime.

Provider implementations consume only layer 1 and layer 2 through the existing
runtime surface. They should never branch on whether the backend is Vault or
Infisical.

## Public Contract Changes

### Secret Backend Kind

Widen the secret backend kind:

```ts
export type DeploymentSecretBackendKind = "vault" | "infisical";
```

The default should remain `"vault"` for compatibility until a deployment
explicitly selects Infisical.

`DeploymentSecretContractBinding.referenceId` should continue to be
backend-qualified:

```text
vault:secret://deployments/pleomino/cloudflare_api_token
infisical:secret://deployments/pleomino/cloudflare_api_token
```

Admitted references should also keep backend-qualified replay identifiers:

```text
vault:secret/deployments/pleomino/cloudflare_api_token@3
infisical:<projectId>/<environment>/<secretPath>/<secretName>@<version>
```

The exact Infisical selector string can be implementation-defined, but it must be
stable, non-secret, and sufficient for exact replay.

### Secret Runtime Helper

Add a provider-neutral helper:

```ts
createDeploymentSecretRuntimeForAdmittedContext({
  authority,
  admittedContext,
  fallbackTargetScope,
  secretContext,
});
```

This helper selects the backend from admitted references first, then from
deployment metadata, then from the default backend. Existing
`createVaultDeploymentSecretRuntime(...)` should remain as a compatibility alias
that forces or defaults to Vault.

Provider code should migrate toward the neutral helper name over time:

```ts
const secretRuntime = createDeploymentSecretRuntimeForAdmittedContext({
  admittedContext,
  secretContext,
});

const publishSecrets = await secretRuntime.enterStep("publish");
```

The helper should fail closed if one runtime invocation would mix incompatible
backends for the same admitted context. Multi-backend support inside one
deployment can be designed later, but the first Infisical integration should keep
one deployment secret backend per admitted context.

## Deployment Metadata

### Backend Selection

Add an optional `secret_backend` metadata field:

```python
secret_backend = "infisical"
```

Allowed values:

- `"vault"`
- `"infisical"`

Omitted means `"vault"` for compatibility. Extractors should normalize the field
onto the deployment contract as `secretBackend`.

This field answers only which backend satisfies `secret_requirements`. It does
not change contract ids, lifecycle steps, target scopes, or provider credential
rules.

### Infisical Runtime Metadata

Add an optional `infisical_runtime` metadata dictionary, analogous to
`vault_runtime`:

```python
infisical_runtime = {
    "site_url": "https://app.infisical.com",
    "project_id": "<infisical-project-id>",
    "environment": "staging",
    "secret_path": "/deployments/pleomino",
    "machine_identity_client_id_env": "VBR_INFISICAL_CLIENT_ID",
    "machine_identity_client_secret_env": "VBR_INFISICAL_CLIENT_SECRET",
    "preferred_credential_source": "machine_identity_universal_auth",
}
```

Allowed non-secret keys:

- `site_url`: Infisical API base URL. Examples: `https://app.infisical.com`,
  `https://us.infisical.com`, `https://eu.infisical.com`, or a reviewed
  self-hosted URL. The implementation should validate the configured base URL
  against the exact Infisical endpoints it uses because Infisical's docs show
  different cloud host examples for auth and secret-read paths.
- `project_id`: Infisical project id. This is routing metadata, not a secret.
- `environment`: Infisical environment slug, such as `dev`, `staging`, or
  `prod`.
- `secret_path`: default Infisical secret path for this deployment's contracts.
- `secret_path_prefix`: optional prefix used by the contract-to-secret-name
  mapper when deployments split secrets across folders.
- `machine_identity_client_id_env`: environment variable that holds the
  Universal Auth client id if the id is not carried directly as non-secret host
  config.
- `machine_identity_client_secret_env`: environment variable that holds the
  Universal Auth client secret.
- `machine_identity_id`: optional non-secret identity id for diagnostics and
  admin reconciliation.
- `preferred_credential_source`: initially
  `machine_identity_universal_auth`.
- `access_token_ttl_seconds`: optional expected token TTL for diagnostics and
  renewal scheduling. The runtime must trust the login response over this value.
- `access_token_max_uses`: optional expected max-use policy for diagnostics.

Forbidden values:

- Universal Auth client secrets
- Infisical access tokens
- personal tokens
- service tokens
- exported `.env` content
- secret values or rendered provider config

For deployments with `secret_backend = "infisical"` and non-empty
`secret_requirements`, validation should require `infisical_runtime.site_url`,
`project_id`, `environment`, `machine_identity_client_id_env`,
`machine_identity_client_secret_env`, and a reviewed credential source unless
the local/test fixture override is active.

### Contract To Infisical Secret Mapping

The preferred default mapping should be deterministic and reviewable:

- `contractId`: `secret://deployments/pleomino/cloudflare_api_token`
- `secret_path`: `/deployments/pleomino`
- `secretName`: `cloudflare_api_token`

The backend adapter should derive:

```text
projectId = infisical_runtime.project_id
environment = infisical_runtime.environment
secretPath = infisical_runtime.secret_path
secretName = final path segment of contractId
```

If this is too limiting for existing Infisical layouts, add an optional
reviewed mapping surface:

```python
infisical_secret_mappings = {
    "secret://deployments/pleomino/cloudflare_api_token": {
        "secret_path": "/cloudflare/pleomino",
        "secret_name": "CLOUDFLARE_API_TOKEN",
    },
}
```

Mapping entries must be non-secret. They must be validated against declared
`secret_requirements`; stale mappings should fail validation so drift does not
accumulate.

## Infisical Backend Adapter

Add `deployment-secret-infisical.ts` with the same responsibilities as
`deployment-secret-vault.ts`:

- resolve admitted references for initial admission
- acquire secret material at runtime
- reacquire or renew where supported
- honor the fixture override for local/test flows
- fail closed on missing, revoked, deleted, expired, or non-exact replay
  references

Suggested exported functions:

```ts
export async function resolveDeploymentInfisicalAdmittedReferences(opts: {
  requirements: DeploymentRequirement[];
  targetScope: string;
  secretContext?: DeploymentSecretContext;
  runtime: DeploymentInfisicalRuntimeConfig;
}): Promise<DeploymentSecretAdmittedReference[]>;

export function createDeploymentInfisicalSecretBackend(opts: {
  secretContext?: DeploymentSecretContext;
  runtime: DeploymentInfisicalRuntimeConfig;
}): DeploymentSecretBackend;
```

### Admission Read

For each required binding, admission should:

1. derive the Infisical secret selector from contract id plus runtime metadata
2. authenticate using the active deployment secret context
3. call Infisical with `viewSecretValue=false` when that is sufficient to obtain
   `id`, `version`, `environment`, `secretPath`, and metadata
4. if Infisical cannot return usable version metadata without the value, call
   the ordinary read endpoint but discard `secretValue` immediately after
   constructing the admitted reference
5. freeze a `DeploymentSecretAdmittedReference`

Admitted reference example:

```json
{
  "name": "cloudflare_api_token",
  "step": "publish",
  "contractId": "secret://deployments/pleomino/cloudflare_api_token",
  "required": true,
  "backend": "infisical",
  "referenceId": "infisical:proj_123/staging/deployments/pleomino/cloudflare_api_token@17",
  "targetScope": "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
  "backendRef": "proj_123/staging/deployments/pleomino/cloudflare_api_token",
  "selectorRef": "proj_123/staging/deployments/pleomino/cloudflare_api_token@17",
  "resolvedVersion": "17",
  "resolvedAt": "2026-05-11T12:00:00.000Z",
  "refreshMode": "none",
  "credentialClass": "routine"
}
```

The reference must not include `secretValue`, bearer tokens, Universal Auth
client secrets, or expanded imported secret values.

### Runtime Acquire

For non-admitted first-use local paths, the adapter may read the latest matching
secret. For protected/shared admitted paths, it must read the exact admitted
version:

```text
GET /api/v4/secrets/{secretName}
  ?projectId=<projectId>
  &environment=<environment>
  &secretPath=<secretPath>
  &version=<resolvedVersion>
  &viewSecretValue=true
```

The returned response must satisfy:

- the backend secret id, project, environment, path, name, and version match the
  admitted selector
- `secretValue` is a string
- the secret is not marked deleted, revoked, or otherwise unavailable by fields
  the API exposes
- imported secret expansion behavior is explicit

Recommended request defaults:

- `viewSecretValue=true` only during runtime acquire
- `expandSecretReferences=false` unless a deployment explicitly designs and
  reviews expansion semantics
- `includeImports=false` unless a deployment explicitly designs and reviews
  imported secret semantics
- `type=shared`

### Refresh Semantics

Vault currently freezes KV versions and defaults to `refreshMode: "none"` for
direct reads. Infisical should use:

- `refreshMode: "none"` for exact admitted static secret versions
- `refreshMode: "reacquire"` for short-lived dynamic secrets or a future
  Infisical dynamic-secret integration where the backend intentionally issues a
  new credential
- `refreshMode: "renew"` only if the adapter has a concrete Infisical API for
  renewing the same credential lease

The first implementation should use `"none"` for ordinary static secrets.

## Credential Context

Widen `DeploymentSecretContext`:

```ts
export type DeploymentSecretContext =
  | { kind: "fixture" }
  | { kind: "vault"; credential: VaultCredentialConfig }
  | { kind: "infisical"; credential: InfisicalCredentialConfig };
```

Suggested credential config:

```ts
export type InfisicalCredentialConfig =
  | {
      kind: "universal_auth";
      siteUrl: string;
      clientId: string;
      clientSecret: string;
    }
  | {
      kind: "access_token";
      siteUrl: string;
      accessToken: string;
      expiresAt?: string;
    };
```

`access_token` is for in-memory handoff inside a reviewed worker process after a
safe login flow. It must not become an operator-facing ambient env contract.

Add `deployment-secret-infisical-credentials.ts` to:

- exchange Universal Auth client id and client secret for an access token
- cache access tokens in memory only, keyed by site URL and identity
- respect token expiry from the login response
- reacquire a token on expiry
- never write tokens or client secrets to `.local`, logs, records, or
  `process.env`

## Credential Source Selection

Infisical credential-source selection should mirror the Vault policy shape but
not inherit Vault-specific names.

Add a provider-neutral credential source layer:

```ts
type DeploymentSecretCredentialSource =
  | "vault_interactive_pkce"
  | "vault_interactive_device"
  | "vault_interactive_print_url"
  | "vault_jenkins_client_secret"
  | "vault_jenkins_oidc"
  | "vault_external_oidc_token"
  | "infisical_machine_identity_universal_auth";
```

Implementation can keep Vault's current source names internally for
compatibility, but the design should move new code toward backend-qualified
source names to avoid claiming that Infisical uses Vault JWT auth.

For the first Infisical release:

- local direct deploys may use Universal Auth only when explicitly configured
  through reviewed environment variable names from `infisical_runtime`
- protected/shared workers may use only server-local Universal Auth credential
  references
- client-submitted Infisical tokens, client-submitted secret values, ambient
  Infisical CLI sessions, and personal tokens are rejected
- interactive human login continues to authorize the deploy request; it is not
  forwarded as the Infisical workload credential

## Admission And Replay

`deployment-secret-admission.ts` should dispatch by backend:

```ts
resolveInitialAdmittedSecretReferences({
  backend: deployment.secretBackend,
  requirements,
  targetScope,
  secretContext,
  vaultRuntime,
  infisicalRuntime,
});
```

Rules:

- initial admission resolves fresh references against the target deployment's
  selected backend
- retry and rollback reuse the source run's recorded admitted references
- promotion selects a control-plane admitted source run and artifact, then
  resolves new admitted references from the target deployment's current metadata
- replay fails closed if an admitted reference cannot be resolved exactly
- replay must not silently substitute latest Infisical values after rotation
- a replay that recorded `backend: "vault"` continues using Vault, even if the
  current deployment metadata now says `secret_backend = "infisical"`
- a replay that recorded `backend: "infisical"` continues using Infisical

This last rule is important for migration. Backend migration changes future
admissions, not the meaning of old runs.

## Fixture Compatibility

Keep `VBR_DEPLOYMENT_SECRET_FIXTURE_PATH` provider-neutral. The existing fixture
schema already keys by `contractId` and carries the policy fields the runtime
needs:

- `value`
- `allowedSteps`
- `targetScopes`
- `refreshMode`
- `credentialClass`
- optional version/selector fields

The fixture path should override both Vault and Infisical for local/test flows.
The backend-specific admitted `referenceId` generated from a fixture can remain
synthetic, but it should use the selected backend kind:

```text
infisical:fixture:secret://deployments/pleomino/cloudflare_api_token@fixture-v1
```

Protected/shared workers should continue rejecting fixture use except in explicit
local fixture service mode.

## Admin And Diagnostics

Do not overload `deploy admin vault ...` for Infisical.

Add:

```bash
deploy auth explain-secret-backend --deployment <label>
deploy auth explain-infisical-identity --deployment <label>
deploy admin infisical plan --deployment <label>
deploy admin infisical check --deployment <label>
```

Optional later:

```bash
deploy admin infisical sync --deployment <label>
```

`plan` should be local and read-only. `check` should read live Infisical state
and verify:

- project exists
- environment exists
- machine identity has project access
- each declared contract maps to an existing secret or approved placeholder
- the identity can read metadata for required secrets
- optional exact permissions match the reviewed policy if Infisical exposes
  enough API to inspect them

`sync` should not be part of the first implementation unless we are comfortable
letting repo tooling mutate Infisical identities, project memberships, roles, and
secret placeholders. If added later, it must be idempotent and admin-token
backed, like the Vault admin flow.

Diagnostics must print only safe routing data:

- backend kind
- site URL
- project id
- environment
- secret path
- machine identity id or client id name when safe
- credential source name
- missing env var names
- mapped contract ids and secret names

Diagnostics must not print:

- Universal Auth client secrets
- access tokens
- secret values
- expanded secret references
- Infisical personal tokens

## Migration Strategy

Migration should be per deployment, not global.

Recommended sequence for one deployment:

1. create Infisical project/environment/path and machine identity
2. copy the current Vault secret values into Infisical using the same
   `secret://deployments/...` contract ids as the reviewed source of truth
3. add `secret_backend = "infisical"` and `infisical_runtime = {...}` to the
   deployment metadata
4. run read-only validation and `deploy auth explain-secret-backend`
5. run an admission-only or validate-only flow that proves admitted references
   are Infisical references
6. perform a normal deployment
7. keep Vault entries until rollback/retry windows for old Vault-admitted runs
   expire

Do not delete Vault secrets at the same time the deployment switches future
admissions to Infisical. Old run replay can still need Vault exact versions.

## Validation Rules

Add validation for:

- unsupported `secret_backend`
- `secret_backend = "infisical"` with missing `infisical_runtime` when
  `secret_requirements` is non-empty
- `secret_backend = "vault"` with missing existing Vault requirements when
  secrets are required and fixture is inactive
- stale `infisical_secret_mappings` entries that do not correspond to declared
  requirements
- declared Infisical mappings with empty `secret_name` or invalid `secret_path`
- use of Infisical runtime metadata containing forbidden key names such as
  `token`, `secret_value`, `client_secret`, or obvious secret material
- provider code importing `deployment-secret-infisical*` directly outside the
  backend/runtime layer

Validation should preserve the existing rule that provider credentials are
declared through `secret_requirements` and resolved by lifecycle step.

## Build-System Fit

This feature is deployment tooling, not an artifact-producing build route.

Build-system implications:

- TypeScript tooling remains under `build-tools/tools/deployments`.
- Thin CLI shims, if any, should delegate to zx TypeScript.
- Buck metadata extraction must include `secret_backend`,
  `infisical_runtime`, and optional `infisical_secret_mappings` in the queried
  attrs.
- Deployment target macros should pass those fields as metadata only. They
  should not run Infisical during Buck builds.
- Tests should be ordinary deployment tooling tests with fake Infisical HTTP
  servers, mirroring the current fake Vault server style.

No Nix dynamic-derivation planner changes should be needed because live secret
resolution is outside artifact-producing Buck actions.

## Test Coverage Expectations

The implementation plan should include tests for:

- `DeploymentSecretBackendKind` accepts Vault and Infisical
- default omitted backend remains Vault
- Infisical admission freezes exact non-secret references and versions
- runtime acquire reads the admitted Infisical version, not latest
- retry and rollback reuse old admitted backend references
- metadata migration to Infisical does not reinterpret old Vault runs
- fixture override works for Infisical local/test flows
- protected/shared worker rejects fixture use outside local fixture mode
- Infisical client secrets and access tokens are redacted from errors and logs
- optional requirements are skipped when missing, required requirements fail
  closed
- target scope and lifecycle step checks remain backend-independent
- break-glass credential class behavior remains enforced by the generic runtime
- diagnostics print routing metadata but no secret material

## Open Design Decisions

These should be answered before implementation planning:

- Should `secret_backend` be deployment-wide only for the first release, or do
  we need per-requirement backend selection immediately?
- Do we want to support Infisical imported secrets and secret-reference
  expansion, or require direct shared secrets only?
- Should Infisical secret names preserve the repo's snake_case names or map to
  uppercase environment-style names by convention?
- Do we need admin `sync`, or is read-only `plan` and `check` enough for the
  initial integration?
- Which Infisical auth modes beyond Universal Auth are required later for
  `mini` or cloud-native workers? Jenkins should normally submit artifacts and
  provenance to the control plane rather than hold Infisical workload
  credentials, unless a future Jenkins-hosted worker mode is explicitly
  designed.

The conservative recommendation is deployment-wide backend selection, direct
shared secrets only, deterministic snake_case default names from contract ids,
read-only admin checks for the first release, and Universal Auth as the only
initial Infisical workload credential source.

## External References

- Infisical Universal Auth:
  <https://infisical.com/docs/documentation/platform/identities/universal-auth>
- Infisical API authentication overview:
  <https://infisical.com/docs/api-reference/overview/authentication>
- Infisical secret retrieve endpoint:
  <https://infisical.com/docs/api-reference/endpoints/secrets/read>
