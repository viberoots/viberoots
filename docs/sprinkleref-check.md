# SprinkleRef Check Design

## Intent

`sprinkleref --check` inventories deployment contract references in the repository and reports
whether each reference is declared, mapped, and satisfiable by the appropriate resolver or runtime
configuration source.

The command is a reference checker, not a secret dumper. It must never print resolved secret values.
It should make missing or stale references visible before bootstrap, admission, deployment, or CI
jobs mutate external state.

## Contract Schemes

The repository already uses three deployment contract URI schemes:

- `secret://` for sensitive secret contract IDs.
- `config://` for non-secret public runtime config contract IDs.
- `runtime://` for non-secret runtime input contract IDs.

`sprinkleref --check` treats these as first-class deployment contract refs. Other URI schemes such
as `https://`, `s3://`, `evidence://`, or `approval://` are ignored unless a later design adds them.

## Command Shape

Initial command forms:

```bash
build-tools/tools/deployments/sprinkleref.ts --check
build-tools/tools/deployments/sprinkleref.ts --check --scheme secret
build-tools/tools/deployments/sprinkleref.ts --check --scheme config
build-tools/tools/deployments/sprinkleref.ts --check --scheme runtime
build-tools/tools/deployments/sprinkleref.ts --check --all
build-tools/tools/deployments/sprinkleref.ts --check --format json
build-tools/tools/deployments/sprinkleref.ts --check --config sprinkleref/local.macos.json
build-tools/tools/deployments/sprinkleref.ts --check --category bootstrap
build-tools/tools/deployments/sprinkleref.ts --check --target //projects/deployments/pleomino-staging:deploy
build-tools/tools/deployments/sprinkleref.ts --check --target //projects/deployments/pleomino-staging:deploy --no-deps
build-tools/tools/deployments/sprinkleref.ts --check --target //projects/apps/pleomino:app --deps transitive
```

`--check` should default to all supported deployment contract schemes. Scheme filters narrow the
report without changing validation semantics. `--all` is accepted as an explicit alias for the
default all-schemes check.

When `--target` is supplied, the command should use Buck2 to scope discovery to the selected target.
Target-scoped checks should default to transitive dependencies because operators usually need to
know every value required by an app or deployment and its dependency closure. `--no-deps` should
limit the report to refs directly declared by the selected target. If a richer option is useful,
`--deps none|direct|transitive` can replace or supplement `--no-deps`.

## Discovery

The checker should scan tracked repository files by default and skip generated or dependency
directories such as `.git`, `buck-out`, and `node_modules`.

The scanner should discover literal references matching:

```text
secret://...
config://...
runtime://...
```

For the first implementation, source locations should include the file path and line number where a
reference appears. Later work can add structured scanners for deployment metadata, cquery output,
OpenTofu output, or admitted run records, but the baseline command should not depend on live
deployment systems.

## Buck Target Scope

`sprinkleref --check --target <buck-target>` should answer a different question from repo-wide text
scanning: which deployment contract values are needed for this target to build, deploy, publish,
provision, smoke, or run?

The preferred source is structured Buck/deployment metadata, not arbitrary text. Target-scoped
discovery should inspect available requirement surfaces such as:

- `secret_requirements`
- `runtime_config_requirements`
- GitHub App requirement profiles that emit `runtime://...` refs
- external deployment requirement profiles that emit `secret://...` and `config://...` refs
- provider target metadata or generated deployment metadata that declares contract refs

The human report should distinguish direct requirements from dependency-derived requirements with
separate `Direct refs` and `From dependencies` sections:

```text
SprinkleRef check for //projects/deployments/pleomino-staging:deploy

Direct refs
  OK
    secret://deployments/pleomino/cloudflare_api_token
      required by //projects/deployments/pleomino-staging:deploy

From dependencies
  Missing
    config://deployments/supabase/public_url/prod
      required by //projects/apps/pleomino:server
```

JSON output should preserve the same distinction:

```json
{
  "target": "//projects/deployments/pleomino-staging:deploy",
  "deps": "transitive",
  "refs": [
    {
      "ref": "secret://deployments/pleomino/cloudflare_api_token",
      "scope": "direct",
      "requiredBy": ["//projects/deployments/pleomino-staging:deploy"],
      "scheme": "secret",
      "sensitive": true,
      "status": "present"
    },
    {
      "ref": "config://deployments/supabase/public_url/prod",
      "scope": "dependency",
      "requiredBy": ["//projects/apps/pleomino:server"],
      "scheme": "config",
      "sensitive": false,
      "status": "missing"
    }
  ]
}
```

If Buck metadata for a target cannot expose structured requirement data, the command should fail
with a clear target-scope error or mark refs as `Unchecked`; it should not silently fall back to
repo-wide text scanning while claiming the output is target-scoped.

## Satisfaction Rules

### `secret://`

Secret refs are satisfied when the selected SprinkleRef resolver config maps the ref to an allowed
secret backend and that backend can confirm the ref is present.

The checker may report backend kind, category, and non-secret storage location. It must not read or
print secret values unless a backend needs a read probe that returns only presence metadata.

### `config://`

Config refs are non-secret runtime config contracts. In repo-wide text scanning, a discovered
`config://` ref is reported as declared because it is not a secret backend entry. In target-scoped
checks, it is satisfied when the selected target closure exposes the ref through deployment
requirement metadata.

The checker may print non-secret values only when the value is present in reviewed checked-in
metadata or an explicitly supplied local config source. JSON output should mark these refs as
`sensitive: false`.

### `runtime://`

Runtime refs are non-secret runtime inputs. In repo-wide text scanning, a discovered `runtime://`
ref is reported as declared because it is not a secret backend entry. In target-scoped checks, it is
satisfied when the selected target closure exposes the ref through deployment requirement metadata
for the relevant lifecycle step.

The checker should report declaration and source information before it attempts value lookup.

## Report Categories

Human output should group refs by status:

- `OK`: declared, mapped, and present enough for the selected check.
- `Missing`: mapped or declared, but not present in the expected backend/source.
- `Unmapped`: discovered in repo text but no resolver category or declaration owns it.
- `Invalid`: malformed or violates backend-neutral naming policy.
- `Unchecked`: discovered but intentionally skipped because no resolver config or source was
  supplied for that scheme.

JSON output should use the same model:

```json
{
  "summary": {
    "present": 10,
    "declared": 2,
    "missing": 2,
    "unmapped": 2,
    "invalid": 1,
    "unchecked": 0
  },
  "refs": [
    {
      "ref": "secret://deployments/pleomino/prod/cloudflare_api_token",
      "scheme": "secret",
      "sensitive": true,
      "status": "missing",
      "category": "bootstrap",
      "backend": "local-file",
      "locations": ["projects/deployments/pleomino-shared/family.bzl:12"]
    }
  ]
}
```

## Exit Codes

- `0`: all checked refs are OK or intentionally unchecked.
- `1`: one or more refs are missing, unmapped, or invalid.
- `2`: resolver config or backend access failed.
- `3`: scanner or command usage error.

## Redaction

`sprinkleref --check` must never print:

- Secret values.
- Universal Auth client secrets.
- Personal access tokens.
- Provider API tokens.
- Raw backend responses that may contain secret material.

It may print non-secret contract IDs, backend names, category names, file paths, line numbers, and
reviewed non-secret config values when the scheme is `config://` or `runtime://`.

## Open Questions

- Whether checked-in docs should be scanned by default or only source/config files.
- Whether non-secret `config://` and `runtime://` value display should be opt-in with
  `--show-non-secret-values`.
- Whether CI should require zero `Unchecked` refs or allow them when a backend config is not
  available.
- Whether target-scoped checks should expose only `--no-deps` or the fuller
  `--deps none|direct|transitive` option.
