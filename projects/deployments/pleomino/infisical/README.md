# Pleomino Infisical Backend

This package owns the non-secret Infisical infrastructure for the Pleomino
staging and production deployment-secret cutover.

The OpenTofu module in `opentofu/main.tf` is parameterized by Infisical host,
organization id, project name and slug, environment slugs, root secret path,
secret names, stage-specific machine identity names, and control-plane
credential-file names. It creates the Pleomino Secrets Management project,
`staging` and `prod` environments, stage-specific machine identities, Universal
Auth configuration, and project identity bindings.

After apply, reconcile the non-secret `deployment_runtime_metadata` output with
the checked-in Pleomino deployment metadata before live rollout. The project id
and machine identity ids in deployment metadata must be the Infisical ids, not
the project name or slug.

The module intentionally does not manage real `cloudflare_api_token` values or
write placeholder values. The Infisical provider has an `infisical_secret`
resource with write-only value support, but PR-12 must not create even dummy
application secret values through IaC. The module therefore emits
`cloudflare_secret_metadata_reconciliation` as the reviewed provider-gap
handoff:

- Object name: `pleomino-deployments/staging/cloudflare_api_token`
- Expected result: shared Infisical secret `cloudflare_api_token` exists at `/`
  in `staging`
- Reconcile path: after PR-17, run the reviewed `sprinkleref add/update` flow
  for `secret://deployments/pleomino/cloudflare_api_token` in `staging`
- Object name: `pleomino-deployments/prod/cloudflare_api_token`
- Expected result: shared Infisical secret `cloudflare_api_token` exists at `/`
  in `prod`
- Reconcile path: after PR-17, run the reviewed `sprinkleref add/update` flow
  for `secret://deployments/pleomino/cloudflare_api_token` in `prod`

If Infisical later adds a true metadata-only placeholder resource, add or import
that metadata-only object into this module without storing a secret value in
OpenTofu state. Until then, operators enter the shared secret named
`cloudflare_api_token` at `/` in both `staging` and `prod` after the project
exists and before live deploys.

Runtime credentials are installed only as deployment control-plane service
credentials:

- `pleomino-staging-infisical-client-id`
- `pleomino-staging-infisical-client-secret`
- `pleomino-prod-infisical-client-id`
- `pleomino-prod-infisical-client-secret`

The deployment metadata stores only the reviewed env-var names consumed by the
worker runtime:

- `PLEOMINO_STAGING_INFISICAL_CLIENT_ID`
- `PLEOMINO_STAGING_INFISICAL_CLIENT_SECRET`
- `PLEOMINO_PROD_INFISICAL_CLIENT_ID`
- `PLEOMINO_PROD_INFISICAL_CLIENT_SECRET`

## IaC operation

Use the reviewed bootstrap command as the primary path. It authenticates with
Infisical, selects the organization, creates or reuses the bootstrap IaC machine
identity, stores bootstrap and deployment access credentials through the
selected SprinkleRef `bootstrap` category or explicit compatibility sink, and
runs OpenTofu with a saved plan before applying it.

```bash
build-tools/tools/deployments/infisical-bootstrap.ts \
  deployment \
  --target //projects/deployments/pleomino/staging:deploy \
  --org-name viberoots \
  --tofu-plan-file .local/pleomino-infisical.tfplan
```

For non-interactive operator or CI flows, provide the bootstrap command's
short-lived admin-token environment variable and an explicit organization
selector. The exact CI variable names live in the top-level bootstrap spec, not
in checked deployment metadata.

```bash
build-tools/tools/deployments/infisical-bootstrap.ts \
  deployment \
  --target //projects/deployments/pleomino/staging:deploy \
  --no-login \
  --org-name viberoots \
  --yes \
  --tofu-plan-file .local/pleomino-infisical.tfplan
```

The command passes bootstrap credentials through the process environment only.
It does not write personal tokens, Universal Auth client secrets, application
secrets, `.tfvars` secret values, or OpenTofu state inputs into git-tracked
files. Existing remote deployment client secrets are preserved by default when
the selected sink already has the corresponding value. Use
`--rotate-deployment-credentials --force-overwrite-local-credentials` only for a
coordinated credential rotation. Use `--no-tofu-apply` for a preview that stops
after `tofu plan`.

The lower-level OpenTofu sequence remains useful for debugging only. Run it with
an Infisical bootstrap machine identity that is allowed to manage non-secret
project resources in the `viberoots` organization. Do not pass personal tokens
or secret values through OpenTofu variables, checked-in files, or shell history.

```bash
tofu init
tofu plan -var organization_id='<infisical-organization-id>'
tofu apply -var organization_id='<infisical-organization-id>'
tofu output -json deployment_runtime_metadata
```

The bootstrap Universal Auth client secret must come from the current
operator's credential path, not from git. Deployment Universal Auth client
secrets are per-machine values stored through the selected `bootstrap`
category. If the selected sink is missing a local deployment credential, rerun
the top-level repo bootstrap to create this machine's own labeled credential,
or rotate explicitly with `--rotate-deployment-credentials` when replacing a
stale local value is intentional. Do not import another operator's Universal
Auth client secret into the current machine's sink. If the `pleomino-deployments`
project or its environments were created manually before OpenTofu was applied,
import those objects into state before applying so the module adopts them
instead of trying to create duplicates.

The deterministic bootstrap command consumes these reviewed non-secret inputs:
Infisical site URL `https://app.infisical.com` by default, organization `viberoots`, OpenTofu directory
`projects/deployments/pleomino/infisical/opentofu`, project name and slug
`pleomino-deployments`, environments `staging` and `prod`, secret path `/`,
secret name `cloudflare_api_token`, machine identity names
`pleomino-staging-deploy` and `pleomino-prod-deploy`, and the credential-file
names listed above.
