# Infisical Bootstrap

The canonical operator entrypoint is:

```bash
build-tools/tools/deployments/infisical-bootstrap.ts repo --dry-run
build-tools/tools/deployments/infisical-bootstrap.ts repo
build-tools/tools/deployments/infisical-bootstrap.ts repo --yes
build-tools/tools/deployments/infisical-bootstrap.ts repo --without-deployments
build-tools/tools/deployments/infisical-bootstrap.ts deployment --target <buck-target> --dry-run
build-tools/tools/deployments/infisical-bootstrap.ts deployment --target <buck-target> --yes
```

Use `--yes` for non-interactive pre-confirmation. Local interactive operators may omit `--yes` and
confirm the repo setup and deployment fan-out prompts; CI and other non-interactive flows must pass
`--yes`. Use `repo --without-deployments` when only resolver/profile setup should run, then retry a
single deployment later with `deployment --target <buck-target>`.

This document intentionally redirects to the repo-root bootstrap spec at
[`infisical-bootstrap.md`](../infisical-bootstrap.md). Keep command examples there and here on the
same `repo` or `deployment --target <buck-target>` mode vocabulary.

Pleomino deployment targets use canonical family labels such as
`//projects/deployments/pleomino/staging:deploy`. The old flat
`projects/deployments/pleomino-*` packages are migration history; see
[`pleomino-deployment-directory-migration.md`](pleomino-deployment-directory-migration.md).

Repo bootstrap materializes backend profile credentials under repo-scoped refs such as
`secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-id`. Pleomino deployment bootstrap
continues to report only stage-specific managed workload refs under
`secret://deployments/pleomino/<stage>/...`. If local `sprinkleref/selected.local.json` still
points profile auth at the old Pleomino bootstrap namespace, rerun `infisical-bootstrap.ts repo`.

Token-based `--no-login` bootstrap flows must pass exactly one of `--org-name` or
`--organization-id`; login-based operator flows may still use interactive or `--yes` single-org
discovery.
