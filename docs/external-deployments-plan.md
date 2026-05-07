# External Build And Deployment Plan

This plan covers the build-system, deployment-system, and scaffolding work needed that is not already
covered by the current implementation surface.

Reviewed context:

- [`build-tools/docs/build-system-design.md`](../build-tools/docs/build-system-design.md) establishes
  Buck as the source of truth for graph structure and Nix as the hermetic artifact builder. It also
  requires new target types to augment the existing `scaf` tooling rather than introducing a second
  scaffold mechanism.
- [`docs/deployment-plan.md`](deployment-plan.md) already plans and implements a substantial shared
  deployment system around provider capabilities, deployment metadata, secretspec/Vault, admission,
  immutable artifact reuse, and protected/shared control-plane execution.
- The current repo already has reviewed deployment paths for `nixos-shared-host`, `cloudflare-pages`,
  `s3-static`, mobile store providers, and a Kubernetes service provider implementation path. It also
  already has generic TypeScript library/CLI/static web/SSR web scaffolds, including a
  `ts/webapp-ssr-next` scaffold.

The remaining gap is external product deployment for:

- a repo-built, Vercel-hosted Next.js console
- OpenTofu-managed infrastructure and foundation deployments
- explicit runtime config, secret, readiness-gate, and promotion contracts for external targets

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no functionality that lands without tests in the same PR
- no provider-side Git auto-builds as the authoritative protected/shared production path
- no speculative app template framework, app recipe registry, or plugin loader
- no separate top-level project-specific `infra` tree outside `projects/deployments`

Each PR below must update this plan if implementation changes invalidate the remaining sequence,
scope, or assumptions.

## PR-1: Vercel-compatible Next.js artifact build target

### 1. Intent

Add a hermetic Buck/Nix artifact path for Next.js apps that produces a Vercel Build Output API
artifact, so an app can be built, hashed, admitted, and published without relying on
Vercel Git auto-builds or untracked local `.vercel` state.

### 2. Scope of changes

- Extend the existing Node webapp build surface with a Vercel prebuilt artifact mode for Next.js
  SSR targets.
- Produce a finalized `.vercel/output` directory or deterministic archive from a Buck target under
  `projects/apps/<name>`.
- Record stable artifact identity from finalized output bytes.
- Fail closed if Vercel project settings, environment variables, or generated metadata are required
  but not declared as build inputs, runtime config inputs, or provisioner outputs.
- Update `ts/webapp-ssr-next` so generated apps can opt into the Vercel artifact target without
  breaking the existing SSR runtime contract.
- Keep all substantive automation in zx TypeScript scripts with `#!/usr/bin/env zx-wrapper`.

### 3. External prerequisites

- No live Vercel account is required for this PR.
- The Vercel CLI or Build Output API package versions must be pinned through the repo's existing
  Node/Nix dependency model.

### 4. Tests to be added

- Template render tests proving `ts/webapp-ssr-next` can generate a Vercel artifact target.
- Artifact identity tests proving identical `.vercel/output` bytes produce identical identities.
- Negative tests proving undeclared Vercel-local state and missing required config fail closed.
- Buck query tests proving the artifact target is labeled as a deployable app and remains compatible
  with `ssr-webapp` component extraction.

### 5. Docs to be added or updated

- Update [`build-tools/docs/scaffolding.md`](../build-tools/docs/scaffolding.md) with Vercel
  artifact mode for `ts/webapp-ssr-next`.
- Update Node/webapp build docs to describe the `.vercel/output` contract and the difference between
  local dev commands and protected/shared artifact builds.
- Update this plan if the artifact target shape changes later PR boundaries.

### 6. Acceptance criteria

- A generated Next.js scaffold can build a Vercel-compatible artifact through Buck/Nix.
- The artifact identity is deterministic and independent of ambient local Vercel state.
- The generated target can be used as a deployment component without custom per-app glue.

### 7. Risks

- Vercel CLI behavior may read project-local or user-local state unless tightly constrained.
- Next.js build output can vary across Node, package-manager, or environment inputs.

### 8. Mitigations

- Pin tool versions and run builds in the existing Nix-backed Node flow.
- Treat required Vercel metadata as explicit inputs and reject ambient `.vercel` or home-directory
  state.
- Add fixture tests that mutate undeclared state and verify the build result does not silently
  consume it.

### 9. Consequences of not implementing this PR

The console deployment would either rely on Vercel Git auto-builds or a developer/CI workspace
outside the repo's immutable artifact admission model.

### 10. Downsides for implementing this PR

It adds another webapp artifact shape to the Node build surface and couples the Next.js scaffold to
Vercel's Build Output API contract.

## PR-2: Vercel deployment metadata, provider capability, and local publisher

### 1. Intent

Introduce a reviewed `vercel` provider family for repo-built prebuilt artifacts, starting with a
local/testable publish adapter and full metadata validation.

### 2. Scope of changes

- Add `vercel` provider target derivation with canonical identity:
  `vercel:<team>/<project>#<environment>`.
- Add deployment extraction, schema validation, provider capability registry entry, and front-door
  validation for Vercel.
- Add a Starlark macro such as `vercel_next_webapp_deployment(...)` that emits `component_kind =
"ssr-webapp"` while preserving the option to support static webapps later.
- Support `publisher = "vercel-prebuilt"` and checked-in publisher config for project/environment
  mapping.
- Implement a local/fake Vercel publisher fixture that accepts admitted prebuilt artifacts and
  returns deterministic deployment IDs and URLs.
- Reject Vercel Git auto-build mode for protected/shared deployments.

### 3. External prerequisites

- No live Vercel account is required for the local publisher fixture.
- Final provider naming should reserve fields for real Vercel team/project IDs or slugs.

### 4. Tests to be added

- Contract extraction tests for valid and invalid Vercel deployment metadata.
- Provider capability validation tests for supported component kinds, canonical identity, lock key,
  preview posture, retry posture, and protected/shared eligibility.
- Front-door validation tests rejecting unsupported publishers, missing publisher config, unsupported
  component kinds, and Git auto-build mode.
- Local publisher tests proving admitted artifact identity is recorded in publish output.

### 5. Docs to be added or updated

- Update [`docs/deployments-schema.md`](deployments-schema.md) with Vercel provider fields.
- Update [`docs/deployment-provider-capabilities.md`](deployment-provider-capabilities.md) with the
  Vercel capability entry.
- Update [`docs/deployments-usage.md`](deployments-usage.md) with local/test Vercel deployment
  examples.
- Update this plan if Vercel static support is pulled into or deferred from the initial provider.

### 6. Acceptance criteria

- A Vercel deployment target can be declared and validated through the repo deployment front door.
- The local publisher consumes only an admitted artifact reference and records deterministic provider
  output.
- Unsupported Vercel deployment shapes fail during validation, not during live publish.

### 7. Risks

- Adding a provider before live API integration can leave false confidence about provider semantics.
- Vercel environment naming can drift from repo lane/environment naming.

### 8. Mitigations

- Keep the first publisher fixture explicit and non-production.
- Make canonical identity fields reviewed repo metadata, while provider-specific IDs are resolved and
  recorded by later live integration.

### 9. Consequences of not implementing this PR

Projects would need ad hoc provider handling and could not participate in
the existing provider capability, locking, validation, and records model.

### 10. Downsides for implementing this PR

It increases the provider registry and validation matrix before the first live Vercel deployment is
available.

## PR-3: Vercel protected/shared publish, preview, smoke, retry, and rollback

### 1. Intent

Turn the Vercel provider into a production-eligible external publisher that uses the existing
admission, secretspec/Vault, immutable artifact, retry, rollback, preview, and record contracts.

### 2. Scope of changes

- Implement live Vercel prebuilt publish using the admitted `.vercel/output` artifact.
- Resolve Vercel API credentials through deployment `secret_requirements` at the `publish` and
  `preview_cleanup` steps.
- Record Vercel deployment ID, URL, alias/domain assignment result, artifact identity, source run ID,
  and provider target identity.
- Add preview publish and preview cleanup as audited operations with source-run scoped identity.
- Add smoke checks for declared console URL, expected app shell, logged-out/AuthKit routing, and
  configured console-to-web base URL.
- Implement retry and rollback using recorded exact artifacts or recorded provider deployments where
  the Vercel API can prove identity.
- Route protected/shared Vercel mutation through the reviewed control-plane service path.

### 3. External prerequisites

- Vercel team/project access.
- Vercel API token stored through the repo's Vault/secretspec backend.
- DNS/domain ownership for any production or staging aliases used in smoke tests.
- Network egress from the deployment worker to Vercel APIs.

### 4. Tests to be added

- Fake Vercel API tests for publish, preview, cleanup, retry, rollback, and ambiguous API outcome
  failure.
- Secretspec tests proving Vercel tokens are resolved only through the secret runtime and are not
  written to records.
- Protected/shared service submission tests proving laptop-local artifact paths are rejected.
- Smoke tests against fixture HTTP servers for success and failure cases.
- Replay tests proving rollback does not rebuild from the current branch.

### 5. Docs to be added or updated

- Update [`docs/deployments-usage.md`](deployments-usage.md) with Vercel publish, preview cleanup,
  retry, and rollback flows.
- Update [`docs/secrets-usage.md`](secrets-usage.md) with Vercel token contract IDs and target-scope
  examples.
- Update operator troubleshooting docs with common Vercel API and alias/domain failure modes.
- Update this plan if live Vercel limitations force a different production assignment model.

### 6. Acceptance criteria

- Protected/shared Vercel deploys publish only admitted prebuilt artifacts.
- Required Vercel secrets are never read from ambient environment outside the reviewed secret runtime.
- Preview, retry, rollback, and smoke behavior are recorded and test-covered.

### 7. Risks

- Vercel API outcomes can be partially successful or eventually consistent.
- Preview cleanup may fail or leave provider resources behind.
- Smoke checks can become flaky if domain assignment propagation is slow.

### 8. Mitigations

- Treat ambiguous provider outcomes as failed runs with explicit records.
- Add bounded cleanup/janitor records for preview cleanup failures.
- Make smoke retries bounded and diagnostic, with provider IDs and URLs recorded for follow-up.

### 9. Consequences of not implementing this PR

The console may be buildable and declarable, but it would not have a reviewed protected/shared
external deploy path with rollback and auditable provider records.

### 10. Downsides for implementing this PR

It introduces live provider API coupling and operational failure modes that require real credentials,
networking, and provider-specific diagnostics.

## PR-4: OpenTofu stack provisioner and foundation deployment support

### 1. Intent

Add a built-in `opentofu-stack` provisioner and provision-only foundation deployment path so
infrastructure remains deployment-owned, reviewed, admitted, and recorded.

### 2. Scope of changes

- Add `opentofu-stack` as a reviewed provisioner type with stack directory ownership under
  `projects/deployments/<deployment-id>/opentofu/`.
- Generate and record plan artifacts before protected/shared mutation.
- Bind plan fingerprint and stack config fingerprint into admission evidence.
- Apply only the reviewed plan or a fail-closed equivalent resolved-input snapshot.
- Add destructive-plan detection and rejection for routine flows unless a reviewed exception or
  destructive workflow is present.
- Add first-class provision-only deployment support for foundation infrastructure.
- Support state backend declaration, environment-scoped stack identity, and promotion compatibility
  rules for stack identity, state backend, and allowed environment differences.
- Resolve provider credentials through `secret_requirements` at the `provision` step.

### 3. External prerequisites

- OpenTofu provider accounts and credentials for Vercel, DNS, Supabase, WorkOS, Ragie, object
  storage, and any chosen container runtime.
- Remote state backend storage and locking, such as S3/R2 plus credentials.
- Manual custody for initial state backend bootstrap if it cannot be created by the same stack.

### 4. Tests to be added

- Plan parsing tests for no-op, create/update, and destructive changes.
- Admission tests proving plan fingerprints are required and replayed.
- Provision-only control-plane tests for protected/shared foundation deployments.
- Secretspec tests proving provision credentials are scoped to `provision` and redacted from records.
- Promotion compatibility tests for stack identity, backend identity, and allowed env differences.
- Fixture stack tests using fake providers or dry-run JSON where live APIs are not required.

### 5. Docs to be added or updated

- Update deployment schema and usage docs with `opentofu-stack` metadata and provision-only flows.
- Add an OpenTofu stack layout guide under `docs/` or `build-tools/docs/` as appropriate.
- Update secrets docs with `provision` step examples.
- Update this plan if foundation deployments use an `opentofu` provider instead of provisioner-only
  deployment targets.

### 6. Acceptance criteria

- App deployments can attach a reviewed OpenTofu provisioner without overlapping publisher
  responsibilities.
- Foundation deployments can run provision-only with normal lane/admission/record semantics.
- Routine protected/shared flows reject unreviewed destructive plans.

### 7. Risks

- Plan interpretation can differ across OpenTofu versions or providers.
- State backend bootstrap can create a circular dependency.
- Destructive-plan classification mistakes can block safe work or allow unsafe work.

### 8. Mitigations

- Pin OpenTofu and provider versions.
- Keep initial backend bootstrap as an explicit operator prerequisite when needed.
- Fail closed on unknown plan actions and require reviewed exceptions for destructive ambiguity.

### 9. Consequences of not implementing this PR

Infrastructure would either live outside the repo deployment model or be applied through
ad hoc operator commands that are not admitted, replayable, or bound to deployment records.

### 10. Downsides for implementing this PR

It adds a substantial infrastructure lifecycle surface and increases the amount of provider-specific
state that deployment records must preserve.

## PR-5: Node service artifact and container/image build contract

### 1. Intent

Add a hermetic build artifact path for `data-room-web` and `data-room-worker` service processes,
including a scaffolded TypeScript service target and an immutable service artifact or OCI image
identity suitable for container-runtime deployment.

### 2. Scope of changes

- Add or extend Node macros so a TypeScript service can produce a runtime artifact with:
  - server entrypoint
  - production command
  - runtime config contract
  - declared secret contract
  - optional OCI image or image-layout output
- Add stable service artifact identity from finalized bytes or image digest.
- Ensure runtime startup does not depend on planner tooling inside the container/image.
- Add a `ts/service` scaffold for long-running Node services with health endpoint, unit test, and
  deployable Buck target.
- Support separate web and worker commands from the same source graph without requiring app-to-app
  imports.
- Add fixture support for service-health smoke tests.

### 3. External prerequisites

- No external container registry is required for the first local artifact contract.
- If OCI images are produced in this PR, a local image-layout toolchain must be pinned through Nix.

### 4. Tests to be added

- Service scaffold smoke tests proving generated targets build and tests run.
- Artifact identity tests for directory artifacts and OCI/image-layout outputs.
- Runtime contract tests proving production command, entrypoint, and health endpoint metadata are
  present.
- Negative tests proving missing runtime config and undeclared secret requirements fail validation.
- Template taxonomy, resolver, and generated manifest parity tests for the new `ts/service` template.

### 5. Docs to be added or updated

- Update [`build-tools/docs/scaffolding.md`](../build-tools/docs/scaffolding.md) with `ts/service`
  usage and when to choose it instead of webapp scaffolds.
- Update build-system docs with the Node service artifact/runtime contract.
- Update deployment docs with the service artifact identity shape.
- Update this plan if the repo chooses directory artifacts first and defers OCI image output.

### 6. Acceptance criteria

- `scaf new ts service <name>` creates a buildable, testable service with a deployable Buck target.
- The service artifact has a stable identity and can be admitted by the deployment system.
- Web and worker process types can share libraries/source graph while producing distinct deployable
  runtime commands or artifacts.

### 7. Risks

- OCI image builds can add platform-specific complexity across Darwin and Linux.
- A too-specific service scaffold could drift toward a data-room app template.

### 8. Mitigations

- Start with a generic Node service contract and add OCI output only when the implementation can be
  tested consistently.
- Keep scaffold content generic: health endpoint, config/secret placeholders, and test harness only.

### 9. Consequences of not implementing this PR

`data-room-web` and `data-room-worker` would not have repo-built immutable service artifacts for
protected/shared deployment.

### 10. Downsides for implementing this PR

It adds a new artifact family and may require additional tooling for image creation, caching, and
cross-platform verification.

## PR-6: Container-runtime deployment macro and service publisher

### 1. Intent

Make the existing service-provider path usable for web and worker deployments by adding the
missing Starlark metadata macro, provider config scaffolding, and service-specific validation for
public web ingress and private worker execution.

### 2. Scope of changes

- Add a reviewed deployment macro for Kubernetes service deployments, or a deliberately named
  container-runtime macro if the repo chooses to keep the provider abstraction above Kubernetes.
- Support `component_kind = "service"` for single-component web and worker deployments.
- Add deployment-package scaffolds for service publisher config such as Helm values, smoke URL, and
  ingress mode.
- Validate:
  - web deployments declare public ingress and health checks
  - worker deployments declare no public ingress by default
  - service deployments use admitted service artifacts or image digests
  - provisioner and publisher responsibilities do not overlap
- Wire service-health smoke into the front door and protected/shared control-plane path.
- Add publish-only retry/rollback support using recorded exact service artifacts.

### 3. External prerequisites

- A chosen production container runtime. The plan assumes the existing Kubernetes provider path is
  the shortest reviewed route unless the team explicitly chooses another runtime.
- Cluster access, namespace policy, service accounts, ingress controller, and registry or artifact
  staging strategy.
- Provider credentials stored through Vault/secretspec.

### 4. Tests to be added

- Extraction tests for the new service deployment macro.
- Provider config scaffold tests for generated Helm or runtime config files.
- Validation tests for public web ingress, private worker ingress, missing health check, missing
  service artifact, unsupported publisher/provisioner, and mismatched target identity.
- Fake publisher tests proving admitted service artifact paths are injected into rendered provider
  config.
- Smoke tests for service-health success and failure.
- Retry/rollback replay tests proving recorded artifacts are reused without rebuild.

### 5. Docs to be added or updated

- Update deployment schema docs with service deployment macro examples.
- Update provider capability docs if Kubernetes capability details change.
- Update deployments usage docs with web and worker examples.
- Update this plan if a non-Kubernetes container runtime is selected.

### 6. Acceptance criteria

- A service deployment can be declared through a first-class macro instead of raw `deployment_target`.
- Web and worker deployments validate different ingress postures.
- Protected/shared publish, smoke, retry, and rollback operate on admitted service artifacts.

### 7. Risks

- Kubernetes may not be the final runtime, so provider-specific work could need migration.
- Worker "no ingress" enforcement can be provider-specific and easy to under-specify.

### 8. Mitigations

- Keep the deployment component contract provider-neutral where possible and isolate Kubernetes
  details in provider config and adapter code.
- Test ingress/no-ingress posture at the metadata and rendered-config layers.

### 9. Consequences of not implementing this PR

Web and worker services would remain outside the reviewed deployment front door or require
hand-authored raw deployment targets and provider config.

### 10. Downsides for implementing this PR

It commits the first external service deployment path to a concrete runtime adapter and increases
operator setup requirements.

## PR-7: Deployment scaffolds for Vercel, service, and OpenTofu packages

### 1. Intent

Add deployment-package scaffolding that can stamp the deployment directories while staying
inside the existing `scaf` system.

### 2. Scope of changes

- Add a `deployment` scaffold taxonomy or equivalent existing-CLI extension under
  `build-tools/tools/scaffolding/templates/`.
- Add templates for:
  - shared lane/governance/admission package
  - Vercel Next.js deployment package
  - service deployment package
  - OpenTofu foundation deployment package
  - app-attached OpenTofu provisioner subdirectory
- Generate `TARGETS`, provider config, placeholder OpenTofu stack layout, secret requirement
  examples, runtime config requirement examples, and README/runbook snippets.
- Add resolver defaults for `projects/deployments/<deployment-id>`.
- Ensure generated templates include labels/test metadata needed by template-only selection.
- Do not generate a data-room-specific app template or plugin registry.

### 3. External prerequisites

- No external account is required for template rendering.
- Template examples may include placeholder values for provider accounts, domains, and contract IDs.

### 4. Tests to be added

- Golden scaffold tests for each deployment template.
- Buck cquery tests proving generated `TARGETS` extract as valid deployments when fixture values are
  supplied.
- Template taxonomy, resolver, generated adapter, and selection tests for the new deployment
  template family.
- Negative scaffold tests proving missing required provider answers produce deterministic errors.

### 5. Docs to be added or updated

- Update [`build-tools/docs/scaffolding.md`](../build-tools/docs/scaffolding.md) with deployment
  scaffold commands and resolver behavior.
- Update deployment usage docs with scaffold-first examples.
- Update this plan if template names or taxonomy shape change.

### 6. Acceptance criteria

- Operators can generate the new deployment packages through `scaf` without manual boilerplate.
- Generated deployment packages are valid after filling reviewed provider/account/domain answers.
- The scaffold system's taxonomy and verify selectors remain fresh and test-covered.

### 7. Risks

- Deployment scaffolds can become too app-specific and violate the companion's "no app_templates"
  guidance.
- Generated placeholders can be mistaken for production-ready values.

### 8. Mitigations

- Keep templates provider/component-oriented, not data-room-oriented.
- Use deterministic placeholder names that fail validation until replaced.
- Include generated README guidance focused on required reviewed fields and commands.

### 9. Consequences of not implementing this PR

Deployment packages would be copied by hand, increasing drift across dev, staging, and prod.

### 10. Downsides for implementing this PR

It expands the scaffolding taxonomy beyond language/project templates and adds more generated
surfaces to maintain.

## PR-8: Secret, runtime config, and readiness-gate admission contracts

### 1. Intent

Promote external-service requirements into deployment metadata, secretspec contracts,
runtime config contracts, and deploy-blocking readiness gates.

### 2. Scope of changes

- Add typed requirement helpers or validation profiles for external deployments:
  - WorkOS/AuthKit public and secret configuration
  - Supabase public URL and privileged service credentials
  - Ragie API credentials and live validation gates
  - Source Access signing/HMAC material
  - console-to-web base URL
  - provider tokens for Vercel, container runtime, DNS, and OpenTofu providers
- Add admission evidence channels for readiness gates that cannot run in every local PR check:
  Ragie ACL semantics, live tenant leak checks, WorkOS MCP auth checks, storage grant lifecycle, and
  Connect metadata/OAuth checks.
- Add package-boundary and deployment-readiness checks for:
  - app targets not importing other app targets
  - source response shape not returning forbidden forensic fields through MCP
- Ensure gates can be required by admission policy without embedding app secrets in CI variables.

### 3. External prerequisites

- WorkOS, Supabase, Ragie, storage, and container-runtime test accounts for live gates.
- Vault paths and roles for all stable `secret://deployments/...` contract IDs.
- A policy decision on which gates are PR checks, staging admission checks, and production admission
  checks.

### 4. Tests to be added

- Requirement validation tests for missing, duplicate, wrong-step, and wrong-scope secret/runtime
  config declarations.
- Admission evaluator tests for each readiness-gate evidence type.
- Fixture tests proving live-gate evidence is redacted and bound to deployment, source revision, and
  provider target.
- Boundary lint tests using fixture `projects/libs` and `projects/apps` graphs.
- Negative tests proving secrets cannot be satisfied from ambient provider env vars outside the
  secret runtime.

### 5. Docs to be added or updated

- Update [`docs/secrets-usage.md`](secrets-usage.md) and
  [`docs/deployment-secrets-api.md`](deployment-secrets-api.md) with contract IDs and steps.
- Update deployment schema/admission docs with readiness-gate evidence.
- Update this plan if readiness gates move between CI and deployment admission.

### 6. Acceptance criteria

- Deployments can declare all required secrets and runtime config without secret values in
  `TARGETS`, `.env`, committed provider settings, or CI variables that bypass the secret runtime.
- Admission can require and verify readiness evidence for external pilot gates.
- Boundary checks are test-covered and can be wired into CI/admission policies.

### 7. Risks

- Live-system gates can be slow, flaky, or hard to reproduce locally.
- Overly broad secret contracts can grant providers more access than required.

### 8. Mitigations

- Separate fast PR checks from protected/shared admission checks.
- Bind evidence to deployment/source/provider identity and keep diagnostics redacted.
- Use step-specific secret requirements and target scopes for least privilege.

### 9. Consequences of not implementing this PR

Projectss could deploy externally before security and readiness gates are enforced
by the repo's deployment system.

### 10. Downsides for implementing this PR

It adds policy and live-environment complexity before all product code exists, and it may require
operators to provision several external test accounts early.

## PR-9: Front-door readiness and boundary query enforcement

### 1. Intent

Close the remaining integration gap between PR-8's policy helpers and the normal deployment
front-door path by carrying readiness gates and dependency graph data through cquery extraction.

### 2. Scope of changes

- Include `readiness_gates` in the deployment cquery attributes used by repo/front-door deployment
  resolution.
- Ensure `extractDeploymentAdmissionPolicies` receives readiness-gate declarations from real
  deployment targets and deploy-blocking admission paths.
- Include dependency graph data needed by `appTargetBoundaryErrors` in the deployment query or add
  an equivalent real graph lookup before front-door validation runs.
- Keep the app-to-app boundary check active for real deployment targets, not only synthetic unit
  test nodes.
- Preserve existing external requirement profile validation and readiness evidence normalization
  behavior from PR-8.

### 3. External prerequisites

- No external accounts are required; the work is query/extraction wiring and fixture coverage.

### 4. Tests to be added

- Cquery extraction tests proving real or fixture deployment targets retain `readiness_gates`
  through `queryDeploymentNodes` into `extractDeploymentAdmissionPolicies`.
- Front-door validation tests proving a deployment with required readiness gates blocks when
  matching evidence is absent and passes when valid bound evidence is supplied.
- Real-query or fixture graph tests proving app-target dependencies are visible to
  `appTargetBoundaryErrors` during front-door validation.
- Negative tests proving an app target importing another app target fails through the same
  front-door path used by deployment validation.

### 5. Docs to be added or updated

- Update deployment schema/admission docs to state that readiness gates and app-boundary checks are
  enforced by front-door deployment resolution, not only helper-level validation.
- Update this plan if the query shape changes again.

### 6. Acceptance criteria

- A deployment policy's `readiness_gates` cannot be dropped during normal repo/front-door
  resolution.
- App-to-app dependency violations are detected from the real deployment graph used by front-door
  validation.
- Tests prove the shipped integration path, not only isolated helper behavior.

### 7. Risks

- Adding graph attributes to deployment queries can make query output larger or expose assumptions
  about target shapes.
- Front-door tests can become brittle if they depend on overly specific cquery fixtures.

### 8. Mitigations

- Request only the minimum attributes needed for readiness and boundary enforcement.
- Prefer small focused fixtures and explicit assertions around the policy data that must survive
  extraction.

### 9. Consequences of not implementing this PR

Readiness gates and app-boundary checks would exist as helper-level contracts but remain bypassable
through normal deployment resolution.

### 10. Downsides for implementing this PR

It expands the deployment query contract and adds another front-door integration test surface to
maintain.

## PR-10: Vercel protected/shared control-plane execution

### 1. Intent

Close the remaining Vercel production-readiness gap by routing protected/shared Vercel deploy,
preview, preview cleanup, retry, and rollback operations through the reviewed deployment
control-plane service instead of rejecting or running them through laptop-local mutation paths.

### 2. Scope of changes

- Add a Vercel control-plane request and response contract that carries the admitted artifact
  reference, source run ID, operation kind, preview cleanup inputs, smoke overrides, and admission
  evidence through the existing service submission boundary.
- Extend provider front-door dispatch so protected/shared Vercel mutations require and use the
  reviewed control-plane service path, while `local_only` Vercel fixtures can still run locally.
- Ensure protected/shared Vercel deploys, previews, retries, rollbacks, and cleanup operations never
  accept laptop-local artifact paths or unreviewed local records roots.
- Preserve the existing Vercel artifact admission, secret runtime, smoke, record, and fake API
  behavior behind the service execution boundary.
- Add replay handling for Vercel retry and rollback that reuses recorded exact artifacts or recorded
  provider deployments where identity can be proven.

### 3. External prerequisites

- No live Vercel account is required for the first control-plane contract tests.
- Live use still requires the Vercel token, team/project access, and DNS/domain ownership described
  in PR-3.

### 4. Tests to be added

- Protected/shared service submission tests proving Vercel deploy, preview, preview cleanup, retry,
  and rollback route through the control-plane service.
- Negative front-door tests proving protected/shared Vercel mutations reject laptop-local artifact
  paths, records roots, and direct local publish flags.
- Replay tests proving Vercel retry and rollback reuse recorded exact artifacts and do not rebuild
  from the current branch.
- Fake Vercel API tests for ambiguous publish and cleanup outcomes through the service boundary.
- Contract tests proving `local_only` Vercel fixture publishing remains available for tests and
  development without weakening protected/shared behavior.

### 5. Docs to be added or updated

- Update deployment usage docs with protected/shared Vercel control-plane examples for deploy,
  preview, cleanup, retry, and rollback.
- Update Vercel troubleshooting docs with service submission, admission, replay, and provider API
  failure modes.
- Update deployment provider capability docs if Vercel runtime parity or service-only flags change.

### 6. Acceptance criteria

- Protected/shared Vercel mutations run only through the reviewed control-plane service path.
- Vercel retry and rollback are recorded, test-covered, and replay exact admitted artifacts or
  proven provider deployment identities.
- Local fixture behavior remains explicit and cannot be selected accidentally for protected/shared
  targets.

### 7. Risks

- Vercel provider records and control-plane records can drift if the service boundary does not carry
  every replay-relevant field.
- Preview cleanup and rollback can have provider-specific ambiguity that is harder to model than a
  normal deploy.

### 8. Mitigations

- Treat the control-plane request schema as the versioned replay boundary and include fixture tests
  for every operation kind.
- Fail closed on ambiguous Vercel API outcomes and preserve diagnostic provider IDs in redacted
  records.

### 9. Consequences of not implementing this PR

Vercel deployments can be declared and locally exercised, but protected/shared production mutation
remains unavailable or outside the reviewed deployment service path.

### 10. Downsides for implementing this PR

It adds another provider-specific control-plane adapter and increases the replay matrix for Vercel
operations.

## PR-11: OpenTofu reviewed apply and provision credential runtime

### 1. Intent

Finish OpenTofu support by applying only the reviewed plan or a fail-closed resolved-input snapshot
and by resolving provider credentials through the deployment secret runtime at the `provision`
step.

### 2. Scope of changes

- Add an OpenTofu apply adapter for `opentofu-stack` provisioners that consumes the recorded plan
  artifact, stack config fingerprint, state backend identity, and admission-bound plan fingerprint.
- Resolve OpenTofu provider and backend credentials only through deployment `secret_requirements`
  at the `provision` step.
- Reject provision-only and app-attached provisioner runs when the plan artifact, plan fingerprint,
  stack config fingerprint, stack identity, or state backend identity does not match admission
  evidence.
- Preserve destructive-plan rejection for routine flows and add an explicit reviewed exception path
  before any destructive workflow can apply.
- Record apply outcome, provider command metadata, state backend identity, plan fingerprint, stack
  config fingerprint, and redacted diagnostics in deployment records.

### 3. External prerequisites

- OpenTofu and provider plugin versions must be pinned through the repo's Nix dependency model.
- Real external use requires provider accounts, backend storage/locking, and Vault roles for the
  declared `provision` contracts.
- Initial state backend bootstrap may remain an explicit operator prerequisite.

### 4. Tests to be added

- Fake OpenTofu apply tests proving only the admitted plan fingerprint can be applied.
- Negative tests for missing plan artifacts, mismatched plan fingerprints, mismatched stack config
  fingerprints, state backend drift, and missing `provision` credentials.
- Secretspec tests proving provider credentials are scoped to `provision` and never written to
  records.
- Destructive-plan tests proving routine flows reject delete/replace/unknown actions unless a
  reviewed destructive workflow or exception is present.
- Provision-only and app-attached provisioner tests proving records include apply outcome and replay
  evidence.

### 5. Docs to be added or updated

- Update deployment usage docs with OpenTofu plan, admission, apply, and provision-only flows.
- Update secrets docs with OpenTofu provider and backend credential contract IDs.
- Add or update the OpenTofu stack layout guide with reviewed apply, state backend, and destructive
  workflow rules.

### 6. Acceptance criteria

- OpenTofu provision-only and app-attached provisioner runs apply only admission-bound plans or
  fail-closed resolved-input snapshots.
- OpenTofu provider credentials are available only through the secret runtime at `provision`.
- Destructive OpenTofu changes cannot run through routine protected/shared flows.

### 7. Risks

- OpenTofu plan JSON and apply behavior can vary across provider versions.
- State backend locking failures can leave confusing partial outcomes.

### 8. Mitigations

- Pin OpenTofu/provider versions and test against stable fixture plan JSON.
- Treat unknown or partial apply outcomes as failed runs with redacted diagnostics and recorded
  follow-up context.

### 9. Consequences of not implementing this PR

OpenTofu deployments can record reviewed plan metadata, but infrastructure mutation still depends on
ad hoc operator commands outside the admitted, replayable deployment model.

### 10. Downsides for implementing this PR

It introduces a real infrastructure mutation surface and requires careful redaction and failure
recording around provider diagnostics.

## PR-12: Kubernetes publisher secret-runtime credentials

### 1. Intent

Close the container-runtime provider credential gap by ensuring Kubernetes service publish,
retry, rollback, and promotion consume declared credentials through the deployment secret runtime
instead of relying on ambient Helm or cluster environment state.

### 2. Scope of changes

- Add Kubernetes/container-runtime credential resolution through deployment `secret_requirements`
  at the `publish` step for normal deploy, retry, rollback, and promotion.
- Pass only scoped, redacted credential material or generated kubeconfig references into the Helm
  publisher process.
- Reject Kubernetes service deployments with provider profiles or protected/shared posture when the
  required publish credentials are undeclared, wrong-step, wrong-scope, or only present as ambient
  provider environment variables.
- Preserve scrubbed publisher environment behavior while adding an explicit reviewed credential
  input path.
- Record credential contract references and redacted publisher credential provenance without
  writing secret values to deployment records.

### 3. External prerequisites

- A chosen Kubernetes credential contract shape, such as a generated kubeconfig secret, service
  account token, or control-plane-issued short-lived credential reference.
- Vault roles and target scopes for each protected/shared Kubernetes provider target.

### 4. Tests to be added

- Secretspec tests proving Kubernetes publish credentials resolve only at `publish` and are redacted
  from records.
- Fake Helm tests proving the publisher receives only reviewed credential inputs and no ambient
  provider environment secrets.
- Negative validation tests for missing, duplicate, wrong-step, wrong-scope, and ambient-only
  Kubernetes/container-runtime credentials.
- Retry, rollback, and promotion tests proving exact-artifact replay still resolves credentials
  through the target deployment's current reviewed secret requirements.

### 5. Docs to be added or updated

- Update deployment secrets docs with Kubernetes/container-runtime credential contract examples.
- Update deployment usage docs with service publish credential setup and failure modes.
- Update provider capability docs to state that Kubernetes protected/shared publish requires
  secret-runtime credentials.

### 6. Acceptance criteria

- Protected/shared Kubernetes service publish paths cannot mutate provider state without reviewed
  `publish` credentials from the secret runtime.
- Kubernetes retry, rollback, and promotion preserve exact artifact replay while resolving current
  target-scoped provider credentials safely.
- Tests prove secret values are not persisted in records or passed through ambient provider
  environment variables.

### 7. Risks

- Credential shape decisions can become provider-specific and leak Kubernetes implementation details
  into generic deployment contracts.
- Short-lived credentials can expire during long smoke or retry flows.

### 8. Mitigations

- Keep the generic requirement contract at the deployment layer and isolate Kubernetes-specific
  materialization in the publisher adapter.
- Resolve credentials close to publish time and record only redacted contract provenance.

### 9. Consequences of not implementing this PR

Kubernetes service artifacts can be admitted and replayed, but provider mutation still depends on
unreviewed ambient cluster access outside the repo's secret-runtime model.

### 10. Downsides for implementing this PR

It adds another credential materialization path and more negative tests around provider environment
handling.

## PR-12.5: Repo-wide zx-init resolver hook (infrastructure only; sweep deferred)

### 1. Intent

Make the `zx-init.mjs` resolver hook (which auto-appends `.ts` to relative imports) reachable from
every Node entry point in the repo, including nix-built derivations that run `node` inside hermetic
sandboxes and shebang `#!/usr/bin/env zx-wrapper` invocations from temp scaffolding workspaces.
This PR lands the resolver-hook plumbing only. The actual repo-wide `.ts`-extension sweep is
deferred to a follow-up PR because two failure classes that surface during the sweep require their
own surgery: contract tests that lock in the old `.ts`-extension convention, and vite/next dev
servers that hang during scaffolding-test temp dev-server startup when bare imports interact with
vite's own ESM resolver. Both are tractable but warrant a focused, separately-scoped PR.

The dev-shell half of the hook landed in chore commit `255ee410` (`exec_in_dev_shell` exports
`NODE_OPTIONS=--import=file://$LIVE_ROOT/.../zx-init.mjs`). This PR extends the hook to:

- the nix-built `zx-wrapper` itself, which now walks up from `$PWD` (or honors `$ZX_INIT`) to
  locate `build-tools/tools/dev/zx-init.mjs` and adds `--import` automatically,
- the four nix derivations that invoke `node` against repo source (`node-webapp`, `node-service`,
  `node-vercel-next`, `planner/node-webapp`),
- the vite plugin in `projects/apps/pleomino/vite.config.ts` that spawns
  `materialize-static-pwa-precache.ts` via `execFileSync`,
- the `bulk-move` flake app.

### 2. Scope of changes

- Modify the nix-built `zx-wrapper` (defined in `build-tools/tools/nix/devshell.nix` and
  `build-tools/tools/nix/flake/per-system-context.nix`) so it discovers `zx-init.mjs` at run time:
  honor an explicit `$ZX_INIT` env var first; otherwise walk up from `$PWD` looking for
  `build-tools/tools/dev/zx-init.mjs`. This single change covers every shebang `#!/usr/bin/env
zx-wrapper` invocation in the repo (~99 spawn sites) without per-site edits, including the
  ones spawned from temp scaffolding workspaces.
- Thread `--import "$REPO_ROOT/build-tools/tools/dev/zx-init.mjs"` through the four nix derivations
  that invoke `node` directly against repo source: `flake/packages/node-webapp.nix`,
  `flake/packages/node-service.nix`, `flake/packages/node-vercel-next.nix`, and
  `planner/node-webapp.nix`. These run `sync-module-contracts.ts`, `service-artifact.ts`, and
  `next-artifact.ts` in hermetic sandboxes that strip `NODE_OPTIONS`, so the env-only hook from
  `_env.sh` does not reach them.
- Thread `--import` through the `bulk-move` flake app (`flake/outputs-apps.nix`) and the vite
  plugin in `projects/apps/pleomino/vite.config.ts` that spawns
  `materialize-static-pwa-precache.ts` via `execFileSync`.
- Keep the dev-shell `NODE_OPTIONS` export from `_env.sh` (committed in `255ee410`) as the
  dev-shell side of the contract.
- Defer to a follow-up PR: the actual `.ts`-extension sweep across `.ts`/`.tsx` source files, plus
  the matching contract-test updates (`webapp.phase3-runtime-consistency-policy.contract.test.ts`,
  `webapp.phase4.guardrails.contract.test.ts`) and a lint rule preventing re-introduction. The
  follow-up PR also has to characterize and fix the vite/next dev-server hang that surfaces in
  `webapp-ssr-vite.dev-runtime-consistency.phase3.test.ts`-style tests when bare imports interact
  with vite's own ESM resolver inside a temp scaffolded workspace.

### 3. External prerequisites

- None.

### 4. Tests to be added

- Contract test asserting that the nix-built `zx-wrapper` registers `zx-init.mjs` automatically
  when invoked with `$PWD` inside a tree that contains `build-tools/tools/dev/zx-init.mjs`, and
  also when invoked with an explicit `$ZX_INIT` env var pointing at a non-default location.
- Contract test asserting that the four updated nix derivations
  (`node-webapp`/`node-service`/`node-vercel-next`/`planner-node-webapp`) thread `--import` of
  `zx-init.mjs` through their generated build phase.
- The follow-up sweep PR will own the linter / `.ts`-extension regression tests; this PR does not
  block on them.

### 5. Docs to be added or updated

- Add a short section to `build-tools/docs/build-system-design.md` (or the relevant build-system
  doc) describing how the resolver hook is registered for dev-shell vs. nix-builder execution and
  why redundant `.ts` extensions are no longer needed.
- Update any developer onboarding/contributing notes that previously instructed authors to add
  `.ts` extensions to relative imports.
- Update this plan if the sweep boundaries or exception list change.

### 6. Acceptance criteria

- All existing tests pass at or better than the most recent recorded successful full-suite timing
  baseline (PR-12 baseline 2443s).
- Removing `.ts` from a relative `import` in any single representative source file does not break
  either the dev-shell `i`/`b`/`v` flow or a nix-built derivation that runs `node`.
- The dev-shell `NODE_OPTIONS` export from `_env.sh` (committed in `255ee410`) remains in place as
  the dev-shell side of the contract; the new wrapper-side discovery is additive, not a
  replacement.
- The follow-up sweep PR can run a deterministic source-tree rewrite and remain green without
  needing further infrastructure work.

### 7. Risks

- A nix derivation may execute `node` in a way the audit misses (e.g. a custom builder that strips
  `NODE_OPTIONS` and never threads `--import`), causing a hard build break only after the sweep
  removes `.ts`.
- Tooling outside the repo (editors, type-checkers, third-party scripts) may rely on explicit
  `.ts` extensions; some IDE configurations resolve specifiers using extensions even though
  `tsconfig.json` already sets `moduleResolution: bundler` and `allowImportingTsExtensions: true`.

### 8. Mitigations

- Drive the audit from a list of every place the repo currently invokes `node` (Buck rules, Nix
  derivations, shell scripts, package scripts) and assert each call site has the hook either via
  `NODE_OPTIONS` or via an explicit `--import` arg.
- Stage the change in two phases: first the resolver-hook plumbing across all entry points (with
  the existing `.ts` extensions left in place), validated by the full suite; then the sweep itself,
  validated again.
- Keep the new lint/contract rule active so future `.ts` extensions cannot creep back in
  silently.

### 9. Consequences of not implementing this PR

The repo keeps two parallel import-style conventions (`./foo.ts` mostly, `./foo` in some places),
which contradicts the project's preference and can confuse new contributors. The dev-shell-only
half of the fix from `255ee410` then sits half-finished, since the real benefit (being able to drop
the redundant extensions) is gated on the nix-builder half.

### 10. Downsides for implementing this PR

It touches many derivations and rules across the build system, and the sweep produces a large
mechanical diff that must be reviewed mostly to confirm it is in fact mechanical. The new lint
rule adds another codebase-wide gate that must keep its allowlist accurate as the build system
evolves.

## PR-13: Vercel deploy-CLI service-backed worker runtime parity

### 1. Intent

Close the Vercel parity gap in the deploy CLI client subprocess so protected/shared Vercel
mutations never mint a vault JWT or prepare a deployment vault runtime locally before handing the
request to the reviewed control-plane service path from PR-10.

### 2. Scope of changes

- Add `vercel` to the `serviceBackedWorkerRuntime` selection in
  `build-tools/tools/deployments/deploy-cli.ts` so the CLI client subprocess for protected/shared
  Vercel deploys, previews, retries, rollbacks, and preview cleanups never invokes
  `prepareDeploymentVaultRuntime` or mints a vault JWT locally, matching the existing Kubernetes
  parity fix.
- Treat the existing Vercel protected front-door and control-plane adapter from PR-10 as the service
  destination; this PR owns the deploy-CLI subprocess handoff gap, not another front-door routing
  rewrite.
- Expand the protected/shared Vercel service-only rejection surface to include explicit
  laptop-local artifact inputs such as `--artifact-dir`; the CLI client may submit an admitted
  artifact reference or source selector, but must not hand a local filesystem path to the service
  boundary.
- Keep Vercel CLI client subprocess execution on the PR-10 service-backed front-door path, while
  preserving `local_only` Vercel fixture behavior on the laptop-local path.
- Centralize the provider selection for service-backed worker runtime so protected/shared providers
  cannot silently fall back to laptop-local secret material handling.

### 3. External prerequisites

- No live Vercel account is required.
- No additional secret runtime contracts beyond those already defined for Vercel in PR-3 and PR-10.

### 4. Tests to be added

- A `vercel.control-plane.service.test.ts` end-to-end test analogous to
  `kubernetes.control-plane.service.test.ts` that exercises the deploy CLI client subprocess against
  an in-process Vercel control-plane worker for protected/shared deploy, preview, preview cleanup,
  retry, and rollback.
- Regression coverage proving the deploy CLI client subprocess never calls
  `prepareDeploymentVaultRuntime` for protected/shared Vercel operations.
- Front-door negative coverage proving protected/shared Vercel deploy and preview reject explicit
  laptop-local artifact directories before service submission.
- Provider-selection coverage proving each protected/shared service-backed provider is explicitly
  classified and that `local_only` Vercel still uses the local fixture path.

### 5. Docs to be added or updated

- Update deployment usage docs to call out that protected/shared Vercel mutations always run through
  the service-backed worker runtime, alongside the equivalent Kubernetes statement.
- Update Vercel troubleshooting docs with the CLI client subprocess service path and the local-only
  fixture exception.

### 6. Acceptance criteria

- Protected/shared Vercel mutations through the deploy CLI never construct a deployment vault
  runtime or mint a vault JWT inside the CLI client subprocess.
- Protected/shared Vercel deploy and preview submissions cannot carry laptop-local artifact
  directories across the service boundary.
- The new Vercel control-plane service test passes against the in-process worker for every Vercel
  operation kind covered by PR-10.
- Provider selection fails closed when a protected/shared service-backed provider is missing from
  the runtime classification.

### 7. Risks

- Service-backed worker runtime selection can drift again if a new provider is added without parity
  updates, regressing into laptop-local secret material handling.
- Vercel control-plane service tests can become slow or flaky if the in-process worker harness is
  not shared with the existing Kubernetes harness.

### 8. Mitigations

- Centralize the `serviceBackedWorkerRuntime` selection so adding a provider requires an explicit
  parity decision and add a regression test that fails when a protected/shared provider is missing
  from the set.
- Reuse the existing in-process control-plane worker harness from the Kubernetes service test to
  keep the new Vercel test deterministic and bounded.

### 9. Consequences of not implementing this PR

The deploy CLI client subprocess can still attempt to mint a vault JWT and prepare a deployment
vault runtime locally for protected/shared Vercel deploys, leaving Vercel one parity step behind
Kubernetes.

### 10. Downsides for implementing this PR

It adds another control-plane service end-to-end test and a provider-selection regression gate,
slightly increasing CLI test surface and runtime.

## PR-14: Shared control-plane admission, replay, and frozen execution snapshot

### 1. Intent

Create the shared provider control-plane admission and replay contract that Vercel, Kubernetes, and
S3 all still need to adopt, so protected/shared provider submissions go through one admission engine
and worker execution runs from a frozen admitted execution snapshot with secret-contract references
rather than provider-local inline admission fields.

### 2. Scope of changes

- Introduce a shared provider control-plane submission preparation path that calls
  `evaluateDeploymentAdmission` before writing queued submission records for Vercel, Kubernetes, and
  S3.
- Migrate the current queue implementations in
  `build-tools/tools/deployments/vercel-control-plane.ts`,
  `build-tools/tools/deployments/kubernetes-control-plane.ts`, and
  `build-tools/tools/deployments/s3-static-control-plane.ts` from raw request snapshots to that
  shared preparation path.
- Replace provider-local synthetic `admission` fields with the shared admission evaluation result
  and preserve that result as part of a frozen admitted execution snapshot.
- Define a versioned frozen execution snapshot carrying secret-contract references, admitted
  artifact references, source run IDs, operation kind, provider target identity, and admission
  evidence.
- Replace raw `artifactDir` fields in protected/shared provider submit requests with admitted
  artifact references or reviewed source selectors before the worker snapshot is persisted.
- Migrate Vercel, Kubernetes, and S3 workers to execute from the frozen admitted execution snapshot
  instead of reconstructing admission state from raw request inputs.
- Use admitted-selector replay for retry, rollback, promotion, and preview cleanup where supported,
  so provider workers reuse recorded admitted snapshots and exact artifact evidence consistently.
- Preserve existing provider-specific artifact admission, smoke, fake API, Helm/S3/Vercel publisher,
  and record behavior behind the shared admission and replay boundary.

### 3. External prerequisites

- No live provider account is required.
- No new secret runtime contracts beyond those already defined for Vercel, Kubernetes, and S3.

### 4. Tests to be added

- Admission engine tests proving Vercel, Kubernetes, and S3 deploy-style submissions are admitted,
  denied, or queued by `evaluateDeploymentAdmission` through the same shared preparation path.
- Frozen execution-snapshot tests proving each migrated provider worker executes from snapshot
  secret-contract references and admitted artifact references, and never reconstructs the secret
  runtime from raw request inputs.
- Replay tests proving Vercel retry, rollback, and preview cleanup, plus Kubernetes/S3 exact-artifact
  replay paths, resolve admitted-selector recorded snapshots and reject mismatched admission
  evidence.
- Negative tests proving provider control-plane workers reject submissions whose admission decision
  did not come from the shared admission engine.

### 5. Docs to be added or updated

- Update deployment design and usage docs to state that provider control-plane submissions go
  through the shared admission engine and execute from frozen admitted execution snapshots.
- Update Vercel, Kubernetes, and S3 troubleshooting docs with admission-evidence and
  frozen-snapshot failure modes.

### 6. Acceptance criteria

- Vercel, Kubernetes, and S3 control-plane submissions never bypass `evaluateDeploymentAdmission`
  and never synthesize provider-local `admission` fields inline.
- Vercel, Kubernetes, and S3 workers execute only from frozen admitted execution snapshots with
  secret-contract references and admitted artifact references.
- Protected/shared provider snapshots do not persist laptop-local artifact directories as execution
  inputs.
- Vercel retry, rollback, and preview cleanup, plus Kubernetes/S3 exact-artifact replay paths,
  resolve admitted-selector replay through the same shared engine.

### 7. Risks

- Migrating existing provider workers to admission-engine and frozen-snapshot execution can break
  recorded fixtures that were captured under provider-local inline paths.
- Snapshot shape changes can cause drift between provider workers if the contract is not centrally
  versioned.

### 8. Mitigations

- Re-record affected provider fixtures alongside the migration and add cross-provider tests proving
  the admission engine and frozen-snapshot contract are shared.
- Treat the admitted execution snapshot as a versioned contract owned by the deployment design and
  test it on every migrated provider path.

### 9. Consequences of not implementing this PR

Provider control-plane execution remains structurally divergent from the design's frozen admission
snapshot and admitted-selector replay model, leaving lane gating, admission evidence, and replay
guarantees dependent on provider-local implementations.

### 10. Downsides for implementing this PR

It requires reworking already-shipped provider workers and re-recording fixtures, increasing
short-term churn and test maintenance.

## PR-15: Shared submit-layer idempotency dedup against payload fingerprint

### 1. Intent

Bring provider control-plane submissions into compliance with the design's submit-layer idempotency
contract so duplicate Vercel, Kubernetes, and S3 requests dedupe against normalized payload
fingerprints instead of always recording synthetic `direct:<submissionId>` request fingerprints.

### 2. Scope of changes

- Compute normalized provider submission payload fingerprints that include operation kind, target
  identity, admitted artifact reference, source run ID, preview cleanup inputs, smoke overrides, and
  any other replay-relevant fields from the frozen admitted execution snapshot.
- Reuse the existing submit-layer helpers in
  `build-tools/tools/deployments/deployment-control-plane-idempotency.ts` instead of introducing a
  second provider-specific idempotency mechanism.
- Replace the always-`created` synthetic `dedupe: {mode: "created", requestFingerprint:
"direct:<submissionId>"}` writes in Vercel, Kubernetes, and S3 with the shared submit-layer
  idempotency engine that returns `created` on first submit and `duplicate` on payload-fingerprint
  match.
- Cover retry, rollback, promotion, and preview cleanup where supported with the same submit-layer
  idempotency contract so repeated requests collapse onto the recorded admitted submission instead
  of producing duplicate records.
- Preserve `local_only` fixture behavior outside the submit-layer idempotency boundary.

### 3. External prerequisites

- No live provider account is required.
- Depends on PR-14's admission and frozen-snapshot integration so payload fingerprints can be
  computed from admitted inputs rather than raw request inputs.

### 4. Tests to be added

- Submit-layer idempotency tests proving identical Vercel, Kubernetes, and S3 payloads return
  `duplicate` and reuse the recorded admitted submission.
- Tests proving payload-fingerprint differences across operation kind, target identity, admitted
  artifact reference, source run ID, preview cleanup inputs, and smoke overrides each produce
  distinct submissions.
- Negative tests proving the synthetic `direct:<submissionId>` request fingerprint is never written
  by migrated provider control planes.
- Cross-provider tests proving Vercel, Kubernetes, and S3 share the same submit-layer idempotency
  engine and contract.

### 5. Docs to be added or updated

- Update deployment design and usage docs with the shared submit-layer idempotency contract and the
  fields included in provider payload fingerprints.
- Update provider troubleshooting docs with `duplicate` submission outcomes and how to interpret
  payload-fingerprint mismatches.

### 6. Acceptance criteria

- Vercel, Kubernetes, and S3 control-plane submissions always dedupe through the shared
  submit-layer idempotency engine against normalized payload fingerprints.
- The synthetic `direct:<submissionId>` request fingerprint is removed from migrated provider
  control-plane writes.
- Retry, rollback, promotion, and preview cleanup honor submit-layer idempotency on the same shared
  code path where those operation kinds are supported.

### 7. Risks

- Choosing the wrong fields for provider payload fingerprints can cause false `duplicate` matches or
  miss true duplicates.
- Adding submit-layer idempotency to retry, rollback, and preview cleanup can interact subtly with
  admitted-selector replay if the two contracts are not aligned.

### 8. Mitigations

- Derive payload fingerprints from the admitted execution snapshot from PR-14 so each field set is
  bound to the admitted contract.
- Test submit-layer idempotency and admitted-selector replay together for every Vercel operation
  kind and for Kubernetes/S3 exact-artifact replay paths.

### 9. Consequences of not implementing this PR

Provider control-plane submissions can record duplicate admitted submissions for the same payload and
do not satisfy the design's submit-layer idempotency contract.

### 10. Downsides for implementing this PR

It introduces another shared contract dependency on the submit-layer idempotency engine and requires
re-recording provider control-plane fixtures whose `dedupe` shape changes.

## PR-16: Live Vercel prebuilt API publisher and failure records

### 1. Intent

Close the remaining Vercel publishing gap by adding a real Vercel API client for admitted prebuilt
artifacts while keeping the existing fake client as an explicit local/test fixture.

### 2. Scope of changes

- Add a live Vercel API client that can upload admitted Build Output API artifacts, create
  deployments, assign aliases/domains where configured, and poll provider outcomes.
- Select the live client only for protected/shared or explicitly configured live provider profiles;
  keep fake/local Vercel publishing opt-in and visibly non-production.
- Resolve Vercel API credentials exclusively through deployment `secret_requirements` and the
  reviewed secret runtime.
- Treat ambiguous, partial, or eventually consistent Vercel API outcomes as failed or pending
  provider records with redacted diagnostics and provider IDs when available.
- Preserve the existing local fake publisher contract for deterministic PR checks.

### 3. External prerequisites

- Vercel team/project access and API token stored through the repo's Vault/secretspec backend.
- Network egress from the deployment worker to Vercel APIs.
- DNS/domain ownership for any configured production or staging aliases.

### 4. Tests to be added

- Fake HTTP Vercel API tests for upload, create deployment, alias/domain assignment, polling,
  success, provider failure, and ambiguous outcome handling.
- Secretspec tests proving Vercel tokens are resolved only through deployment secret runtime and are
  not written to records or diagnostics.
- Selection tests proving live provider profiles use the live client and local/test profiles keep
  using the fake client.
- Record tests proving live provider IDs, URLs, aliases, artifact identity, source run ID, and
  redacted diagnostics are persisted.

### 5. Docs to be added or updated

- Update deployment usage docs with live Vercel setup, secret contract IDs, and failure modes.
- Update deployment troubleshooting docs with Vercel upload, alias/domain, polling, and ambiguous
  API outcome diagnostics.
- Update this plan if live Vercel API limitations force a different production assignment model.

### 6. Acceptance criteria

- Protected/shared Vercel deploys can use a real Vercel API client without consuming ambient local
  Vercel state.
- Required Vercel credentials are resolved only through reviewed deployment secrets.
- Provider records distinguish successful, failed, pending, and ambiguous live Vercel outcomes with
  redacted diagnostics.

### 7. Risks

- Vercel API behavior can be eventually consistent or return partial success after transport
  failures.
- Live API coverage can become flaky if tests depend on external network or account state.

### 8. Mitigations

- Keep PR tests on fake HTTP servers and make live account checks an explicit operator or admission
  gate outside normal PR validation.
- Record every provider ID and URL returned before an ambiguous failure so operators can reconcile
  externally created resources.

### 9. Consequences of not implementing this PR

Vercel deployments remain fake-only despite the plan's live protected/shared publishing contract.

### 10. Downsides for implementing this PR

It adds live provider API coupling and operational failure handling to the Vercel publisher surface.

## PR-17: Vercel service-backed CLI handoff for protected/shared mutations

### 1. Intent

Finish the Vercel protected/shared CLI parity work so deploy, preview, retry, rollback, and preview
cleanup always hand off to the reviewed control-plane service and never prepare laptop-local
artifacts or vault runtime state.

### 2. Scope of changes

- Add Vercel to the deploy CLI service-backed provider selection for protected/shared lanes and
  provider profiles.
- Reject protected/shared Vercel `--artifact-dir` and other laptop-local artifact inputs before
  submit, including deploy and preview flows.
- Route protected/shared Vercel deploy, preview, preview cleanup, retry, and rollback through the
  PR-14 frozen snapshot and PR-15 submit-idempotency control-plane queue path.
- Ensure the CLI client subprocess never calls `prepareDeploymentVaultRuntime` for protected/shared
  Vercel mutations.
- Preserve local/test Vercel flows for non-protected profiles where explicit local behavior remains
  supported.

### 3. External prerequisites

- Depends on PR-14's frozen provider snapshots and PR-15's shared submit idempotency.
- No new secret runtime contracts beyond those already required for Vercel publish and preview
  cleanup.

### 4. Tests to be added

- Deploy CLI subprocess tests proving protected/shared Vercel deploy, preview, preview cleanup,
  retry, and rollback use the service-backed path.
- Regression tests proving protected/shared Vercel CLI execution never calls
  `prepareDeploymentVaultRuntime` and rejects `--artifact-dir`.
- Front-door negative tests proving laptop-local artifact inputs are rejected before a queued
  provider submission is written.
- Local/test profile tests proving explicitly local Vercel behavior still works where supported.

### 5. Docs to be added or updated

- Update deployment usage docs to state that protected/shared Vercel operations are service-backed
  and reject laptop-local artifacts.
- Update troubleshooting docs with the protected/shared Vercel handoff and local-artifact rejection
  messages.

### 6. Acceptance criteria

- Protected/shared Vercel CLI mutations cannot prepare local vault runtime state or submit
  laptop-local artifact directories.
- All protected/shared Vercel mutation kinds use the reviewed control-plane service path.
- Operator-facing errors clearly explain how to submit admitted artifacts or source-run selectors.

### 7. Risks

- Tightening protected/shared Vercel CLI behavior can break existing local operator workflows that
  were accidentally relying on laptop-local state.

### 8. Mitigations

- Keep local/test profile behavior explicit and document the protected/shared distinction.
- Add targeted error messages that point operators to admitted artifacts, preview source runs, and
  rollback/retry source selectors.

### 9. Consequences of not implementing this PR

Protected/shared Vercel CLI execution can still bypass the reviewed service handoff and contradict
the deployment docs.

### 10. Downsides for implementing this PR

It tightens Vercel CLI compatibility and may require operators to adjust preview and emergency
replay habits.

## PR-18: Production OpenTofu apply adapter for Kubernetes control-plane workers

### 1. Intent

Wire OpenTofu provision-only and app-attached Kubernetes control-plane runs to a production apply
adapter so admitted plans are actually applied or fail closed instead of silently succeeding when no
test hook adapter is present.

### 2. Scope of changes

- Add the production OpenTofu apply adapter used by Kubernetes control-plane workers for
  provision-only and app-attached provisioner runs.
- Require admitted plan fingerprints, backend/workspace identity, provider credential references,
  and reviewed config fingerprints before apply begins.
- Fail closed when the production adapter cannot be constructed, credentials are missing, the plan
  fingerprint does not match, or apply exits without a recorded provider outcome.
- Persist OpenTofu apply outcomes, state identity, redacted diagnostics, and exact plan/config
  fingerprints in deployment records.
- Keep fake/test apply adapters injectable for deterministic PR checks.

### 3. External prerequisites

- OpenTofu binary/toolchain pinned through the repo's Nix model.
- Backend and provider credentials stored through reviewed deployment secret requirements.
- Reviewed backend/workspace configuration for each foundation or app-attached provisioner.

### 4. Tests to be added

- Kubernetes control-plane worker tests proving provision-only and app-attached runs construct and
  invoke the production OpenTofu adapter when no test hook adapter is supplied.
- Negative tests proving missing credentials, missing plan fingerprints, mismatched plan
  fingerprints, missing backend identity, and adapter construction failures fail closed.
- Record tests proving successful and failed applies persist plan fingerprints, backend/workspace
  identity, redacted diagnostics, and apply outcome.
- Existing fake adapter tests must remain deterministic and separate from production adapter
  construction tests.

### 5. Docs to be added or updated

- Update deployment usage docs with OpenTofu production apply behavior, required secrets, backend
  identity, and provision-only failure modes.
- Update troubleshooting docs with OpenTofu plan/apply mismatch and credential diagnostics.

### 6. Acceptance criteria

- Protected/shared Kubernetes provision-only and app-attached OpenTofu runs cannot record success
  without an apply outcome.
- Production workers fail closed when admitted plan evidence or credentials are incomplete.
- Deployment records preserve enough redacted OpenTofu apply evidence for audit and replay review.

### 7. Risks

- Production OpenTofu apply behavior can mutate external infrastructure and has more operational
  failure modes than fake adapter tests.

### 8. Mitigations

- Keep normal PR tests on fake or hermetic adapters while making production adapter construction and
  fail-closed behavior testable without live infrastructure.
- Require explicit reviewed credentials, backend identity, and admitted plan fingerprints before any
  apply mutation starts.

### 9. Consequences of not implementing this PR

OpenTofu provision-only and app-attached control-plane runs can record success without applying the
admitted plan in the shipped worker path.

### 10. Downsides for implementing this PR

It introduces production infrastructure mutation wiring and requires careful diagnostics around
credential, backend, and plan mismatches.

## PR-19: Concrete Phase 0 deployment packages and build-graph wiring

### 1. Intent

Use the deployment scaffolds and provider contracts from earlier PRs to create the actual Phase 0
deployment packages required by the architecture, rather than leaving the app represented only by
generic templates and provider capabilities. This PR intentionally absorbs the remaining
build-graph-facing Phase 0 deployment work so later PRs can stay mostly in deployment-domain
runtime, admission, or policy code and avoid repeatedly forcing full build-system validation.

### 2. Scope of changes

- Create deployment packages under `projects/deployments/` for:
  - `platform-shared`
  - `platform-foundation-dev`, `platform-foundation-staging`, and `platform-foundation-prod`
  - `data-room-console-dev`, `data-room-console-staging`, and `data-room-console-prod`
  - `data-room-web-dev`, `data-room-web-staging`, and `data-room-web-prod`
  - `data-room-worker-dev`, `data-room-worker-staging`, and `data-room-worker-prod`
- Wire console deployments to the Vercel prebuilt artifact target and `opentofu-stack` provisioner
  for project, domain, and environment-setting configuration.
- Wire web and worker deployments to admitted service artifacts or image digests and app-attached
  `opentofu-stack` provisioners for service infrastructure.
- Wire foundation deployments as provision-only OpenTofu targets for shared DNS, Supabase resources,
  object buckets, secret path scaffolding, and OpenTofu state configuration.
- Add the migration-bundle artifact target that combines `platform-db/migrations/` and
  `data-room-db/migrations/` in Buck-declared dependency order, and attach that artifact to
  `platform-foundation-*` deployment metadata.
- Add reviewed placeholder provider identities, lane policy references, protection classes,
  `secret_requirements`, `runtime_config_requirements`, smoke checks, and readiness gate references
  that fail validation until real environment values are supplied.
- Add the cquery/extraction attributes needed for concrete deployment targets, migration bundle
  identity, readiness gate references, and release prerequisites in one build-system-facing change.
- Keep all project-specific infrastructure below the owning deployment package; do not introduce a
  separate top-level `infra/` tree.

### 3. External prerequisites

- Agreement on initial dev, staging, and prod provider target names for Vercel, the chosen container
  runtime, Supabase, DNS, and OpenTofu state.
- Stable secret contract IDs for all deployment families.
- Placeholder values are acceptable for this PR if they fail validation until intentionally replaced.

### 4. Tests to be added

- Scaffold/golden tests proving the concrete Phase 0 deployment packages match the reviewed template
  shape after environment-specific answers are supplied.
- Cquery extraction tests proving every concrete package extracts as a deployment target with the
  expected provider family, component target, protection class, lane policy, provisioner, secret
  requirements, runtime config requirements, smoke checks, and readiness gates.
- Migration-bundle extraction tests proving cross-package migration dependencies determine bundle
  order and missing dependencies fail closed.
- Front-door validation tests proving unresolved placeholders fail closed with actionable diagnostics.
- Graph tests proving all concrete deployment component targets point at `projects/apps/*` artifacts
  and no app deployment imports another app target.
- Build-system selector tests proving this PR owns the broad cquery/scaffold/build-graph validation
  pass for the Phase 0 deployment packages, so PR-20 through PR-22 can avoid touching target
  extraction unless implementation discovers a real missing attribute.

### 5. Docs to be added or updated

- Update deployment usage docs with the concrete Phase 0 deployment labels and the expected dev,
  staging, and prod flow.
- Update schema/migration docs with the protected/shared migration bundle target and how it is bound
  to foundation deployment metadata.
- Update the OpenTofu stack layout guide with where console, service, and foundation stack files live
  for these concrete deployments.
- Update secrets docs with the exact Phase 0 deployment contract IDs and which deployment family uses
  each one.

### 6. Acceptance criteria

- The Phase 0 architecture's required deployment directories exist as first-class deployment packages.
- Console, web, worker, foundation, and shared governance targets can be resolved through the normal
  repo deployment front door.
- The migration bundle is a Buck-visible artifact attached to foundation deployment metadata.
- Placeholder or incomplete environment values cannot accidentally pass protected/shared validation.
- No project-specific infrastructure is introduced outside `projects/deployments/`.

### 7. Risks

- Concrete package generation can lock in provider naming before external accounts are finalized.
- Placeholder values can be mistaken for production-ready configuration if validation is too lenient.
- Consolidating build-graph work into this PR makes the PR larger and more likely to require the full
  build-system validation suite.

### 8. Mitigations

- Use clearly invalid placeholder identities that produce deterministic validation errors until
  replaced.
- Keep environment-specific provider IDs reviewed metadata and update this plan if account naming or
  runtime selection changes.
- Keep the build-system-facing changes mechanical and limited to deployment target extraction,
  scaffold output, graph visibility, and migration bundle metadata.

### 9. Consequences of not implementing this PR

The deployment machinery can exist without the Phase 0 app actually being represented as deployable
console, web, worker, shared, and foundation targets.

### 10. Downsides for implementing this PR

It adds a substantial amount of deployment metadata before all external accounts may exist, and it is
expected to trigger the broad build-system validation suite. The payoff is that the later closeout
PRs can stay off the full build-system critical path unless they uncover a missing extraction
contract.

## PR-20: Complete Phase 0 readiness-gate admission coverage

### 1. Intent

Close the gap between generic readiness-gate support and the full Phase 0 pilot gates, especially
the external-source and GitHub gates that decide whether design partners may see connector flows.

### 2. Scope of changes

- Add typed readiness-gate evidence for every Phase 0 gate required by the engineering companion:
  - Gate 1 Ragie ACL array semantics or boolean fallback evidence
  - Gate 2 live tenant-leak suite evidence
  - Gate 3 WorkOS MCP Auth client evidence for Claude, ChatGPT, and Cursor or approved equivalent
  - Gate 4 `fetch_full_document` grant lifecycle evidence
  - Gate 5 Connect and GitHub external-source evidence
- Extend Gate 5 evidence to cover:
  - Connect metadata shape and overlay survival
  - Connect OAuth flows for Drive, Notion, and Slack when enabled
  - Connect source-update Window A validation or enforced `paused_after_import` fallback
  - scoped-source enforcement for Drive, Notion, Slack, and GitHub
  - Connect branding observation and external-demo eligibility
  - Slack single-channel and Notion workspace-token limitation decisions
  - Connect most-restrictive default ACL and `review_pending` landing behavior
  - GitHub selected-repository install, permissions, token non-persistence, hygiene, refresh semantics,
    and retrieval bakeoff
  - `fetch_full_document` denial for Connect-sourced and GitHub-sourced documents under every policy
    combination
- Bind all readiness evidence to deployment, provider target identity, source revision, environment,
  gate version, run timestamp, and redacted diagnostics.
- Allow admission policy to distinguish direct-upload pilot access, connector demo access, and
  internal-only connector validation.
- Ensure evidence can be required for protected/shared deployments without storing external-service
  secrets in CI variables or deployment records.
- Consume the readiness-gate declarations extracted by PR-19; do not add new cquery or scaffold
  attributes in this PR unless PR-19's contract is proven insufficient.

### 3. External prerequisites

- Non-production WorkOS, Ragie, Supabase, storage, GitHub App, and connector-source accounts for live
  validation.
- A policy decision for which gates block dev, staging, prod, direct-upload pilot access, and
  connector demo access.
- Vault roles for all live gate secret contracts.

### 4. Tests to be added

- Admission evaluator tests for each Phase 0 readiness gate and sub-gate, including missing,
  expired, wrong-target, wrong-source-revision, and wrong-environment evidence.
- Fixture evidence tests proving diagnostics are redacted while preserving enough context for review.
- Negative tests proving connector-demo admission fails when Gate 5 lacks source-update validation,
  scoped-source evidence, branding evidence, GitHub hygiene evidence, or external-source
  `fetch_full_document` denial evidence.
- Policy tests proving direct-upload pilot admission can pass with Gates 1-4 while connector-demo
  admission still blocks until Gate 5 passes.
- Secretspec tests proving live gate credentials resolve only through reviewed secret runtime steps.
- Regression tests proving readiness admission consumes PR-19 deployment metadata without requiring
  another build-system extraction change.

### 5. Docs to be added or updated

- Update deployment schema/admission docs with the Phase 0 gate evidence types and their binding
  fields.
- Update deployment usage docs with direct-upload versus connector-demo admission examples.
- Update operator troubleshooting docs with readiness-gate failure messages and rerun guidance.
- Update this plan if any gate is intentionally moved from protected/shared admission to a separate
  release-health workflow.

### 6. Acceptance criteria

- Protected/shared deployments can require all Phase 0 pilot readiness gates by policy.
- Connector-demo admission cannot pass without the full Gate 5 Connect and GitHub evidence set.
- Direct-upload pilot admission remains separately expressible with Gates 1-4 only.
- Gate evidence is redacted, target-bound, source-bound, and environment-bound.
- The PR remains deployment-admission/policy scoped and does not require a second full build-system
  validation pass after PR-19.

### 7. Risks

- Live gate evidence can become stale, flaky, or too expensive to rerun frequently.
- Encoding every Gate 5 sub-gate can make admission policy hard to understand.

### 8. Mitigations

- Version gate evidence and give each evidence type explicit freshness and target-binding rules.
- Keep operator diagnostics short but link to runbooks that explain how to rerun each live gate.
- Separate fast PR checks from protected/shared admission checks.
- If gate metadata cannot be represented by the PR-19 extraction shape, update PR-19 before starting
  this PR rather than spreading build-system work across both.

### 9. Consequences of not implementing this PR

The deployment system can admit external deployments before the architecture's hard pilot and
connector-demo readiness gates have actually passed.

### 10. Downsides for implementing this PR

It adds live-environment policy complexity and requires operators to manage several external test
accounts before connector-demo readiness can be proven.

## PR-21: Foundation migration apply runtime and post-apply RLS checks

### 1. Intent

Make schema migration rollout a protected/shared deployment concern by attaching the cross-package
migration bundle from PR-19, Supabase apply step, and post-apply isolation checks to
`platform-foundation-*` deployments without adding new build-system target shapes.

### 2. Scope of changes

- Consume the migration-bundle artifact and foundation deployment metadata created in PR-19.
- Add the runtime adapter that applies the admitted migration bundle as a reviewed provision or
  release action before web and worker readers are promoted.
- Resolve Supabase service credentials only through deployment `secret_requirements` at the migration
  or provision step.
- Record migration bundle identity, migration list, dependency graph fingerprint, target Supabase
  identity, apply outcome, and redacted diagnostics.
- Run post-apply checks for RLS tenant isolation, composite tenant-aware FK behavior, migration
  ordering invariants, and required extension/settings posture.
- Add release prerequisites so web and worker deployments cannot promote readers that require schema
  changes until the foundation migration run has succeeded for the same reviewed source revision or a
  compatible migration revision.

### 3. External prerequisites

- Dev, staging, and prod Supabase project identities or equivalent Postgres targets.
- Vault-backed Supabase service-role credentials scoped to migration/provision execution.
- A reviewed policy for destructive or irreversible migration exceptions.

### 4. Tests to be added

- Fake Supabase/Postgres apply tests proving bundle identity, target identity, and apply outcome are
  recorded.
- Runtime contract tests proving PR-21 consumes the existing PR-19 migration-bundle metadata rather
  than introducing new target extraction attributes.
- Post-apply check tests for RLS, composite FK violations, tenant context setup, and failure
  diagnostics.
- Admission/prerequisite tests proving web and worker deployments block when required foundation
  migration evidence is absent, stale, failed, or bound to the wrong source revision.
- Secretspec tests proving Supabase migration credentials are scoped to the migration/provision step
  and are not recorded.

### 5. Docs to be added or updated

- Update deployment usage docs with the foundation migration flow and its relationship to web and
  worker promotion.
- Update schema/migration docs with protected/shared migration apply, post-apply checks, and
  destructive migration exception handling.
- Update troubleshooting docs with migration-order, RLS, Supabase credential, and post-apply check
  failure modes.

### 6. Acceptance criteria

- Protected/shared schema changes are applied through `platform-foundation-*` deployment records, not
  ad hoc operator commands.
- Web and worker deployments can require successful migration evidence before promotion.
- Post-apply RLS and composite-FK checks run as deploy-blocking checks for protected/shared
  environments.
- Migration credentials are resolved only through the deployment secret runtime.
- No new build-system extraction or scaffold surface is added after PR-19.

### 7. Risks

- Migration application can become a long-running or partially successful operation with hard recovery
  semantics.
- Binding app promotion to migration evidence can block otherwise safe deploys when compatibility
  windows are not modeled carefully.
- A runtime implementation may discover that PR-19's extraction shape omitted data needed for safe
  migration apply.

### 8. Mitigations

- Require migration compatibility metadata and reviewed destructive exceptions for risky changes.
- Record enough migration and target identity information to support in-doubt-run recovery.
- Keep app-reader prerequisites compatible with backward-compatible migration sequences and feature
  flags.
- If a missing extraction field is found, update PR-19's build-graph contract before implementing
  this PR rather than spreading cquery changes into PR-21.

### 9. Consequences of not implementing this PR

The architecture's schema, RLS, and composite-FK guarantees can be implemented in code but still
rolled out through unreviewed or unordered database changes outside deployment admission.

### 10. Downsides for implementing this PR

It adds a database mutation surface to foundation deployments and increases the amount of evidence
that must be preserved for every protected/shared release.

## PR-22: Coordinated Phase 0 release promotion and prerequisite enforcement

### 1. Intent

Enforce the Phase 0 coordinated release model across the separate console, web, worker, and
foundation deployments without pretending cross-provider releases are atomic.

### 2. Scope of changes

- Add a shared Phase 0 release group or prerequisite model connecting:
  - `platform-foundation-*`
  - `data-room-worker-*`
  - `data-room-web-*`
  - `data-room-console-*`
- Enforce promotion of the same reviewed source revision through dev, staging, and prod unless an
  explicit reviewed compatibility exception is present.
- Preserve separate artifact identities for console, web, and worker while binding them to the same
  release source revision and lane policy.
- Encode default capability-add ordering as foundation/schema, worker, web, console.
- Encode capability-removal ordering as console, web, worker, then foundation cleanup when needed.
- Add deployment prerequisites for runtime config compatibility, console-to-web base URL, web API
  readiness, worker job compatibility, migration evidence, and smoke or release-health checks.
- Support feature-flag or compatibility-window metadata for risky non-atomic changes.
- Keep each deployment single-provider; the release group coordinates separate deployments rather
  than creating one cross-provider deployment object.
- Consume the concrete deployment package and prerequisite metadata extracted by PR-19; avoid adding
  new target shapes or cquery attributes in this PR.

### 3. External prerequisites

- A policy decision on how strictly dev lanes must match staging/prod source-revision promotion.
- Provider target identities for all concrete Phase 0 deployment packages.
- Operator agreement on compatibility exception review requirements.

### 4. Tests to be added

- Promotion tests proving console, web, and worker deployments can advance through dev, staging, and
  prod only with the required shared reviewed source revision or reviewed compatibility exception.
- Prerequisite tests proving console promotion blocks when web readiness, console-to-web runtime
  config, migration evidence, or required smoke checks are missing.
- Ordering tests proving add-capability and remove-capability flows enforce the documented sequence.
- Record tests proving release group runs preserve separate artifact identities and provider records
  while linking them to one release source revision.
- Negative tests proving the release group does not collapse the system into a multi-provider
  deployment target.
- Regression tests proving coordinated release enforcement consumes PR-19 metadata without requiring
  additional build-system extraction changes.

### 5. Docs to be added or updated

- Update deployment usage docs with Phase 0 release group commands, ordering, compatibility windows,
  and rollback/retry expectations.
- Update deployment schema/admission docs with release prerequisites and source-revision coherence
  fields.
- Update operator troubleshooting docs with common cross-deployment prerequisite failures.

### 6. Acceptance criteria

- Phase 0 deployments remain separate provider-specific targets but can be promoted as a coordinated
  release with explicit prerequisites.
- Worker, web, and console promotion order follows the architecture for adding and removing
  capabilities.
- Deployment records preserve separate artifact identity and provider target identity for each
  component while binding the release to a reviewed source revision.
- Risky non-atomic changes require feature-flag, compatibility-window, or reviewed exception
  metadata.
- The PR stays in deployment orchestration/admission code and does not trigger another broad
  build-system validation pass after PR-19.

### 7. Risks

- Release grouping can drift into a hidden multi-provider deployment abstraction.
- Strict source-revision matching can make emergency fixes awkward if one component needs a targeted
  patch.

### 8. Mitigations

- Keep the release group as orchestration over normal deployment targets and records, not a new
  provider type.
- Add reviewed compatibility exceptions with explicit expiration and diagnostics for targeted
  hotfixes.
- If implementation needs extra extracted metadata, fold that requirement back into PR-19 before
  starting this PR.

### 9. Consequences of not implementing this PR

Console, web, worker, and foundation deployments can each be correct in isolation while still being
released in an order or source-revision combination that violates the Phase 0 architecture.

### 10. Downsides for implementing this PR

It adds orchestration and policy surface across deployment families and requires operators to reason
about compatibility windows for non-atomic releases.
