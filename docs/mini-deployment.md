# Mini Shared-Dev Deployment Design

This document defines a concrete design for using `mini` as the shared development deployment
destination for application environments served under `*.apps.kilty.io`.

The reviewed provider family is `nixos-shared-host`. In this document, `mini` is the current
concrete NixOS host instance for that provider shape, not a machine-specific requirement baked into
the provider contract itself.

This document is intentionally narrower than the general deployment model. It specializes the
shared deployment design for one provider family:

- `mini` as the host and ingress node
- declarative NixOS containers as the runtime boundary
- `*.apps.kilty.io` as the shared-dev public hostname space

It should be read together with:

- [Deployments Design](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-design.md)
- [Deployment Contract](/Users/kiltyj/Code/bucknix-fresh/docs/deployments-contract.md)
- [Deployment Provider Capabilities](/Users/kiltyj/Code/bucknix-fresh/docs/deployment-provider-capabilities.md)

If this document ever drifts from the cross-cutting contract or provider-capability rules, those
documents remain authoritative.

## Purpose

The goal is to support shared development deployments on `mini` without introducing a separate
hand-maintained host registry of apps and routes.

We want:

- one shared development platform on `mini`
- one public hostname per app under `*.apps.kilty.io`
- host-owned routing and container realization
- deployment metadata as the only app-specific source of truth
- automatic provisioning of a new dev target from deployment declarations
- automatic ingress generation for that target
- normal deploy/update flows after the target exists

We do not want:

- ad hoc manual edits to a host-owned list of app subdomains
- containers mutating nginx or DNS directly
- package-local scripts running with shared-environment ingress authority
- staging or production semantics mixed into this shared-dev model

## Scope

This design applies only to the shared development environment hosted on `mini`.

Environment scope:

- this model is for shared `dev`
- it is not the default model for `staging`, `shared_nonprod`, or `production_facing`
- `apps.kilty.io` is reserved for this shared-dev platform, so the hostname itself already carries
  the environment meaning
- deployments using this provider family should default to `protection_class = "shared_nonprod"`
  because `mini` is a shared mutable destination with shared ingress and host-owned routing state
- any narrower local-only experimentation should use a different provider family or target class rather
  than treating `mini` shared-dev targets as workstation-local mutation

Provider scope:

- the platform is a single `mini` host
- app isolation is provided by declarative NixOS containers
- ingress is provided by host-level nginx on `mini`
- wildcard DNS and wildcard TLS are assumed for `*.apps.kilty.io`

## Core Model

Each application deployment declares a stable `appName`.

For this provider family, `appName` is the authoritative app identity used to derive the dev target.

For example:

- `appName = "pleomino"`

resolves to:

- hostname: `pleomino.apps.kilty.io`
- container name: `pleomino`
- service identity: `pleomino`

This is intentionally provider-specific derivation. The same `appName` may be interpreted
differently by other provider families in the future.

Important rule:

- deployment metadata declares portable identity
- provider/provisioner logic derives environment-specific routing and runtime naming from that identity

This keeps app metadata portable and prevents DNS policy from leaking into every deployment object.

## High-Level Architecture

The architecture for shared dev on `mini` is:

1. deployment metadata in the repo declares a deployment using a `mini` shared-dev provider family
2. Buck/deploy extraction generates scoped or full-set manifest inputs for shared-dev app targets
3. reviewed deploy/control-plane workflows update the authoritative shared-dev platform state for `mini`
4. `mini` realizes:
   - NixOS containers
   - nginx routes for `*.apps.kilty.io`
5. the deploy workflow publishes the app into the realized target

Plain-language version:

- repo metadata says which shared dev targets should exist
- `mini` materializes those targets declaratively
- `mini` owns ingress and container lifecycle
- deploy updates what runs inside the target

The host remains authoritative for shared infrastructure, but the per-app list is generated from repo
metadata rather than edited by hand.

## Source Of Truth

The source-of-truth split should be:

- deployment metadata in repo:
  - `appName`
  - provider family / deployment kind
  - app artifact contract
  - container-facing runtime contract such as exposed port and optional health path
- generated host manifest:
  - a derived implementation artifact produced from repo metadata
  - not hand-maintained
- `mini` host configuration:
  - wildcard DNS/TLS assumptions
  - ingress and container-generation logic
  - platform-wide defaults and safety rules

This means:

- no hand-maintained host-owned registry of apps
- no second app-owned source of truth on the host
- the generated manifest is allowed because it is derived from authoritative metadata

## Future Isolation And Placement

This design should leave room for future isolation boundaries on `mini` without baking today's
runtime topology into deployment metadata.

If the platform later needs multiple isolated groups of workloads on `mini`, deployment metadata may
declare an optional `targetGroup`.

Design rules:

- `appName` is the stable app identity
- `targetGroup` is an optional logical placement or isolation boundary
- provider logic decides how a target group is realized physically
- when `targetGroup` is omitted, the deployment is placed into the platform's default shared-dev
  target group on `mini`

Current simplification:

- this shared-dev platform currently behaves as one implicit target group on `mini`
- no explicit `targetGroup` field is required to adopt this design today
- if target groups are introduced later, they should affect placement, isolation, ingress policy, and
  host realization rules, but they do not need to affect public hostname shape by default

Public-hostname rule:

- unless a reviewed future need says otherwise, hostname derivation remains `${appName}.apps.kilty.io`
- we do not introduce extra hostname levels or embed target-group identity into the public domain by
  default
- target-group differences should primarily influence host-side placement and isolation, not user-facing
  DNS names

## Deployment Type

This provider family should be treated as a distinct deployment type, for example:

- `nixos-shared-host`

The exact enum or provider-family naming can follow the repo's deployment schema, but the semantics
should be:

- target runs on `mini`
- target is a shared dev NixOS container
- hostname is derived as `${appName}.apps.kilty.io`
- ingress is generated on the host
- any future placement or isolation grouping is expressed through provider policy or an optional
  `targetGroup` metadata field rather than through DNS naming by default

Suggested deployment metadata contract:

- `appName`
  - stable app identity for this deployment family
- `targetGroup`
  - optional logical placement or isolation boundary
  - when omitted, the deployment is placed into the platform's default shared-dev target group on
    `mini`
- `containerPort`
  - the container-internal port exposed by the app
- `healthPath`
  - optional path for readiness or smoke semantics
- `runtimeKind`
  - optional reviewed runtime class such as static site, node app, SSR app, or generic HTTP service
- `publishContract`
  - how the publisher updates the running app inside the container
  - initial reviewed static-webapp contract:
    - stage immutable contents under `/srv/static-app/releases/<artifact-identity>`
    - atomically repoint `/srv/static-app/current` to the staged release
    - keep `/srv/static-app/live` as the stable nginx-facing link

What should not be required:

- explicit subdomain
- explicit environment suffix
- manual host-level ingress identifiers
- explicit target-group-derived hostname segments

For this provider family, those are derived from `appName`.

## Routing And Domains

The domain model is:

- wildcard DNS for `*.apps.kilty.io` points to `mini`
- wildcard TLS for `*.apps.kilty.io` is terminated on `mini`
- nginx on `mini` routes each hostname to the corresponding container backend

Example:

- `pleomino.apps.kilty.io` -> nginx on `mini` -> `pleomino` container -> port `3000`

Future rule:

- if the platform later introduces multiple logical target groups on `mini`, that does not by itself
  require moving to hostnames like `pleomino.group-a.apps.kilty.io`
- such additional DNS structure should be introduced only when there is a reviewed operational need for
  it rather than as a default encoding of host-internal placement

This means adding a new dev deployment should not require:

- a new DNS record
- a hand-written nginx vhost

It should require only:

- a new deployment declaration in the repo
- regeneration of the derived host manifest
- application of host configuration on `mini`

## Why Containers Must Not Self-Register Publicly

Containers should not directly mutate:

- nginx config
- DNS records
- TLS configuration

Why:

- ingress is shared infrastructure
- collisions and ownership need host-level arbitration
- app containers should not get authority over other apps' public routes
- shared-dev convenience should not undermine the design rule that protected shared infrastructure is
  controlled declaratively

So the desired ergonomics are "self-reporting" only in the sense that deployment metadata declares
portable target facts and the host generates ingress from them.

That is:

- automatic from app/deployment metadata
- but still host-controlled

## Generated Manifest Model

The deploy extraction layer should produce a manifest that `mini` can consume during NixOS
evaluation.

Conceptually:

```json
{
  "version": 1,
  "sharedDevApps": [
    {
      "deploymentId": "pleomino-dev",
      "appName": "pleomino",
      "hostname": "pleomino.apps.kilty.io",
      "containerName": "pleomino",
      "containerPort": 3000,
      "healthPath": "/healthz",
      "runtimeKind": "http-service"
    }
  ]
}
```

The exact format is an implementation detail, but the important properties are:

- generated from authoritative repo metadata
- deterministic
- suitable for declarative host config generation
- small enough that the host can evaluate it without running app-specific logic

Safety rule for partial-repo operation:

- a manifest generated from only one repo slice must be treated as an additive or scoped declaration for
  that slice, not as the authoritative complete set of all shared-dev apps on `mini`
- absence from a slice-local manifest must never be interpreted as proof that another app should be
  removed from `mini`
- destructive removal requires an explicit removal action against the specific deployment or an
  authoritative full-platform manifest produced by a workflow that is allowed to speak for the complete
  shared-dev app set

Practical implication:

- creation and update may be driven from slice-local manifests
- deletion must not be inferred from omission in those manifests

## Authoritative Platform State

`mini` should not evaluate a slice-local manifest directly as if it were the complete desired state for
the platform.

Instead, this provider family should maintain an authoritative cumulative platform-state artifact for
shared-dev targets on `mini`.

That authoritative platform state should be:

- derived from deployment metadata
- owned by reviewed deploy/control-plane workflows rather than hand-maintained on the host
- the only desired-state input that `mini` uses to realize shared-dev containers and ingress

Operational meaning:

- a scoped apply updates only the named entries inside the authoritative platform state
- an authoritative full reconcile may replace the full platform state
- an explicit removal deletes one named entry from that platform state
- `mini` always rebuilds from the authoritative platform state rather than from an informationally
  incomplete slice-local manifest

This preserves declarative host realization while keeping partial-repo operation fail-closed.

Current repo implementation for this model:

- deployment extraction still produces `{ version: 1, deployments: [...] }`
- `build-tools/tools/deployments/nixos-shared-host-platform-state.ts` is the reviewed reconciler for:
  - `--mode scoped-apply`
  - `--mode full-reconcile`
  - `--mode remove`
- `build-tools/tools/deployments/nixos-shared-host-apply.ts` consumes only the authoritative cumulative
  platform-state artifact and renders the host-facing container plus nginx config document
- `build-tools/tools/nix/nixos-shared-host-module.nix` is the host-side NixOS consumer that reads the same
  authoritative platform-state artifact and derives `containers` plus `services.nginx.virtualHosts`
- both documents are deterministic JSON so they stay easy to diff, test, and audit

## Host Realization On `mini`

`mini` should consume the authoritative platform state and derive:

- one NixOS container per declared app
- one nginx virtual host per declared app
- deterministic private addressing or equivalent host-to-container reachability

Conceptual realization:

- container name: `${appName}`
- hostname: `${appName}.apps.kilty.io`
- backend target: `${container-ip}:${containerPort}`

The host should remain responsible for:

- assigning deterministic container IPs or another stable routing method
- ensuring nginx only routes to declared backends
- ensuring TLS is valid for `*.apps.kilty.io`
- ensuring container lifecycle matches host policy

## Container Shape

For long-term sanity, containers should use a standardized base shape.

Recommended default:

- one generic app-host container per app
- app artifact is published into that container
- a known supervisor/service inside the container runs the app

This is better than rebuilding the entire host and entire app runtime from scratch on every deploy,
while still keeping the target declarative.

Container responsibilities:

- provide the runtime expected by the deployment kind
- expose the declared `containerPort`
- provide a stable filesystem/service contract for publishers
- optionally provide a standard health endpoint

What containers should not own:

- public DNS
- public TLS
- shared reverse-proxy policy

## Provisioner vs Publisher Split

This provider family should use the same provisioner/publisher split described in the main deployment
design.

Provisioner responsibility:

- ensure the shared dev target exists on `mini`
- this includes:
  - ensuring the generated manifest contains the app
  - applying host configuration on `mini`
  - creating the container
  - creating nginx routing for `${appName}.apps.kilty.io`

Publisher responsibility:

- publish the app artifact into the existing target
- restart or reload the app service as needed
- record deploy outcome and published artifact identity

This separation matters because:

- first deploy of a brand-new app needs host realization work
- later deploys should usually be able to update the app without redefining the target

## First Deploy Lifecycle

The lifecycle for the first deployment of a new shared-dev app should be:

1. developer adds deployment metadata in the repo
2. Buck/deploy extraction identifies the deployment as a `nixos-shared-host` target
3. deploy control plane generates or updates the host manifest for `mini`
4. provisioner applies the new host state on `mini`
   - container is created
   - nginx route is created
   - hostname becomes routable through wildcard DNS/TLS
5. publisher publishes the app artifact into the container
6. smoke/health validation runs against `https://${appName}.apps.kilty.io`
   - smoke always checks `/`
   - when `healthPath` is declared, smoke also checks that path
   - a reachable hostname that serves the wrong `index.html` still fails the deploy

Important properties:

- no host-owned manual app registry edit
- no manual DNS addition
- no manual nginx addition
- first deploy remains declarative and reviewable

## Subsequent Deploy Lifecycle

Once the target exists, a normal deployment should usually be:

1. resolve admitted artifact
2. ensure target still exists and matches declared identity
3. publish artifact into the existing container
4. restart or reload app service
5. run smoke/health validation

Host changes should only be needed later if:

- the runtime contract changes materially
- the exposed container port changes
- the app needs a different standardized container shape

## Explicit Removal Lifecycle

When a shared-dev app target should be removed:

1. issue an explicit removal action for that deployment, or apply an authoritative full-platform
   manifest that proves the deployment is no longer desired
2. regenerate the host state for that removal decision
3. apply host config on `mini`
4. host removes:
   - nginx route
   - container
5. deployment records remain retained according to repo policy

Because wildcard DNS remains in place, removing the host route is enough to stop serving the app.

Fail-closed deletion rule:

- removing a deployment from one local repo slice is not by itself sufficient evidence that the app
  should be removed from `mini`
- the system must distinguish:
  - "this slice does not mention the app"
  - "the app is explicitly removed from service"
  - "the authoritative complete desired-state set no longer includes the app"
- only the latter two states may trigger removal

## Host Application Of Changes

There must be a reviewed way for the deploy system to update `mini`'s realized shared-dev config.

Good implementation options:

- `mini` imports a generated manifest file from the repo or a generated artifact location
- the deploy control plane updates that generated artifact and triggers a host rebuild
- the rebuild applies the new container and ingress topology

What matters is not the exact mechanism, but the ownership model:

- repo deployment metadata is authoritative
- host state is generated from that metadata
- the host applies declarative state rather than imperative app self-registration

Safe reconciliation rule:

- host reconciliation must support scoped apply semantics
- a scoped apply may create or update only the deployments named in the submitted scope
- a scoped apply must not delete deployments outside that scope just because they are absent from the
  submitted manifest
- full-set reconciliation that is allowed to delete omitted deployments must be reserved for a trusted
  workflow that has authoritative visibility into the complete desired-state set for this platform

## Control-Plane Semantics

The control plane should model shared-dev host reconciliation with explicit intent rather than inferring
deletion from omission.

Recommended operation classes:

- scoped apply
  - input names one or more deployments or one repo slice
  - may create or update only the deployments inside that scope
  - must not remove any deployment outside that scope
- authoritative full reconcile
  - input is explicitly marked as representing the complete desired-state set for this platform
  - may create, update, and remove deployments based on that complete set
  - should be reserved for trusted workflows with complete visibility
- explicit removal
  - targets one named deployment identity directly
  - removes the shared-dev target for that deployment after policy checks
  - should remain explicit even when the deployment no longer appears in ordinary slice-local metadata

Suggested contract language:

- omission from a scoped apply is informationally incomplete and must not be interpreted as removal
- removal requires either:
  - an explicit removal request for the named deployment, or
  - an authoritative full reconcile that is allowed to speak for the complete platform state

This allows safe day-to-day operation from partial repo slices while still preserving a clean path for
intentional target removal.

## Safety Rules

Even for shared dev, the following rules should hold:

- the host must reject duplicate `appName` declarations for this provider family
- ingress generation must fail closed if two deployments would resolve to the same hostname
- the host must not route undeclared hostnames to arbitrary containers
- app containers must not be granted authority to mutate shared ingress state
- deploy failure must not leave a misleading deployment record claiming success if the hostname never
  became routable or the target never existed

## Addressing / Networking

The host should use a deterministic private networking model for containers.

Possible acceptable implementations:

- fixed IP allocation derived from app identity
- generated stable address allocation persisted in host state
- a host-local name or socket routing scheme if nginx and the host can resolve it reliably

Requirements:

- backend routing must be deterministic
- nginx generation must have a stable backend target
- the deploy record should preserve enough routing identity to diagnose failures

Current repo implementation uses a deterministic backend identity of `${containerName}:${containerPort}`
and a deterministic backend address of `http://${containerName}.mini.internal:${containerPort}` inside
the generated host document. That keeps host realization stable and lets conflict checks reject
duplicate backend identities before anything is applied.

## Health And Smoke

Shared-dev deployments should support a lightweight default health contract.

Suggested default:

- optional `healthPath`
- if present, host/deploy smoke uses `https://${appName}.apps.kilty.io${healthPath}`
- if absent, provider/runtime defaults may apply

The important rule is:

- smoke should validate the public routed target, not just the private container port

That catches ingress and TLS issues as part of the same shared-dev target contract.

## Persistence And State

This design does not require app data to be ephemeral, but it should default to being replaceable.

Recommended default for shared dev:

- app runtime should tolerate target recreation
- any required persistent state should be declared explicitly and kept separate from routing identity

This keeps shared dev easy to reprovision.

## Relationship To Other Environments

This model is intentionally specialized.

It should not force other environments to use the same naming or runtime assumptions.

The shared-dev domain policy here is:

- `${appName}.apps.kilty.io`

That does not imply:

- staging must use the same host naming
- production must use the same provider family
- all environments must use containers on `mini`

This is why `appName` is a better input than `subdomain`.

Any future placement or isolation metadata should remain optional and should default cleanly to the
platform's standard shared-dev placement on `mini`.

## Why `appName` Is The Right Metadata Primitive

`appName` is preferred because:

- it is stable across environments
- it avoids baking environment-specific DNS policy into app metadata
- it can be interpreted differently by different provider families
- it supports future reuse in staging/production providers

For this provider family specifically:

- `appName` -> `${appName}.apps.kilty.io`

For another provider family later, the same `appName` may instead map to:

- a Pages project
- a Kubernetes service
- a VM name
- a store app identifier

## Recommended Implementation Direction

The cleanest implementation path is:

1. add a deployment/provider capability for `nixos-shared-host`
2. require `appName` and `containerPort`
3. extend deployment extraction to emit a generated shared-dev manifest
4. teach `mini`'s host config to consume that manifest and generate:
   - NixOS containers
   - nginx virtual hosts
5. implement a provisioner that updates/applies host state on `mini`
6. implement a publisher that deploys the resolved app artifact into the target container

The repo now has the first four of those steps in place for `mini`:

1. deployment/provider capability and metadata extraction
2. authoritative cumulative platform-state reconciliation
3. deterministic host-document generation for containers plus nginx routes
4. reviewed explicit removal semantics that do not infer deletion from slice-local omission

For PR-2 specifically, the host realization boundary is now split cleanly:

- TypeScript owns authoritative deployment extraction, reconciliation, and host-manifest rendering
- NixOS owns host-side consumption of the authoritative platform state through
  `build-tools/tools/nix/nixos-shared-host-module.nix`
- both layers reject duplicate hostname and backend conflicts before host realization proceeds

This preserves the repo's core design principles:

- one source of truth
- declarative host realization
- separation of provisioner and publisher concerns
- no hidden mutable host registry

## Operator Summary

What happens when a new shared-dev app is added:

1. add the deployment in repo metadata with `appName`
2. run the deploy/provision flow
3. the system generates host config for `mini`
4. `mini` creates the container and ingress automatically
5. the app becomes reachable at `https://${appName}.apps.kilty.io`
   - the first built-in deploy workflow is `build-tools/tools/bin/deploy`
   - default deploy reconciles the single deployment into platform state, materializes the local/shared-dev host runtime contract, publishes the static artifact, runs blocking smoke, and writes a local durable run record
   - `deploy --remove` records the same deployment id as an explicit removal run, removes that deployment from authoritative platform state, and re-materializes the host without that target

What happens for later updates:

1. deploy a new artifact
2. publisher updates the existing container target
3. ingress remains unchanged

What does not need to happen:

- manual DNS record creation
- manual nginx vhost creation
- manual host-owned app registry edits

## Final Design Decision

For the shared dev environment on `mini`:

- use `appName` as the authoritative app identity
- derive hostnames as `${appName}.apps.kilty.io`
- use a generated host manifest rather than a manual registry
- realize one declarative NixOS container per app
- generate nginx ingress from the same derived metadata
- treat target creation as provisioner work
- treat artifact rollout into that target as publisher work

That is the best fit for the repo's broader deployment design while keeping shared dev lightweight and
pleasant to operate.
