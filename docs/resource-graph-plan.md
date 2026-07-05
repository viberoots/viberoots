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
  - deployment context resolution and selected control-plane metadata
  - provider capability registry
  - deployment service admission, queueing, claims, locking, and audit records
  - execution snapshots, current stage state, and stage history
  - OpenTofu foundation/provisioner support
  - Nix-provided tooling and artifact semantics
- [`docs/control-plane-selector.md`](control-plane-selector.md)
- [`docs/deployments-contract.md`](deployments-contract.md)
- [`docs/control-plane-web-ui.md`](control-plane-web-ui.md)
- [`docs/control-plane-mcp.md`](control-plane-mcp.md)
- [`docs/cloud-control-setup.md`](cloud-control-setup.md)
- [`docs/control-plane-guide.md`](control-plane-guide.md)
- [`docs/control-plane-managed-dependencies.md`](control-plane-managed-dependencies.md)
- [`docs/viberoots-source-modes.md`](viberoots-source-modes.md)
- [`docs/viberoots-maintenance-commands.md`](viberoots-maintenance-commands.md)
- [`../build-tools/docs/nixpkgs-source-selection-plan.md`](../build-tools/docs/nixpkgs-source-selection-plan.md)

## Sequencing Note

Implementation is intentionally paused after PR-3 while
[`../build-tools/docs/nixpkgs-source-selection-plan.md`](../build-tools/docs/nixpkgs-source-selection-plan.md)
is implemented. When this plan resumes at PR-4A, assume target-scoped nixpkgs source selection,
package pins, filtered/remote/cache source-plan evidence, and consumer workspace parity are already
available.

PR-4A and later PRs should consume the source-selection fields and source-plan evidence produced by
the build-system work. They should not introduce a second nixpkgs registry, duplicate source-plan
resolver, package compatibility database, tool/library classifier, or alternate remote/cache
manifest shape. Resource graph status may expose secret-safe profile and pin evidence, but it should
link to or copy only the normalized evidence needed for operator diagnosis and artifact replay.

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
- When indexing or displaying build-system source facts after the nixpkgs source-selection work has
  landed, reuse its graph fields, source-plan evidence, source snapshot data, and cache-manifest
  conventions. Do not infer nixpkgs source identity from labels, raw flake inputs, or derivation
  paths.
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
- Keep resource graph export and read-model state under viberoots-owned workspace or control-plane
  storage. Do not write consumer-authored source, generated provider files, or project config while
  producing graph output.
- Reuse existing graph discovery, deployment query, deployment context, and workspace-state helpers
  before adding new export paths. Any new graph surface must compose with the existing
  `.viberoots/workspace` source-mode contract.
- All new substantive automation, CLI, status, inventory, and export commands must be TypeScript zx
  scripts using `#!/usr/bin/env zx-wrapper`. New `build-tools/tools/bin/*` shell files may only be
  thin delegators.
- New CLI entrypoints must use `build-tools/tools/lib/cli.ts` for argument parsing, and TypeScript
  tool-to-tool invocation must use the repo's `runNodeWithZx` helper rather than hand-rolled Node or
  zx process spawning.

## Validation Policy

- Each PR must add focused tests for its own changed behavior and update operator or design docs for
  the same scope.
- Any PR touching Buck extraction, deployment admission, control-plane state transitions, database
  migrations, provider dispatch, or artifact replay must run the relevant deployment-domain tests.
- Any PR touching Nix-provided tools, Buck graph generation, or provider labels must run the
  relevant build-system tests in addition to focused deployment tests.
- Tests should use realistic repository fixtures. Where temp repos are needed, structure them like
  the supported workspace shape, with top-level `projects/`, supported `sandbox/` roots where the
  deployment query path allows them, and reusable tooling reached through the active viberoots
  source model.
- Tests that exercise graph export or deployment discovery must cover both graph-first discovery
  from `.viberoots/workspace/buck/graph.json` and Buck query fallback where the existing command
  path supports both.
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

After PR-4B, the control plane should expose secret-safe resource graph status and edges while
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
| Resource graph read-model schema shape | PR-3/PR-4A    | PR-4A                       | Planned | Final table/index names should be decided when the export shape exists. |
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
  - `DeploymentContext`
  - `ControlPlaneProfile`
  - `ControlPlaneSelection`
  - `EnvironmentStage`
  - `LanePolicy`
  - `LaneGovernancePolicy`
  - `AdmissionPolicy`
  - `RolloutPolicy`
  - `PreviewPolicy`
  - `SmokePolicy`
  - `SourceRefPolicy`
  - `ReadinessGatePolicy`
  - `AttestationPolicy`
  - `SbomPolicy`
  - `SupplyChainPolicy`
  - `SecretRequirement`
  - `RuntimeConfigRequirement`
  - `RuntimeInput`
  - `AuthProviderProfile`
  - `ServiceClientProfile`
  - `DeploymentTargetException`
  - `Provisioner`
  - `ReleaseAction`
  - `ArtifactInput`
  - `ArtifactChallenge`
  - `StaticWebappUploadSession`
  - `StagedArtifact`
  - `ArtifactBindingProvenance`
  - `CleanupEvidence`
  - `ExecutionSnapshot`
  - `DeployRun`
  - `RunAction`
  - `CurrentStageState`
  - `StageHistoryEntry`
  - `AuditEvent`
  - `RetainedEvidence`
  - `ControlPlaneRuntime`
  - `ControlPlaneReadinessEvidence`
  - `ControlPlaneObservabilityEvidence`
  - `MiniMigrationPreflightEvidence`
- Add an inventory command or test helper that reads current deployment extraction output and maps
  each discovered concept to the taxonomy.
- The inventory path must use the existing deployment extraction graph-read path, including
  deployment graph read options and composite graph reads. Provider index and node-lock sidecars
  must stay available to graph/build-system consumers through that shared read surface without
  implying current deployment extraction depends on those sidecars.
- Inventory must identify existing graph-first deployment discovery/resolution paths that still read
  raw `graph.json`, including Infisical bootstrap discovery and resolver code, and either migrate
  them to `deploymentGraphReadOptions` plus `readCompositeGraph` or explicitly classify why they are
  out of export scope before PR-3 builds on graph-first behavior.
- Include runtime state sources for concepts that are not present in Buck extraction output,
  including execution snapshots, deploy runs, current stage state, retained evidence, stage history,
  run actions, and audit records. These runtime facts should be inventoried as observed/read-model
  inputs, not as reviewed intent.
- Include deployment context defaults, selected control-plane metadata, source-mode-owned workspace
  state, and supported deployment query roots in the inventory rather than treating them as
  out-of-band inputs.
- Include redacted `projects/config/local.json` override evidence, selected deployment-context and
  control-plane override paths, and `VBR_DISALLOW_LOCAL_OVERRIDES=1` fail-closed behavior in the
  inventory.
- Include runtime control-plane service-client selection evidence, including the selection source
  values `context`, `explicit_override`, `explicit`, and `ambient`, so override and ambient fallback
  behavior remains inspectable and testable.
- Include named remote control-plane profile selection via `--remote <name>`, including the resolved
  `controlPlanes.<name>.serviceClient` URL/token-ref facts and fail-closed behavior for missing or
  invalid named profiles, and the existing rejection when a deployment context already selects a
  control plane.
- Include the local service-client profile path for deployments without a context-selected control
  plane, including explicit `--profile`, `--profile-root`, lane-policy default client profiles, and
  the token environment contract. Preserve the existing rejection of profile selection when a
  deployment context already selects a control plane.
- Include deployment target exceptions and lane governance policy as reviewed safety metadata with
  resource identity, graph edges, status visibility, and fail-closed validation coverage.
- Include artifact challenge admission facts as secret-safe runtime inputs: challenge issuance,
  nonce/proof-key validation outcome, one-time challenge consumption, admitted artifact provenance,
  and failure diagnostics. Do not expose raw proof keys or secret-bearing upload data.
- Include static-webapp upload-session facts separately from artifact challenge semantics: archive
  session identity, submission binding, archive format, archive path/object identity, digest,
  `sizeBytes`, expiry, optional object-store payload reference, `upload-session:<id>` provenance,
  and rejected staged-upload cleanup diagnostics, including existing
  `artifact_cleanup_janitor_records` when those records are present. Future expired-upload-session
  sweeper evidence for
  `static_webapp_upload_sessions.expires_at` is deferred until a separate PR adds a durable sweeper
  record path.
- Include selected control-plane runtime/readiness evidence as graph-linked status inputs where the
  current protected/shared flow depends on it: setup-doctor results, conformance checklist status,
  setup bundle evidence, managed dependency evidence, credential preflight/staging, image
  publication evidence, runtime HTTP evidence, selected provider capability evidence, provider
  capability hook evidence, latest non-production deployment evidence, credential rotation, trusted
  runtime-config deployment IDs and worker counts, auth-provider profile evidence, auth
  callback/UI/MCP read health, worker-heartbeats probe evidence, standby
  evidence, operation-specific rollback/restore/break-glass evidence, operation audit evidence, and
  cutover evidence, plus mini migration preflight evidence when a mini cloud-shaped profile requires
  it before protected/shared queueing.
- Include auth-provider profile evidence as a named resource/status concept. It must preserve the
  full `cloud-control-auth-provider-profile@1` object by durable reference or embed an object
  validated by `validateAuthProviderProfile`; do not replace it with a lossy validation summary.
- Include runtime input evidence as a named reviewed resource/status concept. It must preserve the
  full `cloud-control-runtime-input@1` object by durable reference or embed an object validated by
  the current runtime-input contract, including provenance, auth-provider binding, and Infisical
  deployment bindings that make generated auth-provider profiles reviewed.
- `ControlPlaneReadinessEvidence` must preserve the full current `CutoverEvidence` contract rather
  than replacing it with a generic readiness summary. It may store a durable reference to the full
  evidence object, or embed an object that is validated by the current cutover validators. Do not
  copy only a hand-picked subset of fields.
- Include control-plane observability evidence as a named resource/status concept, including the
  generated `aws-ec2-control-plane-observability@1` profile by durable reference or validator-backed
  embedded object. It must preserve `logSink`, `unitLogRouting`, history, exact required alarm IDs
  (`service-down`, `readiness-failure`, `missing-worker-heartbeat`, `queue-backlog`, and
  `repeated-worker-crash`), and a secret-safe operator observability view.
- Include mini migration preflight evidence as a named admission/readiness concept when required by
  a mini cloud-shaped profile, preserving validator-backed state sync, restore, rollback, and
  durable table migrated-row evidence for `submissions`, `queue`, `control_plane_audit_events`,
  `current_stage_state`, `deploy_records`, and `idempotency` before protected/shared work can queue.
  Preserve the `miniMigrationEvidence` request gate before queueing.
- Record resource identity rules, reference rules, source locations, authority boundaries, and
  provider capability bindings in machine-checkable fixtures.
- Keep current deployment behavior unchanged.

### 3. External prerequisites

- None.

### 4. Tests to be added

- Taxonomy completeness tests for representative deployment fixtures across existing provider
  families.
- Fixture coverage for every supported deployment query root: `projects/deployments`,
  `projects/apps`, `projects/libs`, `sandbox/deployments`, `sandbox/apps`, and `sandbox/libs`.
- Source-mode-shaped fixture coverage proving the inventory reads viberoots-owned workspace state
  without writing consumer source.
- Inventory tests proving composite deployment graph reads preserve deployment graph read options
  and keep provider index and node-lock sidecars available to graph/build-system consumers.
- Inventory tests covering Infisical bootstrap graph-first discovery and resolver paths, proving
  they either use `deploymentGraphReadOptions` plus `readCompositeGraph` or are explicitly
  classified out of the resource graph export scope.
- Local override fixtures proving redacted override evidence is retained, selected context/control
  plane override paths are visible, and `VBR_DISALLOW_LOCAL_OVERRIDES=1` fails closed.
- Runtime-state inventory fixtures for execution snapshots, deploy runs, run actions, current stage
  state, retained evidence, stage history, and audit records.
- Named remote control-plane profile fixtures for successful `--remote <name>` selection and
  fail-closed missing, invalid, or context-selected override profiles.
- Service-client profile fixtures for explicit profile, profile root, lane-policy default profile,
  token environment resolution, and rejection when a deployment context-selected control plane is
  present.
- Target-exception and lane-governance fixtures proving safety fields, admission fingerprints,
  source-ref policies, trusted reporters, approval boundaries, and fail-closed validation are
  represented.
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
  deployment contexts, selected control planes, provisioners, artifacts, execution snapshots, runs,
  stage state, artifact challenges, upload sessions, selected control-plane readiness evidence,
  source-ref policies, lane governance, target exceptions, and service-client profile selection.
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
  - `metadata.uid` as the canonical stable resource identity
  - `metadata.labels`
  - `metadata.ownerReferences`
  - `spec`
  - `statusRef` as the canonical link to read-model/runtime status
  - `evidenceRef`
  - `policyRefs`
  - `source`
- Generate envelopes from existing extracted deployment contracts as an additive output.
- Generate envelopes through the same deployment extraction graph-read path used by PR-1
  inventory, including deployment graph read options and composite graph reads. Envelope IDs and
  refs must not come from a divergent graph reader, and provider index/node-lock sidecars must stay
  available to graph/build-system consumers through the shared reader.
- Add an admitted/runtime envelope contract for runtime facts that PR-4B will index, including
  `ExecutionSnapshot`, `DeployRun`, `RunAction`, `CurrentStageState`, `RetainedEvidence`,
  `StageHistoryEntry`, `AuditEvent`, `ArtifactChallenge`, `StaticWebappUploadSession`,
  `StagedArtifact`, `ArtifactBindingProvenance`, `CleanupEvidence`, `ControlPlaneRuntime`, and
  `ControlPlaneReadinessEvidence`, `RuntimeInput`, `AuthProviderProfile`,
  `ControlPlaneObservabilityEvidence`, and `MiniMigrationPreflightEvidence`. Runtime envelopes are
  derived from admitted control-plane records and must not become a mutation API.
- Preserve current deployment extraction outputs used by active deploy flows.
- Define stable identity and ownership rules for the resource kinds introduced in PR-1.
- Define one canonical identity contract and one canonical status-reference contract. Do not leave
  envelope producers free to choose between incompatible identity or inline-status shapes.
- Ensure requirement resources reference secret/runtime-config declarations and evidence only, not
  raw secret values.
- Envelope source metadata must distinguish reviewed Buck intent, resolved deployment-context facts,
  redacted local override facts, graph-first workspace facts, and admitted runtime facts so later
  read models can explain authority without adding a second authoring path.
- Stable `metadata.uid` values for repo-owned Buck intent must derive from canonical labels and
  resource facts, not absolute active-source paths, materialized flake paths, or submodule checkout
  paths.

### 3. External prerequisites

- PR-1 taxonomy and inventory should be available.

### 4. Tests to be added

- Envelope schema tests for every PR-1 resource kind that is extractable from Buck metadata.
- Snapshot tests proving stable IDs, owner references, policy refs, source refs, and evidence refs.
- Envelope generation tests proving composite graph reads use the shared read/options surface, keep
  provider index and node-lock sidecars available, and produce the same IDs/refs as the
  inventory/export path.
- Snapshot tests for deployment-context and selected-control-plane envelopes, including secret-safe
  token references and fail-closed invalid profile cases.
- Snapshot tests proving local override evidence is redacted, source metadata preserves override
  authority, and disallowed local overrides fail closed before envelope output is trusted.
- Source-mode parity tests proving repo-owned Buck intent UIDs and source refs stay stable across
  current source-mode terms: remote materialized flake/source-store paths, local self/pre-extraction
  activation where `.viberoots/current -> ..`, and local sibling/submodule activation such as
  `.viberoots/current -> ../viberoots`.
- Snapshot tests proving service-client selection evidence preserves selected name, URL, token ref,
  and selection source without exposing raw token values.
- Runtime-envelope schema tests for `ExecutionSnapshot`, `DeployRun`, `RunAction`,
  `CurrentStageState`, `RetainedEvidence`, `StageHistoryEntry`, `AuditEvent`,
  `ArtifactChallenge`, `StaticWebappUploadSession`, `StagedArtifact`, `ArtifactBindingProvenance`,
  `CleanupEvidence`, `ControlPlaneRuntime`, `ControlPlaneReadinessEvidence`,
  `RuntimeInput`, `AuthProviderProfile`, `ControlPlaneObservabilityEvidence`, and
  `MiniMigrationPreflightEvidence`, including tests that runtime envelopes are derived from admitted
  records rather than accepted as user-authored input.
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
- Runtime facts needed by PR-4B have a canonical envelope contract before read-model indexing
  begins.
- Repo-owned Buck intent UIDs are stable across supported viberoots source modes.

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

## PR-3: Resource graph workspace export from Buck-reviewed inputs

### 1. Intent

Make a zx workspace-state export command materialize a deterministic resource graph from
Buck-reviewed deployment intent while preserving Buck as the compiler and authority for repo-owned
resources.

### 2. Scope of changes

- Add a user-facing `viberoots resource-graph export` zx workspace-state export command that emits
  the PR-2 envelopes and graph edges for reviewed deployment intent as regenerable
  `.viberoots/workspace` state. Buck/Nix may produce declared artifacts consumed by the exporter,
  but `.viberoots/workspace` materialization must be performed by the zx glue/export command with no
  Buck action side effects.
- Model `resource-graph` as a top-level `viberoots` command with `export` subcommand metadata, or
  extend the CLI metadata/completion model for nested subcommands before wiring the command. Cover
  `viberoots help resource-graph`, `viberoots resource-graph --help`,
  `viberoots resource-graph export --help`, bash/zsh completion at the second token, dispatch for
  `export`, and errors for missing or unknown subcommands. Use `build-tools/tools/lib/cli.ts` for
  parsing.
- Derive graph edges from Buck metadata and existing deployment extraction, not from ad hoc
  filesystem scanning.
- Include edges between deployments, components, provider targets, policies, requirements,
  deployment contexts, selected control planes, deployment target exceptions, provisioners, artifact
  inputs, and source metadata.
- Reuse the existing graph path constants, composite graph reader, deployment query,
  deployment-context resolver, and deployment extraction helpers. Inventory and export paths must
  use the deployment extraction graph-read path, including deployment graph read options and
  composite graph reads, while preserving provider index and node-lock sidecar availability for
  graph/build-system consumers. Graph-first behavior must compose through those helpers, and Buck
  fallback may only appear where the existing helpers already support regeneration or query
  fallback. The export must not create a second reader for `.viberoots/workspace/buck/graph.json` or
  a second deployment-root discovery model.
- Migrate or classify graph-first deployment discovery/resolution paths that still read raw
  `graph.json`, including Infisical bootstrap deployment discovery and resolver flows, before the
  exporter relies on graph-first behavior. Any migrated path must use `deploymentGraphReadOptions`
  plus `readCompositeGraph`.
- Extend `tooling-contract-check` so deployment/resource-graph code cannot introduce raw graph reads
  through `DEFAULT_GRAPH_PATH`, `.viberoots/workspace/buck/graph.json`, or equivalent constants
  outside the reviewed composite-reader allowlist.
- Extract the supported deployment query roots and Buck query expression into a shared helper before
  wiring the exporter if they are still private to the deployment query module.
  `listDeploymentTargets`, `ensureGraph` calls, and the resource graph export path must use the same
  helper.
- Add deterministic ordering, schema versioning, and stable output paths.
- Add resource-graph workspace constants to `workspace-state-paths`, including a resource-graph
  state directory and default envelope/node/edge output paths. Export, cleanup, and regeneration
  tests must use those constants rather than ad hoc `.viberoots/workspace` strings.
- Keep graph export paths under `.viberoots/workspace/**` as regenerable output unless a specific PR
  documents a control-plane storage path. Do not write graph output under `projects/**`, generated
  provider roots, or ad hoc repo-root files.
- Classify each graph export artifact as either regenerable workspace state or durable
  control-plane storage. Regenerable workspace outputs must survive `viberoots gc` only by being
  reproducible; durable control-plane state must not be placed under `.viberoots/workspace`.
- Update `planViberootsGc` to classify and remove resource-graph workspace outputs through the new
  `workspace-state-paths` constants, with dry-run and execution coverage. If implementation evidence
  shows GC should not collect those outputs yet, document that decision in this PR and adjust tests
  to prove `viberoots gc` leaves them intentionally.
- Use `workspace-state-paths` logical paths for export, cleanup, and regeneration assertions. Tests
  must tolerate the local self/pre-extraction layout where `.viberoots/workspace/buck` resolves
  through the `.viberoots/buck` real storage symlink.
- Keep the export read-only. It must not mutate control-plane records, provider state, generated
  provider files, deployment metadata, or consumer-owned project configuration.

### 3. External prerequisites

- PR-2 resource envelope generation should be available.

### 4. Tests to be added

- Buck fixture tests proving representative deployment targets export deterministic resource graph
  documents.
- Snapshot tests for graph nodes and edges.
- Tests proving graph-first discovery and Buck query fallback produce the same resource graph for
  equivalent deployment fixtures for helpers that support both paths. Where the current deployment
  query path is Buck-query-only, PR-3 must either layer graph-first discovery on the existing
  composite graph reader and shared query-root helper or scope equivalence tests to existing
  graph-first discovery helpers.
- Tests covering Infisical bootstrap deployment discovery/resolver graph reads, proving migrated
  paths use `deploymentGraphReadOptions` plus `readCompositeGraph`, and any intentionally unmigrated
  path is classified out of resource graph export scope.
- Tooling-contract tests proving raw graph reads through `DEFAULT_GRAPH_PATH`,
  `.viberoots/workspace/buck/graph.json`, or equivalent constants fail outside the reviewed
  composite-reader allowlist.
- Tests proving every supported deployment query root is handled through the existing query-root
  helpers.
- Tests proving the inventory/export path uses composite deployment graph reads and preserves
  provider index and node-lock sidecar availability for graph/build-system consumers.
- GC classification tests proving workspace graph output is regenerable cleanup state and durable
  control-plane graph state is outside `.viberoots/workspace` cleanup scope, including
  `viberoots gc --dry-run` and execution behavior for the resource-graph workspace constants.
- Source-mode path tests for remote store/source paths, local self/pre-extraction `..`, and local
  sibling/submodule `../viberoots` activation, proving export and cleanup use
  `workspace-state-paths` logical paths while tolerating `.viberoots/buck` real storage.
- Workspace-path tests proving resource-graph state directory and default envelope/node/edge output
  paths are exported from `workspace-state-paths` and used by the exporter.
- Command wiring tests for `viberoots resource-graph export`, covering top-level `resource-graph`
  command metadata, `export` subcommand help/completion metadata, dispatch wiring, CLI parsing,
  bash/zsh completion at the second token, and missing or unknown subcommand errors.
- Negative tests for invalid labels, missing provider targets, invalid policy refs, and unsupported
  requirement refs.
- Tests proving the export path does not introduce hand-authored resource YAML or bypass Buck
  metadata.

### 5. Docs to be added or updated

- Document `viberoots resource-graph export`, output schema, and intended consumers.
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

## PR-4A: Control-plane resource graph read-model schema and minimal status

### 1. Intent

Add the non-authoritative control-plane resource graph schema and minimum secret-safe status surface
without replacing deployment-specific mutation tables.

### 2. Scope of changes

- Add database schema and service plumbing for a read-only resource graph index.
- Index extracted intent envelopes enough to list resource graph nodes and basic edges. PR-4A may
  create placeholder schema for runtime envelopes, but it must not ingest or expose runtime facts
  beyond an explicit unindexed/pre-read-model marker.
- Index secret-safe build source-selection metadata present on extracted intent envelopes or
  exported graph facts, including `nixpkgs_profile`, normalized `nixpkg_pins` profile names, and a
  durable source-plan or manifest reference when the build-system export provides one. PR-4A should
  record profile names and normalized attr/profile links, not raw nixpkgs commits, raw flake URLs, or
  package compatibility interpretations.
- Expose minimum read-only API or CLI status surfaces for listing extracted intent graph nodes and
  basic edges.
- Extend the existing read pipeline rather than adding a parallel graph status path. Minimum status
  must compose with both current HTTP read-route families: `webUi.basePath`-mounted
  `/api/v1/read/*` for web/UI reads and the deployment client routes `/api/v1/status`,
  `/api/v1/records`,
  `/api/v1/current-stage-state`, `/api/v1/stage-history`, and `/api/v1/stage-state-audit`.
  Implementers must either extend both families or bridge CLI/deploy-client reads onto
  the `webUi.basePath`-mounted `/api/v1/read/*` route, while preserving schema versions, request
  IDs, service-token and browser-session auth contexts, redaction, durable audit rows, and prefixed
  web UI reads such as `/ops/api/v1/read/*`. MCP is a separate JSON-RPC endpoint mounted at
  `mcp.basePath` and must receive matching resource/tool behavior and audit coverage where it
  exposes deployment reads.
- Preserve direct authenticated service probes used as readiness evidence, including
  `GET /api/v1/worker-heartbeats`; do not replace them with only web/UI graph reads.
- Preserve existing authoritative deployment/control-plane tables. At minimum this includes
  `submissions`, `queue`, `locks`, `snapshots`, `artifact_challenges`, `run_actions`,
  `artifact_cleanup_janitor_records`, `artifact_objects`, `worker_heartbeats`,
  `control_plane_web_sessions`, `deployment_auth_sessions`, `static_webapp_upload_sessions`,
  `current_stage_state`, `stage_state_history`, `stage_state_audit_events`,
  `control_plane_audit_events`, `deploy_records`, and `idempotency`. Any current table that PR-4A
  intentionally leaves out of graph indexing must still be explicitly classified as preserved and
  authoritative.
- Do not add generic resource mutation APIs in this PR.
- Define migration and backfill behavior explicitly. If existing control-plane records are not
  backfilled, document that decision and make status output distinguish pre-read-model records from
  records with indexed graph facts.

### 3. External prerequisites

- PR-3 resource graph export should be available.
- The nixpkgs source-selection plan should be implemented through the remote/cache and consumer
  workspace parity work, so PR-4A can index the final source-selection graph fields and source-plan
  evidence rather than an interim shape.

### 4. Tests to be added

- Database migration tests for the resource graph read-model schema.
- Migration/backfill tests, including the explicit non-backfill case if older control-plane records
  remain unindexed.
- Schema-derived preservation tests proving PR-4A's preserved-table classification matches the
  current backend schema table IDs, and that any table not indexed by the graph remains explicitly
  preserved and authoritative.
- Read-pipeline tests for listing extracted-intent deployments, policies, provider targets,
  components, artifacts, and basic graph edges through `webUi.basePath`-mounted `/api/v1/read/*`,
  the existing deployment client read routes, CLI, MCP, and web UI surfaces that currently expose
  deployment reads.
- Tests proving resource graph reads preserve schema versions, `x-request-id` propagation,
  service-token/browser-session auth-context behavior, redaction, and durable audit rows.
- Tests proving runtime records are either absent from PR-4A status or explicitly marked
  unindexed/pre-read-model until PR-4B ingests them.
- Source-selection fixture tests proving extracted intent with a non-default `nixpkgs_profile` and a
  normalized `nixpkg_pins` map indexes profile names, attr/profile links, and source-plan refs
  without exposing raw commits or treating pins as compatibility policy.
- Secret-safety tests for minimum status output.
- Regression tests proving deployment submission, idempotency, queueing, locking, and stage-state
  mutation still use deployment-specific invariants.

### 5. Docs to be added or updated

- Document the read-model schema, minimum status API/CLI, and which tables remain authoritative for
  mutation.
- Update operator docs with the new resource graph status commands or endpoints.

### 5.5. Expected regression scope

- `deployment-only`
- Include database/control-plane integration validation because this PR touches runtime state.

### 6. Acceptance criteria

- Operators can list extracted-intent deployments, policies, provider targets, components,
  deployment target exceptions, and artifacts as resource graph nodes.
- Operators can see basic graph edges without using a generic mutation path.
- Operators can see secret-safe source-selection evidence for extracted intent when the build graph
  supplies it.
- Read-model output is secret-safe.
- Deployment-specific mutation invariants remain authoritative.

### 7. Risks

- A generic read-model table may be mistaken for the source of truth.

### 8. Mitigations

- Name and document the read model as non-authoritative for mutation.

### 9. Consequences of not implementing this PR

The resource graph would exist only as build output and would not improve control-plane status or
operator understanding.

### 10. Downsides for implementing this PR

It adds schema and operational complexity before adding new resource kinds.

## PR-4B: Control-plane resource graph runtime linking and rich status

### 1. Intent

Populate the PR-4A read model with admitted runtime facts, retained evidence, selected
control-plane evidence, and richer status links while keeping deployment-specific mutation tables
authoritative.

### 2. Scope of changes

- Ingest or persist admitted resource envelopes and graph edges where they improve status and
  linkage.
- Link deployments, provider targets, policies, artifacts, execution snapshots, deploy runs, current
  stage state, run actions, retained render evidence, retained artifact evidence, and stage history
  through stable resource IDs.
- Link execution snapshots, retained artifact evidence, source snapshots, and cache-manifest records
  to the source-plan evidence produced by the build system when that evidence is available. The read
  model should preserve the selected target's `nixpkgs_profile`, normalized pin attr/profile links,
  and source-plan reference needed to explain exact-artifact replay, without copying raw nixpkgs
  commits into default status output.
- Link deployment target exceptions to affected deployments, provider target changes, shared lock
  scopes, approval evidence, and status output while preserving their fail-closed validation
  behavior.
- Index all durable run-action requests as `RunAction` resources, and preserve the current
  submission-level `latestAction` status as a derived pointer to the latest indexed run action.
  Derive `latestAction` from immutable request time `request_json.submittedAt`, with `action_id` as
  the deterministic tie-break. If an idempotent request reuses an existing action, preserve the
  original submitted time and identity rather than treating mutable update timestamps as new action
  ordering evidence.
- Add the persistence or migration change needed so idempotent run-action reuse does not overwrite
  the original request document or submitted time used for ordering.
- Link deployment contexts and selected control-plane profiles as graph nodes where they improve
  status, authority tracing, and operator diagnostics.
- Preserve redacted local override evidence and selected context/control-plane override paths in
  status. The read model must preserve `VBR_DISALLOW_LOCAL_OVERRIDES=1` fail-closed behavior and
  must not turn local overrides into accepted reviewed intent.
- Preserve service-client selection evidence in status, including source `context`,
  `explicit_override`, `explicit`, or `ambient`, selected control-plane URL, and selected
  control-plane name or token ref only when those fields exist. Do not backfill raw token values or
  ambient token material into the read model.
- Preserve named remote control-plane profile evidence for `--remote <name>`, including the selected
  profile name, resolved URL, token ref, and fail-closed missing or invalid profile diagnostics.
  Preserve the current fail-closed rejection when `--remote <name>` attempts to override a
  deployment context-selected control plane.
- Preserve local service-client profile evidence for non-context deployments, including profile
  name, profile root, default-profile source, and token environment contract without storing raw
  token values.
- Treat the current retained evidence contract as the initial read-model scope:
  `retainedRenderEvidence` kinds `replay_snapshot`, `provider_config`, `provisioner_plan`, and
  `execution_snapshot`; and `retainedArtifactEvidence` fields `identity`, `storedArtifactPath`, and
  `provenancePath`.
- Expose read-only API or CLI status surfaces for listing graph nodes, graph edges, and current
  secret-safe status.
- Route rich graph status through the existing control-plane read pipeline, including
  `webUi.basePath`-mounted `/api/v1/read/*`, the existing deployment client read routes
  (`/api/v1/status`, `/api/v1/records`, `/api/v1/current-stage-state`, `/api/v1/stage-history`, and
  `/api/v1/stage-state-audit`), CLI, MCP resources/tools, and web UI surfaces where deployment reads
  already exist. Do not introduce an alternate endpoint or CLI-only path that bypasses auth-context
  grants, schema-versioning, request IDs, redaction, or audit.
- Link artifact challenge facts into graph status without changing the authoritative admission flow:
  challenge issuance, nonce/proof-key validation outcome, one-time consumption, admitted artifact
  provenance, and failure diagnostics.
- Link static-webapp upload-session facts separately from artifact challenge semantics: archive
  session identity, submission binding, archive format, archive path/object identity, digest,
  `sizeBytes`, expiry, optional object-store payload reference, `upload-session:<id>` provenance,
  and rejected staged-upload cleanup diagnostics, including existing
  `artifact_cleanup_janitor_records` when those records are present. Defer future
  expired-upload-session sweeper evidence for
  `static_webapp_upload_sessions.expires_at` until a separate PR adds a durable sweeper record path.
- Link runtime input evidence into graph status as a named reviewed concept by durable reference to
  the full `cloud-control-runtime-input@1` object or by embedding an object validated by the current
  runtime-input contract, preserving provenance, auth-provider binding, and Infisical deployment
  bindings.
- Link selected control-plane runtime/readiness evidence into graph status for protected/shared
  deployments, including setup-doctor results, conformance checklist status, setup bundle evidence,
  managed dependency evidence, credential preflight/staging, image publication evidence, runtime
  HTTP evidence, selected provider capability evidence, provider capability hook evidence, latest
  non-production deployment evidence, credential rotation, trusted runtime-config deployment IDs and
  worker counts, auth-provider profile evidence, auth callback/UI/MCP read health,
  worker-heartbeats probe evidence, standby evidence, operation-specific
  rollback/restore/break-glass evidence, operation audit evidence, cutover evidence, and mini
  migration preflight evidence when required before protected/shared queueing.
- Link auth-provider profile evidence into graph status as a named secret-safe concept by durable
  reference to the full `cloud-control-auth-provider-profile@1` object or by embedding an object
  validated by `validateAuthProviderProfile`.
- Link control-plane observability evidence into graph status as a named secret-safe concept by
  durable reference to the generated `aws-ec2-control-plane-observability@1` profile or by embedding
  a validator-backed object preserving `logSink`, `unitLogRouting`, history, exact required alarm
  IDs (`service-down`, `readiness-failure`, `missing-worker-heartbeat`, `queue-backlog`, and
  `repeated-worker-crash`), and operator observability view.
- Link mini migration preflight evidence into graph status as a named admission/readiness concept
  when a mini cloud-shaped profile requires it, preserving validator-backed state sync, restore,
  rollback, and durable table migrated-row evidence.
- Graph status for cutover readiness must either durably reference the full current
  `CutoverEvidence` object or embed an object validated by the current cutover validators. It must
  not preserve only a hand-picked subset of cutover fields.
- Do not add generic resource mutation APIs in this PR.

### 3. External prerequisites

- PR-4A read-model schema and minimum status should be available.

### 4. Tests to be added

- Service tests proving read-model writes are derived from admitted or extracted resource facts.
- Status tests proving retained render evidence, retained artifact evidence, deployment-context
  selection, and selected control-plane metadata are secret-safe and linked to the expected resource
  IDs.
- Status tests proving local override evidence is redacted, override authority paths are visible,
  and `VBR_DISALLOW_LOCAL_OVERRIDES=1` rejects local overrides before status treats them as accepted
  graph facts.
- Status tests proving selected control-plane source values are preserved and reported without
  allowing ambient or explicit overrides to hide deployment-context-selected authority.
- Status tests proving selected control-plane name and token ref are optional by source and that raw
  token material is never backfilled into graph status.
- Status tests proving build source-plan evidence from execution snapshots, retained artifact
  evidence, source snapshots, and cache manifests links to the expected resource IDs, preserves
  `nixpkgs_profile` and normalized pin attr/profile links, and does not expose raw nixpkgs commits
  by default.
- Status tests for `--remote <name>` profile selection, including successful resolution and
  fail-closed missing, invalid, or context-selected override profile cases.
- Status tests for local service-client profile evidence, including explicit profile, profile-root,
  default profile, token environment contract, and context-selected rejection.
- Status tests for the initial retained evidence contract, covering all retained render evidence
  kinds and retained artifact evidence fields.
- Status tests for artifact challenge resources proving nonce/proof-key validation outcomes are
  visible, raw proof keys are redacted, one-time consumption is visible, and failed challenges do
  not appear as admitted artifacts.
- Status tests for static-webapp upload-session resources proving digest, expiry, optional
  object-store payload refs, submission binding, archive format, archive path/object identity,
  `sizeBytes`, `upload-session:<id>` provenance, and existing rejected staged-upload cleanup
  diagnostics are visible without assigning challenge proof semantics to upload sessions. Tests must
  include existing `artifact_cleanup_janitor_records` when present, and prove future expired-upload-
  session sweeper evidence is not claimed until a durable sweeper record exists.
- Status tests for selected control-plane runtime/readiness evidence covering setup bundles, managed
  dependencies, credential preflight/staging, image publication, runtime HTTP, selected provider
  capabilities, provider capability hooks, latest non-production deployment evidence, conformance
  checklist status, setup-doctor results, credential rotation, trusted runtime-config deployment IDs
  and worker counts, auth-provider profile evidence, auth callback/UI/MCP read health,
  worker-heartbeats probe evidence, standby evidence, operation-specific
  rollback/restore/break-glass evidence, operation audit evidence, and cutover evidence.
- Status tests for runtime input evidence proving graph status either durably references the full
  `cloud-control-runtime-input@1` object or embeds an object validated by the current runtime-input
  contract, preserving provenance, auth-provider binding, Infisical deployment bindings, and secret
  safety.
- Status tests for auth-provider profile evidence proving graph status either durably references the
  full `cloud-control-auth-provider-profile@1` object or embeds an object validated by
  `validateAuthProviderProfile`, including secret safety.
- Status tests for control-plane observability evidence proving graph status either durably
  references the generated `aws-ec2-control-plane-observability@1` profile or embeds a
  validator-backed object preserving `logSink`, `unitLogRouting`, history, exact required alarm IDs,
  secret safety, and operator observability view.
- Status tests for mini migration preflight evidence proving protected/shared graph status preserves
  state sync, restore, rollback, and durable table migrated-row evidence for `submissions`, `queue`,
  `control_plane_audit_events`, `current_stage_state`, `deploy_records`, and `idempotency` when the
  selected mini cloud-shaped profile requires `miniMigrationEvidence` before queueing work.
- Read-pipeline tests proving rich graph status preserves `webUi.basePath`-mounted `/api/v1/read/*`,
  existing deployment client read routes, CLI, MCP, and web UI behavior, including schema versions,
  `x-request-id`, auth-context grants, redaction, and audit.
- Readiness-probe tests proving `GET /api/v1/worker-heartbeats` remains available as an
  authenticated service probe and feeds the expected typed runtime HTTP evidence.
- Status tests for `RunAction` links covering approval, cancel, resume, and abort actions without
  creating a generic resource mutation bypass.
- Status tests proving all durable run-action requests remain inspectable, `latestAction` resolves
  to the expected indexed `RunAction`, idempotent reused actions preserve their original ordering
  identity, and the submitted-at/action-id ordering rule is deterministic.
- Persistence tests proving an idempotent run-action reuse does not move the backend row's request
  document, submitted time, or derived `latestAction` ordering.
- Secret-safety tests for status output.
- Regression tests proving deployment submission, idempotency, queueing, locking, and stage-state
  mutation still use deployment-specific invariants.

### 5. Docs to be added or updated

- Document the read-model schema, status API/CLI, and which tables remain authoritative for
  mutation.
- Update operator docs with the rich resource graph status commands or endpoints.

### 5.5. Expected regression scope

- `deployment-only`
- Include database/control-plane integration validation because this PR touches runtime state.

### 6. Acceptance criteria

- Operators can list deployments, policies, provider targets, components, artifacts, artifact
  challenges, upload sessions, selected control-plane readiness evidence, and current state as
  resource graph nodes.
- Operators can see edges between deployments, policies, provider targets, artifacts, execution
  snapshots, deploy runs, run actions, retained evidence, deployment target exceptions,
  deployment-context selection, selected control planes, and stage state.
- Operators can see the selected control-plane source and retained evidence references needed to
  explain the current stage without exposing raw credentials or secret-bearing payloads.
- Operators can trace build source-plan evidence from extracted intent through retained artifact or
  execution evidence where the build-system source-selection manifest is available.
- Read-model output is secret-safe.
- Deployment-specific mutation invariants remain authoritative.

### 7. Risks

- Read-model ingestion could become coupled to provider mutation timing.

### 8. Mitigations

- Keep ingestion driven by admitted/extracted facts and existing durable events.

### 9. Consequences of not implementing this PR

The resource graph read model would have schema and basic listings but would not explain runtime
state, evidence, selected control planes, or retained artifacts well enough for operators.

### 10. Downsides for implementing this PR

It adds ingestion and linking complexity after the minimum read model exists.

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
- Include retained render evidence and retained artifact evidence from current stage state when
  those facts are available and secret-safe.
- Preserve links from provider evidence to build source-plan evidence only where provider status is
  already explaining a built artifact or execution snapshot. Provider normalization must not infer
  nixpkgs compatibility, drift, or support semantics from `nixpkgs_profile` or `nixpkg_pins`.
- Normalize retained render evidence only for the current initial kinds `replay_snapshot`,
  `provider_config`, `provisioner_plan`, and `execution_snapshot`, and retained artifact evidence
  only for `identity`, `storedArtifactPath`, and `provenancePath`, until a later PR extends the
  contract deliberately.
- Define a provider evidence matrix for every reviewed provider family. Providers that cannot
  support a normalized field must have an explicit deferred or unsupported entry and fail-closed
  tests.
- Link provider evidence to deployments, provider targets, execution snapshots, deploy runs, and
  current stage state in the PR-4B read model.
- Preserve provider-specific adapters and fail-closed behavior for unsupported semantics.
- Do not collapse provider state into a false universal cloud model.

### 3. External prerequisites

- PR-4B read model should be available.

### 4. Tests to be added

- Provider capability registry tests proving supported semantics are explicit for representative
  providers.
- Evidence normalization tests for at least two materially different provider families.
- Matrix completeness tests proving every reviewed provider family is either normalized for the
  relevant evidence field or explicitly marked unsupported/deferred with fail-closed behavior.
- Evidence normalization tests for retained render evidence and retained artifact evidence that
  distinguish stable evidence references from raw secret-bearing payloads.
- Evidence tests proving provider status may link to source-plan evidence for built artifacts but
  does not classify source-selection choices as provider compatibility facts.
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
- Link provisioner resources to deployments, provider targets, existing admission/policy facts,
  execution snapshots, and current stage state where applicable. Do not add first-class policy
  resource refs in PR-6; PR-7 owns those refs for provisioners.
- Bind approval and policy-related provisioner facts only to existing admission facts in this PR.
  First-class policy resource IDs and versions remain PR-7 scope.
- Ensure OpenTofu remains a provisioner and evidence system for durable cloud infrastructure, not
  the sole source of resource intent.
- Ensure all OpenTofu tooling remains Nix-provided.
- Preserve source-plan evidence for Nix-provided OpenTofu tooling and provisioner artifacts when
  the build-system source-selection manifests expose it. Provisioner status should report the
  selected profile or pin evidence needed for replay diagnostics, not raw nixpkgs commits or a
  provisioner-specific source-selection model.
- Preserve reviewed plan/apply/evidence workflows.

### 3. External prerequisites

- PR-4B read model should be available.
- PR-5 provider evidence conventions must be available.

### 4. Tests to be added

- OpenTofu fixture tests for stack identity, state backend identity, plan artifacts, apply artifacts,
  evidence artifacts, and approval binding.
- Graph-link/status-link tests proving provisioner resources link to deployments, provider targets,
  existing admission/policy facts, execution snapshots, and current stage state where applicable,
  without adding first-class policy resource refs before PR-7.
- Replay compatibility tests for provisioner evidence.
- Tests proving Nix provides OpenTofu tooling for these paths.
- Tests proving OpenTofu tooling and provisioner artifact evidence can link to build-system
  source-plan evidence without duplicating the nixpkgs source-selection registry or resolver.
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

- Complete policy-resource binding for the first-class policy envelopes and read-model nodes already
  introduced by PR-1 through PR-4B:
  - lane policy
  - lane governance policy
  - admission policy
  - readiness gate policy
  - attestation policy
  - SBOM policy
  - supply-chain policy
  - rollout policy
  - preview policy
  - smoke policy
  - source-ref policy where applicable
- Add any remaining policy resource shapes needed for first-class binding that PR-1 intentionally
  left as existing contract fields, including release-action policy and provider capability policy,
  before binding those IDs into admission snapshots or read-model status.
- Bind policy resource IDs and versions into deployment admission snapshots and status output.
- Bind policy resource IDs and versions into provisioner/OpenTofu admission facts and status output
  where PR-6 left approval or policy-related provisioner facts bound only to existing admission
  facts.
- Treat readiness gates, attestation, SBOM, and supply-chain gates as standalone policy resource
  kinds matching the PR-1 taxonomy, not optional `AdmissionPolicy` subresource shapes.
- Ensure policy refs are stable and traceable from deployments, provider targets, execution
  snapshots, deploy runs, provisioner resources, and current stage state.
- Preserve existing policy-specific logic where it enforces safety.
- Do not introduce broad new policy expressiveness in this PR; the first milestone is consistency.

### 3. External prerequisites

- PR-4B read model should be available.
- PR-5 provider capability resource conventions should be available.
- PR-6 provisioner resource integration should be available.

### 4. Tests to be added

- Admission tests proving policy resource IDs and versions are included in snapshots.
- Provisioner admission/status tests proving policy resource IDs and versions bind to OpenTofu
  provisioner facts where PR-6 deferred first-class policy identity.
- Admission and status tests for lane governance, target-exception policy effects, readiness gates,
  attestation, SBOM, and supply-chain gate evidence.
- Admission and status tests proving release-action policy identity/version binding is present for
  release-action decisions and remains fail-closed for missing, stale, or incompatible refs.
- Admission and status tests proving provider-capability policy identity/version binding is present
  for provider eligibility decisions and remains fail-closed for missing, stale, unsupported, or
  incompatible capability policy refs.
- Fail-closed tests for missing, stale, unsupported, or incompatible policy refs.
- Status/read-model tests proving policies are addressable and linked to deployments and runs.
- Status/read-model tests proving policy resources are linked to provisioners where applicable.
- Regression tests for protected/shared approval, rollout, preview, smoke, rollback, and
  release-action behavior.

### 5. Docs to be added or updated

- Update deployment policy documentation with policy resource identities, versioning, refs, and
  status output.
- Document release-action policy and provider-capability policy resource shapes, identity/version
  rules, and fail-closed binding behavior.
- Document that policy resources are consistency and traceability surfaces, not a new permissive
  policy language.

### 5.5. Expected regression scope

- `deployment-only`
- Include protected/shared deployment validation because admission snapshots and policy behavior are
  in scope.

### 6. Acceptance criteria

- Existing policies are first-class resource graph nodes.
- Deployment admission records the policy IDs and versions it relied on.
- Provisioner/OpenTofu admission and status records policy IDs and versions where applicable.
- Release-action policy and provider-capability policy shapes have identity/version binding,
  status/read-model coverage, and fail-closed tests.
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
- Preserve `GET /api/v1/worker-heartbeats` as the current direct authenticated service probe used by
  runtime HTTP readiness evidence; graph status may link to this evidence but must not replace the
  probe.
- Expose this worker evidence through a secret-safe status command or API.
- Link worker evidence to deploy runs and execution snapshots where the existing control-plane
  model already knows the relationship.
- Add a decision gate that records whether current workflows justify a future `WorkerPool` resource.
- The decision gate must be a machine-checked record or fixture with allowed outcomes:
  `defer`, `propose-worker-pool`, or `needs-more-evidence`. It must name the evidence inputs used
  for the decision and fail if required evidence is missing.
- `propose-worker-pool` is valid only when the record names a concrete workflow class and the
  required evidence supporting that class. `defer` and `needs-more-evidence` must preserve the
  no-scheduler boundary.
- Do not implement generic placement, dependency-aware scheduling, worker enrollment, or a new
  remote execution engine.

### 3. External prerequisites

- PR-4B read model should be available.

### 4. Tests to be added

- Worker heartbeat/status tests for healthy, expired, missing, and mismatched worker authority.
- Worker heartbeat probe tests for `GET /api/v1/worker-heartbeats`, including authentication,
  redaction, and typed runtime HTTP evidence output.
- Decision record schema tests for allowed outcomes, invalid outcomes, required evidence inputs, and
  missing-evidence failure.
- Decision semantics tests proving `propose-worker-pool` fails without a concrete workflow class
  and supporting evidence, and proving `defer` and `needs-more-evidence` do not authorize scheduler
  work.
- Read-model tests proving worker evidence links to runs and snapshots without becoming
  authoritative for provider mutation.
- Secret-safety tests for worker status output.
- Negative tests proving status-only worker evidence does not authorize work without the existing
  claim, lease, and fencing checks.

### 5. Docs to be added or updated

- Document worker evidence status output and the exact decision criteria for a future `WorkerPool`
  resource.
- Document the decision record schema, allowed outcomes, required evidence inputs, and failure mode.
- Update architecture docs to state that WorkerPool remains deferred until a concrete workflow
  requires it.

### 5.5. Expected regression scope

- `deployment-only`
- Include control-plane worker/queue tests because worker claims and leases are in scope.

### 6. Acceptance criteria

- Operators can inspect secret-safe worker evidence linked to runs.
- Existing claim, lease, lock, and fencing semantics remain authoritative.
- The repo has a checked decision gate for whether a future WorkerPool PR is justified.
- The decision gate cannot be satisfied by prose alone.
- Invalid decision outcomes and missing required evidence fail tests.
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

Prove the generalized resource graph direction end to end with one primary protected/shared
deployment flow plus a provisioner-inclusive fixture, while keeping the current deployment
reconciler authoritative.

### 2. Scope of changes

- Wire the resource taxonomy, envelopes, Buck graph export, read model, provider evidence, policy
  resources, and worker evidence into one primary representative deployment path, plus the
  provisioner resources and provisioner policy bindings into the separate provisioner-inclusive
  fixture required below.
- Use a protected/shared Cloudflare Pages static-webapp deployment with selected control-plane
  metadata and exact-artifact replay as the minimum representative path unless an earlier PR records
  a better concrete scenario with equal coverage.
- Ensure the flow covers:
  - reviewed Buck intent
  - deployment context resolution and selected control-plane profile
  - redacted local override evidence and source-mode-stable intent identity
  - target source-selection evidence, including `nixpkgs_profile`, normalized `nixpkg_pins`
    attr/profile links, and source-plan or cache-manifest references when present
  - extracted resource graph
  - artifact challenge outcome, static-webapp upload-session provenance, and artifact binding
  - admitted immutable execution snapshot
  - policy decision
  - selected control-plane runtime/readiness evidence
  - provider or provisioner reconciliation evidence
  - retained render and artifact evidence
  - worker evidence and status links
  - run-action history and derived latest action
  - current stage state
  - stage history
  - audit records
  - resource graph status output
- The representative flow must exercise current deploy, status inspection, and at least one replay
  path such as retry, promotion, or rollback. If preview or provisioner evidence is intentionally
  not part of the chosen scenario, document the exclusion and the fixture or follow-up that covers
  it.
- Add a provisioner-inclusive fixture that proves the PR-6 OpenTofu provisioner resource composes
  with the final graph status path, even if the minimum Cloudflare Pages representative flow remains
  the primary protected/shared scenario.
- Include a target-exception effect and PR-7 policy resource identity/version binding in the
  representative path, so admission snapshots, run/status edges, and fail-closed behavior compose
  end to end.
- Include existing read-surface coverage in the representative path, including `webUi.basePath`-
  mounted `/api/v1/read/*`, the current deployment client read routes, CLI, MCP, and web UI reads
  where those surfaces already expose deployment status. The final graph status path must preserve
  schema versions, `x-request-id`, auth-context grants, redaction, and audit.
- Add operator-facing status that explains the desired-vs-observed path without exposing secrets.
- Keep existing deployment submission, approval, retry, rollback, preview, promotion, queueing,
  locking, and idempotency behavior intact.
- Do not add generic resource mutation APIs or a generic platform scheduler.

### 3. External prerequisites

- PR-1 through PR-8 should be complete, including both PR-4A and PR-4B.
- The nixpkgs source-selection implementation plan should be complete enough that local selected
  builds, filtered selected builds, remote source snapshots, cache manifests, and generated consumer
  workspace flakes produce equivalent source-plan evidence for the representative path.

### 4. Tests to be added

- End-to-end protected/shared deployment fixture covering graph export, admission, execution
  snapshot, evidence recording, stage state, history, audit, and resource status.
- End-to-end assertions covering artifact challenge issuance, nonce/proof-key validation outcome,
  one-time consumption, admitted artifact provenance, and failure diagnostics without exposing proof
  keys or secret-bearing upload data.
- End-to-end assertions covering static-webapp upload-session identity, digest, expiry, optional
  object-store payload reference, submission binding, archive format, archive path/object identity,
  `sizeBytes`, `upload-session:<id>` provenance, and existing rejected staged-upload cleanup
  diagnostics, including existing `artifact_cleanup_janitor_records` when present, without assigning
  proof-key semantics to upload sessions. The test must not require future expired-upload-session
  sweeper evidence until a durable sweeper record exists.
- End-to-end assertions covering selected control-plane runtime/readiness evidence, including setup
  doctor results, conformance checklist status, setup bundles, managed dependencies, credential
  preflight/staging, image publication, runtime HTTP, selected provider capabilities, provider
  capability hooks, latest non-production deployment evidence, credential rotation, trusted
  runtime-config deployment IDs and worker counts, auth-provider profile evidence, auth
  callback/UI/MCP read health, worker-heartbeats probe evidence, standby evidence,
  operation-specific rollback/restore/break-glass evidence, operation audit evidence, and cutover
  evidence, plus mini migration preflight evidence when required by the selected mini cloud-shaped
  profile.
- End-to-end assertions covering mini migration preflight evidence before protected/shared queueing,
  including the `miniMigrationEvidence` request gate, state sync, restore, rollback, and durable
  table migrated-row evidence for `submissions`, `queue`, `control_plane_audit_events`,
  `current_stage_state`, `deploy_records`, and `idempotency`.
- End-to-end assertions covering runtime input evidence, proving graph status either durably
  references the full `cloud-control-runtime-input@1` object or embeds an object validated by the
  current runtime-input contract, preserving provenance, auth-provider binding, Infisical deployment
  bindings, and secret safety.
- End-to-end assertions covering auth-provider profile evidence, proving graph status either durably
  references the full `cloud-control-auth-provider-profile@1` object or embeds an object validated
  by `validateAuthProviderProfile`, including secret safety.
- End-to-end assertions covering control-plane observability evidence, proving graph status either
  durably references the generated `aws-ec2-control-plane-observability@1` profile or embeds a
  validator-backed object preserving `logSink`, `unitLogRouting`, history, exact required alarm IDs,
  secret safety, and operator observability view.
- End-to-end cutover readiness assertions proving graph status either durably references the full
  current `CutoverEvidence` object or embeds an object validated by the current cutover validators.
  The test must fail if graph status preserves only a hand-picked subset of cutover fields.
- End-to-end read-surface assertions proving final graph status is available through existing read
  contracts and preserves `webUi.basePath`-mounted `/api/v1/read/*`, deployment client read routes,
  CLI, MCP, and web UI behavior, including schema versions, `x-request-id`, auth-context grants,
  redaction, and audit.
- End-to-end assertions covering a deployment target exception through policy resource
  identity/version binding, admission snapshot, run/status graph edges, and fail-closed rejection
  when stale or missing.
- End-to-end assertions covering provider-capability policy identity/version binding in the primary
  path's admission snapshots and graph status, including fail-closed behavior for stale, missing,
  unsupported, or incompatible capability refs.
- End-to-end assertions covering supported release-action policy identity/version binding in
  admission snapshots and graph status. If no earlier PR recorded an equal-coverage replacement
  primary path that supports release actions, PR-9 must keep Cloudflare Pages as the primary path,
  treat Cloudflare release actions as negative-only coverage, and add a separate supported
  release-action fixture.
- End-to-end assertions proving worker evidence/status links are visible without authorizing work
  outside existing claim, lease, and fencing checks.
- End-to-end assertions proving `GET /api/v1/worker-heartbeats` remains available as an
  authenticated readiness probe and feeds typed runtime HTTP evidence.
- End-to-end assertions proving all durable `RunAction` resources remain inspectable and
  `latestAction` is derived from indexed run-action history.
- End-to-end assertions proving redacted `projects/config/local.json` override evidence appears in
  graph status, `VBR_DISALLOW_LOCAL_OVERRIDES=1` rejects local override usage, and repo-owned intent
  UIDs and status links stay stable across supported source modes.
- End-to-end assertions proving the representative path can expose source-selection evidence from
  local selected builds, filtered selected builds, remote source snapshots, cache manifests, and
  generated consumer workspace flakes without changing resource identity, copying raw nixpkgs
  commits into default status, or treating package pins as compatibility policy.
- End-to-end regeneration assertions proving regenerable `.viberoots/workspace` graph output can be
  cleaned and rebuilt through `workspace-state-paths` logical paths without changing durable
  control-plane graph/status identity, repo-owned intent UIDs, or status links. The assertion must
  cover remote store/source paths, local self/pre-extraction `..`, and local sibling/submodule
  `../viberoots` activation while tolerating `.viberoots/buck` real storage.
- Provisioner-inclusive integration fixture covering OpenTofu resource identity, evidence refs, and
  status links through the resource graph. The fixture must include an admitted OpenTofu provisioner
  path with execution snapshot, retained provisioner evidence, current stage/status links, and
  first-class policy resource ID/version bindings in secret-safe graph status.
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

- The primary protected/shared Cloudflare Pages deployment path, or an equal-coverage replacement
  recorded by an earlier PR, can be traced from Buck intent through admitted runtime graph, provider
  evidence, worker evidence, run-action history, stage state, and audit.
- The same path can explain the build-system source plan used for artifacts without adding a second
  nixpkgs source-selection model to the resource graph.
- The provisioner-inclusive OpenTofu fixture can be traced through provisioner identity, retained
  provisioner evidence, current stage/status links, and first-class policy resource ID/version
  bindings.
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

## PR-10: Backend runtime evidence status ingestion

### 1. Intent

Close the remaining PR-4B/PR-9 gap where rich runtime evidence exists in export-time collectors but
is not linked into backend operator resource graph status.

### 2. Scope of changes

- Add backend read-model ingestion and status links for the runtime evidence kinds already modeled by
  the runtime-source inventory path:
  - runtime input evidence
  - auth-provider profile evidence
  - selected control-plane readiness evidence
  - control-plane observability evidence
  - mini-migration preflight evidence
  - cutover readiness evidence
- Prefer durable references to complete existing evidence objects when available; when embedding is
  necessary, validate with the existing evidence validators rather than hand-picking fields.
- Preserve secret redaction and existing provider/control-plane authority boundaries.
- Keep deployment submissions, queue claims, leases, locks, stage state, audit, and replay tables
  authoritative.
- Do not introduce generic runtime evidence mutation APIs.

### 3. External prerequisites

- PR-4B, PR-8, and PR-9 should be complete.

### 4. Tests to be added

- Backend read-model tests proving each evidence kind appears in graph status with complete
  validator-backed shape or durable reference.
- Secret-safety tests for every new evidence path.
- Negative tests proving missing, stale, malformed, or unsupported evidence remains fail-closed where
  the current control-plane workflow requires that evidence.
- Read-surface tests proving web/API/MCP/CLI status exposes the new evidence without changing auth,
  `x-request-id`, schema version, or audit behavior.

### 5. Docs to be added or updated

- Update operator resource graph status docs to describe the new backend evidence links and how to
  troubleshoot missing evidence.
- Document which evidence remains export-only, if any, and why.

### 5.5. Expected regression scope

- `deployment-only`
- Include focused control-plane runtime/readiness, managed dependency, mini-migration, cutover, and
  resource graph read-model tests.

### 6. Acceptance criteria

- Backend graph status includes the rich runtime evidence required by PR-9.
- Evidence shape is complete enough to be validated by existing contracts or durably referenced.
- Secret-bearing material is redacted.
- Existing mutation authority and fail-closed behavior remain unchanged.

### 7. Risks

- Evidence objects may be large or provider-specific.
- Status may accidentally duplicate secret-bearing request payloads.

### 8. Mitigations

- Use durable references when full objects are too large for routine status.
- Reuse existing validators and redaction helpers.

### 9. Consequences of not implementing this PR

Operator resource graph status would continue to omit runtime evidence that the plan requires.

### 10. Downsides for implementing this PR

It may require touching several existing evidence producers and read-surface tests.

## PR-11: Pre-read-model and backfill status markers

### 1. Intent

Make resource graph status honest about records created before the read model was imported or
backfilled.

### 2. Scope of changes

- Add explicit status markers that distinguish:
  - imported/indexed intent graph facts
  - runtime rows linked to imported graph facts
  - runtime rows that predate the read-model import
  - runtime rows that cannot yet be linked because backfill has not run or required intent facts are
    missing
- Add a bounded backfill or classification path for existing backend rows where safe.
- Preserve current runtime rows without rewriting provider records unless the migration/backfill is
  explicitly reviewed.
- Do not silently report all runtime status as fully indexed when intent graph facts are missing.

### 3. External prerequisites

- PR-4A and PR-4B should be complete.

### 4. Tests to be added

- Read-model tests with imported graph facts, missing graph facts, and pre-read-model backend rows.
- Migration/backfill tests proving old rows are classified or linked without corrupting source
  authority.
- Read-surface tests proving operators can see whether status is indexed, pre-read-model, or
  unlinked.
- Negative tests proving missing intent graph facts are not silently treated as fully linked status.

### 5. Docs to be added or updated

- Document the status markers and operator meaning of pre-read-model or unlinked runtime rows.
- Document any supported backfill command or automatic migration behavior.

### 5.5. Expected regression scope

- `deployment-only`
- Include focused backend schema, read-model, migration, and read-surface tests.

### 6. Acceptance criteria

- Operators can distinguish fully linked graph status from pre-read-model or unlinked status.
- Backfill/classification behavior is tested and secret-safe.
- Existing runtime records remain authoritative and are not rewritten unsafely.

### 7. Risks

- Backfill semantics could be mistaken for replay or mutation authority.

### 8. Mitigations

- Keep markers diagnostic and read-only.
- Treat runtime backend tables as authoritative and avoid reconstructing provider facts from status.

### 9. Consequences of not implementing this PR

Graph status would overstate confidence for older or unlinked runtime records.

### 10. Downsides for implementing this PR

It adds migration/status complexity to a read model that otherwise stays append-only.

## PR-12: Real reconciler-path resource graph E2E

### 1. Intent

Replace the remaining seeded-row proof with a true representative deployment-resource graph
reconciliation test through the current deployment reconciler path.

### 2. Scope of changes

- Add an end-to-end protected/shared Cloudflare Pages static-webapp flow that exercises reviewed
  Buck intent, service admission, artifact challenge/upload, immutable execution snapshot, queueing,
  provider evidence, worker/status evidence, run-action history, stage state/history, audit, graph
  status, and at least one replay path.
- Keep Cloudflare Pages as the primary representative path unless an equal-coverage path is already
  recorded.
- Preserve the separate OpenTofu provisioner-inclusive fixture and supported release-action fixture,
  but connect them to the same final status assertions where practical.
- Include read-surface assertions for web base-path reads, direct API reads, deployment client read
  routes, CLI, MCP, and web UI reads where those surfaces already expose deployment status.
- Preserve all existing submit, retry, rollback, preview, promotion, queueing, locking,
  idempotency, approval, and fail-closed behavior.
- Do not add a generic resource mutation API or scheduler.

### 3. External prerequisites

- PR-10 and PR-11 should be complete or explicitly accounted for in the test fixture.

### 4. Tests to be added

- End-to-end Cloudflare Pages protected/shared deployment test that uses the real submit/admit/worker
  or service-backed execution path instead of direct SQL seeding.
- Replay test for retry, promotion, or rollback that proves graph status preserves policy refs,
  latest actions, provider evidence, stage state/history, and audit.
- Read-surface tests covering API, CLI, MCP, and web UI reads with schema versions, auth grants,
  `x-request-id`, redaction, and audit.
- Negative tests proving unsupported provider/provisioner/policy semantics remain fail-closed.
- Secret-safety assertions for final graph status output.

### 5. Docs to be added or updated

- Update deployment usage docs with the real operator workflow for graph status during deploy,
  status inspection, and replay.
- Document any intentional exclusions from the representative path and the fixtures that cover them.

### 5.5. Expected regression scope

- `deployment-only`
- Include full deployment-domain validation when explicitly authorized.

### 6. Acceptance criteria

- The representative path proves graph status through the real reconciler rather than seeded rows.
- Replay/status behavior remains compatible with existing deployment operator workflows.
- Existing authority boundaries remain intact.

### 7. Risks

- A true end-to-end flow may be slower and more brittle than seeded integration tests.

### 8. Mitigations

- Reuse existing fake provider, fake object-store, and local control-plane harnesses.
- Keep the test focused on one representative path and rely on targeted fixtures for provider
  variants.

### 9. Consequences of not implementing this PR

The resource graph would remain proven mainly by composition fixtures rather than the real
deployment reconciler.

### 10. Downsides for implementing this PR

It may require broader validation and careful test-runtime management.
