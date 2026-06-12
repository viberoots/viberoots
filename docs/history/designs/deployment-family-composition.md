# Deployment Family Composition

Deployment families use Buck/Starlark composition as the repo-native replacement
for base/overlay deployment packages. A target under the canonical
`projects/deployments/<family>/...` layout receives `<family>` as its effective
`deployment_family` when the field is omitted. An explicit `deployment_family`
always wins, and flat legacy packages such as `projects/deployments/example-prod`
do not infer a family from their package name.

Keep common facts in a shared family package, usually
`projects/deployments/<family>-shared/`:

```starlark
deployment_family_defaults(
    component = "//projects/apps/example:app",
    lane_policy = "//projects/deployments/example-shared:lane",
    vault_runtime = example_vault_runtime(),
)
```

Keep stage-specific facts in an explicit `deployment_stage_delta(...)` call:

```starlark
deployment_stage_delta(
    stage = "staging",
    deployment_context = "example-staging",
    admission_policy = "//projects/deployments/example-shared:staging_release",
    protection_class = "shared_nonprod",
    ingress_hostnames = ["staging.example.com"],
    resource_sizing = {"profile": "small"},
    secret_requirements = [example_secret("publish")],
    prerequisites = [{"deployment_id": "example-dev", "mode": "ordering_only"}],
)
```

Shared provider target identity belongs in `projects/config/shared.json` deployment contexts. Keep
only truly stage-local facts in the stage delta. If a deployment still declares explicit
`provider_target` or `infisical_runtime` fields while selecting a context, extraction compares them
with the context and fails closed on drift.

The shared helper rejects attempts to set family-owned fields, such as
`component` or `lane_policy`, from stage/provider arguments. Provider-native
files like `wrangler.jsonc` and `helm/values.yaml` remain renderer inputs below
Buck metadata; if they restate core facts, they must match the composed Buck
metadata.

Concrete stage `TARGETS` files should call a family wrapper and contain only the
reviewed stage delta:

```starlark
example_cloudflare_deployment(
    name = "deploy",
    stage = "staging",
    admission_policy = "staging_release",
    protection_class = "shared_nonprod",
)
```

Do not create normal deployment packages by copying full metadata between
stages. Add fields to the family wrapper or to `deployment_stage_delta(...)` so
reviewers can tell whether a value is shared policy or an intentional stage
difference.

Pleomino follows this boundary: `projects/deployments/pleomino/shared/family.bzl` selects
`pleomino-staging` or `pleomino-prod`, while `projects/config/shared.json` owns the shared
Cloudflare and Infisical topology for those contexts.
