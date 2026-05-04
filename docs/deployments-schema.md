# Deployment Schema

This document defines the minimum schema contract for deployment metadata, policy objects, replay
snapshots, and deployment records.

It is intentionally schema-oriented rather than implementation-oriented. The goal is to make sure
repo validation, CLI code, control-plane code, and records all speak the same shape.

## 1. Deployment Metadata

Authoritative source: the canonical deployment rule in `projects/deployments/<deployment-id>/TARGETS`.

Minimum fields:

| Field                           | Required                                         | Notes                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                          | yes                                              | Canonical target name, normally `deploy`.                                                                                                                           |
| `provider`                      | yes                                              | Provider family identifier.                                                                                                                                         |
| `provider_target`               | yes                                              | Structured provider-target identity object.                                                                                                                         |
| `components`                    | yes                                              | Non-empty list of deployable component descriptors.                                                                                                                 |
| `publisher`                     | yes                                              | Structured publish contract.                                                                                                                                        |
| `protection_class`              | yes                                              | `local_only`, `shared_nonprod`, or `production_facing`.                                                                                                             |
| `secret_requirements`           | yes                                              | `{}` allowed and reviewable.                                                                                                                                        |
| `runtime_config_requirements`   | yes                                              | `{}` allowed; declares non-secret runtime config inputs.                                                                                                            |
| `external_requirement_profiles` | no                                               | Names reviewed external provider or product requirement families whose typed secret/runtime-config declarations must be present and correctly scoped.               |
| `provisioner`                   | no                                               | Present only when provisioning is deployment-owned.                                                                                                                 |
| `release_actions`               | no                                               | Present only when release-time actions are needed.                                                                                                                  |
| `smoke`                         | yes for protected/shared                         | Optional for `local_only`.                                                                                                                                          |
| `preview`                       | no                                               | Explicit opt-in only.                                                                                                                                               |
| `prerequisites`                 | no                                               | Explicit direct-edge deployment prerequisites.                                                                                                                      |
| `vault_runtime`                 | no                                               | Stable Vault/IdP runtime metadata for deployment-derived JWT auth. Secret values must not be stored here.                                                           |
| `lane_policy`                   | yes for `shared_nonprod` and `production_facing` | Must resolve to authoritative policy object.                                                                                                                        |
| `environment_stage`             | yes for `shared_nonprod` and `production_facing` | Must be defined by the lane policy.                                                                                                                                 |
| `admission_policy`              | yes for `shared_nonprod` and `production_facing` | Repo-owned policy reference.                                                                                                                                        |
| `rollout_policy`                | no                                               | Required when behavior differs from provider default, and also required for protected/shared multi-component deployments even when they match the provider default. |

Single-provider invariant:

- a deployment has exactly one `provider` and one authoritative `provider_target` model
- multi-component deployments are allowed within that provider boundary
- systems that span multiple provider families must be represented as multiple coordinated deployments

### `provider_target`

Required shape:

- structured object, not free-form prose
- includes every field required by the provider's canonical identity rule
- optional shorthand fields such as `id` are allowed only as non-authoritative display metadata unless the provider capability entry explicitly makes them part of canonical identity

Initial reviewed `nixos-shared-host` shape:

- canonical identity fields:
  - `host = "nixos-shared-host"`
  - `target_group`
  - `app_name`
- required normalized derived fields:
  - `hostname = "${appName}.apps.kilty.io"`
  - `container_name = "${appName}"`
  - `shared_dev_target_identity = "nixos-shared-host:${targetGroupOrDefault}:${appName}"`
- `target_group` defaults to the provider's implicit shared-dev group when omitted
- `app_name` must be a lowercase hostname token and must not carry dots or explicit subdomain overrides

Initial reviewed `vercel` shape:

- canonical identity fields:
  - `team`
  - `project`
  - `environment`
- canonical identity string:
  - `vercel:<team>/<project>#<environment>`
- optional normalized field:
  - `canonical_url`, defaulting to `https://${project}.vercel.app/`
- the initial provider slice supports repo-built prebuilt SSR artifacts only; provider-side Git
  auto-builds are not a reviewed deployment shape

### `vault_runtime`

Optional keys:

- `addr`: Vault API URL.
- `oidc_issuer`: OIDC issuer URL used to mint workload JWTs.
- `audience`: expected Vault JWT audience.
- `deployment_client_id`: compatibility OIDC client id used when a separate
  human or service client id is not declared.
- `cli_public_client_id`: public OIDC client id for human PKCE/device login.
- `service_account_client_id`: service-account client id for Jenkins
  client-secret minting.
- `deployment_environment`: runner or host environment claim bound by Vault.
- `jwt_role`: Vault JWT role name.
- `jwt_file`: legacy metadata key. Normal deployment runtimes do not read
  workload JWTs from files; omit this for PR-73+ credential-source flows.
- `preferred_credential_source`: one of `interactive_pkce`,
  `interactive_device`, `interactive_print_url`, `jenkins_client_secret`,
  `jenkins_oidc`, or `external_oidc_token`.
- `client_secret_env`: compatibility environment variable name containing the
  OIDC client secret.
- `jenkins_client_secret_env`: Jenkins Credentials-bound Secret Text variable
  used only by the front-door credential-source adapter.
- `external_oidc_token_env`: Jenkins/workload-identity token variable used only
  by the front-door credential-source adapter.
- `pkce_callback_mode`: `loopback` or `public_host`.
- `pkce_callback_external_scheme`: browser-facing redirect scheme, `http` or
  `https`.
- `pkce_callback_external_host`: browser-facing redirect hostname.
- `pkce_callback_external_port`: optional browser-facing redirect port. Omit
  this for reviewed HTTPS reverse-proxy profiles on the default port.
- `pkce_callback_external_path`: browser-facing redirect path, usually
  `/oidc/callback`.
- `pkce_callback_bind_host`: local host where the deploy command listens.
- `pkce_callback_bind_port`: stable local port where the deploy command
  listens for public-host callback profiles.
- `pkce_callback_bind_path`: local listener path, usually `/oidc/callback`.
- `pkce_callback_open_firewall`: `true` only for reviewed direct-public
  profiles. Reverse-proxied profiles keep the local bind port private.

`vault_runtime` may contain public routing and identity metadata, but must never contain client
secrets, Vault tokens, root tokens, or secret material.

External deployments should express product and provider dependencies through
`secret_requirements` and `runtime_config_requirements`, not `.env` files, CI
variables, or provider-local project settings. The reviewed profile families are
WorkOS/AuthKit, Supabase, Ragie, Source Access HMAC material, console-to-web
base URL, Cloudflare, Vercel, container runtime, DNS, and OpenTofu provider
credentials.
Deployment metadata declares the applicable set with
`external_requirement_profiles`; extractors reject unsupported profile names,
missing requirements, duplicate requirement names, wrong lifecycle steps, wrong
contract scopes, or wrong requirement sources.
Secrets use `secret://deployments/...` contract IDs and are resolved only by the
secret runtime for the declared lifecycle step; public runtime config uses
`config://deployments/...` contract IDs.

For the reviewed `mini` shared deploy host shape, existing Vault-backed deployments should use:

```python
vault_runtime = {
    "addr": "https://secrets.apps.kilty.io:8200",
    "oidc_issuer": "https://identity.apps.kilty.io/realms/deployments",
    "audience": "deployments-vault",
    "deployment_client_id": "deployment-runner",
    "cli_public_client_id": "deployment-cli",
    "deployment_environment": "mini",
    "jwt_role": "deploy-pleomino-read",
    "pkce_callback_mode": "public_host",
    "pkce_callback_external_scheme": "https",
    "pkce_callback_external_host": "deploy-auth.apps.kilty.io",
    "pkce_callback_external_path": "/oidc/callback",
    "pkce_callback_bind_host": "127.0.0.1",
    "pkce_callback_bind_port": "7780",
    "pkce_callback_bind_path": "/oidc/callback",
}
```

### `components[*]`

Required keys:

- `id`
- `kind`
- `target`

Canonical reviewed component-kind registry:

- `static-webapp`
- `ssr-webapp`
- `mobile-app`
- `service`
- `third-party-service`

Kubernetes single-service deployments should use `kubernetes_service_deployment(...)` instead of
raw `deployment_target(...)` metadata. The macro emits `component_kind = "service"` and records
reviewed posture in `provider_target`: web services require `ingress_mode = "public"` plus
`health_path`, while worker services must use `ingress_mode = "none"` or `"private"`.

```starlark
kubernetes_service_deployment(
    name = "web",
    component = "//projects/apps/api:image",
    cluster = "prod-us-west",
    namespace = "web",
    release = "api",
    service_kind = "web",
    ingress_mode = "public",
    health_path = "/healthz",
    lane_policy = "//projects/deployments/shared:lane",
    environment_stage = "prod",
    admission_policy = "//projects/deployments/shared:prod_release",
)

kubernetes_service_deployment(
    name = "worker",
    component = "//projects/apps/jobs:image",
    cluster = "prod-us-west",
    namespace = "workers",
    release = "jobs",
    service_kind = "worker",
    lane_policy = "//projects/deployments/shared:lane",
    environment_stage = "prod",
    admission_policy = "//projects/deployments/shared:prod_release",
)
```

Current reviewed provider-specific rule for `nixos-shared-host`:

- every component must use `kind = "static-webapp"`
- single-component deployments may rely on provider-default rollout behavior
- provider-default rollout behavior is in policy only for reviewed shapes where the authoritative
  provider-capability entry explicitly allows omission of `rollout_policy`
- protected/shared multi-component deployments must:
  - resolve every component into one `target_group`
  - declare distinct component ids and distinct `app_name` values
  - declare `rollout_policy`
  - use the reviewed `ordered_best_effort` slice, with `steps` listing every component id exactly once

### `publisher`

Required keys:

- `type`

Optional keys:

- provider-specific package-relative config paths such as `config`

Reviewed Vercel publisher config:

- `publisher = "vercel-prebuilt"`
- `publisher_config` points at checked-in package-local JSON/JSONC, normally
  `vercel-prebuilt.jsonc`
- the config may repeat `team`, `project`, and `environment` for review clarity, but those values
  must match `provider_target`
- `mode = "git-autobuild"` is rejected; protected/shared deploys must consume repo-built artifacts

### `provisioner`

Required keys when present:

- `type`

Optional keys:

- package-relative config or entry references
- declared input class such as `metadata_only` or `immutable_resolved_inputs`
- plan or diff contract for infra-affecting mutation paths
- reviewed higher-bar approval posture when no meaningful plan or diff can be produced

Minimum plan/diff contract when provisioner-managed infra mutation is reviewable:

- whether the plan surface is provider-native or provider-neutral
- whether routine mutation requires a reviewed pre-mutation plan artifact
- how the reviewed plan or diff is fingerprinted and bound to approval or revalidation evidence
- where operators retrieve the reviewed artifact later in a secret-safe form
- how destructive or replacement actions are surfaced distinctly from create or in-place update
- if no meaningful plan or diff can be produced, the reviewed higher-bar approval posture required for that path

`opentofu-stack` is a reviewed built-in provisioner type for Kubernetes-owned
foundation and app-attached infrastructure. Its package-local stack files must
live under `projects/deployments/<deployment-id>/opentofu/`; deployment metadata
must declare `provider_target.stack_identity` and
`provider_target.state_backend_identity`; the resolved OpenTofu plan fingerprint
and stack-config fingerprint are bound into admission evidence. Routine
`deploy` and `--provision-only` flows fail closed on delete, replace, or unknown
plan actions.

### `runtime_config_requirements`

Required shape:

- dictionary keyed by stable logical runtime-config name
- `{}` is the explicit no-runtime-config value
- each entry should declare the non-secret config contract that must be admitted for deterministic execution or replay

Minimum per-entry keys:

- `name`
- `step`
- `contract_id`
- `required`

Optional per-entry keys:

- `source`
- `preview_variant`
- `notes`

### `release_actions[*]`

Required keys when present:

- `type`
- `phase`
- `run_condition`
- `abort_behavior`
- data-compatibility posture
- replay policy by replay context

Allowed `phase` values:

- `pre_publish`
- `post_publish_pre_smoke`
- `post_smoke`

Allowed `run_condition` values:

- `success_only`
- `failure_only`
- `always`

Minimum replay-policy contract:

- explicit behavior for `deploy_publish_slice`
- explicit behavior for `retry`
- explicit behavior for `rollback`
- explicit behavior for `promotion`
- one closed disposition per replay context from:
  - `rerun`
  - `skip`
  - `fail`

Minimum duplicate-execution-safety contract for side-effecting actions:

- required for every replay context where disposition is `rerun`
- one closed duplicate-safety model from:
  - `provider_idempotent`
  - `control_plane_deduplicated`
  - `not_duplicate_safe`
- stable operation-key contract or equivalent deduplication keying rule for `provider_idempotent` and `control_plane_deduplicated`
- if a replay context is `not_duplicate_safe`, that context must not declare `rerun`

Minimum data-compatibility contract:

- explicit posture for rollback compatibility with already-applied state changes
- one closed posture from:
  - `backward_compatible`
  - `forward_only`

Protected/shared routine-path rule:

- destructive built-in `release_actions` must fail closed on the ordinary deploy or provision-only
  path unless a separately reviewed destructive-intent workflow is in use
  - `reversible`
  - `manual_recovery_required`
- if the action type is not `backward_compatible` or `reversible`, protected/shared rollback admission must not assume that re-publishing an earlier artifact is safe

### `smoke`

Required for protected/shared.

Minimum contract:

- validated built-in smoke or release-health type
- enough fields to resolve the smoke target or release-health target

Optional nested field:

- `exception`

Minimum `smoke.exception` fields:

- `owner`
- `reason`
- `scope`
- one review boundary field: `review_by` or `expires_at`

### `preview`

Minimum fields when present:

- `target_derivation`
- `isolation_class`
- supported preview identity selector kind or kinds
  - `branch`
  - `commit`
  - `source_run`
- either explicit cleanup or TTL policy or a provider-defaulted cleanup policy marker
- any smoke override when deviating from the provider default
- whether separate lock scope is allowed, when overriding the provider default
- provider-default preview cleanup policy and preview-locking defaults must come from the authoritative provider capability entry when deployment metadata omits them
- optional preview-specific admission constraints when intentionally different from the deployment's normal admission policy
  - they may be stricter or lighter only where the deployment contract explicitly allows that variation
- local preview-safe deployments should use branch-scoped or commit-scoped preview identity
- protected/shared preview should use `source_run` identity only

### `prerequisites[*]`

Required keys:

- `deployment_id`
- `mode`

Allowed `mode` values:

- `ordering_only`
- `health_gated`

Validation rule:

- prerequisites must reference distinct deployment ids; duplicates are rejected
- prerequisites must not self-reference the owning deployment id
- prerequisites must stay within the same lane; cross-lane prerequisites are rejected
- prerequisites must form an acyclic graph before orchestration
- selectors may widen only by declared direct prerequisite edges; transitive execution order comes from topological sorting, not extra inferred metadata

## 2. Lane Policy Object

Minimum fields:

| Field                     | Required | Notes                                   |
| ------------------------- | -------- | --------------------------------------- |
| `name`                    | yes      | Stable lane identifier.                 |
| `stages`                  | yes      | Ordered stage list.                     |
| `stage_branches`          | yes      | Stage-to-branch mapping.                |
| `allowed_promotion_edges` | yes      | Explicit forward promotion edges.       |
| `artifact_reuse_mode`     | yes      | `same_artifact` or `rebuild_per_stage`. |

Optional fields:

- `promotion_compatibility`
- stricter rollback-candidate policy
- additional lane-specific admission constraints
- versioned interface bindings or schema refs used by Buck extraction, CLI submission, and control-plane admission

### `promotion_compatibility`

Used to define the closed compatibility contract for cross-deployment promotion within a lane.

Minimum reviewed field when present:

- `cross_provider_promotion_edges`
  - closed allowlist of stage edges that may use the reviewed cross-provider compatibility contract
  - edges not listed here stay on strict same-provider / same-publisher promotion semantics

Schema expectation:

- same-provider higher-environment promotion remains strict by default
- cross-provider promotion is still validated against the repo's reviewed compatibility family for
  the source and target deployment shapes; listing an edge here does not make promotion open-ended
- any provisioner behavior that matters to promotability must be represented explicitly through this closed compatibility contract or the reviewed lane default it resolves to
- provisioner differences must not be admitted through adapter-local "safe enough" heuristics outside that resolved contract

Optional fields:

- `additional_validations`
  - reviewed lane-specific checks that must be evaluated before mutation

Contract rule:

- protected/shared promotion must evaluate this closed compatibility contract rather than adapter-local heuristics
- if a lane omits `promotion_compatibility`, the reviewed lane default compatibility contract must still resolve to one explicit closed set before promotion is allowed

## 3. Rollout Policy Object

Required fields when `rollout_policy` is present:

| Field   | Required | Notes                                                                       |
| ------- | -------- | --------------------------------------------------------------------------- |
| `mode`  | yes      | Closed enum described below.                                                |
| `abort` | yes      | Deployment-level abort rule for the rollout.                                |
| `smoke` | yes      | Smoke execution mode for the rollout: `per_phase`, `final_only`, or `both`. |

Allowed `mode` values:

- `all_at_once`
- `all_or_nothing`
- `ordered_best_effort`
- `parallel_best_effort`
- `phased`
- `canary`
- `blue_green`
- `store_staged`

Conditionally required:

- `phases` or `steps` in explicit execution order for `phased`, `canary`, `blue_green`, and `store_staged`
- advance gate definition for every declared phase or step
- exposure increments, bake duration, and completion condition for traffic- or audience-shifting modes such as `canary`, `blue_green`, and `store_staged`

Optional fields:

- explicit component groups
- dependency barriers
- provider-specific validated extensions that do not change the provider-neutral meaning of the mode
- rollout-level approval policy when later phases require fresh approval beyond ordinary admission
- rollout resume policy when paused or interrupted progressive rollout may continue deterministically
- rollout supersedence policy when a newer run interacts with a pending or paused rollout

Progressive-rollout required semantics for `phased`, `canary`, `blue_green`, and `store_staged`:

- explicit phase-state vocabulary support from:
  - `pending`
  - `running`
  - `paused`
  - `succeeded`
  - `failed`
  - `aborted`
- explicit abort semantics for the selected rollout mode
- explicit resumability declaration:
  - `not_resumable`
  - `resume_from_next_phase`
  - `provider_state_resumable`
- explicit rollback posture for partially completed rollout:
  - `not_supported`
  - `requires_new_rollback_run`
  - `provider_defined_partial_rollback`

Minimum per-phase or per-step fields for progressive rollout:

- stable phase or step id
- advance gate
- phase-local approval requirement when different from rollout default
- terminal behavior on failure or abort
- optional bake or stabilization window
- optional target exposure or slot state for traffic-shifting modes

Minimum `advance_gate` contract:

- `type`, using a reviewed closed vocabulary
- evidence source, selector, query, or runner reference appropriate to that gate type
- pass criteria
- timeout rule when evaluation is not instantaneous
- terminal effect when the gate does not pass:
  - `pause`
  - `fail`
  - `abort`

Minimum reviewed `advance_gate.type` vocabulary:

- `manual_approval`
- `smoke_pass`
- `metric_threshold`
- `time_bake`
- `provider_health`
- `store_health`

Minimum gate-evidence record for each evaluated phase gate:

- gate type
- evidence reference, query fingerprint, or runner result reference
- observed result summary
- evaluation time
- terminal decision

## 4. Admission Policy Object

Minimum fields:

| Field                               | Required                | Notes                                                      |
| ----------------------------------- | ----------------------- | ---------------------------------------------------------- |
| `name` or stable id                 | yes                     | Versioned policy identity.                                 |
| `allowed_refs` or equivalent        | yes                     | Allowed branches/refs.                                     |
| `required_checks`                   | yes                     | Required CI or validation checks.                          |
| `required_approvals`                | yes                     | Human/policy approval requirements, possibly empty.        |
| `readiness_gates`                   | no                      | Live or staging-only evidence gates required by admission. |
| `artifact_attestation_requirements` | yes for publishing runs | Build trust requirements.                                  |

Optional fields:

- preview admission constraints
- operation-kind-specific restrictions
- whether same-lineage retry approval reuse is allowed
- `retry_branch_policy`, using the closed enum `branch_independent` or `branch_coupled`
- whether fresh approval is required for rollback by protection class
- approval payload-binding requirements when human or policy approval is required
- authorization scope requirements or policy reference when the deployment uses scoped submit/approve/operate permissions

`readiness_gates` are for deploy-blocking checks that cannot always run in a
local PR, such as Ragie ACL semantics, live tenant leak checks, WorkOS MCP auth,
storage grant lifecycle, and Connect metadata/OAuth checks. Evidence must be
redacted and bound to deployment id, provider target identity, source revision
or source run id, and an external evidence reference. Raw provider responses,
tokens, or diagnostic payloads are not admission evidence. The repo-level
deployment front door resolves these gates from Buck deployment targets and
enforces them through admission; target authors must not rely on helper-only
validation paths.

Minimum `artifact_attestation_requirements` contract:

- accepted builder identity or identity set
- accepted provenance or predicate type
- required binding from artifact identity to source revision plus build inputs
- verification rule for the signing or attesting authority
- failure behavior for revoked, expired, or no-longer-trusted attestation material

Minimum approval payload-binding contract when approval is required:

- required immutable payload fields from:
  - `deploy_run_id`
  - execution-snapshot fingerprint or stable snapshot reference
  - canonical target identity
  - selected artifact identity
  - selected source-run snapshot reference
  - selected preview identity when preview publication or preview cleanup is being approved
  - reviewed provisioner plan/diff artifact reference
- validity or expiry rule for approval reuse where reuse is permitted
- fail-closed behavior when any required bound field changes after approval

Minimum authorization-scope contract when scoped protected/shared permissions are modeled here:

- scope vocabulary drawn from:
  - `repo_admin`
  - `lane`
  - `deployment`
  - `break_glass_incident`
- which actions each scope may authorize, such as `submit`, `approve`, `operate`, `administer_policy`, or `break_glass`
- inheritance or narrowing rule, including whether lane scope applies to all deployments in that lane unless a stricter deployment-level policy narrows it

## 5. Migration / Alias Exception Object

Used when target ownership or target naming is temporarily in transition.

Minimum fields:

| Field                       | Required | Notes                                                                 |
| --------------------------- | -------- | --------------------------------------------------------------------- |
| stable exception id         | yes      | Control-plane object identity.                                        |
| affected deployment ids     | yes      | One or more deployment ids participating in the exception.            |
| exception kind              | yes      | `migration` or `alias`.                                               |
| old normal target identity  | yes      | Prior canonical live-target binding when applicable.                  |
| new normal target identity  | no       | Required for migrations that transfer or rename live-target identity. |
| enforced shared lock scope  | yes      | Lock scope that all affected runs must share during the exception.    |
| approval authority/evidence | yes      | Review ticket, approval record, or equivalent justification.          |
| effective start time        | yes      | Start of validity window.                                             |
| expiry or completion signal | yes      | Explicit expiry time or completion condition.                         |
| reconciliation owner        | yes      | Named owner for cleanup and return to steady state.                   |

Validation expectations:

- admission and replay must consult this object when deciding whether a recorded target binding is still valid
- an expired or completed exception must no longer authorize replay against a stale binding
- the steady-state goal remains one deployment id owning one normal mutable live target

## 6. Replay Snapshot

Used for protected/shared immutable-artifact reuse.

Minimum fields:

| Field                                               | Required          | Notes                                                                                                                       |
| --------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `schema_version`                                    | yes               | Explicit replay schema id.                                                                                                  |
| `deployment_id`                                     | yes               | Source deployment id.                                                                                                       |
| resolved component data                             | yes               | Canonical resolved component projection.                                                                                    |
| artifact refs and identities                        | yes               | Exact immutable artifact identity.                                                                                          |
| runner implementation identities                    | yes               | Built-in publisher/provisioner/smoke/release-action runner version or digest set used by the run.                           |
| declared normal target identity                     | yes               | Normal live target.                                                                                                         |
| effective run target identity                       | yes               | Actual mutated target for that run.                                                                                         |
| provider-config immutable snapshot or immutable ref | yes               | No silent reinterpretation; bare fingerprints are insufficient for replay.                                                  |
| `lane_policy` snapshot/fingerprint                  | yes               | Source-run policy context.                                                                                                  |
| `admission_policy` snapshot/fingerprint             | yes               | Source-run policy context.                                                                                                  |
| rollout policy snapshot                             | yes when relevant | Source-run rollout semantics.                                                                                               |
| `release_actions` plan snapshot                     | yes when relevant | Includes replay behavior, duplicate-execution-safety details for any `rerun` context, and data-compatibility posture.       |
| provisioner plan/diff snapshot or reference         | yes when relevant | Required when a reviewed pre-mutation provisioner plan/diff was part of admission.                                          |
| smoke policy snapshot                               | yes when relevant | Source-run validation contract.                                                                                             |
| secret-contract version/reference                   | yes               | Non-secret contract metadata only.                                                                                          |
| runtime-config reference/fingerprint                | yes when relevant | Non-secret admitted config selector for deterministic replay.                                                               |
| replay reference-resolution policy                  | yes when relevant | Must preserve whether exact reference reuse is required and fail-closed behavior when an admitted reference is unavailable. |
| approval payload-binding snapshot or reference      | yes when relevant | Required when human or policy approval was part of admission.                                                               |
| rollout runtime state snapshot                      | yes when relevant | Required for progressive rollout replay, resume, or auditability.                                                           |

Resolved component expectations:

- every resolved component entry should preserve `id`, `kind`, `target`, `artifact_identity`, and
  `artifact_ref`
- `ssr-webapp` should also preserve the reviewed runtime-contract reference required by the
  publisher/runtime slice
  - for the reviewed `nixos-shared-host` SSR slice that means:
    - `type = "node-dist-server-v1"`
    - `framework`
    - `serverEntry = "dist/server/index.js"`
    - `clientDir = "dist/client"`
    - `servingTopology = "single-host-node-with-nginx"`
    - `environmentNeutralBuild = true`
- `service` Node artifacts should preserve the reviewed `node-service-runtime@1` contract generated
  by `node_service_artifact`:
  - `entrypoint`
  - `productionCommand`
  - `health.path` and `health.port`
  - `runtimeConfig`
  - `secretRequirements`
- default smoke or release-health classification should derive from the reviewed component kind:
  - `static-webapp`: HTTP smoke, 5 minute budget
  - `ssr-webapp`: HTTP or runtime-contract smoke, 10 minute budget
  - `mobile-app`: release-health validation by default
  - `service`: service-health validation, 10 minute budget
  - `third-party-service`: service-health validation, 10 minute budget

Minimum `approval payload-binding snapshot` fields when present:

- approved `deploy_run_id`
- approved execution-snapshot fingerprint or ref
- approved canonical target identity
- approved artifact identity or approved source-run snapshot ref, when publishing
- approved provisioner plan/diff ref, when infra-affecting provisioning was in scope

Minimum `rollout runtime state snapshot` fields when present:

- rollout mode
- current phase or step id
- phase-state map
- resumability status
- latest observed exposure, slot, or track state when applicable
- whether later phases still require fresh approval

## 7. Deployment Record

Minimum required fields for every run:

| Field                                            | Required                               | Notes                                                                                                            |
| ------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `schema_version`                                 | yes                                    | Explicit record schema id.                                                                                       |
| `deploy_run_id`                                  | yes                                    | Globally unique.                                                                                                 |
| `deployment_id`                                  | yes                                    | Concrete deployment id.                                                                                          |
| `deployment_label`                               | yes                                    | Buck deployment label.                                                                                           |
| `operation_kind`                                 | yes                                    | `deploy`, `retry`, `promotion`, `rollback`, `preview_cleanup`.                                                   |
| `lifecycle_state`                                | yes                                    | `pending_approval`, `queued`, `waiting_for_lock`, `running`, `cancelling`, `finished`, `cancelled`.              |
| `termination_reason`                             | yes                                    | Nullable when canonical terminal outcome exists; otherwise uses the closed vocabulary below.                     |
| source revision identifier                       | yes except `preview_cleanup`           | Revision associated with the run; `preview_cleanup` may instead point to preview lineage or source-run ancestry. |
| `requested_by`                                   | yes                                    | Stable principal id for the requesting actor.                                                                    |
| publish mode                                     | yes                                    | `normal` or `preview`; `preview_cleanup` records should use `preview`.                                           |
| declared normal provider-target identity         | yes                                    | Normal live target identity.                                                                                     |
| effective run target identity                    | yes                                    | Actual mutated target identity.                                                                                  |
| `lock_scope`                                     | yes                                    | Canonical lock scope.                                                                                            |
| deployment metadata fingerprint or snapshot ref  | yes                                    | Resolved metadata used by the run.                                                                               |
| execution-snapshot reference                     | yes for protected/shared mutating runs | Frozen snapshot actually used.                                                                                   |
| runner implementation identities                 | yes for protected/shared mutating runs | Built-in publisher/provisioner/smoke/release-action runner version or digest set actually used.                  |
| `lane_policy` fingerprint or snapshot ref        | yes when applicable                    | Authoritative lane context.                                                                                      |
| `admission_policy` fingerprint or snapshot ref   | yes when applicable                    | Authoritative admission context.                                                                                 |
| approval evidence or approval record ref         | yes when human approval is required    | Must explain why the run was admitted.                                                                           |
| approval payload-binding ref or embedded summary | yes when human approval is required    | Must prove what immutable payload the approval authorized.                                                       |
| start time and end time                          | yes                                    | Audit timeline.                                                                                                  |
| `final_outcome`                                  | nullable                               | Canonical terminal outcome when reached.                                                                         |

Conditionally required:

- `submitted_by` when distinct from `requested_by`
- `executed_by` for protected/shared runs
- smoke result when a smoke step was declared and reached
- reviewed provisioner plan/diff artifact reference when infra-affecting mutation relied on one
- per-component publish outcome state for multi-component runs
- per-component resolved artifact identity for multi-component runs
- per-component remote publish identifier when a multi-component provider exposes one
- per-component no-op reuse decision and supporting evidence when a multi-component retry or reconciliation path safely skips re-publish
- progressive rollout state when the run uses phased or traffic-shifting rollout semantics
- rollout phase or step result history when the run uses phased or traffic-shifting rollout semantics
- `parent_run_id` for retry, rollback, and promotion derived from an earlier run
- `release_lineage_id` when the run belongs to a promoted multi-run lineage
- `artifact_lineage_id` when the same artifact is intentionally reused
- `deploy_batch_id` or equivalent grouping id when the run was created from one higher-level mutating batch such as `--from-changes`
- migration or alias exception reference when admission or replay relied on one
- emergency evidence object or structured emergency-evidence reference when break-glass mutation was used
- `failed_step` when `final_outcome` is not `succeeded` and the run reached a canonical lifecycle step after `resolve`
- cancellation summary when a cancel request was accepted
- recovery-state summary when protected/shared in-doubt recovery occurred
- in-doubt-step identifier when protected/shared in-doubt recovery occurred
- recovery decision summary when protected/shared in-doubt recovery occurred
- `cleanup_reason` for `preview_cleanup`
- isolated preview target identity for `preview_cleanup`
- source-run snapshot reference when a protected/shared exact-artifact selector resolved through an earlier admitted run
- explicit preview identity selector summary when `publish_mode = preview` or `operation_kind = preview_cleanup`
- rollout resumability state when a progressive rollout run reaches `paused`
- latest accepted run-action summary when a paused or running progressive rollout has received a first-class action such as `resume`

Identity rule:

- protected/shared identity-bearing audit fields should preserve a stable immutable principal id first
- display-oriented identity strings may be stored in addition to the stable principal id
- omitted identity fields may inherit semantically from earlier ones when the actor is the same
- authorization and self-approval checks should evaluate the stable principal identity, not display strings

### In-Doubt Recovery Summary

Required when protected/shared recovery occurred after provider-side mutation may have begun but before authoritative finalization completed.

Minimum fields:

- whether recovery occurred
- in-doubt step identifier
- whether provider-state reconciliation proved mutation completed, proved mutation did not occur, or remained inconclusive
- whether execution resumed, converged directly to a final record, or terminated for operator follow-up
- recovery-attempt timestamp or interval summary

### Cancellation Summary

Required when a cancel request was accepted for the run.

Minimum fields:

- cancellation requested time
- requesting identity
- lifecycle step active when cancellation was accepted
- whether provider-side mutation or side-effecting `release_actions` may already have begun
- whether the run entered reconciliation before terminalization
- resulting terminalization path:
  - `cancelled_without_mutation`
  - `finished_after_reconciliation`
  - `failed_after_reconciliation`

### Emergency Evidence

Required when break-glass mutation is used.

Minimum fields:

- incident reference
- requesting principal id
- approving principal id, when an approver exists for that emergency path
- executing principal id
- emergency reason or justification
- artifact or source-run selection path
- why the normal control plane was unavailable or bypassed

### Approval Payload-Binding Evidence

Required when human or policy approval is used for admission.

Minimum fields:

- bound `deploy_run_id`
- bound execution-snapshot fingerprint or ref
- bound canonical target identity
- bound artifact identity or source-run snapshot ref when publishing
- bound preview identity selector when preview publication or preview cleanup is being approved
- bound provisioner plan/diff ref when infra-affecting provisioning was approved
- approval record reference or approver principal id

### Progressive Rollout State

Required when the run uses `phased`, `canary`, `blue_green`, or `store_staged`.

Minimum fields:

- rollout mode
- current phase or step id
- current phase state from the closed rollout-state vocabulary
- per-phase state history
- resumability posture
- last observed provider-side exposure, slot, or rollout-track state when the provider exposes it
- whether the rollout is paused awaiting operator action, bake-time expiry, or fresh approval
- whether the paused rollout is currently resumable under recorded state and current approval status
- highest completed phase or increment from which `resume` is allowed to continue

### Latest Accepted Run-Action Summary

Required when a paused or running progressive rollout has received a first-class action such as `resume`.

Minimum fields:

- action type
- requesting principal id
- accepted time
- action idempotency key or equivalent deduplication identity
- resulting lifecycle-state or rollout-state transition
- machine-readable action rejection code when the latest action attempt was rejected and the implementation chooses to surface that in the record or read model

## 8. Retention Expectations

Minimum operator-facing retention windows:

- protected/shared immutable artifacts plus full replay bundles:
  - `production_facing`: 180 days
  - `shared_nonprod`: 30 days
- protected/shared authoritative deployment records, approval evidence, migration or alias exception records, and break-glass emergency evidence:
  - `production_facing`: 1 year
  - `shared_nonprod`: 180 days
- minimum restore-test cadence for the authoritative control plane:
  - `production_facing`: monthly
  - `shared_nonprod`: quarterly
- target control-plane recovery objectives:
  - `production_facing`: RPO `15m`, RTO `1h`
  - `shared_nonprod`: RPO `4h`, RTO `8h`

Retention rule:

- audit and authorization evidence must not expire sooner than the corresponding deployment records they justify
- implementations may retain records longer, but must not retain them for less than these minimums

Canonical `final_outcome` values:

- `validation_failed`
- `build_failed`
- `resolve_failed`
- `provision_failed`
- `release_action_failed`
- `publish_failed`
- `smoke_failed_after_publish`
- `succeeded`
- `null` for no canonical terminal outcome

Canonical `termination_reason` values:

- `cancelled`
- `superseded`
- `no_longer_admitted`
- `lock_timeout`
- `null` when the run reaches a canonical terminal outcome

Notes:

- `failed_step` should use the canonical lifecycle vocabulary such as `release_actions.pre_publish`, `publish`, `release_actions.post_publish_pre_smoke`, `smoke`, or `release_actions.post_smoke`.
- The schema keeps a compact `final_outcome` enum; step-level failure location belongs in `failed_step` rather than expanding `final_outcome` for every phase.
- `termination_reason` is intentionally separate from `final_outcome`; it explains non-canonical terminal exits rather than publish/provision/smoke success or failure.

## 9. Validation Expectations

Repo validation should reject:

- missing required metadata for the deployment's policy class
- unsupported rollout modes for the selected provider
- protected/shared package-local executable mutation hooks
- preview configuration without isolated-target semantics
- missing canonical provider-target identity fields
- invalid prerequisite graphs
- duplicate prerequisite ids
- self-referential prerequisites
- cross-lane prerequisites
- protected/shared approval-policy shapes that leave retry, promotion, or rollback approval semantics ambiguous
- protected/shared immutable-artifact selectors that do not resolve unambiguously to one admitted source-run snapshot
- protected/shared lane policies whose promotion-compatibility contract is missing, open-ended, or not resolvable to one closed reviewed field set before promotion
- `release_actions` declarations that omit phase, abort behavior, or replay policy
- side-effecting `release_actions` declarations that allow `rerun` without a duplicate-execution-safety contract
- `release_actions` declarations that omit data-compatibility posture for stateful action types
- protected/shared infra-affecting provisioner declarations whose reviewed path requires plan/diff visibility but does not define that contract
- `rollout_policy` declarations that omit mode-required phase, gate, or exposure semantics
- approval-requiring protected/shared admission policies that do not define immutable payload-binding requirements
- protected/shared record or snapshot shapes that preserve approval identity but not the immutable payload those approvals authorized
- protected/shared replay shapes that preserve secret/config references without preserving fail-closed reference-resolution behavior
- progressive rollout declarations that omit required phase-state, resume, abort, or partial-rollback semantics

## 10. Versioned Interface Payloads

These payloads define the minimum versioned contract boundary between Buck extraction, the repo-level
CLI, and the shared control plane.

### Extracted Deployment Metadata Payload

Minimum fields:

- `schema_version`
- deployment id
- deployment label
- extracted authoritative deployment metadata fields
- extraction timestamp or build metadata version

### Mutating Submit Request Payload

Minimum fields:

- `schema_version`
- deployment id
- requested `operation_kind`
- requested `publish_mode`
- any explicit source-run selectors
- normalized preview identity selector summary when preview publish or preview cleanup is requested
- caller identity or auth context reference
- client-generated stable submit idempotency key or submission id
- normalized-intent fingerprint or equivalent server-verifiable representation of the request meaning used to detect same-key different-payload conflicts

Contract rules:

- protected/shared submit requests must be idempotent at the control-plane submission layer, not only at the provider publish layer
- re-submitting the same idempotency key with the same normalized request must resolve to the same accepted run or same rejection result
- re-submitting the same idempotency key with materially different normalized request contents must fail with an explicit idempotency-conflict rejection rather than creating a second run

### Run-Action Request Payload

Minimum fields:

- `schema_version`
- target `deploy_run_id`
- requested action such as `resume`
- caller identity or auth context reference
- any action-specific approval evidence or continuation selector required by the paused run's policy
- client-generated stable submit idempotency key or submission id
- normalized-intent fingerprint or equivalent server-verifiable representation of the action meaning used to detect same-key different-payload conflicts

Contract rules:

- protected/shared run-action requests must be idempotent at the control-plane submission layer, not only at the worker or provider layer
- re-submitting the same run-action idempotency key with the same normalized action request must resolve to the same continuation result or same rejection result
- re-submitting the same run-action idempotency key with materially different normalized action request contents must fail with an explicit idempotency-conflict rejection rather than creating duplicate continuation work

### Admitted Execution-Snapshot Payload

Minimum fields:

- `schema_version`
- admitted run id
- frozen deployment metadata snapshot ref
- frozen provider-config snapshot ref
- frozen policy snapshot refs
- declared normal target identity
- effective run target identity
- admitted artifact refs or admitted source revision
- admitted secret/runtime-config refs
- runner implementation identities
- approval payload-binding ref or embedded summary when approval is part of admission
- reviewed provisioner plan/diff artifact ref when infra-affecting mutation is in scope

### Run-Status / Read-Model Payload

Minimum fields:

- `schema_version`
- `deploy_run_id`
- deployment id
- lifecycle state
- final outcome
- termination reason
- effective target identity
- lock scope
- lineage ids when present
- current rollout state when applicable
- whether a paused progressive rollout is currently resumable
- whether later-phase approval is still required before a paused rollout may resume
- preview identity selector summary when `publish_mode = preview` or `operation_kind = preview_cleanup`

### Mutating Submit Response Payload

Minimum fields:

- `schema_version`
- whether the request was accepted
- `deploy_run_id` when a run exists
- whether the submission created a new run or resolved to an existing run through submit-layer idempotency
- initial lifecycle state when a run exists
- stable run-status/read-model reference when a run exists
- machine-readable rejection code when the request is not accepted
- structured rejection details or references sufficient for operator tooling to explain the outcome without parsing free-form text

Minimum closed rejection-code vocabulary:

- `invalid_request`
- `invalid_selector`
- `unauthorized`
- `no_longer_admitted`
- `preview_not_supported`
- `preview_not_isolated`
- `promotion_incompatible`
- `idempotency_conflict`

Contract rules:

- the exact transport or HTTP status mapping is implementation-specific, but this payload shape and rejection-code meaning should remain stable across CLI, UI, and CI-triggering clients
- a repeated request resolved through idempotent deduplication should return the same `deploy_run_id` and indicate that no new run was created
- when a request is valid and authorized to request deployment but still needs human approval, the canonical response is an accepted run with `lifecycle_state = pending_approval`, not a submit-time rejection
- rejection codes should be machine-readable, closed by policy review, and documented enough that clients can automate behavior without depending on prose strings

### Run-Action Response Payload

Minimum fields:

- `schema_version`
- whether the action was accepted
- target `deploy_run_id`
- whether the action created new continuation work or resolved to an existing result through submit-layer idempotency
- resulting lifecycle state and rollout-state summary when a run exists
- stable run-status/read-model reference when a run exists
- machine-readable rejection code when the action is not accepted
- structured rejection details or references sufficient for operator tooling to explain the outcome without parsing free-form text

Minimum closed run-action rejection-code vocabulary:

- `invalid_action`
- `run_not_found`
- `run_not_paused`
- `run_not_resumable`
- `approval_required`
- `approval_no_longer_valid`
- `idempotency_conflict`

Contract rules:

- the exact transport or HTTP status mapping is implementation-specific, but this payload shape and rejection-code meaning should remain stable across CLI, UI, and CI-triggering clients
- a repeated action request resolved through idempotent deduplication should return the same target `deploy_run_id` and indicate that no duplicate continuation work was created
- run-action rejection codes should be machine-readable, closed by policy review, and documented enough that clients can automate behavior without depending on prose strings

### Replay-Selector Payload

Minimum fields:

- `schema_version`
- selector kind such as `source_run_id`
- selected source-run id or equivalent immutable selector
- resolution result or resolution reference once bound

Contract rule:

- these payloads may be transported or serialized differently by implementation, but their schema version and field meaning must remain explicit and fail closed across independently implemented components

## 11. Control-Plane Observability Signals

Minimum required structured event categories for protected/shared mutation:

- submission and admission outcome
- approval granted, reused, expired, or revoked
- lock acquisition attempt, success, timeout, and release
- mutation-step start and finish
- progressive-rollout phase transition
- cancellation, supersedence, and no-longer-admitted termination
- preview cleanup
- break-glass invocation and reconciliation
- in-doubt-run detection, recovery start, recovery decision, and recovery completion

Minimum required metric categories:

- queue depth and queue wait time
- lock contention and stale-lock or fencing-loss events
- run duration by lifecycle step
- retry counts by step
- failure counts by `final_outcome` and `failed_step`
- age of oldest queued and running runs
- backup, restore-test, and failover success state for the authoritative backend
- in-doubt-run count and recovery-outcome count

Minimum required operator-visibility surfaces:

- alerting for resilience, lock, and repeated-run-failure conditions
- dashboards or equivalent views for per-lane run health, queue state, lock state, progressive rollout state, backend recovery posture, and in-doubt or recovered run state

Protected/shared observability and durable-record redaction rules:

- logs, audit events, dashboards, deployment records, and replay snapshots must not contain secret values, raw credentials, rendered secret-bearing config, or unreviewed provider output that may include secret-bearing request or response fields
- when a captured payload is not provably secret-safe, the implementation should persist only a redacted summary, structured code, stable reference, or fingerprint instead of the raw payload

## Companion Docs

- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
- [Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Control-Plane Observability](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-control-plane-observability.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)
- [Deployment Scenarios](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-scenarios.md)
- [Deployment Implementation Plan](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-plan.md)
