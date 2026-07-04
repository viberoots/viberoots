# Infisical Bootstrap Specification

## Goal

Make Infisical bringup repeatable, low-click, and portable across local machines and CI while keeping root credentials out of Infisical and OpenTofu state.

The bootstrap command owns only the work required to make Infisical usable as the deployment secret backend:

- authenticate a human or CI bootstrap caller;
- select the Infisical organization without asking users to hunt for IDs;
- create or reuse shared repo bootstrap metadata and credentials;
- run the deployment Infisical OpenTofu stack through apply when confirmed repo fan-out or explicit
  deployment bootstrap is selected;
- store the bootstrap access credential in a SprinkleRef-resolved bootstrap credential backend;
- manage bootstrap and deployment Universal Auth access credentials through a
  SprinkleRef-resolved bootstrap credential backend.

It must not manage application secrets such as `cloudflare_api_token`. Those belong to the general SprinkleRef secret-management command, which writes to the configured category backend. For this deployment, ordinary post-bootstrap secrets will normally resolve to Infisical after bringup.

## Command Shape

Primary local setup:

```bash
i
i --yes
i --without-secrets
i --machine-label <label>
```

`i` is the normal first-run and daily-run entrypoint. After dependency setup, it performs a narrow
local readiness check for the canonical project config in `projects/config/`, the repo bootstrap
Universal Auth credential, and the Sample webapp deployment Universal Auth credentials for this machine.
It does not run full `sprinkleref --check` and does not require application secrets such as
Cloudflare tokens to exist.

The readiness phase is capability-gated by checked-out deployment metadata. Partial clones or
minimized workspaces that do not include `projects/deployments/sample-webapp/shared/family.bzl` skip
Infisical readiness automatically and do not need `--without-secrets`. Full checkouts can still use
`--without-secrets` or `INSTALL_DEPS_WITHOUT_SECRETS=1` as an explicit dependency-only opt-out.

Ready machines produce no extra setup output unless verbose diagnostics are enabled. If local
readiness is missing, interactive `i` asks once before running repo bootstrap with deployment fan-out
enabled. Non-interactive `i` fails with remediation unless `--yes` or
`INSTALL_DEPS_SETUP_SECRETS=1` explicitly allows setup. Use `i --without-secrets` or
`INSTALL_DEPS_WITHOUT_SECRETS=1` for dependency-only automation.

Advanced recovery and debug commands:

```bash
build-tools/tools/deployments/infisical-bootstrap.ts repo --dry-run
build-tools/tools/deployments/infisical-bootstrap.ts repo
build-tools/tools/deployments/infisical-bootstrap.ts repo --yes
build-tools/tools/deployments/infisical-bootstrap.ts repo --yes --apply-metadata-patch
build-tools/tools/deployments/infisical-bootstrap.ts repo --without-deployments
build-tools/tools/deployments/infisical-bootstrap.ts deployment --target <buck-target> --dry-run
build-tools/tools/deployments/infisical-bootstrap.ts deployment --target <buck-target> --yes
```

`repo` first initializes and validates the repo-wide SprinkleRef resolver/profile boundary. It
creates or checks `projects/config/shared.json`, named backend profiles such as `vault-default` and
`infisical-default`, category lanes such as `main` and `bootstrap`, and shared runtime host profiles
for local and CI execution. Confirmed repo bootstrap also materializes shared backend profile
metadata and the selected bootstrap credential sink. It writes only non-secret resolver metadata
such as Infisical project ids, Vault address env names, mounts, default paths, and credential env
names.

After the repo-wide phase succeeds, confirmed `repo` runs a second `Y/n` prompt to fan out to
reviewed deployment bootstrap targets discovered from deployment metadata. `--yes` pre-confirms
both the repo setup prompt and this deployment fan-out prompt. Use `repo --without-deployments`
when you only want resolver/profile setup; managed deployment bootstrap outputs may remain missing
until a later default repo run or an explicit deployment bootstrap succeeds.

`i --machine-label <label>` forwards the label to repo bootstrap. Credential lifecycle flags such as
`--rotate-bootstrap-credentials`, `--rotate-deployment-credentials`, and
`--force-overwrite-local-credentials` are also forwarded when an operator intentionally invokes them
through `i`.

On first bootstrap, OpenTofu may create or adopt the Sample webapp Infisical project and machine
identities while checked-in reviewed metadata still contains first-bootstrap placeholders. That is
reported as a reviewed metadata handoff, not unexpected drift. The command prints a non-secret patch
for `projects/deployments/sample-webapp/shared/family.bzl` covering only `_INFISICAL_SITE_URL`,
`_INFISICAL_PROJECT_ID`, `_INFISICAL_MACHINE_IDENTITY_IDS`, and
`_INFISICAL_CREDENTIAL_FILE_NAMES`. Local interactive operators can approve the patch at the
`[Y/n]` gate. Non-interactive runs must pass `--apply-metadata-patch`; `--yes` alone does not apply
reviewed metadata. After applying the patch, repo bootstrap reruns deployment fan-out so
reconciliation and the final SprinkleRef checks can use the reviewed values.

If live OpenTofu output differs from already-reviewed non-placeholder metadata, bootstrap still
fails closed. Stop and inspect the Infisical resources instead of applying a generated patch.

Generated local bootstrap artifacts stay local: `projects/config/local.json`, `.local/`,
`.terraform/`, `terraform.tfstate*`, and the OpenTofu `.terraform.lock.hcl` are ignored for this
repo. Do not commit individual-user config, OpenTofu state, or credential material.

To intentionally reset only local bootstrap state before starting fresh, use:

```bash
build-tools/tools/deployments/infisical-bootstrap-reset-local.ts --dry-run
build-tools/tools/deployments/infisical-bootstrap-reset-local.ts
```

The reset utility prints the generated paths and Keychain accounts it will remove, then requires
typing `RESET` unless `--yes` is passed. It removes only generated SprinkleRef/OpenTofu local state
and the `viberoots-bootstrap` macOS Keychain bootstrap/deployment Universal Auth entries. It does
not delete Infisical projects, identities, Cloudflare secrets, or application secrets.

`deployment --target <buck-target>` is the explicit deployment provisioning layer. The existing
Sample webapp Infisical OpenTofu project/environment/identity reconciliation and deployment Universal
Auth credential lifecycle live behind this mode.
Sample webapp is currently the only checked-in live deployment family; speculative
families should stay in temp fixtures until a product-approved plan PR adds
their real deployment packages.

Defaults:

- Infisical host: `https://app.infisical.com`.
- Login: enabled.
- OpenTofu init/plan/apply: enabled only for explicit deployment bootstrap.
- Confirmation: mutation-capable bootstrap requires either non-interactive `--yes` or an
  interactive `Y/n` prompt confirmation before any remote or local write.
- Repo deployment fan-out: enabled by default after repo setup; opt out with
  `--without-deployments`.
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
--without-deployments
--apply-metadata-patch
--no-login
--force-login
--access-token-env <env-name>
--tofu-dir <path>
--no-tofu-apply
--tofu-plan-file <path>
--rotate-bootstrap-credentials
--rotate-deployment-credentials
--force-overwrite-local-credentials
--machine-label <label>
--local-credential-file <path>
--sprinkle-category <category>
--credential-sink <auto|sprinkleref|macos-keychain|local-file>
```

`--infisical-host` is the preferred host selector. `--api-url` and `--cli-domain` are
implementation-level overrides for split API/CLI endpoint testing or future hosted variants; when
omitted, both default to the reviewed Sample webapp Infisical endpoint `https://app.infisical.com`.

`--yes` means “the operator has pre-confirmed this mutation-capable bootstrap for
non-interactive execution.” It does not mean “guess.” Non-dry-run bootstrap checks for `--yes` or an
interactive `Y/n` confirmation before opening Infisical, running OpenTofu, creating resolver config
files, or writing credential sinks. Use `--dry-run` for read-only inspection. If multiple
organizations are available and no explicit org selector was provided, login-based operator flows
still present the org list. If terminal input is unavailable, the command exits with a clear error.
`--no-login` token-based flows require an explicit `--org-name` or `--organization-id` before
authentication or mutation.

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
- `--no-login` must also provide exactly one of `--organization-id` or `--org-name`.
- Routine CI dependency setup should use `i --without-secrets` or
  `INSTALL_DEPS_WITHOUT_SECRETS=1`. Jobs that intentionally prepare local Infisical credentials
  may use `i --yes` or `INSTALL_DEPS_SETUP_SECRETS=1`.
- CI and other non-interactive non-dry-run bootstrap must provide `--yes`; local interactive
  operators may instead confirm the `Y/n` prompt. Missing confirmation fails before any Infisical,
  OpenTofu, resolver-config, or credential-sink mutation.
- Any missing interactive input must fail fast with remediation.

## Organization Selection

Users should not have to locate organization IDs manually.

Resolution order:

1. `--organization-id`: use directly.
2. `--org-name`: list accessible orgs and match exact name.
3. For login-based flows, if exactly one org is accessible and `--yes` is set: use it.
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
- Universal Auth identities are shared, but client-secret records are per operator machine.
- If the selected SprinkleRef/local sink already has this machine's credential, do nothing.
- If local credentials are missing, create a new labeled client-secret record for this machine and
  store it only in the selected local sink, even when other remote client-secret records already
  exist for the same identity.
- `--machine-label <label>` overrides the hostname-derived label used in newly created
  client-secret record descriptions.

Rotation:

- `--rotate-bootstrap-credentials` creates a new remote client secret for this machine and writes it to the selected sink.
- `--force-overwrite-local-credentials` controls local/sink overwrite when a new value is written.
- Old remote client secret records are not revoked or deleted by default unless a separate safe revocation flow is implemented.

Troubleshooting:

- Fresh machines: run `i` and accept the lazy setup prompt. The command creates a new per-machine
  Universal Auth client-secret record when local credentials are absent; users do not import another
  machine's secret.
- Stale macOS Keychain credentials: if local readiness fails or Universal Auth fails with an
  otherwise valid client id, treat the local secret as stale. Rerun
  `i --rotate-bootstrap-credentials --force-overwrite-local-credentials` so lazy setup creates a
  matching remote record and local sink value. If Keychain access is not available, use the advanced
  bootstrap command with `--credential-sink local-file`.
- Deleted remote Universal Auth records: Infisical cannot reveal an existing client secret after
  creation. If this machine's local credential no longer authenticates, rerun
  `i --rotate-bootstrap-credentials --force-overwrite-local-credentials` for repo bootstrap
  credentials or `i --rotate-deployment-credentials --force-overwrite-local-credentials` for
  deployment credentials so a new remote record and local sink value are created together.
- First-bootstrap metadata handoff: apply the generated `family.bzl` patch only when the mismatch is
  limited to first-bootstrap placeholders or empty reviewed fields. If the command reports drift
  against reviewed non-placeholder metadata, stop and inspect the live Infisical project before
  retrying.

## Deployment OpenTofu Infisical Stack

Deployment bootstrap should run OpenTofu for the Infisical stack by default. A successful explicit
deployment bootstrap command should leave the deployment Infisical project, environments,
identities, and bindings applied.

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

After OpenTofu apply, the bootstrap command reads non-secret deployment identity outputs, reconciles them with reviewed Sample webapp metadata, inspects Universal Auth client-secret record metadata for each deployment identity, and manages deployment access credentials through the selected SprinkleRef `bootstrap` category or explicit compatibility sink.

Policy:

- Do not print generated secrets.
- Do not store them in OpenTofu state.
- Do not store them in Infisical as the primary source of truth.
- Do not manage application secrets such as `cloudflare_api_token`.

Default behavior:

- Read OpenTofu outputs for deployment identity IDs and expected credential names/refs.
- Reconcile those non-secret outputs against checked-in reviewed metadata.
- Reuse this machine's local/resolver deployment credential when the selected sink already has it.
- Create a new labeled per-machine deployment client-secret record when the local/resolver value is
  missing, even when other remote records exist for the same deployment identity.
- Stop before overwriting this machine's existing local/resolver secret unless explicit rotation and
  local overwrite are both requested.

Rotation:

- `--rotate-deployment-credentials` creates new remote deployment Universal Auth client secrets for
  this machine and writes the new values to the selected sink.
- `--force-overwrite-local-credentials` is required before replacing existing selected-sink credential values.
- Old remote client-secret records are preserved unless a separate reviewed revocation flow is added.

## Infisical Runtime Metadata

Deployment targets select Infisical with the unified backend selector, for example
`secret_backend = "infisical/default"`. Non-default project config profiles use the same local alias
shape, such as `secret_backend = "infisical/regulated"`, which normalizes to the
`infisical-regulated` SprinkleRef profile. Bare backend values and separate
`secret_backend_profile` metadata are not accepted.

Deployment targets may declare `infisical_runtime` as non-secret routing and credential-source
metadata for Infisical-backed secret requirements. Accepted keys are:

- `site_url`
- `project_id`
- `environment`
- `secret_path`
- `secret_path_prefix`
- `machine_identity_client_id_env`
- `machine_identity_client_secret_env`
- `machine_identity_client_id_file_name`
- `machine_identity_client_secret_file_name`
- `machine_identity_id`
- `preferred_credential_source`
- `access_token_ttl_seconds`
- `access_token_max_uses`

These fields may name reviewed environment variables or non-secret routing identifiers, but they
must not contain secret values, personal tokens, access tokens, service tokens, exported `.env`
content, or rendered provider config.

Token-style env indirections are intentionally rejected. Do not add `token_env`,
`access_token_env`, `personal_token_env`, or `secret_value_env` to `infisical_runtime`; validation
reports each raw key as unsupported before value normalization, including object, array, boolean,
and number values.

## SprinkleRef Resolution

Stable references should stay backend-neutral. Do not encode concrete backends like `jenkins`, `github`, or `macos-keychain` in the URI.

Use the repo’s existing stable secret URI convention unless repo inspection proves a newer convention is required. Current examples suggest `secret://...`.

Example logical refs:

```text
secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-id
secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-secret
secret://deployments/sample-webapp/staging/infisical-client-id
secret://deployments/sample-webapp/staging/infisical-client-secret
secret://deployments/sample-webapp/prod/infisical-client-id
secret://deployments/sample-webapp/prod/infisical-client-secret
```

Repo-wide backend profiles such as `infisical-default` use the repo-scoped
`secret://viberoots/bootstrap/...` refs for their Universal Auth client id and secret. Sample webapp
deployment bootstrap still owns only the stage-specific managed workload refs under
`secret://deployments/sample-webapp/<stage>/...`.

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

The bootstrap command resolves `auto` through the canonical project config. `projects/config/shared.json`
defines shared resolver categories, backend profiles, environments, and runtime host profiles.
`projects/config/local.json` is the single ignored individual-user config file and may select
`activeRuntimeHost` or provide local non-secret values.

Runtime host selection no longer requires separate resolver files. The default loader deep-merges
`projects/config/shared.json` plus `projects/config/local.json` when present, then chooses a runtime
host from an explicit environment override, CI detection, local `activeRuntimeHost`, or the platform
fallback.

```text
projects/config/
  shared.json     # committed shared project config
  local.json      # gitignored individual-user config
```

Selection:

```bash
VBR_SPRINKLEREF_RUNTIME_HOST=local-file sprinkleref --add secret://...
sprinkleref --config projects/config/shared.json --add secret://...
```

`shared.json` should define stable category names, naming conventions, shared Infisical coordinates,
and the available runtime host backends. `local.json` contains only individual-user selections or
local non-secret values.

Example shared project config:

```json
{
  "schemaVersion": "viberoots-project-config@1",
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
    "defaultCategory": "control",
    "categories": {
      "main": { "profile": "infisical-default" },
      "control": { "profile": "infisical-control" }
    },
    "profiles": {
      "infisical-default": {
        "backend": "infisical",
        "host": "https://app.infisical.com",
        "projectId": "<repo-infisical-project-id>",
        "defaultEnvironment": "staging",
        "defaultPath": "/",
        "clientIdRef": "secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-id",
        "clientSecretRef": "secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-secret"
      }
    }
  }
}
```

Example individual local config:

```json
{
  "schemaVersion": "viberoots-project-local-config@1",
  "activeRuntimeHost": "local-macos"
}
```

In the macOS Keychain runtime host, `service` is the Keychain generic-password service/group name.
The logical `secret://...` ref can be used as the Keychain account/name. For example:

```text
service: viberoots-bootstrap
account: secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-secret
```

The bootstrap command should:

- read the canonical project config overlay, or an explicit `SPRINKLEREF_CONFIG` path when set;
- create `projects/config/shared.json` during confirmed repo bootstrap if shared config is missing;
- validate or materialize repo-wide `infisical-*` and `vault-*` backend profiles;
- materialize Infisical profile credentials under repo-scoped
  `secret://viberoots/bootstrap/...` refs, not a deployment family namespace;
- create or select the repo-level Infisical project when a selected profile needs one;
- validate existing operator-authored Infisical profile `projectId` values against the selected
  organization and preserve those profiles, including custom credential refs, endpoint, environment,
  and path fields;
- preserve operator-authored profiles that use `projectIdEnv`; validate the resolved value when the
  environment variable is present, and fail closed without rewriting when it is unset;
- rewrite only missing Infisical profiles or profiles marked
  `generatedBy: "viberoots-repo-bootstrap"`;
- validate Vault profile address/token/mount metadata against Vault when configured env values are
  available, otherwise fail with remediation naming the missing bootstrap env;
- materialize the configured local bootstrap sink path, or validate the macOS Keychain service name;
- default local macOS `bootstrap` to macOS Keychain;
- default non-macOS local `bootstrap` to local `0600` files;
- default `main` to Infisical once OpenTofu has created the project;
- never hide backend selection in code when a resolver config can make it explicit.

With `--credential-sink auto`, bootstrap first uses `SPRINKLEREF_CONFIG` when explicitly set;
otherwise it uses `projects/config/shared.json` plus the ignored `projects/config/local.json` overlay.
If shared project config is missing during confirmed repo bootstrap, it creates the starter
`projects/config/shared.json`; `sprinkleref --init-local` creates or updates
`projects/config/local.json` for individual-user selections. Existing shared resolver metadata is
authoritative and is not overwritten unless a profile is missing or generated by the rule above. In
`--dry-run`, bootstrap reports the starter backend it would use plus a `materializationPlan` for
backend login, Infisical project validation/creation, Vault mount/profile validation, resolver
profile creation, `validatedExistingProfiles`, `materializedProfiles`, and bootstrap sink setup, but
does not create project config files or call backends. Operator-authored profiles whose
`projectIdEnv` is unset appear in `unresolvedExistingProfiles`, not `validatedExistingProfiles`, so
dry-run does not claim confirmed bootstrap would preserve a profile it cannot validate. To
intentionally regenerate an
operator-authored profile, remove that profile or add the generated marker before rerunning repo
bootstrap.
Dry-run and confirmed repo bootstrap use the same deterministic backend profile set for validation
and materialization: profiles required by the deployment graph plus active resolver category-selected
profiles. This can surface an unresolved operator-authored Infisical profile even when the current
deployment graph only requires another backend, because confirmed bootstrap validates active
category selections before mutation.
Deployment graph nodes with secret requirements and omitted `secret_backend` still require the
implicit `vault/default` profile during repo bootstrap profile discovery and resolver validation.

Deployment bootstrap performs this resolver-config creation or validation before opening Infisical,
running OpenTofu, or writing any credential sink output. Missing `--yes` and unsafe bootstrap
category mappings fail without local resolver, remote Infisical, OpenTofu, or credential mutations.

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
sprinkleref --add secret://deployments/sample-webapp/staging/cloudflare-api-token
sprinkleref --update secret://deployments/sample-webapp/staging/cloudflare-api-token
sprinkleref --remove secret://deployments/sample-webapp/staging/cloudflare-api-token
```

The exact binary path can follow repo conventions, but the user-facing interface should be `sprinkleref --add`, `sprinkleref --update`, and `sprinkleref --remove` or equivalent subcommands. It should operate on stable logical refs and resolve the storage backend through the selected category.

Required flags/capabilities:

- `--category <name>` optionally selects the SprinkleRef resolver category.
- If `--category` is omitted, use the main/default secret backend category. For this deployment, that resolves to Infisical after bootstrap.
- `--category bootstrap` writes to the bootstrap/control-plane backend, not Infisical. Use this for credentials required to access Infisical or Vault. Generic SprinkleRef add, update, remove, check, and resolver-entry edit paths reject `bootstrap` when it resolves to an Infisical backend or an Infisical profile.
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
  --add secret://deployments/sample-webapp/staging/cloudflare-api-token \
  --value-env CLOUDFLARE_API_TOKEN

sprinkleref \
  --update secret://deployments/sample-webapp/prod/cloudflare-api-token \
  --value-file .local/secrets/cloudflare-prod-token

sprinkleref \
  --remove secret://deployments/sample-webapp/staging/cloudflare-api-token

sprinkleref \
  --add secret://deployments/sample-webapp/staging/infisical-client-secret \
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
1. Sample webapp (org_...)
2. Sandbox (org_...)

No organization was selected because this terminal is non-interactive.
No Infisical resources were changed.

Fix:
  rerun with --org-name "Sample webapp" --yes
  or pass --organization-id <id>.
```

```text
Infisical bootstrap needs confirmation before mutation-capable execution.
No Infisical resources, resolver config, or credential sink output was changed.

Fix:
  rerun with --yes
  rerun from an interactive terminal and confirm the prompt
  or use --dry-run for read-only inspection
```

```text
OpenTofu plan failed.
Working directory: projects/deployments/sample-webapp/infisical/opentofu
Saved plan: .local/sample-webapp-infisical.tfplan
Retry: cd projects/deployments/sample-webapp/infisical/opentofu && tofu plan -out=.local/sample-webapp-infisical.tfplan
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
