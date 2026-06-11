# Secrets Usage

This is the top-level guide for the deployment secrets workflow.

If you are new here, the key idea is simple:

- the repo stores the names of required secrets
- the repo does not store the secret values
- the secret values are loaded at runtime from the configured backend

Use this guide when you want the shortest path to:

- understand what `SprinkleRef` means
- know when a deployment should declare `secret_requirements`
- resolve secrets at runtime through the selected Vault or Infisical backend and
  the backend-neutral metadata contract
- bootstrap the selected production secret backend and, when needed, export the
  reviewed local/test secret fixture format
- find the right API reference or deeper design doc

## Reviewed Front Door

The main public surface is the `SprinkleRef` layer described in
[Deployment And Secrets API](deployment-secrets-api.md).

For day-to-day operator deployment flows, start with
[Deployments Usage](deployments-usage.md).

For secret-runtime integration and public helper signatures, open
[Deployment And Secrets API](deployment-secrets-api.md).

For production Vault bring-up and the optional local/test export bridge into
`VBR_DEPLOYMENT_SECRET_FIXTURE_PATH`, open
[Vault Production Bootstrap Runbook](vault-production-bootstrap.md).
For Infisical-backed deployments, use the deployment context's reviewed
`infisical_runtime` metadata and the repo's Infisical setup docs.

## Plain-Language Glossary

- `SprinkleRef`: the stable way this repo names a required secret without
  storing the secret value
- `secret_requirements`: the list of secrets a deployment needs
- contract id: the stable name of one secret, such as
  `secret://deployments/pleomino/cloudflare_api_token`
- admitted secret reference: the frozen non-secret replay/runtime metadata
  captured during admission for one resolved secret contract
- secret fixture: the reviewed local/test override file format named by
  `deployment-secret-fixture@1`
- `secret_backend`: the deployment-wide backend selector for
  `secret_requirements`; deployment contexts may supply the default selector
- Vault: a supported backend that stores real secret values
- Infisical: a supported backend selected with
  `secret_backend = "infisical/default"`

## How The Layers Fit Together

- `SprinkleRef` is the contract layer that names required secrets in repo-owned
  metadata.
- admitted secret references are the replay/runtime reference layer that freezes
  the exact non-secret resolution details for one run.
- Vault and Infisical are supported production backends that store and serve real
  secret values.
- Infisical is selected per deployment with reviewed non-secret
  `infisical_runtime` routing metadata; Vault uses reviewed `vault_runtime`
  metadata.
- the secret fixture is the local/test/bootstrap override format for
  non-production flows that intentionally do not read Vault directly.

## Core Model

- deployments declare `secret_requirements`, which are names of needed secrets
- admission freezes admitted secret references, not secret values
- runtime secret values are resolved only when a lifecycle step actually needs
  them
- callers use the stable `SprinkleRef` layer instead of coding directly to the
  selected backend
- Infisical metadata names reviewed Universal Auth credential environment
  variable names. The selected source is
  `infisical_machine_identity_universal_auth`; Infisical CLI sessions, personal
  tokens, client-submitted access tokens, client-submitted secret values, and
  raw client secrets are not allowed in deployment metadata or request payloads.
- Infisical admission stores exact non-secret selectors and versions. Runtime
  acquire reads the admitted version, verifies the returned project,
  environment, path, name, id when present, and version, then returns the secret
  value only through the deployment secret runtime.
- external provider credentials are never satisfied from ambient provider
  environment variables such as local CLI tokens; they must be declared as
  `secret_requirements` and resolved by the secret runtime

## Quick Start

Declare secret requirements in deployment metadata. Keep the contract IDs stable
over time so old runs can still be understood:

```ts
{
  name: "cloudflare_api_token",
  step: "publish",
  contractId: "secret://deployments/pleomino/cloudflare_api_token",
  required: true,
}
```

For local development, isolated tests, or an explicit bootstrap-oriented
workflow, point the runtime at a reviewed fixture file:

```bash
export VBR_DEPLOYMENT_SECRET_FIXTURE_PATH="$PWD/secret-fixture.json"
```

Then use the runtime helper described in
[Deployment And Secrets API](deployment-secrets-api.md):

```ts
const runtime = createDeploymentSecretRuntimeForAdmittedContext({
  admittedContext: {
    secretRequirements: requirements,
    targetEnvironment: {
      lockScope: "cloudflare-pages:web-platform-staging/pleomino-staging-pages",
    },
  },
});

const publishSecrets = await runtime.enterStep("publish");
```

Before bootstrap, deployment admission, or CI validation, run a read-only
SprinkleRef reference check to find missing or unmapped deployment contract refs:

```bash
sprinkleref --check
sprinkleref --check --target //projects/deployments/pleomino/staging:deploy
```

The checker inventories `secret://`, `config://`, and `runtime://` refs without
printing secret values. Add `--config <resolver.json>` when you want
`secret://` refs presence-checked against a concrete resolver backend; otherwise
secret refs are reported as intentionally unchecked.

In this example, `targetEnvironment.lockScope` is the exact value the runtime
checks against `targetScopes`. Operators should treat that `lockScope` value as
the source of truth for the right target scope string.

To select Infisical for a deployment, set `secret_backend = "infisical/default"`
and provide non-secret `infisical_runtime` routing metadata:

```python
secret_backend = "infisical/default"
infisical_runtime = {
    "site_url": "https://app.infisical.com",
    "project_id": "proj_123",
    "environment": "prod",
    "secret_path": "/deployments/pleomino",
    "preferred_credential_source": "infisical_machine_identity_universal_auth",
    "machine_identity_client_id_env": "INFISICAL_CLIENT_ID",
    "machine_identity_client_secret_env": "INFISICAL_CLIENT_SECRET",
}
```

By default, `secret://deployments/pleomino/cloudflare_api_token` resolves to
Infisical secret name `cloudflare_api_token` under the configured
`secret_path`. When `infisical_runtime.secret_path_prefix` is set and no
mapping path override exists, the runtime appends the normalized prefix to
`secret_path` before admitting or acquiring the secret. Precedence is explicit:
`infisical_secret_mappings[contract].secret_path` wins first, then
`infisical_runtime.secret_path` plus optional `secret_path_prefix`, then `/`.
Leading and trailing slashes are normalized so selectors do not contain duplicate
path separators. Use `infisical_secret_mappings` only for reviewed non-secret
path or name overrides:

```python
infisical_secret_mappings = {
    "secret://deployments/pleomino/cloudflare_api_token": {
        "secret_path": "/shared/cloudflare",
        "secret_name": "api-token",
        "approved_placeholder": "true",
        "placeholder_reason": "operator approved before first live value",
    },
}
```

Use `approved_placeholder` only for a reviewed setup gap before the first live
value exists. Without that reviewed flag, `deploy admin infisical check` reports
a missing mapped secret as out of sync.

The fixture override remains provider-neutral:
`VBR_DEPLOYMENT_SECRET_FIXTURE_PATH` overrides both Vault and Infisical for
explicit local/test flows. Secret-consuming Infisical deployments otherwise
require reviewed `machine_identity_client_id_env` and
`machine_identity_client_secret_env` names in `infisical_runtime` during
metadata extraction. Protected/shared hosted services reject this fixture
override unless `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1` marks an explicit local
fixture service. Infisical fixture admissions use
`infisical:fixture:` reference IDs and do not require an Infisical-specific
fixture environment variable.

## External Deployment Contract IDs

Use stable reviewed contract IDs for external dependencies:

- WorkOS/AuthKit public config: `config://deployments/workos/...`
- WorkOS/AuthKit secrets: `secret://deployments/workos/...`
- Supabase public URL: `config://deployments/supabase/public_url/...`
- Supabase privileged credentials: `secret://deployments/supabase/...`
- Ragie API credentials: `secret://deployments/ragie/...`
- Source Access signing/HMAC material:
  `secret://deployments/source-access/...`
- console-to-web base URL: `config://deployments/console/web_base_url/...`
- provider tokens for Cloudflare, Vercel, container runtime, DNS, and OpenTofu:
  `secret://deployments/<provider>/...`
- OpenTofu provider credentials use
  `opentofu_provider_credentials` at step `provision` with contract id
  `secret://deployments/opentofu/provider`. Backend credentials follow the same
  step and contract namespace and must never be sourced from ambient process
  environment.
- Kubernetes/container-runtime publish credentials (for example a generated
  kubeconfig secret, service-account token, or control-plane-issued short-lived
  credential reference) use `kubernetes_publish_kubeconfig` at step `publish`
  with contract id `secret://deployments/kubernetes/<cluster>/<namespace>/...`.
  Protected/shared Kubernetes service deployments must declare publish-step
  `secret_requirements` and may not rely on ambient Helm or cluster
  environment state.
- Platform GitHub App private keys use `github_app_private_key` at step
  `publish` with contract id
  `secret://deployments/<deployment-id>/github/app_private_key`. Optional
  webhook verification secrets use `github_webhook_secret` with
  `secret://deployments/<deployment-id>/github/webhook_secret`. Both resolve
  only through the deployment secret runtime; ambient `GITHUB_*` environment
  variables are not accepted.

Live checked-in deployment packages currently use Pleomino-owned reviewed
contract namespaces. Future deployment families should introduce their own
`secret://deployments/<family>/<deployment-id>/...` and
`runtime://deployments/<family>/<deployment-id>/...` namespaces only in the plan
PR that approves the family as a real deployment surface.

Keep each requirement step-specific. Provider publish tokens belong to
`publish`, provisioning credentials belong to `provision`, preview cleanup
credentials belong to `preview_cleanup`, and smoke-only credentials belong to
`smoke`.

Foundation schema migration fixtures use the Supabase service-role credential
only at the `provision` step. Deploy records may retain the credential env name
and contract reference, but never the resolved service-role value.

## End-To-End Example

This example shows the full path for one secret on a Cloudflare Pages
deployment, from deployment metadata to runtime use.

### What This Example Covers

We will:

1. declare a secret in deployment metadata
2. set up the currently documented Vault-backed secret source
3. run the deployment
4. explain what the system does with that secret at runtime

### Step 1: Add The Secret To The Deployment

Add a `secret_requirements` entry to the deployment's `TARGETS` definition.

Example:

```python
cloudflare_pages_static_webapp_deployment(
    name = "deploy",
    component = "//projects/apps/pleomino:app",
    account = "web-platform-staging",
    project = "pleomino-staging-pages",
    lane_policy = "//projects/deployments/pleomino/shared:lane",
    environment_stage = "staging",
    admission_policy = "//projects/deployments/pleomino/shared:staging_release",
    protection_class = "shared_nonprod",
    secret_requirements = [
        {
            "name": "cloudflare_api_token",
            "step": "publish",
            "contract_id": "secret://deployments/pleomino/cloudflare_api_token",
            "required": "true",
        },
        {
            "name": "cloudflare_api_token",
            "step": "preview_cleanup",
            "contract_id": "secret://deployments/pleomino/cloudflare_api_token",
            "required": "true",
        },
    ],
    runtime_config_requirements = [],
)
```

What the fields mean:

- `name`: the local name of the secret inside this deployment
- `step`: when the secret is required, such as `publish`, `preview_cleanup`,
  `smoke`, or `provision`
- `contract_id`: the stable repo-level name of the secret
- `required`: whether the deployment must stop if that secret is missing

Common example values and when to use them:

- `name = "cloudflare_api_token"`
  Use a short, readable name that tells an operator what the secret is for.
  Good examples are `cloudflare_api_token`, `database_url`, or
  `app_store_connect_key`.
- `step = "publish"`
  Use this when the secret is needed to push a release to a provider. This is
  the most common choice for provider API tokens.
- `step = "preview_cleanup"`
  Use this when the secret is needed to delete provider preview resources.
- `step = "provision"`
  Use this when the secret is needed only while creating or updating
  infrastructure.
- `step = "smoke"`
  Use this when the secret is needed only for post-deploy checks, such as an
  authenticated health check.
- `step = "release_actions.pre_publish"`
  Use this when a custom pre-publish release action needs the secret.
- `step = "release_actions.post_publish_pre_smoke"`
  Use this when a post-publish action needs the secret before smoke checks run.
- `step = "release_actions.post_smoke"`
  Use this when a post-smoke action needs the secret.
- `contract_id = "secret://deployments/pleomino/cloudflare_api_token"`
  Use a stable, descriptive ID. It should stay the same even as the secret
  value rotates.
- `contract_id = "secret://deployments/console/vercel_api_token"`
  Use `name = "vercel_api_token"` for Vercel provider API tokens. Declare it on
  the `publish` step, and add a separate `preview_cleanup` requirement when
  preview cleanup is enabled.
- `contract_id = "secret://deployments/api-staging/cloudflare_api_token"`
  Use `name = "cloudflare_api_token"` for Cloudflare Containers Worker publish
  credentials. Declare it on `provision`, `publish`, and `preview_cleanup` when
  the deployment uses the shared `cloudflare_provider` profile.
- `contract_id = "secret://deployments/api-staging/cloudflare_registry_token"`
  Use `name = "cloudflare_registry_token"` for Cloudflare Containers image
  publish or registry credentials. Declare it on the `publish` step so the
  publisher can push or reference the admitted image through the reviewed
  credential runtime.
- `contract_id = "secret://deployments/demoapp/database_url"`
  Use this kind of shape for app-specific credentials that belong to one
  deployment family. SprinkleRef reports use the effective deployment family:
  explicit `deployment_family` metadata first, then canonical
  `projects/deployments/<family>/...` directory inference.
- `required = "true"`
  Use this when the deployment must stop if the secret is missing.
- `required = "false"`
  Use this only for optional behavior, such as a preview-only credential or an
  optional authenticated smoke check.

Vercel tokens must resolve through the secret runtime. Do not pass them through
ambient shell variables for deployment execution, and do not include token
values in deploy records.

Optional fields you may also see:

- `preview_variant = "isolated-preview"`
  Use this when a secret applies only to a preview deployment variant.
- `notes = "Used only for authenticated smoke checks"`
  Use this for short operator-facing clarification when the purpose is not
  obvious from the name.

### Step 2: Set Up The Secret Backend

For the reviewed production runtime path, use remote Vault with deployment-
derived JWT auth. In local/direct deploys the front door reads the selected
deployment's `vault_runtime` metadata, derives the Vault role and bound claims,
and passes a typed deployment secret context to the secret backend. In
protected service-backed deploys, the laptop client only authenticates and
authorizes the human request; the `mini` worker reads the same non-secret
runtime metadata from the execution snapshot, obtains the workload credential
from server-local credential references, and activates the typed in-memory
secret context only while provider execution is running. Provider code receives
only that explicit context. It does not read Vault JWT files, Vault auth
environment variables, Jenkins credential bindings, OIDC tokens, or client
secrets from ambient `process.env`.

Credential sources are selected from non-secret `vault_runtime` metadata, CLI
flags, and session detection:

- local desktop human deploys default to Authorization Code + PKCE with a
  public CLI client and loopback callback
- SSH/headless human deploys use device authorization when the issuer supports
  it, otherwise the CLI prints a PKCE URL. The default callback stays on
  loopback and can be completed with an SSH forward.
- reviewed shared deploy hosts use service-owned PKCE sessions so the printed
  login URL redirects to `https://deploy-auth.apps.kilty.io/oidc/callback`,
  while nginx forwards that request to the deployment service's private callback
  endpoint. That session authenticates the submitter; it is not forwarded to the
  worker as a Vault workload credential. Use SSH loopback forwarding only for
  deployments without a reviewed public callback profile.
- when device authorization is available, it remains the preferred browserless
  SSH/headless flow.
- Jenkins deploys use either a Jenkins Credentials-bound client secret to mint
  the workload JWT, or a Jenkins/external OIDC token trusted by Vault

For Infisical-backed local/direct and worker-backed deployments, the human login
path only authorizes the deploy request. It is not forwarded as the Infisical
workload credential. The runtime reads `machine_identity_client_id_env` and
`machine_identity_client_secret_env` from `infisical_runtime`, exchanges those
values with Universal Auth in memory, caches the resulting access token only
inside the process until expiry, and reacquires after expiry. Deployments with
non-empty `secret_requirements` must provide both reviewed env-name fields
unless the provider-neutral local/test fixture override is active.

Workload JWTs and Vault tokens are not written to `.local/deploy-vault` and are
not communicated through `process.env`.

Stale ambient variables such as `VBR_VAULT_JWT`, `VBR_VAULT_JWT_FILE`,
`VBR_VAULT_AUTH_METHOD`, and `VAULT_TOKEN` are not the normal runtime contract.
Protected service-backed workers also reject the local/test fixture override,
interactive client credential sources as worker Vault credentials, and
client-submitted secret values. The interactive client session authenticates the
human request to the service; it is not forwarded to the worker as Vault
workload credential material.

Backend migration is per deployment and affects only new admissions. To move a
deployment from Vault to Infisical:

- add `secret_backend = "infisical/default"` and reviewed non-secret
  `infisical_runtime` metadata
- create matching Infisical shared secrets for the existing contract IDs
- run a fresh deploy or promotion so the target admits Infisical references
- keep the old Vault entries until retry and rollback retention windows for
  Vault-admitted runs expire

Retry and rollback replay the recorded admitted references exactly. They do not
reinterpret an old Vault-admitted run as Infisical, and they do not substitute a
new Infisical value after rotation when a recorded version was admitted.

For local development, isolated tests, or explicit bootstrap-oriented
workflows, use the fixture override shown below.

For production secret storage and optional fixture export, use the selected
backend's setup path. Vault-backed deployments use
[Vault Production Bootstrap Runbook](vault-production-bootstrap.md). Infisical-backed deployments use
the reviewed `infisical_runtime` metadata and Infisical setup flow. Export the
secret fixture only when an explicit non-production workflow needs it.

That means:

- you create a file describing the available secrets
- you point the runtime at that file with
  `VBR_DEPLOYMENT_SECRET_FIXTURE_PATH`
- the runtime resolves secrets from that file when the deployment step starts

Create `secret-fixture.json`:

```json
{
  "schemaVersion": "deployment-secret-fixture@1",
  "contracts": {
    "secret://deployments/pleomino/cloudflare_api_token": {
      "value": "super-secret-token",
      "allowedSteps": ["publish"],
      "targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
      "refreshMode": "renew",
      "credentialClass": "routine"
    }
  }
}
```

Then point the deployment runtime at that file:

```bash
export VBR_DEPLOYMENT_SECRET_FIXTURE_PATH="$PWD/secret-fixture.json"
```

What this file does:

- `contracts` is keyed by the same `contract_id` you declared in
  `secret_requirements`
- `value` is the real secret value
- `allowedSteps` limits which lifecycle step may use it
- `targetScopes` limits which deployment target may use it

How to choose `targetScopes`:

- use the deployment's admitted `targetEnvironment.lockScope` value
- in normal deploy flows, that lock scope is usually the same as the deployment
  target's canonical provider target identity
- copy the exact admitted value the system uses rather than reconstructing it by
  hand

Recommended workflow:

1. if the deployment has never run before, get the canonical target identity:

```bash
deploy \
  --deployment //projects/deployments/pleomino/staging:deploy \
  --print-target-identity
```

For normal deploy flows, use that exact string in `targetScopes`.

2. after any real submission, verify the exact admitted value for that run:

```bash
deploy \
  --deployment //projects/deployments/pleomino/staging:deploy \
  --print-run-lock-scope \
  --deploy-run-id "$DEPLOY_RUN_ID"
```

Checked-in Pleomino protected/shared targets select the deployment service
through their `deployment_context` and the referenced `controlPlanes.<name>`
profile. Use `--control-plane-url` or `VBR_DEPLOY_CONTROL_PLANE_URL` only for
commands without deployment context or an explicit reviewed override.

Use that exact `lockScope` value in `targetScopes`.

3. if the two values differ for a special flow, prefer the status value:

- normal deploys usually use the same string for both
- preview, cleanup, rollback, migration, or other non-default flows should be
  verified from the exact run status instead of assumed from memory

Common backend shapes:

- Cloudflare Pages:
  `cloudflare-pages:<account>/<project>`
  Example:
  `cloudflare-pages:web-platform-staging/pleomino-staging-pages`
- Cloudflare Containers:
  `cloudflare-containers:<account_id>/<worker>`
  Example:
  `cloudflare-containers:0123456789abcdef0123456789abcdef/api-staging`
- `nixos-shared-host`:
  `nixos-shared-host:<target-group>:<app>`
  Example:
  `nixos-shared-host:shared-dev:pleomino`
- S3 static:
  `s3-static:<account>/<bucket>`
  Example:
  `s3-static:web-platform/pleomino-staging-site`
- Kubernetes:
  `kubernetes:<cluster>/<namespace>/<release>`
  Example:
  `kubernetes:shared-cluster/web/pleomino`
- App Store Connect:
  `app-store-connect:<issuer>/<app>#track:<track>`
- Google Play:
  `google-play:<developer-account>/<app>#track:<track>`

Copyable example:

```json
"targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"]
```

That value should come from one of the two commands above.

Common fixture fields, example values, and when to use them:

- `"value": "super-secret-token"`
  The real secret value. In real operation this should come from the configured
  backend, not from a checked-in file.
- `"allowedSteps": ["publish"]`
  Use `["publish"]` for provider API tokens that are only needed while
  publishing.
- `"allowedSteps": ["preview_cleanup"]`
  Use `["preview_cleanup"]` for provider API tokens that are only needed while
  deleting preview resources.
- `"allowedSteps": ["smoke"]`
  Use `["smoke"]` for a credential that is only needed for smoke checks.
- `"allowedSteps": ["provision"]`
  Use `["provision"]` for infrastructure-only credentials.
- `"allowedSteps": ["publish", "smoke"]`
  Use multiple steps only when the same credential is intentionally shared
  across both steps.
- `"targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"]`
  Prefer an exact target scope like this for normal operation. This should be
  the deployment's admitted `lockScope` value.
- `"targetScopes": ["*"]`
  Use this only for broad test fixtures or other tightly controlled cases. An
  exact target scope is usually safer.
- `"refreshMode": "renew"`
  Use this when the secret should be renewed in place as it approaches expiry.
- `"refreshMode": "reacquire"`
  Use this when the runtime should fetch a new copy instead of renewing the old
  one.
- `"refreshMode": "none"`
  Use this when the secret is short-lived enough that no refresh behavior is
  needed.
- `"credentialClass": "routine"`
  Use this for normal day-to-day deployment credentials.
- `"credentialClass": "break_glass"`
  Use this only for emergency credentials that should not be available during
  normal operation.

Advanced fixture fields you may see:

- `"expiresAt": "2026-04-16T12:00:00Z"`
  Use this when you want the fixture to behave like an expiring credential.
- `"revoked": true`
  Use this to test or simulate a revoked secret.
- `"renewed": { ... }`
  Use this to describe what the fixture should return after a renew.
- `"reacquired": { ... }`
  Use this to describe what the fixture should return after a reacquire.

Complete example with more explicit choices:

```json
{
  "schemaVersion": "deployment-secret-fixture@1",
  "contracts": {
    "secret://deployments/pleomino/cloudflare_api_token": {
      "value": "super-secret-token",
      "allowedSteps": ["publish"],
      "targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
      "refreshMode": "renew",
      "credentialClass": "routine",
      "expiresAt": "2026-12-31T23:59:59Z"
    },
    "secret://deployments/pleomino/preview_basic_auth_password": {
      "value": "preview-password",
      "allowedSteps": ["smoke"],
      "targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
      "refreshMode": "none",
      "credentialClass": "routine"
    }
  }
}
```

### Step 3: Run The Deployment

Build the app as usual, then run the normal deployment command.

Important note about `--artifact-dir`:

- for a normal deploy, `--artifact-dir` is optional
- if you omit it, the deploy CLI uses the deployment target's component metadata
  to build and find the artifact automatically
- if you include it, you are telling the CLI to use that local build output
  folder as the artifact source instead of auto-resolving the artifact

So the deployment target or macro does provide the source-of-truth artifact
target. `--artifact-dir` is just an operator override for cases where you want
to point at a specific local build output. For protected/shared service-backed
runs, that folder must be staged, uploaded, or admitted through `mini`; the
hosted service must not trust a laptop-local path directly.

Example with an explicit local override:

```bash
deploy \
  --deployment //projects/deployments/pleomino/staging:deploy \
  --artifact-dir ./dist
```

Example without the override:

```bash
deploy \
  --deployment //projects/deployments/pleomino/staging:deploy
```

Use the explicit `--artifact-dir ./dist` form when:

- you already built the app and want to use that exact local folder
- you are writing a hands-on example and want the artifact source to be visible
- you want to avoid ambiguity about which local output is being used

Use the shorter form without `--artifact-dir` when:

- you want the standard repo-driven path
- the deployment metadata already points at the correct component target
- you are happy for the CLI to build and resolve the artifact automatically

### Step 4: What Happens At Runtime

When the deployment reaches the `publish` step, the runtime:

1. reads the deployment's `secret_requirements`
2. looks up `secret://deployments/pleomino/cloudflare_api_token` in the selected
   backend
3. checks that the secret is allowed for the `publish` step
4. checks that the secret is allowed for the target scope
5. allows the publish step to continue only if those checks pass

In plain language: the secret must exist, it must be authorized for this step,
and it must be authorized for this deployment target.

If any of those checks fail, the deployment stops before the protected step
continues.

Here is the same flow with the example values above:

1. the deployment says it needs `cloudflare_api_token`
2. the runtime sees that it is needed for the `publish` step
3. the runtime looks up
   `secret://deployments/pleomino/cloudflare_api_token`
4. the backend returns `super-secret-token`
5. the runtime checks that `publish` is included in `allowedSteps`
6. the runtime checks that
   `cloudflare-pages:web-platform-staging/pleomino-staging-pages` is allowed in
   `targetScopes`
7. the publish step is allowed to continue

That target-scope string is not arbitrary. In the current runtime, it comes
from the deployment's admitted `targetEnvironment.lockScope`.

If the same deployment reached the `smoke` step, that `cloudflare_api_token`
would not be available there unless `allowedSteps` also included `"smoke"`.

### What Gets Stored In Records

The deployment records keep the secret reference:

- `secret://deployments/pleomino/cloudflare_api_token`

They do not store the secret value:

- not `super-secret-token`

This lets the system prove which secret contract was required without writing
the actual secret value into durable records or replay snapshots.

### Current Scope Note

This repo now documents two distinct layers:

- Vault as the long-lived production source of truth in
  [Vault Production Bootstrap Runbook](vault-production-bootstrap.md)
- JWT-first runtime Vault reads for the reviewed production path through
  deployment `vault_runtime` metadata and deployment-derived workload JWTs
- Infisical runtime reads through Universal Auth and reviewed non-secret
  `infisical_runtime` metadata
- the local/test fixture override consumed through
  `VBR_DEPLOYMENT_SECRET_FIXTURE_PATH`

Records and replay snapshots now keep admitted non-secret secret references so
retry and rollback can fetch the same backend version exactly while still never
persisting secret values.

## Auth Diagnostics

Use the auth commands before a protected/shared deploy when setup is uncertain:

```bash
deploy auth doctor --deployment //projects/deployments/pleomino/staging:deploy
deploy auth explain-vault-role --deployment //projects/deployments/pleomino/staging:deploy
deploy auth explain-secret-backend --deployment //projects/deployments/pleomino/staging:deploy
deploy auth explain-infisical-identity --deployment //projects/deployments/pleomino/staging:deploy
deploy auth print-login --deployment //projects/deployments/pleomino/staging:deploy
deploy auth print-jenkins-help --deployment //projects/deployments/pleomino/staging:deploy
```

`deploy auth doctor` is read-only: it reports the selected credential source,
why it was selected, missing Vault metadata, missing Jenkins/OIDC bindings, and
the memory-only session policy without minting tokens, reading secret values, or
calling provider mutation APIs.

`deploy auth explain-vault-role` prints safe routing metadata: issuer, audience,
Vault address, role name, generated policy name, and bound claim names. It does
not print client secrets, JWTs, Vault tokens, PKCE verifiers, device codes, or
Jenkins-bound secret values.

`deploy auth print-login` prints SSH-safe login guidance without launching a
browser. `deploy auth print-jenkins-help` prints the Jenkins `withCredentials`
shape and the selected deployment's credential environment variable names.
`deploy auth explain-secret-backend` and
`deploy auth explain-infisical-identity` print safe backend routing and
Universal Auth env-name references without printing credential values.

The default session policy is memory-only. There is no persistent token cache,
no `deploy auth status`, and no `deploy auth logout` until a reviewed OS
credential-store cache is introduced.

## Vault Role Reconciliation

Use the reviewed admin Vault commands when live Vault auth roles drift from the
project deployment metadata:

```bash
deploy admin vault plan --deployment //projects/deployments/pleomino/staging:deploy
deploy admin vault check --deployment //projects/deployments/pleomino/staging:deploy
deploy admin vault sync --deployment //projects/deployments/pleomino/staging:deploy
```

`plan` is local and read-only. `check` reads live Vault state and exits
non-zero when the JWT config, read policy, or JWT role differs from the
deployment contract. `sync` applies the derived Vault JWT config, read policy,
and role idempotently. The command reads a Vault admin token from `VAULT_TOKEN`
by default, or from `--vault-admin-token-env` / `--vault-admin-token-file`.

## Infisical Read-Only Checks

Use the reviewed Infisical admin commands before the first live Infisical-backed
deployment:

```bash
deploy auth explain-secret-backend --deployment //projects/deployments/pleomino/staging:deploy
deploy admin infisical plan --deployment //projects/deployments/pleomino/staging:deploy
deploy admin infisical check --deployment //projects/deployments/pleomino/staging:deploy
```

`plan` is local and read-only. `check` uses the reviewed
`infisical_machine_identity_universal_auth` credential source to verify live
project, environment, and mapped shared-secret metadata. It reports only safe
routing data such as site URL, project id, environment, secret path, contract
ids, secret names, credential source name, and missing env var names. There is
no `deploy admin infisical sync` command.

Typical `check` output includes:

```json
{
  "schemaVersion": "deploy-admin-infisical-check@1",
  "backendKind": "infisical",
  "credentialSource": {
    "name": "infisical_machine_identity_universal_auth",
    "machineIdentityId": "identity_123",
    "machineIdentityClientIdEnv": "INFISICAL_CLIENT_ID",
    "machineIdentityClientSecretEnv": "INFISICAL_CLIENT_SECRET",
    "missingEnvVarNames": []
  },
  "desiredSecrets": [
    {
      "contractId": "secret://deployments/pleomino/cloudflare_api_token",
      "selector": {
        "secretPath": "/deployments/pleomino",
        "secretName": "cloudflare_api_token"
      },
      "approvedPlaceholder": false
    }
  ],
  "diagnostics": [
    { "kind": "project", "status": "ok" },
    { "kind": "environment", "status": "ok" },
    {
      "kind": "machine_identity_project_access",
      "status": "ok",
      "permissionEvidence": { "access": true, "permissions": ["secrets:read"] }
    },
    { "kind": "secret", "status": "ok" }
  ]
}
```

When a first live value is intentionally deferred, the reviewed mapping can set
`approved_placeholder = "true"` and `placeholder_reason = "<reason>"`. A missing
secret then reports `placeholderApproved: true`; otherwise a missing mapped
secret keeps the check out of sync.

## When To Open Which Doc

Open [Deployment And Secrets API](deployment-secrets-api.md)
when you need the exact CLI flags, HTTP endpoints, schema names, or helper
signatures.

Open [Vault Production Bootstrap Runbook](vault-production-bootstrap.md)
when you are setting up Vault itself, configuring JWT auth roles, writing secrets,
or generating the optional local/test runtime export from Vault.

Open [Deployments Design](deployments-design.md)
when you need the architectural rationale behind `SprinkleRef`, replay
snapshots, and Vault-backed resolution.

Open [Deployment Contract](deployments-contract.md)
when you need the fail-closed rules for secret references, approval binding, and
replay behavior.
