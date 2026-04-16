# Vault Production Bootstrap Runbook

This runbook shows how to bootstrap Vault as the production source of truth for
deployment secrets.

Important current-repo reality:

- the reviewed production runtime now reads Vault directly through
  `VAULT_ADDR` plus `VAULT_TOKEN`
- the exported JSON fixture path through `BNX_DEPLOYMENT_SECRET_FIXTURE_PATH`
  remains available only for reviewed local, test, and bootstrap-oriented
  workflows, not as the normal production runtime mechanism
- this runbook therefore covers both:
  - bootstrapping Vault itself for the direct runtime path
  - optionally exporting the reviewed runtime fixture for local/test workflows

Use this runbook when:

- you are setting up production or shared-environment secret storage for the
  first time
- you are adding a new deployment secret contract and want Vault to be the
  source of truth
- you are rotating or replacing a secret and need to regenerate the optional
  local/test runtime export used by a bootstrap or isolated test workflow

## What Success Looks Like

At the end of this runbook:

- Vault is initialized, unsealed, reachable over TLS, and auditing requests
- a KV v2 secrets engine exists at `secret/`
- an AppRole-based machine identity can read only the reviewed deployment
  secret paths it needs
- deployment secrets are stored in Vault using a predictable path convention
- the reviewed production runtime can read those secrets directly with
  `VAULT_ADDR` plus `VAULT_TOKEN`
- when needed, a reviewed `deployment-vault-fixture@1` file can still be
  exported from Vault for local/test flows through
  `BNX_DEPLOYMENT_SECRET_FIXTURE_PATH`

## Before You Start

You need:

- a machine with the `vault` CLI and `jq`
- network access to the Vault server or cluster
- an operator credential that can initialize Vault or change mounts, auth
  methods, policies, and secrets
- the exact `contract_id` values declared in deployment metadata
- the exact target scope values used by the deployment runtime

Example values used in this runbook:

- Vault address:
  `https://vault.example.net:8200`
- contract ID:
  `secret://deployments/pleomino/cloudflare_api_token`
- deployment target scope:
  `cloudflare-pages:web-platform-staging/pleomino-staging-pages`
- optional exported runtime fixture path:
  `.local/deploy-secrets/vault.json`

## How To Choose `targetScopes`

Use the deployment's exact admitted target value for `targetScopes`.

Use this rule:

- `targetScopes` should contain the exact deployment `lockScope` value that the
  runtime will check at secret-use time

In the current code:

- the secret runtime compares `targetScopes` against the runtime `targetScope`
- the convenience helper sets that runtime `targetScope` from
  `admittedContext.targetEnvironment.lockScope`
- for normal deploy flows, that `lockScope` is usually the same as the
  deployment target's canonical `providerTargetIdentity`

Practical operator workflow:

1. if this is first-time setup and no run exists yet, ask the repo for the
   canonical target identity:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --print-target-identity
```

For ordinary deploy flows, use that exact output string in `targetScopes`.

2. if the deployment already has a submitted run, verify the exact admitted
   value from status:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --print-run-lock-scope \
  --deploy-run-id "$DEPLOY_RUN_ID" \
  --control-plane-url "$BNX_DEPLOY_CONTROL_PLANE_URL"
```

Use that exact `lockScope` value in `targetScopes`.

3. precedence rule:

- for normal first-time setup, `--print-target-identity` is the
  practical default
- once a run exists, `lockScope` from the status API is the more exact value
- for preview or any other non-default flow, prefer the exact status value over
  assumptions

Common shapes:

- Cloudflare Pages:
  `cloudflare-pages:<account>/<project>`
  Example:
  `cloudflare-pages:web-platform-staging/pleomino-staging-pages`
- `nixos-shared-host`:
  `nixos-shared-host:<target-group>:<app>`
  Example:
  `nixos-shared-host:shared-dev:pleomino`
- S3 static:
  `s3-static:<account>/<bucket>`
- Kubernetes:
  `kubernetes:<cluster>/<namespace>/<release>`
- App Store Connect:
  `app-store-connect:<issuer>/<app>#track:<track>`
- Google Play:
  `google-play:<developer-account>/<app>#track:<track>`

## Plain-Language Model

The deployment system uses three layers:

1. the repo stores a stable contract ID such as
   `secret://deployments/pleomino/cloudflare_api_token`
2. Vault stores the real secret value and the metadata that says where it may be
   used
3. the reviewed production runtime reads Vault directly, while local/test
   workflows can intentionally use an exported fixture file with the same
   contracts and metadata

In other words: Vault is the long-lived source of truth, and the exported
fixture is an optional override for local/test/bootstrap flows rather than the
normal production runtime path.

## Recommended Path Convention

The repo does not currently enforce a Vault path convention, so this runbook
uses one recommended convention to keep operator workflows predictable.

Map each contract ID to a KV v2 path under `secret/`:

- contract ID:
  `secret://deployments/pleomino/cloudflare_api_token`
- Vault KV path:
  `secret/deployments/pleomino/cloudflare_api_token`

Use the same pattern for other secrets:

- `secret://deployments/pleomino/preview_basic_auth_password`
  becomes `secret/deployments/pleomino/preview_basic_auth_password`
- `secret://deployments/demoapp/database_url`
  becomes `secret/deployments/demoapp/database_url`

This convention keeps the Vault paths and exported runtime fixture aligned with
the contract IDs used in deployment metadata.

## Step 1: Point The CLI At Vault

Set the Vault address on the machine that will perform the bootstrap:

```bash
export VAULT_ADDR='https://vault.example.net:8200'
```

If your environment requires a custom CA bundle, set that before continuing.

## Step 2: Initialize And Unseal Vault

If Vault is already initialized and unsealed, skip to the next step.

Initialize the storage backend once:

```bash
vault operator init -key-shares=5 -key-threshold=3 > vault-init.txt
```

Common example values and when to use them:

- `-key-shares=5`
  Create five unseal key shares so the recovery responsibility can be split
  across multiple operators.
- `-key-threshold=3`
  Require any three of those shares to unseal Vault.

Important handling rules:

- do not leave `vault-init.txt` on the Vault server
- move the unseal keys and initial root token into your real secure escrow
  process immediately
- treat the initial root token as bootstrap-only, not as an everyday operator
  credential

Then unseal Vault with enough key shares to meet the threshold:

```bash
vault operator unseal <unseal-key-1>
vault operator unseal <unseal-key-2>
vault operator unseal <unseal-key-3>
```

If you are running more than one Vault node, unseal each node the same way.

## Step 3: Enable Audit Logging

Enable at least one audit device before storing production secrets:

```bash
vault audit enable file file_path=/var/log/vault_audit.log mode=0600
```

Example values:

- `file_path=/var/log/vault_audit.log`
  A simple host-local audit log path.
- `mode=0600`
  Restricts the audit log to the owning user.

Use a different audit device if your environment requires centralized logging,
but keep Vault auditing enabled before continuing.

## Step 4: Enable The KV v2 Secrets Engine

This runbook uses a KV v2 engine mounted at `secret/`:

```bash
vault secrets enable -path=secret kv-v2
```

Use `secret/` when you want the examples in this runbook to work exactly as
written.

If your environment already uses a different mount path, keep that path
consistent across policies, write commands, and exporter scripts.

## Step 5: Enable AppRole For Machine Access

Enable the AppRole auth method:

```bash
vault auth enable approle
```

Use AppRole when a CI job or deployment helper needs machine-to-machine access
to Vault without an interactive human login.

## Step 6: Create A Least-Privilege Read Policy

Write a policy that allows the deployment exporter to read only the specific
deployment secrets it needs.

Create `deploy-pleomino-read.hcl`:

```hcl
path "secret/data/deployments/pleomino/*" {
  capabilities = ["read"]
}
```

Then upload it:

```bash
vault policy write deploy-pleomino-read deploy-pleomino-read.hcl
```

Use narrower paths when possible:

- `path "secret/data/deployments/pleomino/*"`
  Use this when one app family should read only its own deployment secrets.
- `path "secret/data/deployments/*"`
  Broader and usually less desirable. Use only when one trusted machine really
  must read many deployment families.

## Step 7: Create The Exporter AppRole

Create an AppRole that uses that read policy:

```bash
vault write auth/approle/role/deploy-pleomino-read \
  token_policies="deploy-pleomino-read" \
  secret_id_ttl="30m" \
  token_ttl="30m" \
  token_max_ttl="2h"
```

Example values and when to use them:

- `token_policies="deploy-pleomino-read"`
  Attach only the read policy created above.
- `secret_id_ttl="30m"`
  Use a short lifetime for the bootstrap credential handed to CI or an export
  helper.
- `token_ttl="30m"`
  Use a short-lived token for routine export runs.
- `token_max_ttl="2h"`
  Give enough time for one controlled export job without creating a long-lived
  credential.

Read back the role ID and create one secret ID:

```bash
vault read -field=role_id auth/approle/role/deploy-pleomino-read/role-id
```

```bash
vault write -format=json -f auth/approle/role/deploy-pleomino-read/secret-id \
  | jq -r '.data.secret_id'
```

Keep both values secure. Together they are the machine credential that can
export the runtime fixture.

## Step 8: Store Secrets In Vault

Store each deployment secret under the recommended KV path using JSON files.

Create `cloudflare_api_token.json`:

```json
{
  "value": "super-secret-token",
  "allowedSteps": ["publish"],
  "targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
  "refreshMode": "renew",
  "credentialClass": "routine"
}
```

Write it to Vault:

```bash
vault kv put -mount=secret \
  deployments/pleomino/cloudflare_api_token \
  @cloudflare_api_token.json
```

Create a second example secret if the deployment also needs an authenticated
smoke-check credential:

```json
{
  "value": "preview-password",
  "allowedSteps": ["smoke"],
  "targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"],
  "refreshMode": "none",
  "credentialClass": "routine"
}
```

```bash
vault kv put -mount=secret \
  deployments/pleomino/preview_basic_auth_password \
  @preview_basic_auth_password.json
```

What these fields mean:

- `"value": "super-secret-token"`
  The actual secret value returned to the runtime.
- `"allowedSteps": ["publish"]`
  Use `publish` for provider credentials needed only while publishing.
- `"allowedSteps": ["smoke"]`
  Use `smoke` for credentials needed only during smoke checks.
- `"targetScopes": ["cloudflare-pages:web-platform-staging/pleomino-staging-pages"]`
  Restrict the secret to the exact deployment target that should use it. This
  should match the deployment's admitted `lockScope`.
- `"refreshMode": "renew"`
  Use when the same credential should be renewed in place.
- `"refreshMode": "none"`
  Use when no refresh behavior is needed.
- `"credentialClass": "routine"`
  Normal day-to-day deployment credential.

## Step 9: Log In As The Exporter

Use the AppRole credentials to mint a short-lived Vault token for export:

```bash
export ROLE_ID='replace-with-role-id'
export SECRET_ID='replace-with-secret-id'

export VAULT_TOKEN="$(
  vault write -format=json auth/approle/login \
    role_id="$ROLE_ID" \
    secret_id="$SECRET_ID" \
    | jq -r '.auth.client_token'
)"
```

Use this token only for the export step below. Do not reuse it as a general
operator token.

## Step 10: Export The Runtime Fixture From Vault

The reviewed fixture override path expects a `deployment-vault-fixture@1` file
keyed by contract ID.

Create the export directory and write the file:

```bash
mkdir -p .local/deploy-secrets

jq -n \
  --argjson cloudflare_api_token "$(
    vault kv get -format=json -mount=secret deployments/pleomino/cloudflare_api_token \
      | jq '.data.data'
  )" \
  --argjson preview_basic_auth_password "$(
    vault kv get -format=json -mount=secret deployments/pleomino/preview_basic_auth_password \
      | jq '.data.data'
  )" \
  '{
    schemaVersion: "deployment-vault-fixture@1",
    contracts: {
      "secret://deployments/pleomino/cloudflare_api_token": $cloudflare_api_token,
      "secret://deployments/pleomino/preview_basic_auth_password": $preview_basic_auth_password
    }
  }' > .local/deploy-secrets/vault.json
```

Lock down the exported file:

```bash
chmod 0600 .local/deploy-secrets/vault.json
```

Important handling rules:

- do not commit this file
- keep it outside world-readable directories
- regenerate it after each secret rotation
- delete old exports once the new export is in use

## Step 11: Point The Deployment Runtime At The Export

Set the optional fixture override env var only for local development, isolated
tests, or explicit bootstrap-oriented workflows:

```bash
export BNX_DEPLOYMENT_SECRET_FIXTURE_PATH="$PWD/.local/deploy-secrets/vault.json"
```

At this point, the runtime can resolve the same contract IDs that the
deployment metadata declared.

## Step 12: Run A Deployment

Run the normal deployment flow:

```bash
deploy --deployment //projects/deployments/pleomino-staging:deploy
```

If you want to force one exact local build output, you can still provide the
usual override:

```bash
deploy \
  --deployment //projects/deployments/pleomino-staging:deploy \
  --artifact-dir ./dist
```

## Step 13: Verify The Result

A healthy end-to-end result looks like this:

- the deploy succeeds or reaches the expected approval gate
- the runtime can resolve the required contract IDs for the active lifecycle
  step
- the durable deployment record stores
  `secret://deployments/pleomino/cloudflare_api_token`
  rather than the raw token value
- the exported fixture file exists only where a reviewed local/test or
  bootstrap workflow needs it

## Rotation And Ongoing Operations

When you rotate a secret:

1. write a new version at the same Vault path
2. regenerate the exported runtime fixture
3. replace the file referenced by `BNX_DEPLOYMENT_SECRET_FIXTURE_PATH`
4. rerun the deployment or the next workflow that needs the updated secret

Example rotation write:

```bash
vault kv put -mount=secret \
  deployments/pleomino/cloudflare_api_token \
  @cloudflare_api_token.json
```

Keep the `contract_id` stable during rotation. The secret value changes, but the
repo-level contract name should not.

## Related Docs

- [Secrets Usage](/Users/kiltyj/Code/bucknix-fresh/docs/secrets-usage.md)
- [Deployment And Secrets API](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-secrets-api.md)
- [Deployments Usage](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-usage.md)

## External References

These Vault commands are based on the official HashiCorp docs:

- [operator init](https://developer.hashicorp.com/vault/docs/commands/operator/init)
- [operator unseal](https://developer.hashicorp.com/vault/docs/commands/operator/unseal)
- [audit enable](https://developer.hashicorp.com/vault/docs/commands/audit/enable)
- [KV v2 setup](https://developer.hashicorp.com/vault/docs/secrets/kv/kv-v2/setup)
- [AppRole auth](https://developer.hashicorp.com/vault/docs/auth/approle)
- [policy write](https://developer.hashicorp.com/vault/docs/commands/policy/write)
- [kv put](https://developer.hashicorp.com/vault/docs/commands/kv/put)
