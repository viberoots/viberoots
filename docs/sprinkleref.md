# SprinkleRef Resolver

SprinkleRef stable refs stay backend-neutral. Use `secret://deployments/...` for true secrets and
`config://...` or `runtime://...` for non-secret declarations, then select the storage backend
through a resolver config and optional category.

Project config lives outside deployment metadata:

```text
projects/config/shared.json
projects/config/local.json
```

`projects/config/shared.json` is checked in and contains repo-wide non-secret routing metadata such
as Infisical project coordinates, environments, runtime host profiles, resolver categories, and
logical refs. `projects/config/local.json` is gitignored and contains individual operator values,
such as local bootstrap sink selection, local file paths, and local AWS/Supabase sandbox
coordinates. The tool loads shared config first, then deep-merges local config over it. When local
config changes a shared value, commands report an `Active local overrides` section with redacted
secret-like values. Set `VBR_DISALLOW_LOCAL_OVERRIDES=1` when a strict run should fail if any local
override is active.

`defaultCategory` is normally `main`. Omitted `--category` uses that category for ordinary
deployment and application secrets. `--category bootstrap` is reserved for root credentials needed
to access Infisical or Vault, so it must resolve to a non-Infisical backend such as macOS Keychain
or restrictive local files.
That bootstrap safety guard applies both to standalone `sprinkleref` commands and to higher-level
AWS account stack ref resolution when stack config or local values explicitly choose
`category: "bootstrap"`.

Initialize starter configs:

```bash
sprinkleref --init
sprinkleref --init-local
```

Repo-wide bootstrap also uses this resolver shape:

```bash
build-tools/tools/deployments/infisical-bootstrap.ts repo --dry-run
build-tools/tools/deployments/infisical-bootstrap.ts repo
sprinkleref --check
```

With `--credential-sink auto`, repo bootstrap uses the canonical project config path. If
`projects/config/shared.json` does not exist and `--yes` has already passed bootstrap preflight, it
creates the starter shared config. Dry-run bootstrap reports the starter backend without creating
config files. Confirmed repo bootstrap offers a second deployment fan-out prompt by default so
managed deployment bootstrap outputs can be created after repo setup. Use
`repo --without-deployments` to stop after resolver/profile setup, or retry one scope directly with
`deployment --target <buck-target>`.

`sprinkleref --init-local` creates or updates `projects/config/local.json` with empty placeholders
for private coordinates and a non-plaintext ref object for
`secret://control-plane/supabase/management-api-token`. Empty coordinate placeholders remain
unresolved until filled. A present local config file must parse to an object root; scalar or array
roots fail as malformed project config rather than being treated as a missing file. Evidence records
`localValuesPath` for the JSON file and `localValuesEntryPath` for the resolved hierarchical entry,
for example `values.control-plane.aws.account-id`. Local redirect evidence keeps the local ref in
`ref` and records the redirected target as `redirectRef` with `redirectSource` details. The command
also prints the normal token write command for the canonical project config:

```bash
sprinkleref --update secret://control-plane/supabase/management-api-token --create-missing
```

Add `--category bootstrap` only when the stack field or local value explicitly opts into the
bootstrap category. It never writes a plaintext token placeholder.

Generated AWS account setup refs declare `category: "control"` in stack config. Resolver code does
not infer a category from `control-plane` ref prefixes. When a stack ref declares a category
explicitly, that category resolves the original logical ref and wins over matching local scalar,
`{ "value": ... }`, and redirect entries, including redirects to a different target ref. Stack refs
without an explicit category continue to use local values first.

Project config may define named backend profiles separately from categories. Profiles name backend
instances/accounts, while categories name usage lanes:

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
    "defaultCategory": "main",
    "profiles": {
      "infisical-default": {
        "backend": "infisical",
        "host": "https://app.infisical.com",
        "projectId": "<repo-infisical-project-id>",
        "defaultEnvironment": "staging",
        "clientIdEnv": "INFISICAL_MACHINE_IDENTITY_CLIENT_ID",
        "clientSecretEnv": "INFISICAL_MACHINE_IDENTITY_CLIENT_SECRET"
      }
    },
    "categories": {
      "main": { "profile": "infisical-default" }
    }
  }
}
```

Runtime hosts choose the `bootstrap` category for the current execution context. Local config can
set `activeRuntimeHost`, CI environments are detected for GitHub Actions, Jenkins, GitLab CI, and
Bitbucket Pipelines, and `VBR_SPRINKLEREF_RUNTIME_HOST` can force a host explicitly.

Infisical profiles use Universal Auth env names only: `clientIdEnv` and `clientSecretEnv`.
`tokenEnv` remains valid for Vault profiles, but Infisical resolver profiles reject raw token env
credentials.

Infisical storage is the only backend that splits logical refs into native UI coordinates.
SprinkleRef keeps refs backend-neutral, then strips the URI scheme for Infisical: for example
`secret://control-plane/supabase/management-api-token` is stored in environment `prod`, folder
`/control-plane/supabase`, and UI key `management-api-token`. Add, update, read, check, and remove
all use that same mapping. The full logical ref is preserved as Infisical metadata named
`sprinkleref` when the backend API accepts metadata; do not create Infisical keys containing
`secret://`, `config://`, or `runtime://`.

## Moving from older local files

The canonical project config replaced the earlier `config/sprinkleref/*` resolver files. Those
paths are not compatibility inputs. Move any still-useful values into the new files and delete the
old files.

- Move repo-wide resolver policy, shared backend coordinates, named environments, runtime host
  profiles, and shared non-secret values into `projects/config/shared.json`.
- Move individual operator values, active runtime host selection, and local-only backend file paths
  into `projects/config/local.json`.
- Move entries from `config/sprinkleref/local/values.json` into the `values` object in
  `projects/config/local.json`.
- Replace `config/sprinkleref/selected.local.json` with either local overrides in
  `projects/config/local.json` or shared category/profile selection in `projects/config/shared.json`.
- Fold prior `config/sprinkleref/local.*.json` and `config/sprinkleref/ci.*.json` resolver variants
  into `runtimeHosts` entries in the shared file, with the clone-specific active selection in the
  local file when needed.

Example local values move:

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

Example runtime host move:

```json
{
  "schemaVersion": "viberoots-project-config@1",
  "runtimeHosts": {
    "github-actions": {
      "backend": "github-actions",
      "scope": "repository",
      "namePrefix": "VIBEROOTS_"
    },
    "local-macos": {
      "backend": "macos-keychain",
      "service": "viberoots-bootstrap"
    }
  }
}
```

One-time Infisical cleanup note: if an operator-authored root-level test secret exists from earlier
experiments, move or recreate only that Infisical record under its derived coordinates. For example,
an old root-level key `management-api-token` should move to folder `/control-plane/supabase` with key
`management-api-token`. SprinkleRef does not search the old root-level location. The logical
SprinkleRef identifier stays `secret://control-plane/supabase/management-api-token`, and
non-Infisical backends do not need this cleanup.

Generated starter configs use generic env-name based profile metadata. Confirmed
`infisical-bootstrap repo` validates those profiles and writes or preserves real non-secret
backend metadata, such as an Infisical `projectId`, before deployment bootstrap consumes them.
Repo dry-run is read-only and reports a `materializationPlan` showing whether backend login,
Infisical project validation/creation, Vault profile/mount validation, resolver profile creation,
bootstrap sink setup, or deployment fan-out would be needed. Add `--yes` only when the prompts must
be pre-confirmed non-interactively.

Deployment metadata selects these profiles through `secret_backend =
"<backend>/<profile-alias>"`. For example, `secret_backend = "infisical/default"` selects the
`infisical-default` profile, while `secret_backend = "vault/regulated"` selects
`vault-regulated`. Deployment metadata does not expose a separate profile field; keep resolver
profile selection in the unified selector.

Add, update, or remove ordinary secrets:

```bash
sprinkleref \
  --add secret://deployments/pleomino/staging/cloudflare_api_token

sprinkleref \
  --add secret://deployments/pleomino/staging/cloudflare_api_token \
  --overwrite-existing

sprinkleref \
  --update secret://deployments/pleomino/prod/cloudflare_api_token \
  --value-file .local/secrets/cloudflare-prod-token

sprinkleref \
  --update secret://deployments/pleomino/prod/new_runtime_secret \
  --create-missing \
  --value-file .local/secrets/new-runtime-secret

sprinkleref \
  --remove secret://deployments/pleomino/staging/cloudflare_api_token
```

When no `--value-env` or `--value-file` is supplied, the command prompts for the value instead of
accepting it as a shell argument. The command never prints secret values. `--dry-run` reports the
resolved category and backend without reading or writing the value. `--remove` requires an
interactive confirmation unless `--yes` is supplied.

`--add` fails when the target ref already exists. Pass `--overwrite-existing` only when the
operator deliberately wants `--add` to replace the existing backend value. `--update` fails when
the target ref is missing. Pass `--create-missing` only when the operator deliberately wants
`--update` to create that backend value.

Resolver category edits use the same explicit collision policy with `--resolver-entry`: adding an
existing category requires `--overwrite-existing`, and updating a missing category requires
`--create-missing`. Resolver entries describe backend selection and non-secret routing metadata
only; secret values must be supplied to ordinary `--add` or `--update` operations through
`--value-env`, `--value-file`, or the prompt.

For bootstrap credentials:

```bash
sprinkleref \
  --add secret://deployments/pleomino/staging/infisical-client-secret \
  --category bootstrap
```

Runtime host profiles are shared project config entries for GitHub Actions, Jenkins, GitLab CI/CD,
Bitbucket Pipelines, and local execution. This command does not perform remote CI provider writes.

Check repository deployment contract references before bootstrap, admission, deployment, or CI
validation:

```bash
sprinkleref --check
sprinkleref --check --scheme secret
sprinkleref --check --target //projects/deployments/pleomino/staging:deploy
sprinkleref --check --target //projects/deployments/pleomino/staging:deploy --no-deps
sprinkleref --check --format json
```

`--check` scans tracked repository files for `secret://`, `config://`, and `runtime://` references
while skipping generated output and dependency directories. `secret://` refs are presence-checked
through the canonical project config by default, or through an explicit config when one is supplied.
`config://` and `runtime://` refs are non-secret contract declarations and are not looked up in
secret stores.

Target checks use Buck metadata and default to transitive dependencies. Use `--deps none`,
`--deps direct`, `--deps transitive`, or `--no-deps` to adjust the target closure. Target output
separates refs declared directly by the selected target from refs inherited from dependencies.
Exit codes are stable: `0` for OK or intentionally unchecked refs, `1` for missing, unmapped, or
invalid refs, `2` for resolver/backend access errors, and `3` for usage or scanner errors.
