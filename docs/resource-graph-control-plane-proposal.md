# Viberoots Resource Graph Control Plane Proposal

## Resource Graph From The Existing Deployment Control Plane

This document is an engineering proposal for the next architectural direction of Viberoots. It is
not an edit of the v8 proposal. It starts from the current repository architecture, ADRs,
deployment contracts, provider capability model, and control-plane implementation.

The core conclusion is:

```text
Do not build a new Kubernetes-like platform beside Viberoots.

Generalize the Buck-defined deployment graph and the Postgres-backed control-plane
reconciliation model that already exist.
```

## 1. Executive Summary

Viberoots already contains the beginning of a resource-graph platform. The current form is
deployment-focused:

- Deployment resources are declared in Buck `TARGETS`.
- Deployment metadata is extracted into typed contracts.
- Protected and shared mutation flows through a control-plane service and worker fleet.
- Postgres owns authoritative runtime state: submissions, queue, locks, idempotency, snapshots,
  deploy records, current stage state, stage history, audit, artifact metadata, and worker
  heartbeats.
- Providers are data-plane execution substrates with explicit capability entries.
- Buck owns dependency structure and build/test planning.
- Nix owns reproducible toolchains, environments, artifacts, and OCI images.
- OpenTofu is already used in reviewed IaC/evidence paths for durable cloud infrastructure and
  deployment-owned provisioners.

The natural path is to turn the existing deployment graph into a broader resource graph without
discarding the architecture that already works.

The long-term principle remains valid:

```text
Everything is a resource.
Resources form graphs.
Graphs are declarative.
The control plane reconciles those graphs.
```

But the first resources are not hypothetical. They are already present:

- Deployment
- Deployment family
- Component
- Provider target
- Environment stage
- Lane policy
- Admission policy
- Secret requirement
- Runtime-config requirement
- Preview policy
- Rollout policy
- Provisioner
- Release action
- Artifact input
- Execution snapshot
- Deploy run
- Current stage state

The platform should evolve by making those concepts more explicit, more uniformly addressable, and
more reusable across domains.

## 2. Current Architecture

### 2.1 Build And Metadata Layer

Buck is the source of deployment structure.

Every concrete deployment is intended to live under:

```text
projects/deployments/<deployment-id>/
```

and expose:

```text
:deploy
```

Deployment metadata is declared through Starlark rules such as:

- `deployment_target`
- `cloudflare_pages_static_webapp_deployment`
- `nixos_shared_host_static_webapp_deployment`
- `nixos_shared_host_ssr_webapp_deployment`
- `s3_static_webapp_deployment`
- `kubernetes_service_deployment`
- `vercel_next_webapp_deployment`
- `opentofu_foundation_deployment`

This means deployment state begins as reviewed, version-controlled source. Provider config files
may provide provider-native inputs, but they are not a second source of truth for core deployment
facts.

Buck owns:

- deployment target discovery
- deployment metadata extraction
- dependency graph structure
- build artifact dependencies
- impacted-test and impacted-deployment selection

### 2.2 Artifact And Environment Layer

Nix owns reproducibility.

Viberoots uses Buck as graph/orchestration and Nix as the hermetic build and artifact layer. The
current build-system design treats Buck as the graph authority and Nix as the artifact/environment
authority. This split should remain.

Nix owns:

- toolchains
- dependency closure construction
- build environments
- Nix-built OCI images
- reproducible application artifacts
- binary-cache compatibility

The control plane itself is intended to run as a Nix-built OCI image with service and worker modes.

### 2.3 Deployment Control Plane

The protected/shared deployment control plane is already a concrete system:

- stateless HTTP service
- stateless worker loop
- Postgres backend
- S3-compatible artifact store
- file-mounted runtime credentials
- provider-specific execution adapters

The service accepts submissions, validates admission, enforces idempotency, exposes status/read
models, and creates durable work. Workers claim queued work and execute provider operations under
database-backed authority.

The authoritative backend includes tables or concepts for:

- submissions
- snapshots
- queue
- idempotency
- artifact challenges
- run actions
- locks
- deploy records
- current stage state
- stage-state history
- stage-state audit events
- control-plane audit events
- artifact objects
- worker heartbeats
- web and auth sessions
- upload sessions

This is already a domain-specific reconciler for deployments.

### 2.4 Provider Model

Deployments are intentionally single-provider. Systems that span provider families are represented
as multiple coordinated deployments.

Reviewed provider capability entries currently cover provider families such as:

- `nixos-shared-host`
- `cloudflare-pages`
- `cloudflare-containers`
- `s3-static`
- `kubernetes`
- `vercel`
- `app-store-connect`
- `google-play`

Each capability entry defines the provider-specific contract:

- canonical target identity fields
- lock-key shape
- supported component kinds
- rollout support
- preview support
- smoke or release-health model
- retry and idempotency assumptions
- partial-publish observability
- provisioner support
- release-action support
- protected/shared eligibility

This is already a provider abstraction. It should become one foundation of the broader resource
model.

### 2.5 Policy Model

Viberoots already has several policy surfaces:

- protection class
- lane policy
- admission policy
- source-ref policy
- allowed promotion edges
- artifact reuse mode
- required checks
- required approvals
- rollout policy
- preview policy
- release-action replay policy
- provider capability policy
- secret/runtime-config requirement policy
- authorization grants and scopes

These are not incidental fields. They are the beginnings of a policy engine bound to a resource
graph.

### 2.6 Runtime State Model

The current state model distinguishes between reviewed intent and operational state:

- Git/Buck metadata owns deployment intent and policy.
- The control plane owns admitted runtime state.
- Provider APIs own provider-local live state.
- OpenTofu owns infrastructure state where OpenTofu is the reviewed realization tool.
- Object storage owns immutable admitted artifacts and snapshots.

This split is correct. Viberoots should not duplicate all subsystem state inside Postgres. It
should persist the state needed to admit, reconcile, audit, replay, recover, and explain
deployments.

## 3. Existing Architectural Strengths

### 3.1 Clear Authority Boundary

The control-plane/data-plane split is already strong. Protected/shared mutation goes through the
control plane. CI and laptops submit; they are not peer mutating authorities. Providers execute
instructions; they are not deployment authorities.

This should be preserved.

### 3.2 Declarative Source Of Truth

Deployment metadata lives in Buck `TARGETS`, not ad hoc JSON. This makes deployments:

- reviewable
- diffable
- queryable
- graph-connected
- build-aware

Any generalized resource model should retain this property.

### 3.3 Durable Coordination

Postgres-backed queueing, claim leases, worker ownership, idempotency, locks, fencing tokens,
current stage state, and history provide durable coordination.

This is materially stronger than a simple job runner. It is already reconciliation infrastructure.

### 3.4 Exact Artifact And Snapshot Semantics

Protected/shared deployments are designed around admitted artifacts and frozen execution snapshots.
Retry, rollback, preview, and promotion flows replay recorded facts instead of reinterpreting the
current workspace.

This is a core differentiator and should become a general resource-graph invariant:

```text
Mutating execution consumes admitted, immutable inputs.
Replay consumes recorded snapshots.
```

### 3.5 Provider Capability Registry

Provider behavior is captured in a structured registry instead of scattered conditionals. This
gives Viberoots a scalable way to support heterogeneous substrates without turning the core model
into provider-specific code.

### 3.6 IaC And Evidence Orientation

Current control-plane setup docs treat durable cloud changes as reviewed IaC/evidence work.
Repository commands render inputs, orchestrate reviewed flows, collect evidence, and gate readiness.
They must not become a second imperative provisioning engine.

This orientation is exactly right for a resource-graph platform.

## 4. Existing Resource Graph Concepts

Viberoots already has resources. They are not yet named as a single resource graph, but the shapes
are present.

### 4.1 Deployment

`Deployment` is the primary existing resource.

It includes:

- stable deployment id
- Buck label
- provider
- provider target
- component or components
- publisher
- protection class
- deployment family
- environment stage
- lane policy
- admission policy
- secret requirements
- runtime-config requirements
- external requirement profiles
- release actions
- target exceptions
- migration bundle
- smoke policy
- rollout policy
- bootstrap policy
- vault or Infisical runtime metadata
- preview policy

This should remain the initial root of the platform resource graph.

### 4.2 Provider Target

`ProviderTarget` is the provider-specific identity of a live target.

Current examples include:

- Cloudflare account/project
- NixOS shared-host target group/app name
- S3 account/bucket/region/distribution
- Kubernetes cluster/namespace/release
- Vercel team/project/environment
- OpenTofu stack identity/state backend
- mobile app store app/bundle/track

Provider targets should become first-class graph nodes because locks, policy, live identity,
preview isolation, and recovery all depend on them.

### 4.3 Component

Components are deployable units inside a deployment. Current component kinds include web apps,
services, mobile apps, and third-party service shapes.

Components should remain graph nodes, but not deployment authorities. A component becomes mutable
only through a deployment and provider target.

### 4.4 Policy Resources

Lane policy, admission policy, rollout policy, preview policy, smoke policy, release-action policy,
and provider capability policy already behave like resources.

They should become addressable graph resources with stable identity, versioning, and explicit
references from deployments.

### 4.5 Requirement Resources

Secret requirements and runtime-config requirements are already structured contracts. They should
remain references to values, not secret values themselves.

The resource graph should model:

- requirement declaration
- backend routing metadata
- admissibility
- resolution evidence
- replay identity

It should not store raw secrets.

### 4.6 Execution Resources

Submissions, execution snapshots, deploy runs, run actions, artifacts, current stage state, and
stage history are already runtime resources.

These belong in the control-plane state store, not in Buck `TARGETS`.

The long-term graph therefore has two layers:

```text
Reviewed intent graph
  Buck / Git / project config

Admitted runtime graph
  Postgres / object storage / provider evidence
```

Both are resource graphs. They have different authorities and lifecycles.

## 5. Existing Reconciliation Concepts

The current deployment control plane already performs reconciliation in a domain-specific way.

### 5.1 Submission Admission

The service validates requests, artifact identity, policy, authorization, idempotency, and provider
eligibility before creating durable work. This is the transition from user intent to admitted
runtime intent.

### 5.2 Execution Snapshots

Protected/shared mutation freezes an execution snapshot before queueing or mutation. That snapshot
records the deployment metadata, source, artifact, provider target, policy, secret/runtime-config
references, and implementation identity needed for later execution or replay.

This is equivalent to a desired-state snapshot for a single run.

### 5.3 Queueing And Worker Claims

Queued work is claimed through Postgres. Claims carry worker id, claim token, and lease expiry.
Workers must keep authority current. Expired leases revoke worker authority.

This gives Viberoots safe horizontal worker scaling without making workers authoritative.

### 5.4 Locking And Fencing

Provider locks are scoped by deployment/provider target and carry fencing tokens. A worker must own
the current lock before mutating provider state and before finalizing durable records.

This is a reconciliation guardrail.

### 5.5 State Transitions

Lifecycle states such as pending approval, queued, waiting for lock, running, cancelling, and
finished provide an explicit state machine for runs. Final outcome is separate from lifecycle
state.

This separation should be retained in any generalized resource reconciler.

### 5.6 Current Stage State And History

The control plane stores current stage state keyed by deployment id and environment stage, plus
append-only history. Promotion, rollback, and retry decisions derive from that state, not from
mutable provider tags or Git refs.

This is the strongest existing example of desired-vs-observed state reconciliation.

### 5.7 Idempotency

Submissions and run actions use durable idempotency keys. Same key plus same normalized payload
returns the same result; same key plus different payload fails closed.

This must become a general resource-graph write invariant.

### 5.8 Auditability

The control plane records audit events, stage-state events, deployment records, artifact metadata,
and redacted failure summaries. Secret-bearing data is excluded from durable operator-visible
surfaces.

Generalization must preserve secret-safe audit by construction.

## 6. Proposed Generalization Path

The path should be evolutionary.

### 6.1 Name The Existing Model

First, document the existing deployment resource graph as a formal model.

Define:

- resource identity rules
- resource reference rules
- graph extraction rules
- intent-vs-runtime authority boundaries
- policy attachment rules
- status/read-model rules

Do this for existing deployment resources before adding new resource kinds.

### 6.2 Create A Resource Envelope

Introduce a small common resource envelope for extracted and admitted resources.

The envelope should include:

- `apiVersion`
- `kind`
- `metadata.name`
- `metadata.uid` or stable identity
- `metadata.labels`
- `metadata.ownerReferences`
- `spec`
- `statusRef`
- `evidenceRef`
- `policyRefs`
- `source`

This envelope should not force all resources into Kubernetes semantics. It should only standardize
identity, references, policy binding, and status reporting.

The current implementation uses `deployment.resource.viberoots.dev/v1` envelopes derived from the
checked deployment resource inventory. The envelope transform is read-only: it preserves existing
deployment extraction output, excludes source paths from repo-owned Buck intent UIDs, and treats
runtime envelopes as admitted status/evidence records rather than a mutation API. Runtime envelope
inputs carry an admitted control-plane source marker, while graph-first workspace state and redacted
local project overrides remain separate `workspace_state` source facts.

### 6.3 Keep Buck As The Intent Graph Compiler

For repo-owned resources, Buck should remain the graph compiler.

The extraction path should produce typed resource documents from `TARGETS`. Those documents become
the reviewed intent graph consumed by CLI and control-plane admission.

Do not introduce hand-authored YAML as a replacement for Buck deployment metadata.

### 6.4 Generalize The Control-Plane Backend Carefully

Do not replace the existing deployment tables with a generic key-value blob store.

Instead:

- keep domain-specific tables where they enforce strong invariants
- add generic resource index/read-model tables only where they improve querying and linking
- preserve explicit deployment tables for submissions, queue, locks, stage state, records, and audit
- introduce generalized resource status after the deployment-specific invariants are stable

The current database is valuable because it encodes behavior, not just storage.

### 6.5 Promote Existing Policies To First-Class Resources

Lane policy, admission policy, rollout policy, preview policy, provider capability, and execution
policy facts should converge into a coherent policy-resource model.

The first milestone should be consistency, not expressiveness.

### 6.6 Add WorkerPool Later

`WorkerPool` is likely a valid long-term resource, but it should not be the first proof point.

The first proof point should be:

```text
Deployment graph -> admitted resource snapshot -> provider reconciliation -> stage state
```

Only after that model is formalized should Viberoots add:

- worker pool resources
- worker capability metadata
- placement constraints
- remote-execution integration policy
- worker identity enrollment

## 7. Near-Term Architecture (1-2 Years)

Near term, Viberoots should become a generalized deployment-resource platform.

### 7.1 Resource Graph Scope

The graph should cover:

- Deployment
- DeploymentFamily
- Component
- ProviderTarget
- EnvironmentStage
- LanePolicy
- AdmissionPolicy
- RolloutPolicy
- PreviewPolicy
- SecretRequirement
- RuntimeConfigRequirement
- Provisioner
- ReleaseAction
- ArtifactInput
- ExecutionSnapshot
- DeployRun
- CurrentStageState

These are all extensions of existing concepts.

### 7.2 Control-Plane Scope

The control plane should generalize:

- submit API contracts
- status/read models
- approval/run-action contracts
- artifact challenge/admission
- provider dispatch
- resource status surfaces
- audit event model

It should keep deployment-specific behavior where required:

- promotion compatibility
- rollback candidate policy
- exact-artifact replay
- provider target locks
- release-action replay policy
- progressive rollout semantics

### 7.3 Provider Scope

Provider capability entries should become the mandatory extension point for all provider families.

Near-term provider support should prioritize depth over count:

- complete protected/shared semantics for existing reviewed providers
- close fail-closed gaps before adding many new provider families
- standardize provisioner support and plan/diff admission
- make provider read/reconcile evidence explicit

### 7.4 IaC Scope

Near term, Viberoots should codify the practical IaC boundary already used in the repo:

- Nix owns builds, environments, and OCI images.
- NixOS owns hosts directly controlled by Viberoots.
- OpenTofu owns durable cloud infrastructure where that is the reviewed provider-appropriate path.
- Deployment metadata owns infrastructure intent.
- The control plane admits and records infrastructure-affecting runs.
- Repository commands may orchestrate reviewed plan/apply and evidence collection, but must not
  become an imperative provisioning engine.

The existing IaC ADR should be updated or superseded so the OpenTofu boundary is explicit and not
left as an apparent contradiction.

### 7.5 Remote Execution Scope

Near term, remote execution should remain an integration.

Viberoots should own:

- which work is eligible to run remotely
- policy around source, artifact, and secret boundaries
- placement constraints at the Viberoots level when needed
- integration contracts with REAPI-compatible systems

Viberoots should not build its own remote execution engine without a specific strategic reason.

## 8. Long-Term Architecture (3-5 Years)

Long term, Viberoots can become a generalized resource-graph control plane for software delivery
and platform operations.

### 8.1 General Resource Graph

The graph may eventually include:

- Organization
- Tenant
- Project
- Repository
- Deployment
- Environment
- ProviderTarget
- Artifact
- Policy
- SecretContract
- RuntimeConfigContract
- Provisioner
- WorkerPool
- ExecutionBackend
- CacheBackend
- ObservabilitySink
- IdentityBinding

These should be introduced only when existing deployment and platform workflows need them.

### 8.2 General Reconciliation Runtime

The current deployment reconciler can evolve into a reconciliation runtime with:

- typed resource admission
- dependency-aware scheduling
- idempotent writes
- leases and fencing
- desired-state snapshots
- observed-state evidence
- status subresources
- event streams
- recovery workflows

This should remain Viberoots-specific. The value is in the policy, graph, and software-delivery
contracts, not in copying Kubernetes APIs.

### 8.3 Multi-Control-Plane And Multi-Tenant Operation

Long term, Viberoots should support multiple independent control-plane stacks:

- different AWS accounts
- different regions
- different organizations
- customer-hosted environments
- regulated tenant partitions

The resource graph should support tenancy and isolation from the beginning, but fleet-level
multi-tenancy should be introduced through concrete product and operator requirements.

### 8.4 Worker And Execution Capacity

WorkerPool becomes appropriate when Viberoots needs to manage execution capacity across:

- control-plane workers
- deployment workers
- remote-build workers
- test workers
- customer-hosted runners
- cloud-provider runners

At that point, worker resources should model:

- provider
- region
- architecture
- tenancy
- trust zone
- compliance labels
- cost class
- supported execution modes
- identity material
- health and capacity

Execution backends should still perform low-level scheduling. Viberoots should decide eligibility
and policy.

## 9. Cross-Cloud Strategy

Cross-cloud support already begins with provider abstractions and single-provider deployment
boundaries.

The strategy should be:

```text
Keep deployments single-provider.
Represent multi-provider systems as coordinated deployment graphs.
Normalize policy and state above providers.
Keep provider-specific behavior in provider capability entries and adapters.
```

This avoids a false universal cloud model while still enabling cross-cloud operations.

Viberoots should normalize:

- deployment identity
- provider target identity
- admission
- artifact semantics
- promotion semantics
- rollback semantics
- preview semantics
- locking
- audit
- status
- replay

Providers should own:

- provider API details
- provider-specific live identifiers
- provider-native publish operations
- provider-specific smoke/readiness evidence
- provider-specific drift/read-state evidence

OpenTofu provisioners should own infrastructure realization when infrastructure is the subject of
the change.

## 10. Infrastructure-as-Code Strategy

IaC is first-class, but it is not one tool.

### 10.1 Source Intent

Deployment and platform intent should be version-controlled and reviewed.

Primary sources:

- Buck `TARGETS`
- deployment Starlark rules
- project shared config
- provider capability registry
- policy definitions
- OpenTofu stack inputs where reviewed
- Nix flake and derivations

### 10.2 Build Reproducibility

Nix remains the build and artifact reproducibility layer.

This includes:

- devshells
- toolchains
- dependency closures
- build artifacts
- OCI images
- cache inputs

### 10.3 Infrastructure Realization

The practical boundary should be:

```text
Viberoots owns intent, admission, orchestration, policy, and evidence.
OpenTofu owns durable cloud infrastructure realization where selected.
NixOS owns directly controlled host configuration.
Providers own provider-local state.
```

OpenTofu plan/diff artifacts should be admitted, approved, recorded, and replay-checked when
infrastructure-affecting mutation is in scope.

### 10.4 Evidence

Every durable infrastructure flow should produce evidence:

- plan output
- apply output
- read-only provider evidence
- readiness evidence
- cutover evidence
- rollback or recovery evidence when relevant

Evidence should be typed and secret-safe.

## 11. Build vs Buy Analysis

### 11.1 Strategic Areas Worth Owning

Viberoots should own:

- deployment graph model
- resource identity and reference model
- control-plane admission
- control-plane reconciliation semantics
- policy engine
- provider capability abstraction
- deployment experience
- exact-artifact and snapshot semantics
- replay, retry, rollback, promotion, and preview semantics
- secret/runtime-config contract model
- audit and status contracts
- integration boundaries

These are differentiating because they define how Viberoots makes software delivery safe,
reviewable, reproducible, and portable.

### 11.2 Areas Worth Integrating

Viberoots should integrate rather than replace:

- object storage
- Postgres
- OpenTofu
- Nix binary caches
- remote execution backends
- observability backends
- identity providers
- secret backends
- provider APIs
- mature container runtimes

Owning the abstraction does not require owning the implementation.

### 11.3 Areas To Revisit Only With Evidence

Viberoots should consider building deeper implementations only if existing systems block core
requirements:

- custom remote execution
- custom object storage
- custom observability pipeline
- custom secret backend
- custom infrastructure reconciler

The default should be integration.

## 12. Open Decisions

1. Should the common resource envelope be introduced first for extracted intent resources,
   admitted runtime resources, or both?

2. How much of the current deployment backend should remain deployment-specific versus moving to
   generic resource tables?

3. What is the exact compatibility contract between `Deployment`, `ProviderTarget`, and future
   `Environment` resources?

4. Should provider capability entries become first-class resources with versioned API identities?

5. How should control-plane status expose resource graph edges without leaking secret-bearing
   runtime details?

6. What is the minimum first-class tenant model needed for deployment isolation without importing
   broader product-tenancy assumptions too early?

7. How should ADR-00007 be revised to reflect the current accepted OpenTofu usage in AWS and
   deployment-owned infrastructure flows?

8. When does `WorkerPool` become necessary, and which concrete workflow should justify it?

9. Should remote execution placement policy live under a future `ExecutionPolicy` resource or
   under provider capability and build-system policy until there is more evidence?

10. What migration path preserves existing deployment records if resource identities are
    generalized?

## 13. Recommended Next Milestones

### Milestone 1: Document The Current Deployment Resource Graph

Produce a formal design document for the existing graph:

- resource kinds
- identities
- references
- authority boundaries
- source locations
- extracted contracts
- runtime state resources
- provider capability bindings

### Milestone 2: Add A Resource Envelope For Extracted Deployment Contracts

Wrap extracted deployment documents in a stable envelope without changing behavior.

Success criteria:

- current deploy flows still work
- operators still use Buck labels
- no hand-authored resource YAML is introduced
- resource identity and ownership become machine-readable

### Milestone 3: Create A Resource Graph Read Model

Add a read-only graph view over existing extracted deployment resources and current stage state.

Success criteria:

- list deployments, policies, provider targets, components, and current state as graph nodes
- show edges between deployments, policies, provider targets, artifacts, and stage state
- expose secret-safe status only

### Milestone 4: Unify Provider Status And Reconciliation Evidence

For reviewed providers, standardize observed-state evidence:

- live target identity
- last known provider release id
- drift signal when supported
- preview target evidence
- partial publish evidence
- smoke/readiness evidence

### Milestone 5: Clarify OpenTofu As A First-Class Provisioner Resource

Make OpenTofu provisioners and foundation deployments fit the resource graph cleanly:

- stack identity
- state backend identity
- plan artifact
- apply artifact
- evidence artifacts
- approval binding
- replay compatibility

### Milestone 6: Generalize Policy Resources

Make lane/admission/rollout/preview/provider capability policies uniformly addressable and
versioned.

### Milestone 7: Decide On WorkerPool Based On A Concrete Workflow

Only after the deployment resource graph is formalized, decide whether WorkerPool is needed for:

- remote builds
- deployment worker capacity
- customer-hosted execution
- regulated execution placement

Do not add WorkerPool as an abstract platform gesture.

## 14. Risks

### 14.1 Overbuilding

The largest risk is building a generalized platform before the existing deployment model is fully
formalized.

Mitigation:

- generalize only existing concepts first
- require concrete workflows for new resource kinds
- preserve Buck `TARGETS` as the intent authoring path

### 14.2 Weakening Existing Invariants

A generic resource store could accidentally weaken deployment-specific safety around exact
artifacts, snapshots, replay, rollback, and provider locks.

Mitigation:

- keep domain-specific tables and invariants where they carry safety
- add generic read models before generic write models
- preserve fail-closed behavior

### 14.3 Provider Abstraction Leakage

Cross-cloud normalization can hide provider differences that matter for safe mutation.

Mitigation:

- keep provider capability entries explicit
- require provider-specific evidence
- reject unsupported semantics instead of emulating them poorly

### 14.4 IaC Boundary Confusion

The repo contains older Nix/NixOS-first IaC language and newer OpenTofu-based AWS/control-plane
flows. Leaving this unresolved creates review ambiguity.

Mitigation:

- update the IaC ADR
- define Nix, NixOS, OpenTofu, provider, and control-plane ownership clearly
- keep all durable cloud mutation reviewed and evidence-backed

### 14.5 Premature Worker Scheduling

WorkerPool and placement abstractions could distract from the more mature deployment graph.

Mitigation:

- delay WorkerPool until a concrete remote-build, deployment-worker, or customer-hosted execution
  workflow requires it
- integrate with mature remote execution systems first

### 14.6 Multi-Tenant Complexity

Tenant resources are important, but importing broad product-tenancy models too early could make the
deployment platform harder to operate.

Mitigation:

- start with deployment isolation, environment-stage isolation, provider-target isolation, and
  secret-contract isolation
- introduce broader tenant resources only when control-plane or customer-hosted workflows require
  them

## 15. Final Recommendation

Adopt the resource-graph direction, but define it as an evolution of the current system.

The architecture should be:

```text
Git / Buck TARGETS
  reviewed intent graph

Buck extraction
  typed resource contracts

Control-plane admission
  immutable execution snapshots and policy decisions

Postgres + object storage
  authoritative runtime graph, queue, locks, state, history, audit, artifacts

Workers
  reconciler execution under leases and fencing

Providers / OpenTofu / NixOS / execution systems
  realization substrates
```

The near-term goal is not a generic platform. It is a generalized deployment-resource platform that
makes existing concepts explicit and reusable.

The long-term goal is a resource-graph control plane for software delivery and platform operations,
where Viberoots owns the abstractions and integration points while continuing to integrate mature
systems for storage, remote execution, observability, infrastructure realization, identity, and
secrets.

The first engineering move should be to formalize the existing deployment resource graph and expose
a read-only graph/status model. That gives the team a concrete foundation for generalization
without discarding the architecture already present in the repo.
