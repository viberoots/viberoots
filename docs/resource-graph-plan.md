# Resource Graph Control Plane Implementation Plan

This plan implements the design in
[`docs/resource-graph-control-plane-proposal.md`](resource-graph-control-plane-proposal.md).
It follows the PR-section style used by
[`docs/viberoots-flake-plan.md`](viberoots-flake-plan.md), but the scope here is the resource
graph and deployment control-plane evolution.

The proposal's core constraint is that Viberoots should evolve the deployment graph and
Postgres-backed reconciliation model that already exist. The goal is not to build a new
Kubernetes-like platform or replace Buck, Nix, OpenTofu, provider APIs, Postgres, object storage, or
remote execution systems with custom implementations.

## Reviewed Context

- [`docs/resource-graph-control-plane-proposal.md`](resource-graph-control-plane-proposal.md)
- [`docs/viberoots-flake-plan.md`](viberoots-flake-plan.md)
- Existing deployment and control-plane contracts referenced by the proposal:
  - Buck deployment metadata and extraction
  - provider capability registry
  - deployment service admission, queueing, claims, locking, and audit records
  - execution snapshots, current stage state, and stage history
  - OpenTofu foundation/provisioner support
  - Nix-provided tooling and artifact semantics

## Implementation Guardrails

- Do not add documentation-only PRs or testing-only PRs. Each PR must implement a coherent slice of
  functionality and must include the tests and documentation for that slice.
- Do not weaken tests, assertions, admission checks, locking, fencing, idempotency, replay
  semantics, rollback policy, exact-artifact behavior, or provider eligibility checks.
- Do not remove supported deployment functionality while generalizing the model.
- Do not introduce hand-authored resource YAML as a replacement for reviewed Buck deployment
  metadata.
- Keep Buck as the reviewed intent graph compiler for repo-owned resources.
- Keep Nix as the source of user-facing tools, build reproducibility, dev shells, toolchains, OCI
  image construction, and artifact environments.
- Keep durable cloud mutation reviewed, evidence-backed, and provider appropriate. Repository
  commands may orchestrate plan/apply and evidence collection, but must not become an unreviewed
  imperative provisioning engine.
- Add generic resource indexes and read models only where they improve querying, linking, or status.
  Do not replace deployment-specific tables that enforce safety.
- Normalize provider identity, status, and evidence without hiding provider-specific constraints.
  Unsupported semantics must fail closed.
- Treat `WorkerPool` as a later decision that requires a concrete workflow. Do not add an abstract
  scheduler as an early platform gesture.
- Preserve secret-safe behavior. The graph may record requirement declarations, backend routing,
  admissibility, resolution evidence, and replay identity, but it must not store raw secrets.

## Validation Policy

- Each PR must add focused tests for its own changed behavior and update operator or design docs for
  the same scope.
- Any PR touching Buck extraction, deployment admission, control-plane state transitions, database
  migrations, provider dispatch, or artifact replay must run the relevant deployment-domain tests.
- Any PR touching Nix-provided tools, Buck graph generation, or provider labels must run the
  relevant build-system tests in addition to focused deployment tests.
- Tests should use realistic repository fixtures. Where temp repos are needed, structure them like
  the supported workspace shape, with top-level `projects/` and reusable tooling reached through the
  active viberoots source model.
- Failing tests should be investigated to root cause. Do not weaken assertions to pass a PR.

## De-Risking Checkpoints

### Checkpoint A: Existing Graph Named

After PR-1, the repository should have a machine-checked inventory of the current deployment graph:
resource concepts, identities, references, source locations, extracted contracts, runtime state
resources, provider capability bindings, and authority boundaries.

Decision: continue only if the inventory matches real deployment behavior and does not require
moving authority away from Buck/Nix/control-plane boundaries.

### Checkpoint B: Envelope Is Additive

After PR-2, resource envelopes should wrap existing extracted deployment contracts without changing
current deploy flows.

Decision: continue only if operators can still use Buck labels, current deploy paths still work,
and envelope identity/ownership is machine-readable without introducing a parallel authoring model.

### Checkpoint C: Read Model Is Non-Authoritative

After PR-4, the control plane should expose secret-safe resource graph status and edges while
leaving deployment-specific admission, queue, lock, stage-state, audit, and replay tables
authoritative.

Decision: continue only if the read model improves status/querying without becoming a generic
mutation bypass.

### Checkpoint D: Evidence And Policy Are First-Class

After PR-7, provider evidence, OpenTofu provisioner evidence, and policy resources should be
versioned, addressable, and bound into deployment admission without weakening existing
protected/shared semantics.

Decision: continue only if provider-specific constraints remain explicit and durable cloud mutation
remains reviewed and evidence-backed.

### Checkpoint E: WorkerPool Needs Evidence

After PR-8, the repo should have enough worker/capacity/status evidence to decide whether
`WorkerPool` is needed for a concrete workflow.

Decision: add a real WorkerPool resource only if the evidence identifies a concrete remote-build,
deployment-worker, customer-hosted execution, or regulated placement workflow that current
integration contracts cannot model cleanly.

## Integration Debt Ledger

Use this ledger for deliberate follow-up from implementation PRs. Do not use it to hide failing
tests, weakened assertions, or behavior regressions.

| Area                                   | Introduced by | Owner PR                    | Status  | Notes                                                                   |
| -------------------------------------- | ------------- | --------------------------- | ------- | ----------------------------------------------------------------------- |
| Resource graph read-model schema shape | PR-3/PR-4     | PR-4                        | Planned | Final table/index names should be decided when the export shape exists. |
| Provider evidence normalization gaps   | PR-5          | PR-5/PR-9                   | Planned | Provider-specific unsupported semantics must remain fail-closed.        |
| WorkerPool decision                    | PR-8          | Future PR only if justified | Planned | No abstract scheduler in this plan.                                     |

## PR-1: Deployment resource graph inventory and taxonomy

### 1. Intent

Name the current deployment resource graph as an explicit model before adding new generic behavior.
This PR should turn existing deployment concepts into a checked taxonomy and inventory that future
PRs can build on.

### 2. Scope of changes

- Add a typed resource taxonomy for existing deployment concepts, including:
  - `Deployment`
  - `DeploymentFamily`
  - `Component`
  - `ProviderTarget`
  - `EnvironmentStage`
  - `LanePolicy`
  - `AdmissionPolicy`
  - `RolloutPolicy`
  - `PreviewPolicy`
  - `SmokePolicy`
  - `SecretRequirement`
  - `RuntimeConfigRequirement`
  - `Provisioner`
  - `ReleaseAction`
  - `ArtifactInput`
  - `ExecutionSnapshot`
  - `DeployRun`
  - `CurrentStageState`
- Add an inventory command or test helper that reads current deployment extraction output and maps
  each discovered concept to the taxonomy.
- Record resource identity rules, reference rules, source locations, authority boundaries, and
  provider capability bindings in machine-checkable fixtures.
- Keep current deployment behavior unchanged.

### 3. External prerequisites

- None.

### 4. Tests to be added

- Taxonomy completeness tests for representative deployment fixtures across existing provider
  families.
- Snapshot tests proving extracted deployment metadata maps to the expected resource concepts.
- Negative tests proving unknown or unsupported extracted concepts fail clearly rather than being
  silently dropped.
- Tests proving this inventory path does not mutate deployment records or provider state.

### 5. Docs to be added or updated

- Add or update deployment design documentation with the current resource taxonomy, identity rules,
  reference rules, and authority boundaries.
- Document that Buck deployment metadata remains the authoring path for repo-owned intent.

### 5.5. Expected regression scope

- `deployment-only`
- Broaden to build-system validation only if the inventory changes Buck graph extraction rather than
  consuming existing extracted output.

### 6. Acceptance criteria

- The existing deployment graph is described by a checked taxonomy.
- The inventory covers deployments, provider targets, components, policies, requirements,
  provisioners, artifacts, execution snapshots, runs, and stage state.
- No deployment behavior changes.

### 7. Risks

- The taxonomy may accidentally describe the intended future model instead of the current system.
- Existing provider families may expose inconsistent metadata shapes.

### 8. Mitigations

- Drive the taxonomy from real extraction output and representative fixtures.
- Treat inconsistencies as explicit findings with owner PRs, not as hidden normalization.

### 9. Consequences of not implementing this PR

Later PRs would generalize resource behavior without a checked baseline of what already exists.

### 10. Downsides for implementing this PR

It adds inventory and taxonomy code before adding user-visible status surfaces.

## PR-2: Resource envelope for extracted deployment contracts

### 1. Intent

Introduce a small common resource envelope around extracted deployment contracts while keeping the
existing deployment contract and operator workflows intact.

### 2. Scope of changes

- Add a versioned resource envelope shape with:
  - `apiVersion`
  - `kind`
  - `metadata.name`
  - `metadata.uid` or stable identity
  - `metadata.labels`
  - `metadata.ownerReferences`
  - `spec`
  - `statusRef` or `status`
  - `evidenceRef`
  - `policyRefs`
  - `source`
- Generate envelopes from existing extracted deployment contracts as an additive output.
- Preserve current deployment extraction outputs used by active deploy flows.
- Define stable identity and ownership rules for the resource kinds introduced in PR-1.
- Ensure requirement resources reference secret/runtime-config declarations and evidence only, not
  raw secret values.

### 3. External prerequisites

- PR-1 taxonomy and inventory should be available.

### 4. Tests to be added

- Envelope schema tests for every PR-1 resource kind that is extractable from Buck metadata.
- Snapshot tests proving stable IDs, owner references, policy refs, source refs, and evidence refs.
- Compatibility tests proving existing deploy commands still consume the existing deployment
  contract shape.
- Secret-safety tests proving envelope output does not expose raw secret values.

### 5. Docs to be added or updated

- Document the resource envelope schema and versioning rules.
- Update deployment contract docs to explain that envelopes are additive read/extraction output, not
  a replacement authoring format.

### 5.5. Expected regression scope

- `deployment-only`
- Add build-system extraction tests if envelope generation is wired into shared Buck graph tooling.

### 6. Acceptance criteria

- Existing deploy flows still work.
- Operators still use Buck labels.
- No hand-authored resource YAML is introduced.
- Resource identity and ownership become machine-readable.

### 7. Risks

- The envelope may drift toward Kubernetes semantics that do not match Viberoots.
- A parallel resource output may diverge from existing deployment contracts.

### 8. Mitigations

- Keep the envelope minimal and Viberoots-specific.
- Generate envelopes from the same extracted facts consumed by deployment flows.

### 9. Consequences of not implementing this PR

The graph would remain difficult to index, link, and expose consistently through control-plane
status.

### 10. Downsides for implementing this PR

It introduces another serialized contract that must be versioned and tested.

## PR-3: Buck resource graph export

### 1. Intent

Make Buck extraction produce a deterministic resource graph export for deployment intent while
preserving Buck as the compiler and authority for repo-owned resources.

### 2. Scope of changes

- Add a resource graph export command or build artifact that emits the PR-2 envelopes and graph
  edges for reviewed deployment intent.
- Derive graph edges from Buck metadata and existing deployment extraction, not from ad hoc
  filesystem scanning.
- Include edges between deployments, components, provider targets, policies, requirements,
  provisioners, artifact inputs, and source metadata.
- Add deterministic ordering, schema versioning, and stable output paths.
- Keep the export read-only. It must not mutate control-plane records, provider state, generated
  provider files, or deployment metadata.

### 3. External prerequisites

- PR-2 resource envelope generation should be available.

### 4. Tests to be added

- Buck fixture tests proving representative deployment targets export deterministic resource graph
  documents.
- Snapshot tests for graph nodes and edges.
- Negative tests for invalid labels, missing provider targets, invalid policy refs, and unsupported
  requirement refs.
- Tests proving the export path does not introduce hand-authored resource YAML or bypass Buck
  metadata.

### 5. Docs to be added or updated

- Document the resource graph export command, output schema, and intended consumers.
- Update deployment design docs to describe Buck as the intent graph compiler.

### 5.5. Expected regression scope

- `deployment-only`
- `mixed-build-system` if the export changes shared Buck graph generation, provider labels, or
  selector behavior.

### 6. Acceptance criteria

- A representative deployment graph can be exported as stable resource documents and edges.
- The export is deterministic across repeated runs with the same input.
- Buck remains the only reviewed compiler for repo-owned deployment intent.

### 7. Risks

- Graph export may duplicate existing extraction logic.
- Deterministic output may be brittle if provider metadata includes unstable ordering.

### 8. Mitigations

- Reuse existing extraction helpers wherever possible.
- Normalize ordering at the graph export boundary and test it directly.

### 9. Consequences of not implementing this PR

The control plane would have no stable resource graph input to index or expose.

### 10. Downsides for implementing this PR

It creates a new build/export surface that must stay synchronized with deployment extraction.

## PR-4: Control-plane resource graph read model

### 1. Intent

Add a secret-safe control-plane read model for resource graph nodes, edges, status, and current
stage state without replacing deployment-specific mutation tables.

### 2. Scope of changes

- Add database schema and service plumbing for a read-only resource graph index.
- Ingest or persist admitted resource envelopes and graph edges where they improve status and
  linkage.
- Link deployments, provider targets, policies, artifacts, execution snapshots, deploy runs, current
  stage state, and stage history through stable resource IDs.
- Expose read-only API or CLI status surfaces for listing graph nodes, graph edges, and current
  secret-safe status.
- Preserve existing deployment tables for submissions, queue, claims, locks, stage state, records,
  audit, and idempotency.
- Do not add generic resource mutation APIs in this PR.

### 3. External prerequisites

- PR-3 resource graph export should be available.

### 4. Tests to be added

- Database migration tests for the resource graph read-model schema.
- Service tests proving read-model writes are derived from admitted or extracted resource facts.
- API or CLI tests for listing deployments, policies, provider targets, components, artifacts, and
  current state as graph nodes and edges.
- Secret-safety tests for status output.
- Regression tests proving deployment submission, idempotency, queueing, locking, and stage-state
  mutation still use deployment-specific invariants.

### 5. Docs to be added or updated

- Document the read-model schema, status API/CLI, and which tables remain authoritative for
  mutation.
- Update operator docs with the new resource graph status commands or endpoints.

### 5.5. Expected regression scope

- `deployment-only`
- Include database/control-plane integration validation because this PR touches runtime state.

### 6. Acceptance criteria

- Operators can list deployments, policies, provider targets, components, artifacts, and current
  state as resource graph nodes.
- Operators can see edges between deployments, policies, provider targets, artifacts, execution
  snapshots, deploy runs, and stage state.
- Read-model output is secret-safe.
- Deployment-specific mutation invariants remain authoritative.

### 7. Risks

- A generic read-model table may be mistaken for the source of truth.
- Read-model ingestion could become coupled to provider mutation timing.

### 8. Mitigations

- Name and document the read model as non-authoritative for mutation.
- Keep ingestion driven by admitted/extracted facts and existing durable events.

### 9. Consequences of not implementing this PR

The resource graph would exist only as build output and would not improve control-plane status or
operator understanding.

### 10. Downsides for implementing this PR

It adds schema and operational complexity before adding new resource kinds.

## PR-5: Provider status and reconciliation evidence resources

### 1. Intent

Normalize provider status and reconciliation evidence as first-class resource-linked facts while
keeping provider-specific capabilities explicit.

### 2. Scope of changes

- Extend provider capability entries or derived resources with versioned identities and explicit
  supported semantics.
- Normalize provider evidence fields for reviewed providers, including:
  - live target identity
  - last known provider release id
  - drift signal when supported
  - preview target evidence
  - partial publish evidence
  - smoke/readiness evidence
  - rollback or recovery evidence where available
- Link provider evidence to deployments, provider targets, execution snapshots, deploy runs, and
  current stage state in the PR-4 read model.
- Preserve provider-specific adapters and fail-closed behavior for unsupported semantics.
- Do not collapse provider state into a false universal cloud model.

### 3. External prerequisites

- PR-4 read model should be available.

### 4. Tests to be added

- Provider capability registry tests proving supported semantics are explicit for representative
  providers.
- Evidence normalization tests for at least two materially different provider families.
- Negative tests proving unsupported drift, preview, partial publish, smoke, or rollback semantics
  fail closed rather than being emulated.
- Read-model tests proving provider evidence links to the expected resource IDs.

### 5. Docs to be added or updated

- Update provider capability documentation with resource identities, supported semantics, and
  evidence fields.
- Document provider evidence status output for operators.

### 5.5. Expected regression scope

- `deployment-only`
- Broaden to provider-specific build or integration tests when adapters or provider fixtures change.

### 6. Acceptance criteria

- Reviewed providers expose normalized secret-safe evidence where supported.
- Provider-specific constraints remain visible in the capability registry.
- The resource graph can link deployments and provider targets to observed-state evidence.

### 7. Risks

- Cross-cloud normalization may hide provider differences that are safety relevant.
- Provider evidence fields may be too broad or too narrow for some provider families.

### 8. Mitigations

- Keep unsupported semantics explicit and fail closed.
- Require provider-specific tests before enabling normalized evidence for a provider.

### 9. Consequences of not implementing this PR

The resource graph would show desired intent and runtime runs but not enough observed provider state
to support reconciliation-oriented status.

### 10. Downsides for implementing this PR

It requires careful provider-by-provider review and may reveal inconsistent existing evidence
contracts.

## PR-6: OpenTofu provisioner resource integration

### 1. Intent

Make OpenTofu foundation and provisioner flows fit cleanly into the resource graph while preserving
the reviewed IaC boundary.

### 2. Scope of changes

- Model OpenTofu stacks as first-class provisioner resources with:
  - stack identity
  - state backend identity
  - plan artifact references
  - apply artifact references
  - evidence artifact references
  - approval binding
  - replay compatibility
- Link provisioner resources to deployments, provider targets, policies, execution snapshots, and
  current stage state where applicable.
- Ensure OpenTofu remains a provisioner and evidence system for durable cloud infrastructure, not
  the sole source of resource intent.
- Ensure all OpenTofu tooling remains Nix-provided.
- Preserve reviewed plan/apply/evidence workflows.

### 3. External prerequisites

- PR-4 read model should be available.
- PR-5 provider evidence conventions should be available or close enough to share evidence shape.

### 4. Tests to be added

- OpenTofu fixture tests for stack identity, state backend identity, plan artifacts, apply artifacts,
  evidence artifacts, and approval binding.
- Replay compatibility tests for provisioner evidence.
- Tests proving Nix provides OpenTofu tooling for these paths.
- Negative tests proving provisioner resources do not store raw secrets and do not duplicate
  provider-owned live state.

### 5. Docs to be added or updated

- Update IaC documentation or the relevant ADR to state the boundary between Nix, NixOS, OpenTofu,
  providers, and the control plane.
- Document the OpenTofu provisioner resource contract and operator evidence flow.

### 5.5. Expected regression scope

- `deployment-only`
- Include OpenTofu/control-plane fixture validation.
- Include Nix tool-provisioning validation if any shell, package, or derivation wiring changes.

### 6. Acceptance criteria

- OpenTofu provisioners appear in the resource graph with stable identities and evidence refs.
- Durable cloud mutation remains reviewed and evidence-backed.
- Existing OpenTofu foundation/provisioner workflows still work.

### 7. Risks

- The graph could imply that OpenTofu is the only valid infrastructure source.
- State backend and plan/apply evidence may expose sensitive data if not filtered carefully.

### 8. Mitigations

- Document OpenTofu as one provisioner under Viberoots admission and policy.
- Redact and test evidence surfaces for secret safety.

### 9. Consequences of not implementing this PR

OpenTofu would remain a special-case deployment adjunct instead of a clear provisioner resource in
the graph.

### 10. Downsides for implementing this PR

It tightens IaC terminology and contracts around an area that already has existing workflows.

## PR-7: First-class policy resources and admission binding

### 1. Intent

Make deployment policy resources uniformly addressable, versioned, and visible in admission and
status without weakening the existing fail-closed protected/shared behavior.

### 2. Scope of changes

- Promote existing policy concepts to first-class resource envelopes and read-model nodes:
  - lane policy
  - admission policy
  - rollout policy
  - preview policy
  - smoke policy
  - release-action policy
  - provider capability policy
  - source-ref policy where applicable
- Bind policy resource IDs and versions into deployment admission snapshots and status output.
- Ensure policy refs are stable and traceable from deployments, provider targets, execution
  snapshots, deploy runs, and current stage state.
- Preserve existing policy-specific logic where it enforces safety.
- Do not introduce broad new policy expressiveness in this PR; the first milestone is consistency.

### 3. External prerequisites

- PR-4 read model should be available.
- PR-5 provider capability resource conventions should be available.

### 4. Tests to be added

- Admission tests proving policy resource IDs and versions are included in snapshots.
- Fail-closed tests for missing, stale, unsupported, or incompatible policy refs.
- Status/read-model tests proving policies are addressable and linked to deployments and runs.
- Regression tests for protected/shared approval, rollout, preview, smoke, rollback, and
  release-action behavior.

### 5. Docs to be added or updated

- Update deployment policy documentation with policy resource identities, versioning, refs, and
  status output.
- Document that policy resources are consistency and traceability surfaces, not a new permissive
  policy language.

### 5.5. Expected regression scope

- `deployment-only`
- Include protected/shared deployment validation because admission snapshots and policy behavior are
  in scope.

### 6. Acceptance criteria

- Existing policies are first-class resource graph nodes.
- Deployment admission records the policy IDs and versions it relied on.
- Missing or incompatible policy facts fail closed.
- Existing protected/shared deployment behavior is preserved.

### 7. Risks

- Policy versioning could diverge from extracted deployment metadata.
- Generalizing policy references could accidentally make admission more permissive.

### 8. Mitigations

- Derive policy resources from the same reviewed metadata admission already uses.
- Add negative admission tests for every changed policy class.

### 9. Consequences of not implementing this PR

Policies would remain scattered contract fields instead of inspectable graph resources, limiting
auditability and reconciliation status.

### 10. Downsides for implementing this PR

It adds more identifiers and versions that operators and tests must understand.

## PR-8: Worker evidence and WorkerPool decision gate

### 1. Intent

Collect the concrete worker and execution evidence needed to decide whether `WorkerPool` should
become a resource, without adding a premature generic scheduler.

### 2. Scope of changes

- Add or extend worker status/heartbeat/read-model fields needed to evaluate concrete workflows:
  - worker identity
  - control-plane association
  - supported execution modes
  - trust zone or tenancy labels where already known
  - provider or region metadata where already known
  - current health
  - lease/claim state
  - coarse capacity signal if available without replacing the execution backend
- Expose this worker evidence through a secret-safe status command or API.
- Link worker evidence to deploy runs and execution snapshots where the existing control-plane
  model already knows the relationship.
- Add a decision gate that records whether current workflows justify a future `WorkerPool` resource.
- Do not implement generic placement, dependency-aware scheduling, worker enrollment, or a new
  remote execution engine.

### 3. External prerequisites

- PR-4 read model should be available.

### 4. Tests to be added

- Worker heartbeat/status tests for healthy, expired, missing, and mismatched worker authority.
- Read-model tests proving worker evidence links to runs and snapshots without becoming
  authoritative for provider mutation.
- Secret-safety tests for worker status output.
- Negative tests proving status-only worker evidence does not authorize work without the existing
  claim, lease, and fencing checks.

### 5. Docs to be added or updated

- Document worker evidence status output and the exact decision criteria for a future `WorkerPool`
  resource.
- Update architecture docs to state that WorkerPool remains deferred until a concrete workflow
  requires it.

### 5.5. Expected regression scope

- `deployment-only`
- Include control-plane worker/queue tests because worker claims and leases are in scope.

### 6. Acceptance criteria

- Operators can inspect secret-safe worker evidence linked to runs.
- Existing claim, lease, lock, and fencing semantics remain authoritative.
- The repo has a checked decision gate for whether a future WorkerPool PR is justified.
- No generic scheduler is introduced.

### 7. Risks

- Worker evidence fields may be interpreted as scheduling policy before the model is ready.
- Capacity status could become stale or misleading.

### 8. Mitigations

- Keep output explicitly diagnostic.
- Preserve existing queue/claim/lease/fencing enforcement and test that it remains required.

### 9. Consequences of not implementing this PR

The project would either defer WorkerPool indefinitely without evidence or add it prematurely.

### 10. Downsides for implementing this PR

It adds diagnostic worker status plumbing that may later be replaced or extended by a real
WorkerPool model.

## PR-9: End-to-end deployment resource graph reconciliation flow

### 1. Intent

Prove the generalized resource graph direction end to end for one representative protected/shared
deployment flow while keeping the current deployment reconciler authoritative.

### 2. Scope of changes

- Wire the resource taxonomy, envelopes, Buck graph export, read model, provider evidence,
  provisioner resources, policy resources, and worker evidence into one representative deployment
  path.
- Ensure the flow covers:
  - reviewed Buck intent
  - extracted resource graph
  - admitted immutable execution snapshot
  - policy decision
  - provider or provisioner reconciliation evidence
  - current stage state
  - stage history
  - audit records
  - resource graph status output
- Add operator-facing status that explains the desired-vs-observed path without exposing secrets.
- Keep existing deployment submission, approval, retry, rollback, preview, promotion, queueing,
  locking, and idempotency behavior intact.
- Do not add generic resource mutation APIs or a generic platform scheduler.

### 3. External prerequisites

- PR-1 through PR-8 should be complete.

### 4. Tests to be added

- End-to-end protected/shared deployment fixture covering graph export, admission, execution
  snapshot, evidence recording, stage state, history, audit, and resource status.
- Regression tests for retry, rollback, preview or promotion where the representative flow touches
  those surfaces.
- Tests proving existing CLI behavior still works for operators using Buck labels.
- Secret-safety tests for final resource graph status output.
- Negative tests proving unsupported provider/provisioner/policy semantics still fail closed.

### 5. Docs to be added or updated

- Update deployment usage docs with the end-to-end resource graph status workflow.
- Update architecture docs with the finalized near-term resource graph control-plane contract.
- Document remaining future work only when it is justified by implementation evidence, especially
  any future WorkerPool work.

### 5.5. Expected regression scope

- `deployment-only`
- Include full deployment-domain validation.
- Include build-system validation if the final wiring touches Buck extraction, graph export, Nix
  tooling, or provider labels.

### 6. Acceptance criteria

- A representative protected/shared deployment can be traced from Buck intent through admitted
  runtime graph, provider/provisioner evidence, stage state, and audit.
- Current deployment reconciler invariants remain authoritative.
- Operators get useful secret-safe resource graph status.
- The implementation demonstrates a generalized deployment-resource platform, not a separate
  Kubernetes-like platform.

### 7. Risks

- End-to-end wiring could reveal earlier schema or identity choices that do not compose.
- Status output may become too verbose or too generic for operators.

### 8. Mitigations

- Keep resource IDs and edges stable across PRs and adjust earlier schemas only when tests prove a
  composition issue.
- Design final status output around deployment troubleshooting workflows.

### 9. Consequences of not implementing this PR

The project would have individual graph pieces but no proof that they improve a real deployment
reconciliation workflow.

### 10. Downsides for implementing this PR

It is an integration-heavy PR and may require broader validation than the earlier slices.
