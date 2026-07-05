# Deployment Provider Capabilities

This document defines the required contract for each built-in deployment provider capability entry.

The goal is to keep provider behavior explicit, reviewable, and consistent across adapters.

Every built-in provider intended for protected/shared deployment use should have one authoritative entry
covering the fields below before it is considered in policy.

Normative-source note:

- reviewed built-in provider entries are rendered from the structured provider-capability registry in
  `build-tools/tools/deployments/provider-capabilities/**`
- those structured capability entries are the authoritative source for normative provider values
- this document may add explanatory prose outside the rendered registry block, but must not redefine
  reviewed provider values independently
- [Deployment Design](history/designs/deployments-design.md) may summarize provider support for onboarding, but this document owns the normative provider-capability contract
- [Deployments Usage](deployments-usage.md) is the reviewed
  operator-facing front door for the day-to-day command surface that sits above
  these provider-specific capability details

Secret backend note:

- Vault and Infisical are deployment secret backends, not provider capability
  variants. Providers continue to declare required credentials through
  `secret_requirements`; choosing Infisical changes how admitted references are
  resolved and replayed, not the provider-facing credential declaration.

## Required Capability Fields

| Field                              | Purpose                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `provider`                         | Stable provider family identifier.                                                                                                              |
| canonical target identity fields   | Defines which `provider_target` fields establish live-target identity.                                                                          |
| canonical lock-key rule            | Defines how lock scope is derived from canonical identity.                                                                                      |
| supported component kinds          | Defines which component shapes the provider can publish.                                                                                        |
| supported rollout modes            | Defines which `rollout_policy` modes are valid.                                                                                                 |
| default rollout mode               | Defines the provider's default rollout semantics when deployment metadata omits `rollout_policy`.                                               |
| rollout-policy omission posture    | Defines which reviewed deployment shapes may omit `rollout_policy` and rely on the explicit provider default.                                   |
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

## Resource Graph Provider Evidence

The resource graph read model exposes provider observed-state evidence as
`ProviderEvidence` runtime resources. Provider evidence is normalized through a
versioned matrix, `provider-evidence-matrix@1`, so each reviewed provider marks
live target identity, provider release id, drift, preview, partial publish,
smoke/readiness, and rollback/recovery evidence as `supported`, `unsupported`,
or `deferred`.

Unsupported or deferred fields must stay explicit in status instead of being
emulated from unrelated facts. Source-plan links are preserved only when the
provider record already explains a built artifact or execution snapshot; the
resource graph does not infer provider compatibility from `nixpkgs_profile` or
`nixpkg_pins`.

Provider capability policy resources use `ProviderCapabilityPolicy` with
`resourceId = provider-capability:<provider>` and version `provider-capability@1`. This is the
traceable identity for provider eligibility decisions. Missing or unsupported provider capability
refs remain fail-closed through the reviewed provider registry and existing protected/shared
eligibility checks.

Release-action policy resources use `ReleaseActionPolicy` with `resourceId = <release-action Buck
label>:policy` and the extracted release-action fingerprint as `version`. These resources make
release-action decisions addressable in snapshots and status while linking back to the release-action
label as reviewed source. They do not add a new policy language; unsupported, destructive, stale, or
incompatible release actions still fail through the existing release-action admission and replay
checks.

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

<!-- BEGIN GENERATED PROVIDER CAPABILITIES -->

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
  - `ssr-webapp`
- multi-component support:
  - reviewed for `shared_nonprod` only when every component is a `static-webapp`
  - all components must resolve to one `target_group`
  - every component must declare a distinct `app_name`
  - replay-style flows (`publish-only`, retry, rollback, promotion) are reviewed for the ordered-best-effort static-webapp slice when the replay source preserves per-component exact artifact and publish state
  - the reviewed `ssr-webapp` slice is single-component only
- additional unsupported shapes:
  - explicit subdomain-style overrides
  - provider-family use with non-webapp component targets

### Rollout Support

- default rollout mode:
  - `all_at_once`
- rollout-policy omission posture:
  - omission is reviewed only for single-component deployments
  - protected/shared multi-component deployments must declare `rollout_policy` explicitly even when the intended behavior would otherwise match the provider default
- supported rollout modes:
  - `all_at_once`
  - `ordered_best_effort`
- reviewed multi-component posture:
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
  - every reviewed `ssr-webapp` publish validates `https://${appName}.apps.kilty.io/` and optional `healthPath` against the admitted SSR runtime instead of inferring a static artifact contract

### Built-In Publisher Contract

- built-in publisher types:
  - `nixos-shared-host-static-webapp`
  - `nixos-shared-host-ssr-webapp`
- reviewed SSR runtime contract for `nixos-shared-host-ssr-webapp`:
  - admitted immutable artifact kind is `ssr-webapp`
  - the artifact must contain `dist/server/index.js`
  - the artifact must contain `dist/client`
  - the host runtime starts the server with `node dist/server/index.js`
  - `runtime_config_requirements` and `secret_requirements` remain the only reviewed runtime-config and secret injection boundary for this slice
  - promotion-safe lanes require the reviewed contract `node-dist-server-v1` and serving topology `single-host-node-with-nginx`

### Retry / Idempotency

- reviewed initial publish contract for `nixos-shared-host-static-webapp`:
  - stage immutable artifact contents under `/srv/static-app/releases/<artifact-identity>`
  - activate by atomically repointing `/srv/static-app/current`
  - keep nginx rooted at `/srv/static-app/live`, which remains a stable link to `current`
  - re-publishing an already-staged artifact identity may reuse the existing release directory
  - admitted deploys persist the exact static artifact under the local artifact/provenance store before publish starts
  - the shared control-plane execution snapshot freezes publish input as an exact-artifact reference instead of a workstation-local `artifactDir`
  - multi-component replay may skip a previously published component only when the host can prove the live immutable artifact identity already matches the recorded exact artifact identity; otherwise it must republish conservatively
- reviewed initial publish contract for `nixos-shared-host-ssr-webapp`:
  - stage immutable artifact contents under `/srv/ssr-app/releases/<artifact-identity>`
  - activate by atomically repointing `/srv/ssr-app/current`
  - keep `/srv/ssr-app/live` stable for the reviewed Node runtime and nginx ingress contract
  - preserve exact SSR runtime-contract provenance in records and replay snapshots

### Replay Snapshot Baseline

- reviewed immutable-reuse baseline for `nixos-shared-host-static-webapp`:
  - each admitted deploy persists a replay snapshot for the run
  - the replay snapshot records:
    - the exact publish input:
      - one exact artifact reference for single-component runs
      - per-component exact artifact references plus one composite artifact identity for multi-component runs
    - canonical provider-target identity
    - deployment metadata fingerprint
    - platform-state snapshot reference
    - rendered host-config snapshot reference
    - per-component artifact, publish, smoke, and live-identity state once the run reaches publish
  - reusable artifact provenance stays in the artifact/provenance store, while deployment-run records point at that artifact plus the replay snapshot used for the run

### Immutable-Reuse Operator Flows

- reviewed immutable-reuse slice for `shared_nonprod` `nixos-shared-host` static-webapp deployments:
  - shared `--publish-only` must name an admitted source run with `--source-run-id`
  - shared `--publish-only` must not accept a fresh local `artifactDir` as an implicit rebuild input
  - same-deployment `--publish-only` is recorded as `retry`
  - same-deployment rollback requires both `--publish-only` and `--rollback`
  - rollback source selection is limited to prior successful normal runs for the same deployment
  - successful `retry`, `rollback`, and `explicit_removal` runs are not valid rollback sources
  - if the retained exact artifact is unavailable, retry or rollback fails closed instead of rebuilding
  - multi-component retry, rollback, and same-artifact promotion reuse recorded per-component exact artifact inputs rather than re-resolving local build state
  - multi-component retry remains deployment-atomic by default after a partial publish failure; already-live components may be treated as no-op reuse only with exact live-identity proof

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
  - failed step when a run terminates unsuccessfully after service-side admission
  - for multi-component runs:
    - per-component exact artifact references
    - per-component publish outcome, smoke outcome, and live-identity proof
    - per-component no-op reuse evidence when replay safely skips a publish

### Provisioner Support

- reviewed built-in provisioner reference for the initial slice:
  - `nixos-shared-host-manifest`
- meaning:
  - shared control-plane `deploy` and `explicit_removal` runs generate one reviewed provisioner plan artifact from the frozen execution snapshot before the first mutating provider step
  - the plan artifact fingerprint is bound into protected/shared admission evidence so approval and later revalidation fail closed on plan drift
  - routine `deploy` remains non-destructive by default; if the reviewed plan would delete or replace an owned live target identity, the routine path is rejected and operators must use the separate destructive workflow instead of piggybacking on ordinary deploy authority
  - reviewed deploy/control-plane workflows maintain one authoritative cumulative platform-state artifact for the selected `nixos-shared-host` target
  - scoped apply may create or update only the named deployment entries in that platform state
  - authoritative full reconcile may replace the full platform state
  - explicit removal deletes one named deployment entry without inferring deletion from slice-local omission
  - host realization consumes only that authoritative platform state and owns container and ingress creation on the target NixOS host
  - host generation derives one generic `static-app-host` container plus one nginx route per declared app and fails closed on duplicate hostnames or backend identities
  - the current host-consumer boundary is the NixOS module `build-tools/tools/nix/nixos-shared-host-module.nix`
  - the initial operator workflow also has a reviewed service materialization path that mirrors the same container filesystem contract for end-to-end publish and smoke testing

### Built-In `release_actions` Support

- protected/shared built-in `release_actions`:
  - supported only for the reviewed built-in types:
    - `cache_warmup`
    - `post_publish_verification`
  - reviewed built-in action types that must be rejected on the ordinary protected/shared deploy path:
    - `schema_migration`
  - replay follows the recorded per-action replay policy for `retry`, `rollback`, and `promotion`
  - package-local executable hooks remain out of policy

### Protected/Shared Eligibility

- `protection_class` defaults to `shared_nonprod`
- protected/shared remote artifact submissions require service-issued authorized one-time challenges, reviewed proof-key binding, expected/admitted artifact identity binding, and server-side proof verification before worker queueing
- the initial reviewed slice supports shared-dev metadata extraction, authoritative platform-state reconciliation, and deterministic host realization for static webapps plus the single-component reviewed SSR runtime slice on a NixOS host
- protected/shared execution must stay inside the vetted built-in publisher, provisioner, smoke-runner, and reviewed built-in `release_actions` registry; package-local executable hooks are rejected on the normal control-plane path

## Capability Entry: `app-store-connect`

### Identity

- `provider`: `app-store-connect`
- canonical target identity fields:
  - `issuer`
  - `app`
  - `track`
- canonical lock-key shape:
  - `app-store-connect:<issuer>/<app>#track:<track>`
- required reviewed provider-target fields:
  - `bundle_id`
  - `platform = ios`
  - `signing_model = app-store`

### Component Support

- supported component kinds:
  - `mobile-app`
- multi-component support:
  - not supported in the reviewed initial slice
  - deployments must contain exactly one `mobile-app` component
- additional unsupported shapes:
  - Android or mixed-platform releases
  - non-mobile component kinds

### Rollout Support

- default rollout mode:
  - `all_at_once`
- rollout-policy omission posture:
  - omission is reviewed only for the single-component iOS mobile-app slice
- supported rollout modes:
  - `all_at_once`
  - `store_staged`
- reviewed staged-rollout posture:
  - `abort = "stop_on_first_failure"`
  - `smoke = "final_only"`
  - `steps` may be omitted or set to `["default"]`

### Preview Support

- preview support:
  - not reviewed in the initial `app-store-connect` slice

### Smoke / Release Health

- default smoke model:
  - built-in release-health validation rather than URL smoke
  - success requires reviewed upload receipt, processing success, installability, and, when `store_staged` is used, staged-rollout health evidence

### Built-In Publisher Contract

- built-in publisher type:
  - `app-store-connect-mobile-release`
- exact publish input:
  - one admitted immutable signed iOS release artifact (`.ipa`)
- checked-in provider config:
  - `app-store-connect.jsonc` remains provider-local publish configuration only
  - deployment metadata stays authoritative for issuer, app, bundle id, track, platform, and signing model; config drift must fail closed before publish

### Retry / Idempotency

- shared `--publish-only` reuses only an admitted exact artifact selected with `--source-run-id`
- same-deployment `--publish-only` is reviewed as `retry`
- same-deployment rollback is reviewed only for prior successful normal runs on the same canonical store target identity
- cross-deployment promotion is reviewed only for exact-artifact reuse through the source-ref lane contract
- static-webapp exact-artifact promotion may cross reviewed providers only on lane edges that explicitly opt in, and only when the source and target both resolve to the same reviewed static artifact compatibility family

### Replay Snapshot Baseline

- each admitted run persists:
  - the exact immutable mobile artifact reference
  - canonical provider-target identity
  - deployment metadata fingerprint
  - provider-config snapshot path
  - release-health evidence, track state, and rollout state needed for replay eligibility decisions

### Promotion Compatibility

- promotion-safe mobile lanes treat these as explicit compatibility inputs:
  - publisher type must match exactly
  - signing model must match exactly
  - track progression must move forward through the reviewed App Store Connect track order
  - rollout progression may stay at `all_at_once` or advance to `store_staged`, but must not regress

### Partial Publish Observability

- the adapter records:
  - store submission id
  - provider release id
  - exact artifact identity
  - track state
  - rollout state
  - release-health evidence

### Provisioner Support

- deployment-owned provisioners for protected/shared mutation:
- not supported in the reviewed `app-store-connect` capability entry

### Built-In `release_actions` Support

- protected/shared built-in `release_actions`:
  - not supported in the reviewed `app-store-connect` capability entry

### Protected/Shared Eligibility

- in policy for protected/shared single-component signed iOS `mobile-app` deployments
- protected/shared execution must stay inside the vetted built-in publisher and release-health validation path

## Capability Entry: `google-play`

### Identity

- `provider`: `google-play`
- canonical target identity fields:
  - `developer_account`
  - `app`
  - `track`
- canonical lock-key shape:
  - `google-play:<developer_account>/<app>#track:<track>`
- required reviewed provider-target fields:
  - `package_name`
  - `platform = android`
  - `signing_model = play-app-signing`

### Component Support

- supported component kinds:
  - `mobile-app`
- multi-component support:
  - not supported in the reviewed initial slice
  - deployments must contain exactly one `mobile-app` component
- additional unsupported shapes:
  - iOS or mixed-platform releases
  - non-mobile component kinds

### Rollout Support

- default rollout mode:
  - `all_at_once`
- rollout-policy omission posture:
  - omission is reviewed only for the single-component Android mobile-app slice
- supported rollout modes:
  - `all_at_once`
  - `store_staged`
- reviewed staged-rollout posture:
  - `abort = "stop_on_first_failure"`
  - `smoke = "final_only"`
  - `steps` may be omitted or set to `["default"]`

### Preview Support

- preview support:
  - not reviewed in the initial `google-play` slice

### Smoke / Release Health

- default smoke model:
  - built-in release-health validation rather than URL smoke
  - success requires reviewed upload receipt, processing success, installability, explicit track progression evidence, and, when `store_staged` is used, staged-rollout health evidence

### Built-In Publisher Contract

- built-in publisher type:
  - `google-play-mobile-release`
- exact publish input:
  - one admitted immutable signed Android release artifact (`.aab`)
- checked-in provider config:
  - `google-play.jsonc` remains provider-local publish configuration only
  - deployment metadata stays authoritative for developer account, app, package name, track, platform, and signing model; config drift must fail closed before publish

### Retry / Idempotency

- shared `--publish-only` reuses only an admitted exact artifact selected with `--source-run-id`
- same-deployment `--publish-only` is reviewed as `retry`
- same-deployment rollback is reviewed only for prior successful normal runs on the same canonical store target identity
- cross-deployment promotion is reviewed only for exact-artifact reuse through the source-ref lane contract

### Replay Snapshot Baseline

- each admitted run persists:
  - the exact immutable mobile artifact reference
  - canonical provider-target identity
  - deployment metadata fingerprint
  - provider-config snapshot path
  - release-health evidence, track state, and rollout state needed for replay eligibility decisions

### Promotion Compatibility

- promotion-safe mobile lanes treat these as explicit compatibility inputs:
  - publisher type must match exactly
  - signing model must match exactly
  - track progression must move forward through the reviewed Google Play track order
  - rollout progression may stay at `all_at_once` or advance to `store_staged`, but must not regress

### Partial Publish Observability

- the adapter records:
  - store submission id
  - provider release id
  - exact artifact identity
  - track state
  - rollout state
  - release-health evidence

### Provisioner Support

- deployment-owned provisioners for protected/shared mutation:
- not supported in the reviewed `google-play` capability entry

### Built-In `release_actions` Support

- protected/shared built-in `release_actions`:
  - not supported in the reviewed `google-play` capability entry

### Protected/Shared Eligibility

- in policy for protected/shared single-component signed Android `mobile-app` deployments
- protected/shared execution must stay inside the vetted built-in publisher and release-health validation path

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
- rollout-policy omission posture:
  - omission is reviewed only for the single-component static-webapp slice
  - no multi-component or advanced-rollout omission path is in policy
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
  - the current built-in operator contract uses `deploy --deployment <label> --preview --source-run-id <deploy-run-id>`
- preview isolation model:
  - provider-managed isolated preview target derived deterministically from deployment metadata plus run context
- preview cleanup default:
  - provider-managed cleanup with a default TTL of `7d`; deployment metadata may override when needed
  - the current built-in explicit cleanup contract uses `deploy --deployment <label> --preview-cleanup --source-run-id <deploy-run-id>`
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
- same-deployment rollback is supported only as exact-artifact reuse through `deploy --deployment <label> --publish-only --rollback --source-run-id <deploy-run-id>`
- rollback source selection is limited to prior successful normal live-target runs for the same deployment
- rollback fails closed when the retained exact artifact is unavailable or when the selected source run refers to preview rather than the normal live target

### Target Transition Support

- reviewed retire/migrate-target support:
  - supported only through the separate operator workflows `deploy --deployment <label> --retire-target --target-exception-ref <label>` and `deploy --deployment <label> --migrate-target --target-exception-ref <label>`
- reviewed exception requirements:
  - the selected target exception must be active, must carry the reviewed shared lock scope, and must not be superseded
  - migration exceptions must define `new_provider_target_identity`
- audit guarantees:
  - records preserve old target identity, new target identity when applicable, the selected exception object, and the resulting ownership state

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
  - allowed built-in action types: none
  - rejected built-in action types: all until a reviewed capability update explicitly allows specific types and their replay expectations
  - implication:
    - protected/shared `cloudflare-pages` deployments should reject `release_actions` until a reviewed capability update explicitly allows specific built-in action types and their replay expectations

### Protected/Shared Eligibility

- in policy for protected/shared single-component static-webapp deployments
- protected/shared execution must stay inside vetted built-in publisher, preview, and smoke-runner code
- package-local executable hooks, deployment-owned provisioners, and unreviewed `release_actions` remain out of policy for the normal shared-control-plane path

### Example Topology

- `example-dev` stays on `nixos-shared-host` as the shared-dev path
- `example-staging` uses `cloudflare-pages` with protection class `shared_nonprod`
- `example-prod` uses `cloudflare-pages` with protection class `production_facing`

## Capability Entry: `cloudflare-containers`

### Identity

- `provider`: `cloudflare-containers`
- canonical target identity fields:
  - `account_id`
  - `worker`
- canonical lock-key shape:
  - `cloudflare-containers:<account_id>/<worker>`

### Component Support

- supported component kinds:
  - `ssr-webapp`
  - `service`
  - `third-party-service`
- multi-component support:
  - not supported for protected/shared use
  - deployments must contain exactly one containerized component
- additional unsupported shapes:
  - ambient local Docker builds in protected/shared mutation
  - provider-side Git auto-builds as the authoritative artifact source

### Rollout Support

- default rollout mode:
  - `all_at_once`
- rollout-policy omission posture:
  - omission is reviewed only for the single-component local/fake publisher slice
  - advanced rollout policy requires a later reviewed live publisher contract
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
  - not reviewed for the initial Containers provider slice
- preview isolation model:
  - no preview target derivation is currently reviewed
- preview cleanup default:
  - not supported
- preview lock-scope default:
  - normal deployment lock only
- required guarantees:
  - separate reviewed PR before preview mutation is allowed

### Smoke / Release Health

- default smoke model:
  - public ingress may use HTTP smoke against the configured custom domain
  - private and no-ingress deployments rely on explicit smoke metadata or exceptions
- preview override:
  - not supported in the initial reviewed slice

### Built-In Publisher Contract

- built-in publisher type:
  - `cloudflare-containers-local`
- exact publish input:
  - one admitted immutable service artifact directory or OCI image digest file
- checked-in provider config:
  - `wrangler.jsonc` remains provider-native Worker and Containers configuration
  - deployment metadata remains authoritative for account, worker, ingress, and domain
- account selection:
  - protected/shared execution must use declared `cloudflare_account_id` metadata
- front-door validation:
  - `deploy --deployment <label> --validate-only` accepts reviewed metadata through the shared validation path
  - protected/shared public ingress fails closed without a custom domain and zone or a reviewed non-production `workers.dev` exception

### Retry / Idempotency

- local fake publisher retries are deterministic by artifact and config fingerprint
- live retry and rollback require a later reviewed Cloudflare API integration

### Target Transition Support

- not reviewed for the initial Containers provider slice

### Partial Publish Observability

- records preserve admitted artifact identity, Worker config fingerprint, target identity, and smoke URL when present

### Provisioner Support

- not supported in the reviewed initial capability entry

### Built-In `release_actions` Support

- protected/shared built-in `release_actions`:
  - not supported in the reviewed `cloudflare-containers` capability entry
  - allowed built-in action types: none

### Protected/Shared Eligibility

- metadata extraction and validation are reviewed
- protected/shared live mutation fails closed until a reviewed live publisher exists

## Capability Entry: `s3-static`

### Identity

- `provider`: `s3-static`
- canonical target identity fields:
  - `account`
  - `bucket`
  - optional `distribution`
- canonical lock-key shape:
  - `s3-static:<account>/<bucket>`
  - when a reviewed CDN hostname is part of the live target contract, the normalized identity appends `#distribution:<distribution>`

### Component Support

- supported component kinds:
  - `static-webapp`
- multi-component support:
  - not supported in the reviewed initial slice
- additional unsupported shapes:
  - preview/ephemeral targets
  - non-static component kinds

### Rollout Support

- default rollout mode:
  - `all_at_once`
- rollout-policy omission posture:
  - omission is reviewed only for the single-component static-webapp slice
- supported rollout modes:
  - `all_at_once`

### Preview Support

- preview support:
  - not reviewed in the initial `s3-static` slice

### Smoke / Release Health

- default smoke model:
  - built-in HTTP smoke against the reviewed canonical URL after publish
  - when `distribution` is declared, the canonical URL is `https://${distribution}/`
  - otherwise the canonical URL is the bucket website endpoint `https://${bucket}.s3-website.${region}.amazonaws.com/`

### Built-In Publisher Contract

- built-in publisher type:
  - `aws-s3-sync`
- exact publish input:
  - one admitted immutable `static-webapp` artifact directory
- checked-in provider config:
  - `aws-s3-sync.jsonc` remains provider-local publish configuration only
  - deployment metadata remains authoritative for `bucket`, `region`, and optional `distribution`; config drift must fail closed before publish

### Retry / Idempotency

- shared `--publish-only` reuses only an admitted exact artifact selected with `--source-run-id`
- same-deployment `--publish-only` is reviewed as `retry`
- same-deployment rollback is reviewed only for prior successful normal runs on the same canonical live target identity
- ambiguous provider outcomes must fail closed rather than silently retrying or rebuilding

### Immutable-Reuse Operator Flows

- reviewed protected/shared exact-artifact reuse slice:
  - `deploy --deployment <label> --publish-only --source-run-id <deploy-run-id>` reuses the admitted exact artifact plus the recorded deployment snapshot
  - same-deployment rollback requires both `--publish-only` and `--rollback`
  - rollback source selection is limited to prior successful normal live-target runs for the same deployment
  - retry or rollback fails closed when the retained exact artifact is unavailable

### Partial Publish Observability

- the adapter records:
  - canonical provider-target identity
  - exact artifact identity
  - provider config fingerprint
  - provider release id when the publisher exposes one

### Provisioner Support

- reviewed built-in provisioners for the initial slice:
  - `terraform-stack`
  - `cdktf-stack`
- meaning:
  - the normal deploy path may materialize one reviewed non-destructive plan artifact for bucket/CDN/DNS ownership before publish
  - the plan artifact fingerprint is available for protected/shared admission binding and operator review
- `--provision-only` is reviewed for protected/shared deployments through the control-plane service when the deployment declares one reviewed built-in provisioner
- that provision-only path still binds one admitted source revision and one frozen execution snapshot before provider mutation

### Built-In `release_actions` Support

- protected/shared built-in `release_actions`:
  - not supported in the reviewed initial `s3-static` capability entry

### Protected/Shared Eligibility

- in policy for protected/shared single-component static-webapp deployments
- protected/shared mutation, exact-artifact retry or rollback reuse, and reviewed `--provision-only` execution must route through the reviewed control-plane service / worker front door
- protected/shared execution must stay inside vetted built-in publisher, provisioner, and smoke-runner code

## Capability Entry: `kubernetes`

### Identity

- `provider`: `kubernetes`
- canonical target identity fields:
  - `cluster`
  - `namespace`
  - `release`
- canonical lock-key shape:
  - `kubernetes:<cluster>/<namespace>/<release>`

### Component Support

- supported component kinds:
  - `service`
  - `third-party-service`
- multi-component support:
  - supported for reviewed service plus sidecar or shared-platform slices
  - every component must be `service` or `third-party-service`
- additional unsupported shapes:
  - `static-webapp`
  - `ssr-webapp`
  - `mobile-app`

### Rollout Support

- default rollout mode:
  - `all_at_once`
- rollout-policy omission posture:
  - omission is reviewed only for the single-component service slice
  - protected/shared multi-component deployments must declare rollout policy explicitly
- supported rollout modes:
  - `all_at_once`
  - `ordered_best_effort`
- reviewed multi-component posture:
  - `ordered_best_effort`
  - `abort = stop_on_first_failure`
  - `smoke = final_only`
  - `steps` must list every component id exactly once

### Preview Support

- preview support:
  - not reviewed in the initial `kubernetes` slice

### Smoke / Release Health

- default smoke model:
  - built-in service-health smoke against the reviewed release endpoint after publish
  - the initial slice assumes namespace and release identity come from authoritative deployment metadata rather than from Helm values drift

### Built-In Publisher Contract

- built-in publisher type:
  - `helm-release`
- exact publish input:
  - one or more admitted immutable service-style component artifacts
- checked-in provider config:
  - `helm/values.yaml` or equivalent release values remain provider-local publish configuration only
  - deployment metadata remains authoritative for cluster, namespace, release, ingress mode, health path, service kind, and provider target identity; config drift must fail closed before publish
  - the reviewed initial slice requires a provider-local `chart` entry and may declare `smoke_url` plus optional `smoke_expect_contains` for service-health validation
  - the rendered publish config injects the admitted per-component artifact paths and identities so the release step consumes exact resolved inputs instead of ambient workspace state
  - rendered publish config is frozen in protected/shared execution snapshots before worker mutation
  - live release identity drift is fail-closed; normal artifact reconciliation happens only through the reviewed Helm publish step

### Retry / Idempotency

- shared `--publish-only` reuses only admitted exact component artifacts selected with `--source-run-id`
- same-deployment `--publish-only` is reviewed as `retry`
- same-deployment rollback is reviewed only for prior successful normal runs on the same canonical release target identity
- ambiguous provider outcomes must fail closed rather than silently replaying Helm mutation or rebuilding

### Immutable-Reuse Operator Flows

- reviewed protected/shared exact-artifact reuse slice:
  - `deploy --deployment <label> --publish-only --source-run-id <deploy-run-id>` reuses the recorded exact component artifacts plus the recorded deployment snapshot
  - same-deployment rollback requires both `--publish-only` and `--rollback`
  - rollback source selection is limited to prior successful normal release-target runs for the same deployment
  - retry and rollback preserve the recorded release values fingerprint and per-component publish inputs instead of re-resolving ambient workspace state

### Partial Publish Observability

- the adapter should preserve:
  - canonical provider-target identity
  - namespace and release identity
  - exact component artifact identities
  - per-component publish state for shared-platform or sidecar-shaped deployments

### Provisioner Support

- reviewed built-in provisioners for the initial slice:
  - `terraform-stack`
  - `cdktf-stack`
  - `opentofu-stack`
- meaning:
  - the normal deploy path may prepare namespace, ingress, storage, service-account, or related cluster wiring before publish
  - deployment metadata stays authoritative for target identity while the provisioner config stays provider-local
  - the initial reviewed deploy flow records a provisioner plan artifact alongside publish records when a built-in Kubernetes provisioner is declared
- `--provision-only` is reviewed for protected/shared deployments through the control-plane service when the deployment declares one reviewed built-in provisioner
- `opentofu-stack` provisioners must keep stack-owned files under the deployment package `opentofu/` directory, declare separate reviewed JSON (`plan_json`) and saved apply plan (`apply_plan`) artifacts, and bind stack identity plus state backend identity into admission evidence
- that provision-only path still binds one admitted source revision and one frozen execution snapshot before provider mutation

### Built-In `release_actions` Support

- protected/shared built-in `release_actions`:
  - not supported in the reviewed initial `kubernetes` capability entry

### Protected/Shared Eligibility

- in policy for protected/shared single-component service deployments
- in policy for protected/shared reviewed multi-component service plus sidecar or shared-platform deployments only when the deployment declares the reviewed explicit rollout policy
- protected/shared mutation, exact-artifact retry or rollback reuse, and reviewed `--provision-only` execution must route through the reviewed control-plane service / worker front door
- protected/shared execution must stay inside vetted built-in publisher, provisioner, and service-health smoke code
- protected/shared kubernetes service publish, retry, rollback, and promotion must declare `secret_requirements` at the `publish` step; ambient Helm or cluster credentials are rejected and the publisher process receives only the resolved reviewed credential env
- Kubernetes service artifacts must be admitted immutable artifact references, `sha256:<digest>` files, or image references pinned with `@sha256`; mutable tag identities such as `latest`, `dev`, `staging`, and `prod` are rejected

## Capability Entry: `opentofu`

### Identity

- `provider`: `opentofu`
- canonical target identity fields:
  - `stack_identity`
  - `state_backend_identity`
- canonical lock-key shape:
  - `opentofu:<stack_identity>#state:<state_backend_identity>`
- required reviewed provider-target fields:
  - `stack_identity` identifies the reviewed foundation or migration stack
  - `state_backend_identity` identifies the reviewed state backend boundary

### Component Support

- supported component kinds:
  - `provision-only`
- multi-component support:
  - not supported for provision-only OpenTofu stacks
- additional unsupported shapes:
  - publishable application components
  - multi-component stacks

### Rollout Support

- default rollout mode:
  - `all_at_once`
- rollout-policy omission posture:
  - omission is reviewed only for a single provision-only migration bundle
- supported rollout modes:
  - `all_at_once`

### Preview Support

- preview support:
  - not reviewed for provision-only OpenTofu deployments

### Smoke / Release Health

- default smoke model:
  - post-apply checks come from reviewed migration evidence rather than HTTP smoke

### Built-In Publisher Contract

- built-in publisher type:
  - `provision-only`
- exact publish input:
  - one admitted migration bundle bound to one reviewed stack
- checked-in provider config:
  - `opentofu/` stack files remain provider-local configuration for the deployment package
  - the reviewed stack config declares separate reviewed plan JSON and saved apply plan artifacts

### Retry / Idempotency

- provision-only replay is not supported unless a future capability entry defines it
- ambiguous OpenTofu outcomes must fail closed before repeating provider mutation

### Partial Publish Observability

- the foundation record preserves:
  - canonical provider-target identity
  - stack identity
  - state backend identity
  - reviewed plan and apply evidence fingerprints
  - post-apply check outcomes

### Provisioner Support

- the provider itself is the reviewed `opentofu-stack` provision-only path
- OpenTofu files must stay under the deployment package `opentofu/` directory and bind stack identity plus state backend identity into admission evidence

### Built-In `release_actions` Support

- protected/shared built-in `release_actions`:
  - release actions are not supported for OpenTofu provision-only runs

### Protected/Shared Eligibility

- in policy for reviewed provision-only migration bundles
- protected/shared mutation must route through the reviewed control-plane front door
- ambient provider credentials are rejected; only resolved reviewed credential env is used

## Capability Entry: `vercel`

### Identity

- `provider`: `vercel`
- canonical target identity fields:
  - `team`
  - `project`
  - `environment`
- canonical lock-key shape:
  - `vercel:<team>/<project>#<environment>`

### Component Support

- supported component kinds:
  - `ssr-webapp`
- multi-component support:
  - not supported in the initial Vercel slice
- additional unsupported shapes:
  - static webapps
  - provider-side Git auto-builds

### Rollout Support

- default rollout mode:
  - `all_at_once`
- rollout-policy omission posture:
  - omission is reviewed only for one prebuilt `ssr-webapp` artifact
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
  - preview publish and preview cleanup are audited source-run scoped operations
  - preview mutations require the same secret-runtime token contract as publish

### Smoke / Release Health

- default smoke model:
  - live protected/shared publishes poll the Vercel deployment until a determinate provider outcome is available, then run the built-in HTTP smoke against the returned public URL
  - the local fake publisher remains a deterministic `local_only` fixture and records the reviewed canonical URL without contacting Vercel

### Built-In Publisher Contract

- built-in publisher type:
  - `vercel-prebuilt`
- exact publish input:
  - one admitted immutable Vercel Build Output API artifact
- checked-in provider config:
  - publisher config records team, project, environment, and `mode: prebuilt`
  - `mode: git-autobuild` and ambient `.vercel` state are rejected

### Retry / Idempotency

- fake API publishes are deterministic for target identity plus artifact identity
- retry and rollback use recorded exact artifacts and never rebuild from branch state
- ambiguous provider API outcomes fail closed with explicit records
- shared `--publish-only` reuses only an admitted exact prebuilt artifact selected with `--source-run-id`
- same-deployment `--publish-only` is reviewed as `retry`
- same-deployment rollback is reviewed only for prior successful normal runs on the same canonical live target identity

### Immutable-Reuse Operator Flows

- same-deployment rollback requires both `--publish-only` and `--rollback`
- rollback source selection is limited to prior successful normal live-target runs for the same deployment
- retry or rollback fails closed when the retained exact artifact is unavailable

### Partial Publish Observability

- live records persist provider release id, public URL, alias assignment state, artifact identity, source run id when present, and redacted diagnostics for failed, pending, or ambiguous provider outcomes
- the local fixture records deterministic provider release id, public URL, and artifact identity without external network access

### Provisioner Support

- not supported in the initial Vercel provider slice
- `--provision-only` is reviewed for protected/shared deployments through the control-plane service when the deployment declares one reviewed built-in provisioner

### Built-In `release_actions` Support

- protected/shared built-in `release_actions`:
  - not supported in the initial Vercel provider slice

### Protected/Shared Eligibility

- protected/shared Vercel mutation is routed through the reviewed control-plane service
- laptop-local protected/shared artifact paths are rejected by the public front door
- protected/shared mutation, exact-artifact retry or rollback reuse, and reviewed `--provision-only` execution must route through the reviewed control-plane service / worker front door

<!-- END GENERATED PROVIDER CAPABILITIES -->

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
9. Define provisioner and built-in `release_actions` posture.
10. State whether the provider is approved for protected/shared use.

Change-control rule:

- a built-in adapter must not widen provider support beyond the reviewed structured capability entry
- when provider behavior changes materially, update the structured provider-capability registry and render this document in the same change
- reviewed operator examples must keep the public repo-facing `deploy --deployment <label> ...` selector form; keep deployment-id wording conceptual only

## Companion Docs

- [Deployment Design](history/designs/deployments-design.md)
- [Deployment Contract](deployments-contract.md)
- [Deployment Schema](deployments-schema.md)
- [Deployment Scenarios](deployment-scenarios.md)
- [Deployment Implementation Plan](history/plans/deployment-plan.md)
