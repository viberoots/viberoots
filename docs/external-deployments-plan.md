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
