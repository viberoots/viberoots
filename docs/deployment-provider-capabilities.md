# Deployment Provider Capabilities

This document defines the required contract for each built-in deployment provider capability entry.

The goal is to keep provider behavior explicit, reviewable, and consistent across adapters.

Every built-in provider intended for protected/shared deployment use should have one authoritative entry
covering the fields below before it is considered in policy.

Normative-source note:

- this document is the authoritative reviewed registry for built-in provider capability support
- [Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md) may summarize provider support for onboarding, but this document owns the normative provider-capability contract

## Required Capability Fields

| Field                              | Purpose                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`                         | Stable provider family identifier.                                                                                                              |
| canonical target identity fields   | Defines which `provider_target` fields establish live-target identity.                                                                          |
| canonical lock-key rule            | Defines how lock scope is derived from canonical identity.                                                                                      |
| supported component kinds          | Defines which component shapes the provider can publish.                                                                                        |
| supported rollout modes            | Defines which `rollout_policy` modes are valid.                                                                                                 |
| default rollout mode               | Defines the provider's default rollout semantics when deployment metadata omits `rollout_policy`.                                               |
| preview support                    | States whether preview is unsupported, supported with restrictions, or fully supported.                                                         |
| preview isolation model            | Defines how preview target isolation is proven.                                                                                                 |
| preview cleanup default            | Defines the concrete default cleanup/TTL behavior when deployment metadata relies on provider defaults.                                         |
| preview lock-scope default         | Defines whether preview shares the normal lock by default or may use its own lock by default.                                                   |
| smoke or release-health model      | Defines how built-in smoke/health checks work for this provider.                                                                                |
| retry/idempotency assumptions      | Defines when publish retry is safe.                                                                                                             |
| partial publish observability      | Defines whether partial publish state can be observed and recorded.                                                                             |
| provisioner support                | Defines whether deployment-owned provisioners are supported, which built-in provisioner types are allowed, and what plan/diff guarantees exist. |
| built-in `release_actions` support | Defines whether protected/shared built-in release actions are supported and which reviewed action types are allowed.                            |
| multi-component support            | Defines whether multi-component deployments are supported.                                                                                      |
| protected/shared eligibility       | States whether the provider is in policy for protected/shared use.                                                                              |

## Review Questions For Every Provider

- What exact `provider_target` fields determine the normal mutable live target?
- Can preview mutate an isolated target with its own cleanup and lock semantics?
- Which rollout modes are truly supported, and which must be rejected?
- What smoke or release-health checks are available by default?
- Under what conditions is retry safe or idempotent?
- Can the provider surface concrete publish identifiers and partial publish state?
- Does the provider support deployment-owned provisioners for protected/shared use, and what reviewed plan/diff guarantees apply?
- Does the provider support protected/shared built-in `release_actions`, and which action types are allowed?
- Does the provider require package-local executable hooks, or can it stay inside the built-in registry model?

## Capability Entry: `nixos-shared-host`

### Identity

- `provider`: `nixos-shared-host`
- canonical target identity fields:
  - `host`
  - `target_group`
  - `app_name`
- canonical lock-key shape:
  - `nixos-shared-host:<target_group>:<app_name>`
- required normalized derived fields:
  - `hostname = "${appName}.apps.kilty.io"`
  - `container_name = "${appName}"`

### Component Support

- supported component kinds:
  - `static-webapp`
- multi-component support:
  - reviewed for `shared_nonprod` only when every component is a `static-webapp`
  - all components must resolve to one `target_group`
  - every component must declare a distinct `app_name`
  - replay-style flows (`publish-only`, retry, rollback, promotion) remain single-component only in the current reviewed slice
- additional unsupported shapes:
  - explicit subdomain-style overrides
  - provider-family use with non-webapp component targets

### Rollout Support

- default rollout mode:
  - provider-family host realization only; publish rollout remains single-target and all-at-once in the initial slice
- supported rollout modes:
  - `all_at_once` for single-component deployments
  - `ordered_best_effort` for the reviewed multi-component static-webapp slice, with:
    - explicit `rollout_policy`
    - `abort = "stop_on_first_failure"`
    - `smoke = "final_only"`
    - `steps` listing every component id exactly once

### Preview Support

- preview support:
  - not reviewed in the initial `nixos-shared-host` slice

### Smoke / Release Health

- default smoke model:
  - when `healthPath` is declared, smoke resolves against `https://${appName}.apps.kilty.io${healthPath}`
  - every static-webapp publish also validates `https://${appName}.apps.kilty.io/` and rejects success when the public root does not serve the just-published `index.html`

### Retry / Idempotency

- reviewed initial publish contract for `nixos-shared-host-static-webapp`:
  - stage immutable artifact contents under `/srv/static-app/releases/<artifact-identity>`
  - activate by atomically repointing `/srv/static-app/current`
  - keep nginx rooted at `/srv/static-app/live`, which remains a stable link to `current`
  - re-publishing an already-staged artifact identity may reuse the existing release directory
  - admitted deploys persist the exact static artifact under the local artifact/provenance store before publish starts
  - the shared control-plane execution snapshot freezes publish input as an exact-artifact reference instead of a workstation-local `artifactDir`

### Replay Snapshot Baseline

- reviewed initial immutable-reuse baseline for `nixos-shared-host-static-webapp`:
  - each admitted deploy persists a replay snapshot for the run
  - the replay snapshot records:
    - exact artifact reference
    - canonical provider-target identity
    - deployment metadata fingerprint
    - platform-state snapshot reference
    - rendered host-config snapshot reference
  - reusable artifact provenance stays in the artifact/provenance store, while deployment-run records point at that artifact plus the replay snapshot used for the run

### Immutable-Reuse Operator Flows

- reviewed initial same-deployment immutable-reuse slice for `mini`:
  - shared `--publish-only` must name an admitted source run with `--source-run-id`
  - shared `--publish-only` must not accept a fresh local `artifactDir` as an implicit rebuild input
  - same-deployment `--publish-only` is recorded as `retry`
  - same-deployment rollback requires both `--publish-only` and `--rollback`
  - rollback source selection is limited to prior successful normal runs for the same deployment
  - successful `retry`, `rollback`, and `explicit_removal` runs are not valid rollback sources
  - if the retained exact artifact is unavailable, retry or rollback fails closed instead of rebuilding

### Partial Publish Observability

- the initial local record surface preserves:
  - canonical `operation_kind = deploy`
  - `run_classification = deploy | retry | rollback | explicit_removal`
  - `publish_mode = normal`
  - `lifecycle_state = finished`
  - canonical `final_outcome`
  - deployment id and deployment label
  - canonical provider-target identity as both structured provider-target fields and normalized identity
  - artifact identity for publish runs
  - artifact provenance and stored exact-artifact references for admitted deploys
  - parent-run and artifact-lineage fields for retry / rollback reuse
  - deployment metadata fingerprint and replay snapshot path
  - failed step when a run terminates unsuccessfully after admission into the local workflow

### Provisioner Support

- reviewed built-in provisioner reference for the initial slice:
  - `nixos-shared-host-manifest`
- meaning:
  - reviewed deploy/control-plane workflows maintain one authoritative cumulative platform-state artifact for the selected `nixos-shared-host` target
  - scoped apply may create or update only the named deployment entries in that platform state
  - authoritative full reconcile may replace the full platform state
  - explicit removal deletes one named deployment entry without inferring deletion from slice-local omission
  - host realization consumes only that authoritative platform state and owns container and ingress creation on the target NixOS host
  - host generation derives one generic `static-app-host` container plus one nginx route per declared app and fails closed on duplicate hostnames or backend identities
  - the current host-consumer boundary is the NixOS module `build-tools/tools/nix/nixos-shared-host-module.nix`
  - the initial operator workflow also has a reviewed local materialization path that mirrors the same container filesystem contract for end-to-end publish and smoke testing

### Built-In `release_actions` Support

- not supported in the initial reviewed `nixos-shared-host` slice

### Protected/Shared Eligibility

- `protection_class` defaults to `shared_nonprod`
- the initial reviewed slice supports shared-dev metadata extraction, authoritative platform-state reconciliation, and deterministic host realization for static webapps on a NixOS host

## Capability Entry: `cloudflare-pages`

### Identity

- `provider`: `cloudflare-pages`
- canonical target identity fields:
  - `project`
  - `account`
- canonical lock-key shape:
  - `cloudflare-pages:<account>/<project>`

### Component Support

- supported component kinds:
  - `static-webapp`
- multi-component support:
  - not supported for protected/shared use
  - deployments must contain exactly one `static-webapp` component
- additional unsupported shapes:
  - complex multi-component systems
  - provider-specific arbitrary executable hooks in protected/shared paths

### Rollout Support

- default rollout mode:
  - `all_at_once`
- supported rollout modes:
  - `all_at_once`
- unsupported rollout modes:
  - `all_or_nothing`
  - `ordered_best_effort`
  - `parallel_best_effort`
  - `canary`
  - `blue_green`
  - `phased`
  - `store_staged`

### Preview Support

- preview support:
  - supported only when the deployment explicitly opts in with `preview` metadata
  - the current built-in operator contract uses `deploy <deployment> --preview --source-run-id <deploy-run-id>`
- preview isolation model:
  - provider-managed isolated preview target derived deterministically from deployment metadata plus run context
- preview cleanup default:
  - provider-managed cleanup with a default TTL of `7d`; deployment metadata may override when needed
  - the current built-in explicit cleanup contract uses `deploy <deployment> --preview-cleanup --source-run-id <deploy-run-id>`
- preview lock-scope default:
  - preview shares the normal deployment lock by default
  - a separate preview lock scope is allowed only when the preview satisfies the stronger independent-execution isolation bar
- required guarantees:
  - isolated effective mutable target identity
  - isolated smoke target
  - isolated cleanup path

### Smoke / Release Health

- default smoke model:
  - built-in HTTP smoke against the configured canonical URL
  - for the reviewed static-webapp slice, the canonical normal URL is `https://${project}.pages.dev/`
  - the initial built-in smoke run validates that canonical root URL after publish and blocks success on mismatch or non-200
- preview override:
  - may use preview URL only when explicitly configured

### Built-In Publisher Contract

- built-in publisher type:
  - `wrangler-pages`
- exact publish input:
  - one admitted immutable `static-webapp` artifact directory
- checked-in provider config:
  - `wrangler.jsonc` remains provider-native Wrangler configuration only
  - deployment metadata injects or validates the authoritative Pages project name instead of allowing config drift to silently retarget publish
- account selection:
  - protected/shared execution must derive the Cloudflare account scope from authoritative deployment metadata rather than ambient local CLI defaults

### Retry / Idempotency

- publish retry may be allowed only for clearly transient network/provider failures
- if the provider cannot prove idempotent retry semantics after an ambiguous result, the adapter must reconcile remote state before retrying

### Partial Publish Observability

- the adapter should preserve:
  - provider-exposed deployment id or equivalent publish id
  - final publish result
- stronger partial-state guarantees are implementation-dependent and should not be assumed without explicit adapter support

### Provisioner Support

- deployment-owned provisioners for protected/shared mutation:
  - not supported in the reviewed `cloudflare-pages` capability entry
- implication:
  - protected/shared `cloudflare-pages` deployments should reject provisioner-managed infra mutation until a reviewed capability update defines allowed built-in provisioner types and their plan/diff contract

### Built-In `release_actions` Support

- protected/shared built-in `release_actions`:
  - not supported in the reviewed `cloudflare-pages` capability entry
- implication:
  - protected/shared `cloudflare-pages` deployments should reject `release_actions` until a reviewed capability update explicitly allows specific built-in action types and their replay expectations

### Protected/Shared Eligibility

- in policy for protected/shared single-component static-webapp deployments
- protected/shared execution must stay inside vetted built-in publisher, preview, and smoke-runner code

### Initial Pleomino Topology

- `pleomino-dev` stays on `nixos-shared-host` as the shared-dev path
- `pleomino-staging` uses `cloudflare-pages` with protection class `shared_nonprod`
- `pleomino-prod` uses `cloudflare-pages` with protection class `production_facing`

## Adding Another Provider

Before adding a new built-in provider for protected/shared use:

1. Define canonical target identity and lock-key semantics.
2. State supported component kinds.
3. State supported rollout modes.
4. State the default rollout mode.
5. Define preview isolation rules.
6. Define smoke/release-health rules.
7. Define retry/idempotency rules.
8. State whether partial publish state is observable.
9. State whether the provider is approved for protected/shared use.

Change-control rule:

- a built-in adapter must not widen provider support beyond the reviewed capability entry in this document
- when provider behavior changes materially, update this document first or in the same change

## Companion Docs

- [Deployment Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
- [Deployment Schema](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-schema.md)
- [Deployment Scenarios](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-scenarios.md)
- [Deployment Implementation Plan](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-plan.md)
