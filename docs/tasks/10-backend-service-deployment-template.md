# 12. Backend Service Deployment Template

**Tier:** Developer / Stakeholder Enablement
**Priority:** 12 of 44
**Depends on:** #11 Backend Service Build Template(s), #8 Container Deployment Provider
**Estimated effort:** M
**Date:** 2026-05-25
**Summary:** Wire the existing per-provider and shared governance scaffold templates into a single compound invocation that generates dev/staging/prod TARGETS and lane policy stubs for a new backend service.

## What

Add a `scaf`-driven deployment package template for a new backend service that produces a
complete, valid `projects/deployments/<name>/` structure across dev, staging, and prod variants
without manual boilerplate.

The template family has two sides:

**1. Deployment scaffold (`deployment/service` or `deployment/cloudflare-containers`)** — already
partially in place. The `deployment/service` scaffold generates a single-stage
`kubernetes_service_deployment(...)` TARGETS, a `helm/values.yaml`, and a `README.md` for one
environment. The `deployment/cloudflare-containers` scaffold generates a
`cloudflare_containers_deployment(...)` TARGETS and a `wrangler.jsonc`. Neither scaffold
currently generates the three-environment (`dev`/`staging`/`prod`) layout with the
`shared/TARGETS` governance/lane/admission package that every multi-stage deployment requires.

**2. Shared governance scaffold (`deployment/shared`)** — generates a `deployment_lane_policy`,
`deployment_lane_governance`, and three `deployment_admission_policy` targets in a sibling
`shared/` subdirectory. This half exists as a standalone template but is not wired as an
automatic companion step when generating a service deployment package.

The task is to close that gap:

- Wire the shared governance template as an automatic companion when `scaf new deployment
cloudflare-containers` (or `deployment/service`) is invoked without an existing shared package,
  or document and test the two-step invocation order explicitly.
- Extend (or introduce) a per-environment directory layout so that a single `scaf` invocation
  stamps `dev/TARGETS`, `staging/TARGETS`, `prod/TARGETS`, and `shared/TARGETS` for the chosen
  provider, with each stage having the correct `environment_stage`, `admission_policy`,
  `protection_class` (`local_only` for dev, `shared_nonprod` for staging, `production_facing` for
  prod), and `lane_policy` pointing at the shared package.
- Ensure generated `secret_requirements` stubs carry placeholder `contract_id` values of the form
  `secret://deployments/<name>/<secret-name>` (matching the existing per-provider conventions in
  `deployment/cloudflare-containers/TARGETS.jinja` and `deployment/service/TARGETS.jinja`) and
  include the correct `step` fields (`provision`, `publish`, `preview_cleanup` as applicable to
  the chosen provider).
- Ensure generated `runtime_config_requirements` stubs carry placeholder `contract_id` values of
  the form `runtime://deployments/<name>/<config-name>`.
- Add `scaf` golden tests covering the multi-environment output for both provider variants.
- Add Buck `cquery` tests proving the generated `TARGETS` files extract as valid deployment
  targets with correct provider, protection class, and admission policy references when fixture
  values are substituted.

The concrete provider choices in scope for this task are `cloudflare-containers` (the primary
reviewed path for backend services per the existing capability table) and, as a secondary variant,
`kubernetes` (via `kubernetes_service_deployment`). The `nixos-shared-host` provider is excluded
because it supports only `static-webapp` and `ssr-webapp` component kinds, not `service`.

## Why Now

Task #11 produces a `node_service_artifact` with a `service.runtime.json` runtime contract. The
moment a developer generates that artifact they immediately need somewhere to deploy it. Without
this template, they write three environment-specific TARGETS files by hand, copy shared governance
boilerplate from the `pleomino` example, and fill in `secret_requirements` stubs by guessing at
the `contract_id` convention. Hand-authoring is where lane policy typos, missing admission
policies, and mismatched `protection_class` values appear. Every such error surfaces only at
deploy time, not at `buck build` time.

Task #23 (Bob setup) and Task #24 (dry run) both assume a valid deployment package exists before
they can demonstrate a working end-to-end flow. Generating that package by hand in #23 or #24
would make those tasks harder to scope and harder to review. A reviewed template means #23 and
#24 can start from a known-good structure.

The `deployment/shared` and per-provider deployment templates exist in the scaffolding system
today, but they are not wired together as a first-class multi-environment workflow. The gap is
small enough to close in an M-sized task and large enough to matter for every future service
added to the repo.

## Risks

- **Template drift vs. macro signature.** The `cloudflare_containers_deployment` and
  `kubernetes_service_deployment` macros validate their required fields at Buck load time. If the
  Jinja template falls out of sync with the macro signature — for example, after a new required
  field is added to the macro — generated packages will fail at `buck build` rather than `scaf`.
  This is the same risk the existing single-stage templates carry; the multi-stage template
  amplifies it because three TARGETS files need to stay in sync simultaneously.

- **Shared package naming collision.** The copier defaults for `deployment/cloudflare-containers`
  and `deployment/service` both derive `shared_package` as `{{ name }}-shared`. If an operator
  runs the scaffold twice for the same service name, the second run will overwrite the shared
  package. The `scaf` resolver sets `resolverDestination` but does not currently guard against
  existing directories.

- **`protection_class` set incorrectly for dev.** The existing single-stage templates default to
  `protection_class = "shared_nonprod"`. A three-stage template that generates dev as
  `local_only`, staging as `shared_nonprod`, and prod as `production_facing` must not accidentally
  apply `local_only` policy to staging, which would silently bypass the `lane_policy` enforcement
  check in `_require_shared_policy`.

- **Incomplete SprinkleRef contract IDs block first deploy.** The placeholder `contract_id`
  values in generated `secret_requirements` are not usable until an operator provisions the
  corresponding Infisical paths and machine identity roles. If a developer runs `deploy` before
  provisioning, the error will come from the secret-resolution step, not from a clear scaffolding
  warning. The README template should state this explicitly.

## Trade-offs

- **Single compound `scaf` invocation vs. sequential two-step.** A single invocation that stamps
  all four directories (`dev/`, `staging/`, `prod/`, `shared/`) is the more ergonomic choice and
  matches what an operator actually needs for a new service. The trade-off is that it couples the
  shared governance template to the provider template inside the scaffolding system, which means
  changes to either template must be reviewed together. The alternative — documented two-step
  invocation — keeps templates independent but forces the operator to run two commands and risks
  them skipping the second.

- **Cloudflare-containers as the primary template vs. kubernetes.** The capability table shows
  `cloudflare-containers` supports `service` and `ssr-webapp` component kinds, is already wired
  to `cloudflare_containers_deployment`, and has an existing `deployment/cloudflare-containers`
  scaffold template. Kubernetes has `kubernetes_service_deployment` and
  `deployment/service` but requires cluster, namespace, and Helm config inputs that are not yet
  provisioned for the current stack. Making `cloudflare-containers` the primary and `kubernetes`
  the secondary avoids requiring provider infrastructure that is not yet available.

- **Three separate environment directories vs. a family macro.** The `pleomino` deployment uses a
  shared `family.bzl` that encodes provider-specific constants for all stages, with each
  environment's `TARGETS` calling a thin per-stage wrapper. A generated template could follow the
  same pattern and put shared constants in a `shared/family.bzl`, or it could generate three
  independent TARGETS files. Three independent files are simpler to understand and do not require
  a `family.bzl` authoring convention, but they repeat constant values (Infisical project ID,
  account ID) that a family macro would centralize. For a template that must cover the general
  case, three independent TARGETS files are the safer default; operators can refactor to a family
  macro after the deployment is working.

## Considerations

- The `deployment/shared` template uses `default_client_profile: "default"` in its copier defaults.
  The generated `deployment_lane_policy` target passes this through to the lane policy. Confirm
  that `"default"` is the correct default for backend service deployments using the
  `cloudflare-containers` provider, or determine whether a different client profile applies.

- The `cloudflare_containers_deployment` macro requires `cloudflare_account_id` and `worker` as
  non-defaultable inputs, and `kubernetes_service_deployment` requires `cluster`. The multi-stage
  scaffold must prompt for these once (not once per environment) and thread them through all
  generated environment TARGETS files.

- The existing `deployment/cloudflare-containers` copier default for `protection_class` is
  `"shared_nonprod"` and for `stage` is `"dev"`. When extending to three environments, the
  copier must generate per-environment overrides without inheriting a single stage default across
  all three files.

- The `wrangler.jsonc` is a provider-native file in `cloudflare-containers` deployments. Each
  environment needs its own `wrangler.jsonc` because the worker name and account differ per
  stage. The template must generate three distinct `wrangler.jsonc` files, or accept that the
  operator will edit them after generation.

- Secret requirements for `cloudflare-containers` cover three steps: `provision`,
  `publish`, and `preview_cleanup`. Each carries a `contract_id` of the form
  `secret://deployments/<name>/<secret-name>`. The generated TARGETS stubs must use
  distinct per-environment contract IDs (e.g.,
  `secret://deployments/<name>/staging/cloudflare_api_token`) if stages use separate tokens, or
  a single cross-stage contract ID if the operator intends to share credentials. The template
  README should make this choice visible.

- Golden scaffold tests must cover both the `cloudflare-containers` and `service` (Kubernetes)
  provider variants, and must verify that generated output includes all three environment
  directories plus the shared package directory, each with structurally correct TARGETS content.

- Buck cquery tests should verify that `kind:deployment` and `deployment:cloudflare-containers`
  (or `deployment:kubernetes`) labels are present on the generated `:deploy` target, consistent
  with the label conventions enforced in `cloudflare_containers_deployment` and
  `kubernetes_service_deployment`.

- The `external-deployments-plan.md` PR-7 scope explicitly excludes data-room-specific content.
  Generated templates must remain provider/component-oriented with deterministic placeholder names
  that fail validation until replaced by real values.
