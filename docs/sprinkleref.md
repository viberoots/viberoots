# SprinkleRef Resolver

SprinkleRef stable refs stay backend-neutral. Use `secret://deployments/...` for the logical secret
identity, then select the storage backend through a resolver config and optional category.

Resolver configs live outside deployment metadata:

```text
sprinkleref/base.json
sprinkleref/local.macos.json
sprinkleref/local.file.json
sprinkleref/ci.github.json
sprinkleref/ci.jenkins.json
sprinkleref/ci.gitlab.json
sprinkleref/ci.bitbucket.json
```

`defaultCategory` is normally `main`. Omitted `--category` uses that category for ordinary
deployment and application secrets. `--category bootstrap` is reserved for root credentials needed
to access Infisical or Vault, so it must resolve to a non-Infisical backend such as macOS Keychain
or restrictive local files.

Initialize starter configs:

```bash
build-tools/tools/deployments/sprinkleref.ts --init sprinkleref
```

The Infisical bootstrap command also uses this resolver shape. With `--credential-sink auto`, it
uses `SPRINKLEREF_CONFIG` when set, then an existing `sprinkleref/selected.local.json`. If neither
exists and `--yes` has already passed bootstrap preflight, it creates the starter config set and
uses `selected.local.json` so the `bootstrap` backend choice is visible in config instead of hidden
inside bootstrap code. Dry-run bootstrap reports the starter backend without creating the config
files. Existing resolver configs are treated as authoritative.

Add, update, or remove ordinary secrets:

```bash
build-tools/tools/deployments/sprinkleref.ts \
  --config sprinkleref/local.macos.json \
  --add secret://deployments/pleomino/staging/cloudflare_api_token

build-tools/tools/deployments/sprinkleref.ts \
  --config sprinkleref/local.macos.json \
  --add secret://deployments/pleomino/staging/cloudflare_api_token \
  --overwrite-existing

build-tools/tools/deployments/sprinkleref.ts \
  --config sprinkleref/local.macos.json \
  --update secret://deployments/pleomino/prod/cloudflare_api_token \
  --value-file .local/secrets/cloudflare-prod-token

build-tools/tools/deployments/sprinkleref.ts \
  --config sprinkleref/local.macos.json \
  --update secret://deployments/pleomino/prod/new_runtime_secret \
  --create-missing \
  --value-file .local/secrets/new-runtime-secret

build-tools/tools/deployments/sprinkleref.ts \
  --config sprinkleref/local.macos.json \
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
build-tools/tools/deployments/sprinkleref.ts \
  --config sprinkleref/local.file.json \
  --add secret://deployments/pleomino/staging/infisical-client-secret \
  --category bootstrap
```

CI resolver templates are generated and parsed as read-only mappings for GitHub Actions, Jenkins,
GitLab CI/CD, and Bitbucket Pipelines. This command does not perform remote CI provider writes.
