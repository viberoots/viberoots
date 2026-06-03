# Local SprinkleRef Design

This design defines how clone-local control-plane setup values should resolve without checking
developer-specific account coordinates or plaintext secrets into the repository.

The goal is good developer experience without weakening the existing SprinkleRef model:

- `secret://...` remains the backend-neutral logical reference for true secrets.
- `config://...` and `runtime://...` identify non-secret configuration/runtime values.
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
- `{ "ref": "config://..." }`, `{ "ref": "runtime://..." }`, or `{ "ref": "secret://..." }`
  means resolve through SprinkleRef.
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
  "awsAccountId": { "ref": "config://control-plane/aws/account-id", "category": "control" },
  "awsOrganizationId": {
    "ref": "config://control-plane/aws/organization-id",
    "category": "control"
  },
  "supabaseOrgId": { "ref": "config://control-plane/supabase/org-id", "category": "control" },
  "supabaseProjectRef": {
    "ref": "config://control-plane/supabase/project-ref",
    "category": "control"
  },
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
config/sprinkleref/local/values.json
```

Ignore the whole local directory:

```text
config/sprinkleref/local/
```

The file is hierarchical so one file can hold all clone-local values:

```json
{
  "schemaVersion": "sprinkleref-values@1",
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
  "schemaVersion": "sprinkleref-values@1",
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

## Resolver Config

Keep shared resolver policy in tracked config when possible:

```text
config/sprinkleref/selected.json
```

Example:

```json
{
  "version": 1,
  "defaultCategory": "control",
  "profiles": {
    "control-infisical": {
      "backend": "infisical",
      "host": "https://app.infisical.com",
      "projectId": "<project-id>",
      "defaultEnvironment": "control",
      "clientIdEnv": "INFISICAL_MACHINE_IDENTITY_CLIENT_ID",
      "clientSecretEnv": "INFISICAL_MACHINE_IDENTITY_CLIENT_SECRET"
    },
    "bootstrap-keychain": {
      "backend": "macos-keychain",
      "service": "viberoots.sprinkleref"
    }
  },
  "categories": {
    "control": { "profile": "control-infisical" },
    "bootstrap": { "profile": "bootstrap-keychain" }
  }
}
```

Developers should not need a per-clone selector for ordinary local overrides. The conventional local
values file is enough. A per-clone selector can still exist for exceptional cases, but it should not
be the default path.

The conventional local values file is an implicit local-first resolver. It does not need to be
listed in `config/sprinkleref/selected.json`, which lets the shared selector remain the same for
every clone. Resolution should still report when a value came from the implicit local file.

The repo currently has flows that use `config/sprinkleref/selected.local.json`. This design moves
toward tracked shared resolver policy in `config/sprinkleref/selected.json` plus gitignored
clone-local values in `config/sprinkleref/local/values.json`. Existing `selected.local.json` usage
should be migrated or retained only as an escape hatch for unusual local backend selection.

## Resolution Strategy

For a stack field with an inline value:

1. CLI flag, when supplied.
2. Inline stack config scalar or `{ "value": ... }`.
3. Default, when the field has one.
4. Missing/blocking.

For a stack field with `{ "ref": "<scheme>://..." }`:

1. CLI flag, when supplied.
2. If the stack ref declares `category`, resolve the original logical ref through that category;
   local values do not satisfy scalar, `{ "value": ... }`, or redirect target-ref changes for that
   ref.
3. Conventional local values file at `config/sprinkleref/local/values.json`.
4. If the local entry is scalar or `{ "value": ... }`, use it only when the requested field is not
   secret-class.
5. If the local entry is `{ "ref": "<scheme>://...", "category": "<category>" }`, resolve the target
   ref through that category.
6. If the local entry is `{ "ref": "<scheme>://..." }`, resolve the target ref through the current
   category chain.
7. If no local entry resolves, use the configured category/backend resolver, such as Infisical or
   Vault.
8. Default, when the field has one.
9. Missing/blocking.

For `supabaseAccessToken`:

1. Explicit setup-shell env var, when supplied.
2. Stack config `{ "ref": "secret://control-plane/supabase/management-api-token",
"category": "control" }`; if it includes another category such as `bootstrap`, resolve through
   that explicit category.
3. Local values redirect without a category, resolved through the selected/default category chain,
   when present.
4. Local values redirect to `category: "bootstrap"`, only when explicitly chosen.
5. Configured remote resolver, when present.
6. Missing/blocking.

The token value must never be printed or written into stack config, local values, inputs, or
evidence.

Generated control-plane setup refs should declare `category: "control"` explicitly. Resolver code
must not infer `control` from a `control-plane` ref prefix. A local redirect to
`category: "bootstrap"` is an explicit clone-local decision to use the bootstrap lane for that one
value only when the stack ref has no explicit category. Redirects that change the target ref are
also ignored when the stack ref declares a category, so an explicit category always applies to the
original logical ref. Local scalar and `{ "value": ... }` entries are also local-first only for stack
refs without an explicit category.

## Developer Experience

Command ownership:

- `control-plane aws-account config-init` owns AWS account stack config generation because that file
  is specific to the control-plane fresh-account workflow.
- `sprinkleref --init-local` should own local SprinkleRef values initialization because
  `config/sprinkleref/local/values.json` is a generic SprinkleRef local resolution surface, not a
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
config/sprinkleref/local/values.json
```

with placeholders for non-secret/private coordinates and redirect objects for secret-class refs:

```json
{
  "schemaVersion": "sprinkleref-values@1",
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
      category: control
      action: fill config/sprinkleref/local/values.json or write the ref in SprinkleRef
    supabaseOrgId
      ref: config://control-plane/supabase/org-id
      category: control
      action: fill config/sprinkleref/local/values.json or write the ref in SprinkleRef
    supabaseProjectRef
      ref: config://control-plane/supabase/project-ref
      category: control
      action: fill config/sprinkleref/local/values.json or write the ref in SprinkleRef
    supabaseAccessToken
      ref: secret://control-plane/supabase/management-api-token
      category: control
      action: fill config/sprinkleref/local/values.json or write the ref in SprinkleRef

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
      "path": "values.control-plane.aws.account-id",
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
      "localValuesPath": "config/sprinkleref/local/values.json",
      "ref": "secret://control-plane/supabase/management-api-token",
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

## Implementation Notes

- Add parser support for scalar, `{ "value": ... }`, and `{ "ref": ... }` stack config fields.
- Add local hierarchical values lookup at `config/sprinkleref/local/values.json`.
- Add redirect support for local values entries with `{ "ref": "secret://...", "category": "..." }`.
- Enforce secret-class restrictions so `supabaseAccessToken` cannot be inline or plaintext local.
- Preserve existing `bootstrap` guardrails: the `bootstrap` category must not use Infisical when it
  stores credentials needed to access Infisical.
- Add cycle detection for ref redirects.
- Update `config-init`, `check`, JSON evidence, and docs together so the UX remains consistent.
