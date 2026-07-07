# Local SprinkleRef Design

This design defines how clone-local control-plane setup values should resolve without checking
developer-specific account coordinates or plaintext secrets into the repository.

The goal is good developer experience without weakening the existing SprinkleRef model:

- `secret://...` remains the backend-neutral logical reference for true secrets.
- `config://...` identifies non-secret configuration values.
- `runtime://...` identifies values supplied by the selected runtime host contract. Runtime refs can
  be non-secret config or secret material delivered by a reviewed host binding, such as an
  environment variable.
- Resolver config chooses where refs are stored.
- `bootstrap` remains a SprinkleRef category/lane for root credentials needed to access a primary
  secret manager such as Infisical or Vault.
- `macos-keychain`, `local-file`, `infisical`, and `vault` remain backend kinds, not logical ref
  schemes.
- Clone-local files may store private coordinates, but should not encourage plaintext local
  secrets.

## Problem

Fresh-account and control-plane setup needs values that differ across developers, accounts, or
clones:

- Domain. It has no repo default and must be supplied by the operator or resolved from clone/team
  config.
- AWS account id.
- AWS organization id.
- Optional expected AWS role ARN.
- Supabase organization id.
- Supabase project ref / Reference ID.
- Supabase Management API token.

Some are not secrets, but they are still deployment coordinates that should not be checked in for
every clone. The token is a true secret and must not be written to plaintext local JSON.

Supabase organization plan is intentionally not part of the stack config. The setup command should
read it from the Supabase Management API and validate fail-closed that it supports PrivateLink.

The existing minimal stack config is useful, but a plain local `stack.json` can become a noisy or
developer-specific value file. We need a cleaner path where the stack config can point at logical
refs and each clone can resolve those refs locally or through shared remote backends.

## Existing Terminology

Use the repo's current SprinkleRef terminology precisely:

- **Ref:** backend-neutral logical identity, such as
  `config://control-plane/aws/account-id` or
  `secret://control-plane/supabase/management-api-token`.
- **Category:** usage lane selected by resolver config, such as `main`, `control`, or `bootstrap`.
- **Backend kind:** storage implementation, such as `infisical`, `vault`, `local-file`, or
  `macos-keychain`.
- **Bootstrap category:** existing reserved lane for root credentials needed to access Infisical or
  Vault. It must not point at Infisical when those credentials are needed to access Infisical.

Do not introduce a new `bootstrap://` scheme. Bootstrap is a category, not a ref scheme.

## Stack Config Value Shape

Control-plane stack config fields should accept three forms:

```json
"domain": "example.com"
```

```json
"domain": { "value": "example.com" }
```

```json
"awsAccountId": { "ref": "config://control-plane/aws/account-id" }
```

Rules:

- Plain scalar means inline value.
- `{ "value": ... }` means explicit inline value. This form exists so future fields can hold object
  or array values without changing the field model.
- `{ "ref": "config://..." }` means resolve through merged project config values.
- `{ "ref": "runtime://..." }` means resolve through the selected runtime host contract.
- `{ "ref": "secret://..." }` means resolve through the selected SprinkleRef backend lane.
- `{ "value": ..., "ref": ... }` is invalid.
- Empty string, `{ "value": "" }`, and `{ "ref": "" }` are missing for required fields.
- True secret fields must reject inline scalar and `{ "value": ... }`.

For the AWS account setup path, `supabaseAccessToken` is a true secret. It must resolve through
SprinkleRef or a deliberately exported setup-shell env var. It must not be accepted inline in stack
config or local values.

Use `supabaseAccessToken`, not `supabaseAccessTokenRef`, in the new shape. The field name describes
the logical setup input; the object shape describes whether the value is inline or ref-backed.

## Canonical Stack Config

`control-plane aws-account config-init` should generate a minimal stack config. It should not write
obvious defaults or derived values.

Recommended generated shape:

```json
{
  "schemaVersion": "aws-account-stack-config@1",
  "domain": "",
  "awsAccountId": { "ref": "config://control-plane/aws/account-id" },
  "awsOrganizationId": { "ref": "config://control-plane/aws/organization-id" },
  "supabaseOrgId": { "ref": "config://control-plane/supabase/org-id" },
  "supabaseProjectRef": { "ref": "config://control-plane/supabase/project-ref" },
  "supabaseAccessToken": {
    "ref": "secret://control-plane/supabase/management-api-token",
    "category": "control"
  }
}
```

Do not generate these by default:

- `stackName`
- `region`
- service names
- derived hostnames
- evidence directory
- state backend names
- Supabase API base URL
- token env
- `expectedAwsRoleArn`

Those fields remain supported as explicit overrides. `expectedAwsRoleArn` is optional hardening: if
present, `check-aws-login` must fail closed unless `aws sts get-caller-identity` returns that exact
ARN. If absent, account-id validation is enough.

## Local Values File

Use one conventional gitignored clone-local values file:

```text
projects/config/local.json
```

Ignore only the individual-user file:

```text
projects/config/local.json
```

The file is hierarchical so one file can hold all clone-local values:

```json
{
  "schemaVersion": "viberoots-project-local-config@1",
  "values": {
    "control-plane": {
      "aws": {
        "account-id": "123456789012",
        "organization-id": "o-example"
      },
      "supabase": {
        "org-id": "org-example",
        "project-ref": "abcd1234"
      }
    }
  }
}
```

A ref like:

```text
config://control-plane/aws/account-id
```

maps to:

```text
values.control-plane.aws.account-id
```

The top-level key is `values`, not `secrets`, because this local file is intended primarily for
clone-local coordinates. It should not normalize plaintext local secrets.

## Local Ref Redirects

Local values may also contain redirect objects. This lets a clone opt into resolving a specific
logical ref through a specific SprinkleRef category without adding a new URI scheme.

Example:

```json
{
  "schemaVersion": "viberoots-project-local-config@1",
  "values": {
    "control-plane": {
      "supabase": {
        "management-api-token": {
          "ref": "secret://control-plane/supabase/management-api-token",
          "category": "bootstrap"
        }
      }
    }
  }
}
```

Meaning:

- The logical value is still `secret://control-plane/supabase/management-api-token`.
- This clone chooses to resolve that value through the `bootstrap` category.
- The resolver config decides whether `bootstrap` uses `macos-keychain`, `local-file`, or another
  allowed non-Infisical backend.
- If the selected category is Infisical, the backend stores this ref under folder
  `/control-plane/supabase` with UI key `management-api-token`; the UI key is not the full
  `secret://...` URI.

This avoids global automatic keychain fallback. A keychain/bootstrap value is used only by clones
whose local values file explicitly redirects to the `bootstrap` category.

Redirect rules:

- `{ "ref": "secret://...", "category": "bootstrap" }` resolves the referenced ref through that
  category.
- `{ "ref": "secret://..." }` resolves the referenced ref through the current/default category
  chain.
- `category`, when present, must be a non-empty string naming a configured SprinkleRef category.
  Malformed category values fail closed instead of being treated as absent.
- AWS account stack resolution applies the same bootstrap guard as standalone SprinkleRef commands,
  so a redirect to `category: "bootstrap"` cannot use an Infisical-backed bootstrap category.
- Cycle detection is required.
- For secret-class fields, local scalar values and `{ "value": ... }` are invalid, but redirect
  objects are allowed.

## Project Config

Keep shared resolver policy and repo-wide non-secret coordinates in tracked project config:

```text
projects/config/shared.json
```

Example:

```json
{
  "schemaVersion": "viberoots-project-config@1",
  "environments": {
    "staging": { "infisicalEnvironment": "staging" },
    "prod": { "infisicalEnvironment": "prod" }
  },
  "runtimeHosts": {
    "local-macos": {
      "backend": "macos-keychain",
      "service": "viberoots-bootstrap"
    },
    "github-actions": {
      "backend": "github-actions",
      "scope": "repository",
      "namePrefix": "VIBEROOTS_"
    }
  },
  "sprinkleref": {
    "version": 1,
    "bootstrapScope": "example-app",
    "defaultCategory": "control",
    "profiles": {
      "control-infisical": {
        "backend": "infisical",
        "host": "https://app.infisical.com",
        "projectId": "<project-id>",
        "clientIdEnv": "INFISICAL_MACHINE_IDENTITY_CLIENT_ID",
        "clientSecretEnv": "INFISICAL_MACHINE_IDENTITY_CLIENT_SECRET"
      }
    },
    "categories": {
      "control": { "profile": "control-infisical", "environment": "prod" }
    }
  }
}
```

Developers should not need a per-clone selector for ordinary local overrides. The canonical local
file is `projects/config/local.json`. The tool loads `shared.json`, then deep-merges `local.json`
over it. Every changed overlap path is reported as an active local override with secret-like values
redacted. Use the coarse no-local-overrides guard for strict runs that should prove shared config is
not being locally changed.

The `control` category is a resolver lane for control-plane setup refs. It can currently target the
same Infisical `prod` environment as other production-ready refs; introduce a separate Infisical
environment only as a deliberate resolver-profile change.

`sprinkleref.bootstrapScope` controls the workspace segment under the reserved repo-bootstrap
namespace for credentials that unlock Infisical-backed resolver profiles. When it is omitted,
bootstrap uses the consumer workspace directory name. For example, a workspace named
`unfairly-common` stores its repo bootstrap Universal Auth client under
`secret://bootstrap/unfairly-common/viberoots-iac-bootstrap/client-id` and
`secret://bootstrap/unfairly-common/viberoots-iac-bootstrap/client-secret`. Operators may override
the scope for one bootstrap run with `--bootstrap-scope <name>`. The scope is a single path segment
containing letters, numbers, `.`, `_`, or `-`.

Local values are an implicit local-first resolution surface. They do not need to be listed in
`projects/config/shared.json`, which lets shared config remain the same for every clone. Resolution
should still report when a value came from `projects/config/local.json`.

Shared deployment topology also belongs in `projects/config/shared.json`. A deployment selects one
context, for example `deployment_context = "example-prod"`, and the context fills omitted
non-secret provider metadata:

```json
{
  "controlPlanes": {
    "example-prod": {
      "serviceClient": {
        "controlPlaneUrl": "https://deploy.example-app.example.com",
        "controlPlaneTokenRef": "secret://control-planes/example-prod/service-token"
      },
      "records": { "backend": "service" }
    }
  },
  "deploymentContexts": {
    "example-prod": {
      "controlPlane": "example-prod",
      "secretBackend": "infisical/default",
      "aws": { "accountId": "111122223333", "defaultRegion": "us-west-2" },
      "infisical": {
        "host": "https://app.infisical.com",
        "projectId": "5a927a1a-e78d-433e-affc-17cc051780c0",
        "projectName": "example-deployments",
        "projectSlug": "example-deployments",
        "environment": "prod",
        "defaultPath": "/",
        "clientIdEnv": "EXAMPLE_APP_PROD_INFISICAL_CLIENT_ID",
        "clientSecretEnv": "EXAMPLE_APP_PROD_INFISICAL_CLIENT_SECRET",
        "clientIdRef": "secret://deployments/example-app/prod/infisical-client-id",
        "clientSecretRef": "secret://deployments/example-app/prod/infisical-client-secret",
        "clientIdFileName": "example-prod-infisical-client-id",
        "clientSecretFileName": "example-prod-infisical-client-secret",
        "machineIdentityId": "ceca24df-0e8b-457e-a5a8-cf20a122d2da",
        "machineIdentityName": "example-prod-deploy"
      },
      "cloudflare": {
        "account": "web-platform-prod",
        "accountId": "1b911846f80a89272c0dbaf44f5c810f",
        "projectName": "example-prod-pages",
        "customDomain": "example-app.example.com",
        "zoneId": "9411ac5903acb1c2e29b3d4c04ef7e6f",
        "apiTokenRef": "secret://deployments/example-app/cloudflare_api_token"
      }
    },
    "admin-prod": {
      "controlPlane": "example-prod",
      "secretBackend": "infisical/admin",
      "aws": { "accountId": "444455556666", "defaultRegion": "us-east-1" },
      "infisical": { "projectId": "admin-project-id", "environment": "prod" },
      "cloudflare": { "account": "admin-platform", "projectName": "admin-prod-pages" }
    }
  }
}
```

Context values are defaults and constraints. If deployment metadata duplicates a context-provided
provider field, the values must match. Secret values still live in the selected backend or bootstrap
lane; JSON context fields may contain logical `secret://...` refs but not plaintext tokens or
passwords.

Older `config/sprinkleref/*` resolver files should be deleted after their useful values are moved.
Move shared resolver settings and prior `local.*.json` / `ci.*.json` runtime variants into
`projects/config/shared.json`, move entries from `config/sprinkleref/local/values.json` and
clone-only selections from `config/sprinkleref/selected.local.json` into
`projects/config/local.json`, and keep true secret values in the selected secret backend rather than
in either JSON file. See [sprinkleref.md](sprinkleref.md) for concrete examples.

## Resolution Strategy

For a stack field with an inline value:

1. CLI flag, when supplied.
2. Inline stack config scalar or `{ "value": ... }`.
3. Default, when the field has one.
4. Missing/blocking.

For a stack field with `{ "ref": "<scheme>://..." }`:

1. CLI flag, when supplied.
2. Dispatch by URI scheme.
3. `config://...` resolves through merged `projects/config/shared.json` and
   `projects/config/local.json` values. A stale `category` field is ignored for this scheme.
4. `runtime://...` resolves through the selected runtime host contract.
5. `secret://...` resolves through the selected SprinkleRef backend lane. If the stack ref declares
   `category`, that category resolves the secret ref explicitly.
6. Local project config entries may be scalar, `{ "value": ... }`, or redirect objects. A redirect
   to another `config://...` target still resolves from project config; a redirect to
   `secret://...` resolves through the selected backend.
7. Default, when the field has one.
8. Missing/blocking.

For `supabaseAccessToken`:

1. Explicit setup-shell env var, when supplied.
2. Stack config `{ "ref": "secret://control-plane/supabase/management-api-token",
"category": "control" }`; if it includes another category such as `bootstrap`, resolve through
   that explicit category.
3. Local values redirect without a category, resolved through the configured default category,
   when present.
4. Local values redirect to `category: "bootstrap"`, only when explicitly chosen.
5. Configured remote resolver, when present.
6. Missing/blocking.

The token value must never be printed or written into stack config, local values, inputs, or
evidence.

Generated control-plane setup refs dispatch by URI scheme. Non-secret `config://...` coordinates
such as AWS account ids and Supabase project refs resolve through merged project config values even
if an old stack file still contains a `category` field. Categories are SprinkleRef resolver lanes,
so they apply to `secret://...` setup refs such as the Supabase Management API token, not to
project-config coordinates. Resolver code must not infer `control` from a `control-plane` ref
prefix.

## Developer Experience

Command ownership:

- `control-plane aws-account config-init` owns AWS account stack config generation because that file
  is specific to the control-plane fresh-account workflow.
- `sprinkleref --init-local` should own local SprinkleRef values initialization because
  `projects/config/local.json` is a generic SprinkleRef local resolution surface, not a
  control-plane-only command.
- Secret writes should continue to use the existing `sprinkleref --add` / `sprinkleref --update`
  operation model. Do not add a parallel `control-plane sprinkleref` command unless the
  `control-plane` CLI grows an explicit generic tool-forwarding layer.

Common local setup:

```bash
control-plane aws-account config-init
sprinkleref --init-local
sprinkleref \
  --update secret://control-plane/supabase/management-api-token \
  --create-missing
control-plane aws-account check
```

Add `--category bootstrap` only when the stack config or clone-local value explicitly chooses
`category: "bootstrap"` for the token ref.

`sprinkleref --init-local` should write or update:

```text
projects/config/local.json
```

with placeholders for non-secret/private coordinates and redirect objects for secret-class refs:

```json
{
  "schemaVersion": "viberoots-project-local-config@1",
  "values": {
    "control-plane": {
      "aws": {
        "account-id": "",
        "organization-id": ""
      },
      "supabase": {
        "org-id": "",
        "project-ref": "",
        "management-api-token": {
          "ref": "secret://control-plane/supabase/management-api-token"
        }
      }
    }
  }
}
```

The command should print the
`sprinkleref --update secret://control-plane/supabase/management-api-token --create-missing`
command for the secret instead of asking the developer to put the token into JSON. It should not
print bootstrap token guidance unless a future command mode explicitly initializes a
`category: "bootstrap"` local token redirect.

## Check Output

`control-plane aws-account check` should stay compact and source-aware:

```text
Stack Config
  Missing:
    awsAccountId
      ref: config://control-plane/aws/account-id
      source: shared project config
      action: fill projects/config/shared.json or projects/config/local.json
    supabaseOrgId
      ref: config://control-plane/supabase/org-id
      source: shared project config
      action: fill projects/config/shared.json or projects/config/local.json
    supabaseProjectRef
      ref: config://control-plane/supabase/project-ref
      source: shared project config
      action: fill projects/config/shared.json or projects/config/local.json
    supabaseAccessToken
      ref: secret://control-plane/supabase/management-api-token
      category: control
      action: write the ref in the selected SprinkleRef backend

Resolved:
    domain                        inline
    region                        default: us-east-1
    stackName                     default: control
```

Do not print secret values. For non-secret coordinates, the command may print values when useful,
but evidence should always include source metadata.

## Evidence

Evidence should record how each value was resolved.

Example:

```json
{
  "resolvedInputs": {
    "awsAccountId": {
      "source": "local-values",
      "localValuesPath": "projects/config/local.json",
      "localValuesEntryPath": "values.control-plane.aws.account-id",
      "valuePrinted": true
    },
    "supabaseAccessToken": {
      "source": "sprinkleref",
      "ref": "secret://control-plane/supabase/management-api-token",
      "category": "control",
      "backend": "infisical",
      "valuePrinted": false
    },
    "supabaseAccessTokenBootstrapRedirect": {
      "source": "sprinkleref",
      "localValuesPath": "projects/config/local.json",
      "localValuesEntryPath": "values.control-plane.supabase.management-api-token",
      "ref": "secret://control-plane/supabase/management-api-token",
      "redirectRef": "secret://control-plane/supabase/management-api-token",
      "category": "bootstrap",
      "backend": "macos-keychain",
      "valuePrinted": false
    }
  }
}
```

For true secrets, evidence must never include the resolved value. For private coordinates, evidence
may include the value if it is needed for auditability and the output is already treated as setup
evidence rather than a public artifact.

## Rejected Alternatives

### `supabaseProjectRefRef`

Supabase commonly calls its project identifier the project ref / Reference ID. Adding another `Ref`
suffix for SprinkleRef indirection creates awkward names such as `supabaseProjectRefRef`. The value
shape avoids this.

### `bootstrap://...`

This introduces a new scheme for something the repo already models as a category. It also blurs the
line between logical refs and resolver lanes. Use `secret://...` plus `category: "bootstrap"`
instead.

### Automatic Global Keychain Fallback

Automatically falling back to keychain can leak machine-global values across clones. A clone should
opt into bootstrap/keychain resolution through its local values file. This keeps local behavior
explicit and auditable.

### Plaintext Local Secrets

A gitignored local file is still plaintext. It is acceptable for private coordinates, but it should
not become the recommended storage for true secrets. Secret-class refs should use remote secret
managers or the bootstrap category backed by macOS Keychain or another reviewed non-plaintext store.

## Current Implementation

The current implementation supports scalar, `{ "value": ... }`, and `{ "ref": ... }` stack config
fields; hierarchical values in `projects/config/local.json`; local redirect objects with
`{ "ref": "secret://...", "category": "..." }`; secret-class rejection for inline or plaintext
`supabaseAccessToken`; bootstrap-category guardrails; redirect cycle detection; and source-aware
check/evidence output.
