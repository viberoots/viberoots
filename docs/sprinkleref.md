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

Add, update, or remove ordinary secrets:

```bash
build-tools/tools/deployments/sprinkleref.ts \
  --config sprinkleref/local.macos.json \
  --add secret://deployments/pleomino/staging/cloudflare_api_token

build-tools/tools/deployments/sprinkleref.ts \
  --config sprinkleref/local.macos.json \
  --update secret://deployments/pleomino/prod/cloudflare_api_token \
  --value-file .local/secrets/cloudflare-prod-token

build-tools/tools/deployments/sprinkleref.ts \
  --config sprinkleref/local.macos.json \
  --remove secret://deployments/pleomino/staging/cloudflare_api_token
```

When no `--value-env` or `--value-file` is supplied, the command prompts for the value instead of
accepting it as a shell argument. The command never prints secret values. `--dry-run` reports the
resolved category and backend without reading or writing the value. `--remove` requires an
interactive confirmation unless `--yes` is supplied.

For bootstrap credentials:

```bash
build-tools/tools/deployments/sprinkleref.ts \
  --config sprinkleref/local.file.json \
  --add secret://deployments/pleomino/staging/infisical-client-secret \
  --category bootstrap
```

CI resolver templates are generated and parsed as read-only mappings for GitHub Actions, Jenkins,
GitLab CI/CD, and Bitbucket Pipelines. This command does not perform remote CI provider writes.
