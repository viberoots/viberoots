# Infisical Bootstrap

The canonical operator entrypoint is:

```bash
build-tools/tools/deployments/infisical-bootstrap.ts repo --dry-run
build-tools/tools/deployments/infisical-bootstrap.ts repo
build-tools/tools/deployments/infisical-bootstrap.ts repo --yes
build-tools/tools/deployments/infisical-bootstrap.ts repo --yes --apply-metadata-patch
build-tools/tools/deployments/infisical-bootstrap.ts repo --without-deployments
build-tools/tools/deployments/infisical-bootstrap.ts deployment --target <buck-target> --dry-run
build-tools/tools/deployments/infisical-bootstrap.ts deployment --target <buck-target> --yes
```

Use `--yes` for non-interactive pre-confirmation. Local interactive operators may omit `--yes` and
confirm the repo setup and deployment fan-out prompts; CI and other non-interactive flows must pass
`--yes`. Use `repo --without-deployments` when only resolver/profile setup should run, then retry a
single deployment later with `deployment --target <buck-target>`.

Fresh Pleomino Infisical bootstrap is a two-phase reviewed metadata handoff. If OpenTofu creates or
adopts live resources while `family.bzl` still has first-bootstrap placeholders, repo bootstrap
prints a non-secret patch for the reviewed constants and pauses before applying it. Interactive
operators can approve the `[Y/n]` metadata gate; non-interactive runs must add
`--apply-metadata-patch`. Real drift against already-reviewed non-placeholder values still fails
closed.

This document intentionally redirects to the repo-root bootstrap spec at
[`infisical-bootstrap.md`](../infisical-bootstrap.md). Keep command examples there and here on the
same `repo` or `deployment --target <buck-target>` mode vocabulary.

Pleomino deployment targets use canonical family labels such as
`//projects/deployments/pleomino/staging:deploy`. The old flat
`projects/deployments/pleomino-*` packages are migration history; see
[`pleomino-deployment-directory-migration.md`](pleomino-deployment-directory-migration.md).
Pleomino is currently the only checked-in live deployment family; new families
should be introduced only through an explicit product-approved plan PR.

Repo bootstrap materializes backend profile credentials under repo-scoped refs such as
`secret://viberoots/bootstrap/viberoots-iac-bootstrap/client-id`. Pleomino deployment bootstrap
continues to report only stage-specific managed workload refs under
`secret://deployments/pleomino/<stage>/...`. If local `sprinkleref/selected.local.json` still
points profile auth at the old Pleomino bootstrap namespace, rerun
`build-tools/tools/deployments/infisical-bootstrap.ts repo`.
Existing operator-authored Infisical profiles are preserved once their `projectId` validates in the
selected organization.
Bootstrap rewrites only missing profiles, profiles with `generatedBy: "viberoots-repo-bootstrap"`,
or untouched legacy starter profiles that exactly match the old `VBR_INFISICAL_*` starter shape.
That legacy shape is exactly `backend: "infisical"`, `host: "https://app.infisical.com"`,
`projectIdEnv: "VBR_INFISICAL_PROJECT_ID"`, `defaultEnvironment: "staging"`, `defaultPath: "/"`,
`clientIdEnv: "VBR_INFISICAL_CLIENT_ID"`, and
`clientSecretEnv: "VBR_INFISICAL_CLIENT_SECRET"` with no other keys. Additional fields such as
`namespace`, custom refs, or future resolver metadata make the profile operator-authored.
To intentionally regenerate a profile, remove that profile or add the generated marker before
rerunning repo bootstrap.
Profiles that use operator-authored `projectIdEnv` are also preserved; confirmed bootstrap validates
the resolved env value when present and fails closed without rewriting the profile when the env var
is unset. Repo dry-run mirrors that closed state by reporting the profile in
`unresolvedExistingProfiles` instead of `validatedExistingProfiles`.
Repo dry-run reports the same backend profile set confirmed repo bootstrap will validate or
materialize: graph-required profiles plus active profiles selected by resolver categories, even when
the current deployment graph does not require that category-selected backend.
Deployment graph nodes with secret requirements and omitted `secret_backend` contribute the implicit
`vault/default` profile to repo bootstrap discovery, matching deployment metadata normalization.

Token-based `--no-login` bootstrap flows must pass exactly one of `--org-name` or
`--organization-id`; login-based operator flows may still use interactive or `--yes` single-org
discovery.

Expected local bootstrap artifacts are ignored and should not be committed: `sprinkleref/`, the
OpenTofu `.terraform/` directory, `terraform.tfstate*`, and `.terraform.lock.hcl`.

Troubleshooting:

- Stale macOS Keychain bootstrap credentials usually appear as Universal Auth login failures after
  repo metadata still validates. Rerun `build-tools/tools/deployments/infisical-bootstrap.ts repo
--dry-run` to confirm the selected sink, then rotate with `--rotate-bootstrap-credentials` or
  switch to `--credential-sink local-file` if local Keychain access is unavailable.
- Deleted remote Universal Auth client-secret records are not recoverable from Infisical; the
  client secret is only available when created. If the remote record was deleted or the local sink no
  longer has the matching value, rerun repo bootstrap with the appropriate rotation flag instead of
  editing reviewed deployment metadata.
- First-bootstrap metadata handoff is expected only when reviewed values are placeholders or empty
  first-bootstrap fields. Drift against already-reviewed project ids, identity ids, environment
  slugs, secret names, or refs requires a human Infisical review before retrying.
- The generated first-bootstrap patch is applied by reviewed constant and stage key. Duplicate
  placeholder or live-looking values in comments, Vault metadata, stable refs, or unrelated
  constants are intentionally ignored.
