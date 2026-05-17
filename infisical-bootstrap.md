# Infisical Bootstrap Specification

## Goal

Make Infisical bringup repeatable, low-click, and portable across local machines and CI while keeping root credentials out of Infisical and OpenTofu state.

The bootstrap command owns only the work required to make Infisical usable as the deployment secret backend:

- authenticate a human or CI bootstrap caller;
- select the Infisical organization without asking users to hunt for IDs;
- create or reuse the bootstrap IaC identity;
- run the Infisical OpenTofu stack through apply by default;
- store the bootstrap access credential in a SprinkleRef-resolved bootstrap credential backend;
- manage bootstrap and deployment Universal Auth access credentials through a
  SprinkleRef-resolved bootstrap credential backend.

It must not manage application secrets such as `cloudflare_api_token`. Those belong to the general SprinkleRef secret-management command, which writes to the configured category backend. For this deployment, ordinary post-bootstrap secrets will normally resolve to Infisical after bringup.

## Command Shape

Primary command:

```bash
build-tools/tools/deployments/infisical-iac-bootstrap.ts
```

Defaults:

- Infisical host: `https://app.infisical.com`.
- Login: enabled.
- OpenTofu init/plan/apply: enabled for the Infisical stack.
- Confirmation: mutation-capable bootstrap requires `--yes` before any remote or local write.
- Credential preservation: preserve existing remote/local credentials unless explicit rotation is requested.
- Secret output: never print secret values.

Key flags:

```text
--infisical-host us|eu|url
--api-url <url>
--cli-domain <url>
--organization-id <id>
--org-name <exact-name>
--yes
--no-login
--force-login
--access-token-env <env-name>
--tofu-dir <path>
--no-tofu-apply
--tofu-plan-file <path>
--rotate-bootstrap-credentials
--rotate-deployment-credentials
--force-overwrite-local-credentials
--local-credential-file <path>
--sprinkle-category <category>
--credential-sink <auto|sprinkleref|macos-keychain|local-file>
```

`--infisical-host` is the preferred host selector. `--api-url` and `--cli-domain` are
implementation-level overrides for split API/CLI endpoint testing or future hosted variants; when
omitted, both default to the reviewed Pleomino Infisical endpoint `https://app.infisical.com`.

`--yes` means “the operator has confirmed this mutation-capable bootstrap.” It does not mean
“guess.” Non-dry-run bootstrap checks this before opening Infisical, running OpenTofu, creating
resolver config files, or writing credential sinks. Use `--dry-run` for read-only inspection. If
multiple organizations are available and no explicit org selector was provided, the command still
presents the org list. If terminal input is unavailable, it exits with a clear error.

## Authentication

Default behavior runs `infisical login` in a temporary `HOME`.

Requirements:

- Do not touch the user’s normal `~/.infisical` state.
- Delete temporary CLI state after token extraction.
- Do not write the human access token to disk.
- If this Infisical CLI build cannot safely revoke only the temporary local/session token, do not run broad logout or session-revoke operations.
- If browser/server-side logout remains manual, print secure cleanup guidance.

CI/non-interactive behavior:

- `--no-login` requires a token from `--access-token-env`, default `INFISICAL_ACCESS_TOKEN`.
- CI must also provide `--organization-id` or `--org-name`.
- CI and local non-dry-run bootstrap must provide `--yes`; missing confirmation fails before any
  Infisical, OpenTofu, resolver-config, or credential-sink mutation.
- Any missing interactive input must fail fast with remediation.

## Organization Selection

Users should not have to locate organization IDs manually.

Resolution order:

1. `--organization-id`: use directly.
2. `--org-name`: list accessible orgs and match exact name.
3. If exactly one org is accessible and `--yes` is set: use it.
4. Otherwise print a numbered list and prompt.

If a list must be presented and stdin/stdout are not interactive, exit with:

- the accessible org names and IDs;
- why the script stopped;
- the exact remediation, such as passing `--org-name`, `--organization-id`, or running in an interactive terminal.

## Bootstrap IaC Identity

The bootstrap command ensures an org-level machine identity exists with enough permission to manage Infisical IaC resources.

It must:

- list identities in the selected org;
- detect duplicate identity names and stop with remediation;
- create the bootstrap identity if missing;
- ensure Universal Auth is attached;
- create a bootstrap client secret only when needed or when rotation is explicitly requested;
- never store bootstrap client secrets in OpenTofu state.

Default credential policy:

- Preserve existing credentials by default.
- If the remote Universal Auth client secret record exists and the selected SprinkleRef/local sink has a credential, do nothing.
- If the remote record exists but the local/resolver credential is missing, preserve the remote record and warn that Infisical only reveals client secrets at creation time.
- To repair that state, the user must either import the existing value into the configured sink or rerun with an explicit rotate flag.

Rotation:

- `--rotate-bootstrap-credentials` creates a new remote client secret and writes it to the selected sink.
- `--force-overwrite-local-credentials` controls local/sink overwrite when a new value is written.
- Old remote client secret records are not revoked or deleted by default unless a separate safe revocation flow is implemented.

## OpenTofu Infisical Stack

The bootstrap command should run OpenTofu for the Infisical stack by default. A successful single bootstrap command should leave the Infisical project, environments, identities, and bindings applied.

Default sequence:

1. `tofu init`
2. `tofu plan -out=<saved-plan>`
3. show a plan summary
4. `tofu apply <saved-plan>`
5. read outputs needed for deployment credential lifecycle reconciliation

Requirements:

- Apply must use the saved plan file.
- Do not implicitly re-plan during apply.
- `--no-tofu-apply` disables the default apply path for preview/debug.
- Failure output for `init`, `plan`, and `apply` includes the OpenTofu directory, the saved plan
  path when available, and the exact retry command for the failed stage.
- Bootstrap credentials should be supplied through environment only, not tfvars/state.

The OpenTofu module should continue to manage non-secret Infisical resources:

- project;
- environments;
- machine identities;
- Universal Auth configuration;
- project identity bindings;
- non-secret outputs.

The OpenTofu module should not manage Universal Auth client secret values when doing so would place secrets in state.

## Deployment Infisical Credential Lifecycle

Deployment identity client secrets are required so the deployment control plane can access Infisical. These credentials cannot be sourced from Infisical itself without an earlier credential, so they must live in a bootstrap/control-plane credential backend resolved by SprinkleRef.

After OpenTofu apply, the bootstrap command reads non-secret deployment identity outputs, reconciles them with reviewed Pleomino metadata, inspects Universal Auth client-secret record metadata for each deployment identity, and manages deployment access credentials through the selected SprinkleRef `bootstrap` category or explicit compatibility sink.

Policy:

- Do not print generated secrets.
- Do not store them in OpenTofu state.
- Do not store them in Infisical as the primary source of truth.
- Do not manage application secrets such as `cloudflare_api_token`.

Default behavior:

- Read OpenTofu outputs for deployment identity IDs and expected credential names/refs.
- Reconcile those non-secret outputs against checked-in reviewed metadata.
- Preserve remote deployment client-secret records when the selected sink already has the matching local/resolver credential.
- Stop with secure remediation when Infisical has an existing remote client-secret record but the local/resolver secret value is missing, because Infisical only reveals client-secret values at creation time.
- Stop before creating a new remote client secret when a local/resolver secret exists but no usable remote record is visible.

Rotation:

- `--rotate-deployment-credentials` creates new remote deployment Universal Auth client secrets and writes the new values to the selected sink.
- `--force-overwrite-local-credentials` is required before replacing existing selected-sink credential values.
- Old remote client-secret records are preserved unless a separate reviewed revocation flow is added.

## SprinkleRef Resolution

Stable references should stay backend-neutral. Do not encode concrete backends like `jenkins`, `github`, or `macos-keychain` in the URI.

Use the repo’s existing stable secret URI convention unless repo inspection proves a newer convention is required. Current examples suggest `secret://...`.

Example logical refs:

```text
secret://deployments/pleomino/staging/infisical-client-id
secret://deployments/pleomino/staging/infisical-client-secret
secret://deployments/pleomino/prod/infisical-client-id
secret://deployments/pleomino/prod/infisical-client-secret
```

SprinkleRef should resolve these using a category, for example:

```text
category: bootstrap
```

The category maps to the active backend according to resolver configuration. For most ordinary deployment secrets, the category may resolve to Infisical. For Infisical bootstrap/access credentials, the category must resolve to a non-Infisical backend because these credentials unlock Infisical.

Required backend targets for the `bootstrap` category:

- macOS Keychain;
- local file fallback;
- environment variables for CI;
- GitHub Actions secrets;
- Jenkins credentials;
- GitLab CI/CD variables;
- Bitbucket Pipelines secured variables.

The bootstrap script should not write to GitHub, Jenkins, GitLab, or Bitbucket APIs. It should emit stable refs and backend mapping templates or instructions. CI providers can then be populated by their normal secure admin/API process.

## SprinkleRef Resolver Configuration

SprinkleRef needs explicit resolver configuration. The stable `secret://...` URI identifies what secret is needed; the selected category determines where that secret lives for the current execution context.

`--category` selects a category. If omitted, the default category is used.

Recommended categories:

- `main`: ordinary deployment/application secrets. For this deployment, `main` resolves to Infisical after bootstrap.
- `bootstrap`: root credentials needed to access Infisical or Vault. This category must not resolve to Infisical for Infisical access credentials.

The bootstrap command resolves `auto` through the SprinkleRef resolver config. It uses an existing
selected resolver config when present and creates starter resolver configs only for confirmed,
non-dry-run bootstrap.

Resolver configs should be separate per execution context, with a shared base where useful:

```text
sprinkleref/
  base.json
  local.macos.json
  local.file.json
  ci.github.json
  ci.jenkins.json
  ci.gitlab.json
  ci.bitbucket.json
```

Selection:

```bash
SPRINKLEREF_CONFIG=sprinkleref/local.macos.json sprinkleref --add secret://...
sprinkleref --config sprinkleref/local.macos.json --add secret://...
```

`base.json` should define stable category names, naming conventions, and defaults that are independent of a concrete secret store. Context-specific files bind categories to concrete backends.

Example macOS local config:

```json
{
  "version": 1,
  "extends": "./base.json",
  "defaultCategory": "main",
  "categories": {
    "bootstrap": {
      "backend": "macos-keychain",
      "service": "viberoots-bootstrap"
    },
    "main": {
      "backend": "infisical",
      "host": "https://app.infisical.com",
      "projectRef": "secret://deployments/pleomino/infisical/project-id",
      "defaultEnvironment": "staging",
      "defaultPath": "/"
    }
  }
}
```

In the macOS Keychain backend, `service` is the Keychain generic-password service/group name. The logical `secret://...` ref can be used as the Keychain account/name. For example:

```text
service: viberoots-bootstrap
account: secret://deployments/pleomino/staging/infisical-client-secret
```

Example GitHub Actions CI config:

```json
{
  "version": 1,
  "extends": "./base.json",
  "defaultCategory": "main",
  "categories": {
    "bootstrap": {
      "backend": "github-actions",
      "scope": "repository",
      "namePrefix": "VIBEROOTS_"
    },
    "main": {
      "backend": "infisical",
      "host": "https://app.infisical.com",
      "projectRef": "secret://deployments/pleomino/infisical/project-id",
      "defaultEnvironment": "staging",
      "defaultPath": "/"
    }
  }
}
```

The bootstrap command should:

- read the selected SprinkleRef resolver config if it exists;
- create starter resolver configs if none exist;
- default local macOS `bootstrap` to macOS Keychain;
- default non-macOS local `bootstrap` to local `0600` files;
- default `main` to Infisical once OpenTofu has created the project;
- never hide backend selection in code when a resolver config can make it explicit.

With `--credential-sink auto`, bootstrap first uses `SPRINKLEREF_CONFIG` when set, then
`sprinkleref/selected.local.json` when present. If neither exists, it creates the starter
`sprinkleref/` config set and uses `selected.local.json`, whose `bootstrap` category explicitly
selects macOS Keychain on macOS and local `0600` files elsewhere. Existing resolver configs are
authoritative and are not overwritten. In `--dry-run`, bootstrap reports the starter backend it
would use but does not create resolver config files.

## Credential Sinks

Credential sink priority:

1. Explicit SprinkleRef resolver category if configured.
2. macOS Keychain on macOS.
3. Local `0600` files under `.local/infisical/...`.
4. Environment variables for CI read-only resolution.

The first implementation may write to:

- macOS Keychain;
- local `0600` files;
- generated resolver mapping templates.

CI provider support may initially be resolver templates only, not API writes.

For local files:

- store under `.local/infisical/bootstrap/` or `.local/infisical/deployment-credentials/`;
- create directories with restrictive permissions where possible;
- write files with mode `0600`;
- ensure `.local` remains gitignored.

For macOS Keychain:

- item names should derive from stable logical refs;
- use the selected SprinkleRef category as metadata/account/service context;
- never echo secret values in commands or logs.

## Application Secret Management

The bootstrap command must not manage application secrets such as:

- `cloudflare_api_token`;
- deploy provider tokens;
- app runtime secrets;
- database credentials;
- arbitrary environment secrets.

Those belong to a general SprinkleRef command:

```bash
sprinkleref --add secret://deployments/pleomino/staging/cloudflare-api-token
sprinkleref --update secret://deployments/pleomino/staging/cloudflare-api-token
sprinkleref --remove secret://deployments/pleomino/staging/cloudflare-api-token
```

The exact binary path can follow repo conventions, but the user-facing interface should be `sprinkleref --add`, `sprinkleref --update`, and `sprinkleref --remove` or equivalent subcommands. It should operate on stable logical refs and resolve the storage backend through the selected category.

Required flags/capabilities:

- `--category <name>` optionally selects the SprinkleRef resolver category.
- If `--category` is omitted, use the main/default secret backend category. For this deployment, that resolves to Infisical after bootstrap.
- `--category bootstrap` writes to the bootstrap/control-plane backend, not Infisical. Use this for credentials required to access Infisical or Vault.
- `--add <secret-ref>` creates a new secret value and fails if the ref already exists unless an explicit overwrite flag is provided.
- `--update <secret-ref>` updates an existing value and fails if the ref is missing unless an explicit create flag is provided.
- `--remove <secret-ref>` deletes/removes the value from the resolved backend after confirmation unless `--yes` is provided.

For the reviewed CLI, that explicit collision surface is `--overwrite-existing` for deliberate
`--add` replacement and `--create-missing` for deliberate `--update` creation. Resolver-config
category edits use the same modes through `sprinkleref --resolver-entry`, and those edits accept
only backend-selection metadata, not secret values.

Bootstrap uses the resolver config as the authority for backend selection. When `--credential-sink
auto` must create starter files, it uses create-only resolver-config writes so existing operator
files are not replaced. Existing resolver configs are reused as-is; overwrite remains an explicit
operator action through the SprinkleRef resolver-entry CLI rather than hidden bootstrap behavior.

- `--value-env <env-name>` reads the value from an environment variable.
- `--value-file <path>` reads the value from a file.
- hidden TTY prompt is the primary interactive UX when no non-interactive value source is provided, so users can enter new secrets directly from the command line without the value being echoed.
- optional explicit imports from Vault or OS stores can be added later.
- `--yes` confirms destructive or overwrite operations when all inputs are otherwise deterministic.
- `--dry-run` explains which backend/ref would be affected without reading or writing the secret value.

Default behavior:

- preserve by default;
- never print secret values;
- fail fast in non-interactive mode if required value or confirmation input is missing;
- explain whether the selected category resolves to Infisical, Keychain, local file, CI env, or another backend without embedding that backend in the stable URI;
- default category is the normal/main backend;
- bootstrap category is opt-in and reserved for root credentials that cannot be stored in the main backend.

Examples:

```bash
CLOUDFLARE_API_TOKEN=... sprinkleref \
  --add secret://deployments/pleomino/staging/cloudflare-api-token \
  --value-env CLOUDFLARE_API_TOKEN

sprinkleref \
  --update secret://deployments/pleomino/prod/cloudflare-api-token \
  --value-file .local/secrets/cloudflare-prod-token

sprinkleref \
  --remove secret://deployments/pleomino/staging/cloudflare-api-token

sprinkleref \
  --add secret://deployments/pleomino/staging/infisical-client-secret \
  --category bootstrap
```

## Error UX

Early exits should be verbose but secure.

Every failure should explain:

- what the script attempted;
- what it discovered;
- why it stopped;
- whether anything was changed;
- exact remediation commands or flags.

Never print:

- human access tokens;
- Universal Auth client secrets;
- application secret values;
- provider tokens.

Good failure examples:

```text
Multiple Infisical organizations are accessible:
1. Pleomino (org_...)
2. Sandbox (org_...)

No organization was selected because this terminal is non-interactive.
No Infisical resources were changed.

Fix:
  rerun with --org-name "Pleomino" --yes
  or pass --organization-id <id>.
```

```text
Infisical bootstrap requires --yes before mutation-capable execution.
No Infisical resources, OpenTofu state, resolver config, or credential sink output was changed.

Fix:
  rerun with --yes
  or use --dry-run for read-only inspection.
```

```text
OpenTofu plan failed.
Working directory: projects/deployments/pleomino-infisical/opentofu
Saved plan: .local/pleomino-infisical.tfplan
Retry: cd projects/deployments/pleomino-infisical/opentofu && tofu plan -out=.local/pleomino-infisical.tfplan
Cause: provider authorization failed
```

## Validation

Add fake-API/unit coverage for:

- default login skipped with `--no-login`;
- temporary HOME cleanup behavior;
- org selection matrix;
- non-interactive org-list failures;
- duplicate identity detection;
- preserve/rotate bootstrap credential policy;
- OpenTofu saved plan and apply sequence;
- apply confirmation behavior with and without `--yes`;
- deployment credential preserve/repair/rotate policy through stable refs;
- SprinkleRef category resolution;
- local file sink permissions;
- macOS Keychain sink command construction where testable;
- CI resolver template generation for GitHub, Jenkins, GitLab, and Bitbucket;
- refusal to manage application secrets in the bootstrap command.

Before operational use, run one live validation against Infisical and capture:

- selected organization ID;
- bootstrap identity ID;
- OpenTofu project/environment outputs;
- deployment identity IDs;
- logical `secret://...` refs emitted;
- confirmation that no secret values were printed;
- confirmation that OpenTofu state does not contain Universal Auth client secret values.
