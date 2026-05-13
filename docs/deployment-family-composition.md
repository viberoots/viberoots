# Deployment Family Composition

Deployment families use Buck/Starlark composition as the repo-native replacement
for base/overlay deployment packages.

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
    admission_policy = "//projects/deployments/example-shared:staging_release",
    protection_class = "shared_nonprod",
    provider_target = {"account": "web-platform", "project": "example-staging"},
    ingress_hostnames = ["staging.example.com"],
    resource_sizing = {"profile": "small"},
    secret_requirements = [example_secret("publish")],
    prerequisites = [{"deployment_id": "example-dev", "mode": "ordering_only"}],
)
```

Provider target identity belongs in the stage delta, even when the provider
macro also needs native runtime arguments such as app name or port. The family
helper rejects matching keys when provider arguments drift away from the stage
`provider_target`, so the Buck metadata remains the review source of truth.

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
    account = "web-platform",
    project = "example-staging",
    admission_policy = "staging_release",
    protection_class = "shared_nonprod",
)
```

Do not create normal deployment packages by copying full metadata between
stages. Add fields to the family wrapper or to `deployment_stage_delta(...)` so
reviewers can tell whether a value is shared policy or an intentional stage
difference.
