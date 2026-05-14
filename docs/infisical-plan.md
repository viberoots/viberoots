# Infisical Deployment Secrets Plan

This plan implements the Infisical deployment secrets model described in
[Infisical Deployment Secrets Design](/Users/kiltyj/Code/viberoots/docs/infisical-design.md).

Reviewed context:

- Deployment metadata remains authoritative in `TARGETS`; provider-native files and secret backends
  are not a second source of truth for deployment facts.
- `SprinkleRef` remains the repo-level contract layer. Deployments declare secret needs through
  `secret_requirements`, and provider publishers, provisioners, smoke runners, and release actions
  consume resolved secrets only through the deployment secret runtime.
- Vault remains the default and supported production backend. Infisical is added for provider parity,
  not as a replacement or migration forcing function.
- The first Infisical release uses deployment-wide backend selection, direct shared secrets only,
  deterministic snake_case secret names derived from contract ids by default, read-only admin
  diagnostics, and Universal Auth as the only operator-visible Infisical workload credential source.
- `VBR_DEPLOYMENT_SECRET_FIXTURE_PATH` stays provider-neutral and overrides both Vault and Infisical
  only for local/test flows or explicit local fixture service mode.
- No Infisical access token, Universal Auth client secret, personal token, secret value, expanded
  secret reference, or rendered secret-bearing config may be persisted in deployment records, logs,
  checked-in metadata, or diagnostics.

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no replacement or deletion of Vault bootstrap, admin, direct runtime, or replay support
- no per-requirement mixed-backend deployment support in the first implementation
- no Infisical admin `sync` or mutation of Infisical projects, identities, roles, memberships, or
  placeholders in the first implementation
- no ambient Infisical CLI session, personal token, client-submitted token, or client-submitted
  secret-value support
- no Buck action, Nix planner, or artifact-producing build route that contacts Infisical

Verify-scope organization:

- The PR sequence is intentionally organized so ordinary implementation work stays under the
  reviewed deployment-owned paths from
  [Deployment Verify Scope](/Users/kiltyj/Code/viberoots/docs/deployment-verify-scope.md):
  - `build-tools/deployments/**`
  - `build-tools/tools/deployments/**`
  - `build-tools/tools/tests/deployments/**`
  - exact reviewed support paths listed in that document
- Backend dispatch, redaction helpers, fake Infisical servers, CLI/admin commands, and runtime
  helper wiring should live in deployment-owned modules, not in shared `build-tools/tools/lib/**`,
  `build-tools/lang/**`, root Buck/Nix config, or shared test-loader files, when that is the clean
  ownership boundary for the code.
- If an implementation discovers that a shared path really must change, update this plan first and
  treat that PR as `mixed-build-system`; clean design takes precedence over minimizing verify scope,
  and shared build-system work must not be hidden inside a nominally deployment-only PR.
- The only planned non-`deployment-only` PR is the final end-to-end scenario PR if it adds or changes
  checked-in packages under `projects/deployments/**`; that should classify as
  `deployment-and-project-impact`, not full build-system scope, unless implementation discovers a
  shared-path change is the right design.

Each PR below must update this plan if implementation changes invalidate the remaining sequence,
scope, or assumptions.

## PR-1: Secret backend contract and deployment metadata extraction

### 1. Intent

Add the backend-selection contract and Buck metadata surface needed for Infisical while preserving
Vault as the default for every existing deployment.

### 2. Scope of changes

- Widen `DeploymentSecretBackendKind` from only `vault` to `vault | infisical`.
- Keep `deploymentSecretContractBindings(...)` defaulting to Vault when no backend is supplied.
- Add normalized deployment metadata fields:
  - `secret_backend`, extracted as `secretBackend`
  - `infisical_runtime`, extracted as `infisicalRuntime`
  - `infisical_secret_mappings`, extracted as `infisicalSecretMappings`
- Add these fields to deployment target rules and provider helper macros without changing provider
  behavior.
- Validate backend metadata shape at extraction/validation time:
  - unsupported `secret_backend` fails
  - omitted backend normalizes to Vault
  - `secret_backend = "infisical"` with non-empty `secret_requirements` requires
    `infisical_runtime.site_url`, `project_id`, `environment`, and a reviewed credential source
    unless fixture mode is explicitly active
  - Infisical mapping keys must correspond to declared `secret_requirements`
  - mapping values must have non-empty `secret_name` and valid `secret_path`
  - forbidden Infisical runtime key names such as `token`, `secret_value`, `client_secret`, and
    obvious secret-material names fail validation
- Ensure deployment metadata JSON and query helpers expose only non-secret Infisical routing data.
- Do not add any Infisical network call in Buck rules, macros, extraction, validation, or Nix.

### 3. External prerequisites

- None. Existing deployments continue to default to Vault.

### 4. Tests to be added

- Add unit tests proving `DeploymentSecretBackendKind` accepts Vault and Infisical and that omitted
  backend metadata still produces Vault contract bindings.
- Add deployment extraction tests proving `secret_backend`, `infisical_runtime`, and
  `infisical_secret_mappings` are emitted from `TARGETS`.
- Add validation tests rejecting unsupported backends, missing Infisical runtime for required
  secrets, stale mappings, invalid mapping paths/names, and forbidden secret-looking runtime keys.
- Add fixture deployment metadata tests proving an Infisical deployment with no secret requirements
  does not require runtime credentials.
- Add a guardrail test proving extraction and validation do not attempt to contact Infisical.

### 5. Docs to be added or updated

- Update deployment schema docs for `secret_backend`, `infisical_runtime`, and
  `infisical_secret_mappings`.
- Update secrets usage docs to describe deployment-wide backend selection and Vault defaulting.
- Update the deployment secrets API docs with the widened backend kind and metadata field names.

### 5.5. Expected regression scope

- `deployment-only`
- Keep implementation under `build-tools/deployments/**`,
  `build-tools/tools/deployments/**`, and `build-tools/tools/tests/deployments/**`. If backend
  metadata extraction requires changing shared Buck graph tooling, split that discovery into an
  explicit `mixed-build-system` plan update instead of expanding this PR silently; do that if the
  shared graph change is the clean design.

### 6. Acceptance criteria

- Existing Vault deployments validate without metadata changes.
- A deployment can declare `secret_backend = "infisical"` and non-secret Infisical runtime metadata.
- Invalid Infisical metadata fails before any admission or provider mutation.
- Documentation, tests, and extracted metadata all use the same field names and defaulting rules.

### 7. Risks

- Backend metadata could accidentally become a parallel secret declaration surface.
- Overly permissive runtime dictionaries could let secret material into reviewed metadata.

### 8. Mitigations

- Keep `secret_requirements` as the only secret declaration surface.
- Validate Infisical metadata as routing data only and reject secret-looking keys early.

### 9. Consequences of not implementing this PR

Infisical support would have no reviewed, queryable deployment metadata contract.

### 10. Downsides for implementing this PR

It adds schema and validation surface before any Infisical secret can be read.

## PR-2: Provider-neutral runtime helper and backend dispatch

### 1. Intent

Make backend selection explicit in the generic runtime layer so provider code can stop assuming
Vault while existing Vault callers remain compatible.

### 2. Scope of changes

- Add `createDeploymentSecretRuntimeForAdmittedContext(...)`.
- Select the backend from admitted references first, then deployment/admitted metadata, then the
  Vault default.
- Keep `createVaultDeploymentSecretRuntime(...)` as a compatibility alias that forces or defaults to
  Vault for existing callers.
- Fail closed when one runtime invocation would mix incompatible backends in the same admitted
  context.
- Add a backend registry or dispatch helper that can construct the Vault backend now and the
  Infisical backend once PR-4 lands.
- Update provider-facing call sites that can be safely migrated in this PR to use the neutral helper
  without changing behavior.
- Keep step checks, target-scope checks, refresh handling, optional requirement behavior, and
  break-glass enforcement in the generic runtime instead of backend adapters.

### 3. External prerequisites

- None. Vault remains the only functional backend until the Infisical adapter lands.

### 4. Tests to be added

- Add runtime helper tests proving admitted Vault references still use Vault even when current
  metadata changes.
- Add backend-dispatch tests for default Vault selection, explicit Vault selection, explicit
  Infisical selection failing clearly before the adapter is registered, and mixed-backend rejection.
- Update existing runtime tests to cover the neutral helper name.
- Add provider-facing tests proving migrated call sites still resolve Vault secrets through the same
  lifecycle step and target-scope checks.

### 5. Docs to be added or updated

- Update deployment secrets API docs to introduce
  `createDeploymentSecretRuntimeForAdmittedContext(...)`.
- Mark `createVaultDeploymentSecretRuntime(...)` as a compatibility helper rather than the preferred
  new provider-facing API.
- Update examples that are not intentionally Vault-specific to use the neutral helper.

### 5.5. Expected regression scope

- `deployment-only`
- Keep backend dispatch and helper selection in `build-tools/tools/deployments/**`. Do not move the
  dispatch registry into shared `build-tools/tools/lib/**` only for verify-scope reasons; use a
  shared module if the implementation proves this is genuinely cross-domain infrastructure.

### 6. Acceptance criteria

- Existing Vault secret runtime behavior is unchanged.
- New provider code has a backend-neutral helper to call.
- Mixed backend use inside one admitted context fails closed with a clear error.

### 7. Risks

- A helper rename could accidentally weaken runtime authorization checks.
- Existing provider tests may hide direct Vault assumptions.

### 8. Mitigations

- Keep authorization in the generic runtime and add parity tests around the neutral helper.
- Preserve Vault helper aliases until all existing call sites can migrate deliberately.

### 9. Consequences of not implementing this PR

Infisical would require provider code to branch on backend details, violating the design.

### 10. Downsides for implementing this PR

It introduces backend dispatch before Infisical has a concrete adapter.

## PR-3: Infisical credential context and Universal Auth client

### 1. Intent

Add the in-memory Infisical workload credential layer used by the backend adapter without exposing
new ambient token contracts.

### 2. Scope of changes

- Widen `DeploymentSecretContext` to include Infisical credentials:
  - Universal Auth client id and client secret
  - in-memory access token handoff for reviewed worker internals only
- Add `deployment-secret-infisical-credentials.ts`.
- Implement Universal Auth login against the configured Infisical site URL.
- Cache access tokens in memory only, keyed by site URL and identity.
- Respect token expiry from the login response and reacquire on expiry.
- Normalize and validate Infisical site URLs before constructing API endpoints.
- Add redaction helpers for Infisical client secrets, access tokens, and obvious token-bearing
  response fields.
- Add credential source selection for `infisical_machine_identity_universal_auth`.
- Reject ambient Infisical CLI sessions, personal tokens, client-submitted access tokens, and
  client-submitted secret values in operator-facing flows.

### 3. External prerequisites

- Infisical machine identities and Universal Auth client credentials must be created outside this
  repo before live check/deploy flows can use them.
- Operators must provide credentials only through the reviewed environment variable names declared
  in `infisical_runtime` or through server-local worker credential references.

### 4. Tests to be added

- Add fake Infisical auth-server tests for successful Universal Auth login, token expiry, in-memory
  token reuse, and token reacquire after expiry.
- Add failure tests for missing client id env, missing client secret env, invalid site URL, malformed
  login response, and rejected ambient/personal token sources.
- Add redaction tests proving client secrets and access tokens do not appear in thrown errors,
  structured diagnostics, or logs.
- Add credential-source selection tests proving Infisical uses backend-qualified source names and
  does not reuse Vault-specific source labels.

### 5. Docs to be added or updated

- Update deployment secrets API docs with Infisical credential context types and credential source
  names.
- Update secrets usage docs with the reviewed Universal Auth environment variable pattern.
- Add operator notes that human deploy authentication authorizes the request but is not forwarded as
  the Infisical workload credential.

### 5.5. Expected regression scope

- `deployment-only`
- Keep the credential client, redaction helpers, and fake-server tests in deployment-owned tooling
  paths. Do not add generic HTTP or redaction utilities to shared build-system libraries unless a
  later explicit full-scope PR is the cleaner design.

### 6. Acceptance criteria

- Infisical Universal Auth credentials can be exchanged for an access token in memory.
- Token caching and expiry behavior are deterministic and tested.
- Secret-bearing credential material is redacted from all tested error and diagnostic paths.

### 7. Risks

- Credential-source names could imply Infisical supports Vault-style JWT or interactive human login.
- Token caching could accidentally persist to disk or `process.env`.

### 8. Mitigations

- Use backend-qualified source names and narrow first-release credential support to Universal Auth.
- Keep token cache process-local and test that no filesystem or environment persistence occurs.

### 9. Consequences of not implementing this PR

The backend adapter would need to handle authentication ad hoc, increasing the chance of leaked or
ambient credentials.

### 10. Downsides for implementing this PR

It adds live-backend credential plumbing before secret read behavior exists.

## PR-4: Infisical backend adapter for admission, runtime acquire, and fixture override

### 1. Intent

Implement the Infisical backend adapter behind the generic deployment secret runtime.

### 2. Scope of changes

- Add `deployment-secret-infisical.ts`.
- Implement `resolveDeploymentInfisicalAdmittedReferences(...)`.
- Implement `createDeploymentInfisicalSecretBackend(...)`.
- Derive the default selector from contract id plus `infisical_runtime`:
  - `projectId = infisical_runtime.project_id`
  - `environment = infisical_runtime.environment`
  - `secretPath = infisical_runtime.secret_path`
  - `secretName = final path segment of contractId`
- Apply optional reviewed `infisical_secret_mappings` for path/name overrides.
- During admission, read Infisical metadata with `viewSecretValue=false` when sufficient; if the API
  cannot provide usable version metadata without the value, read the normal endpoint and discard
  `secretValue` immediately after constructing the admitted reference.
- Freeze admitted references with backend `infisical`, stable non-secret `referenceId`,
  `backendRef`, `selectorRef`, exact `resolvedVersion` when available, `resolvedAt`,
  `refreshMode = "none"` for ordinary static secrets, and credential class.
- During runtime acquire, read the exact admitted version for protected/shared admitted paths.
- Verify returned project, environment, path, name, id/reference, and version match the admitted
  selector.
- Default to `viewSecretValue=true` only during runtime acquire, with imported secret expansion and
  imports disabled for the first release.
- Honor `VBR_DEPLOYMENT_SECRET_FIXTURE_PATH` for Infisical local/test flows, using synthetic
  backend-qualified fixture references such as
  `infisical:fixture:secret://deployments/pleomino/cloudflare_api_token@fixture-v1`.
- Fail closed on missing, revoked, deleted, unavailable, malformed, or non-exact replay references.

### 3. External prerequisites

- Live Infisical projects, environments, paths, secrets, and machine identities are required only for
  live operator checks or live deployment runs.

### 4. Tests to be added

- Add a fake Infisical HTTP server mirroring the fake Vault test style.
- Add admission tests proving Infisical admitted references contain exact non-secret selectors and no
  `secretValue`.
- Add runtime acquire tests proving the adapter reads the admitted version rather than latest after
  rotation.
- Add mapping tests for default contract-id-to-secret-name derivation and reviewed path/name
  overrides.
- Add optional requirement tests proving missing optional secrets are skipped and missing required
  secrets fail closed.
- Add replay mismatch tests for project, environment, path, name, id/reference, version, deleted, and
  revoked/unavailable response states.
- Add fixture tests proving provider-neutral fixtures override Infisical and use Infisical-qualified
  synthetic references.
- Add redaction tests proving secret values, client secrets, access tokens, and expanded references
  do not leak through adapter errors.

### 5. Docs to be added or updated

- Update deployment secrets API docs with Infisical admitted reference examples and runtime acquire
  semantics.
- Update secrets usage docs with default contract-to-Infisical mapping and optional reviewed mapping
  examples.
- Document that imported secret/reference expansion is disabled for the first release unless a later
  design adds reviewed semantics.

### 5.5. Expected regression scope

- `deployment-only`
- Keep the Infisical adapter, fake Infisical server, and adapter tests under deployment-owned
  tooling paths.

### 6. Acceptance criteria

- Infisical admission freezes exact non-secret references and versions.
- Runtime acquire uses exact admitted selectors and returns secret material only through the generic
  runtime.
- Fixture mode works for Infisical without creating an Infisical-specific fixture path.
- No provider code imports the Infisical adapter directly.

### 7. Risks

- Infisical API responses may differ across hosted regions or self-hosted installations.
- A fallback read that sees `secretValue` during admission could leak if not handled carefully.

### 8. Mitigations

- Validate the configured site URL and centralize endpoint construction in the adapter.
- Discard admission-time `secretValue` immediately and cover error paths with redaction tests.

### 9. Consequences of not implementing this PR

Infisical metadata could be declared but no deployment could safely admit or resolve Infisical
secrets.

### 10. Downsides for implementing this PR

It adds another live backend surface that needs fake-server coverage and careful API drift handling.

## PR-5: Admission, replay, and migration semantics across Vault and Infisical

### 1. Intent

Wire backend dispatch into admission and replay so backend migration affects future admissions only,
not the meaning of recorded runs.

### 2. Scope of changes

- Update `resolveInitialAdmittedSecretReferences(...)` to dispatch by selected backend and receive
  `vaultRuntime` and `infisicalRuntime` inputs.
- Keep retry and rollback using the source run's recorded admitted references.
- Ensure promotion selects a control-plane admitted source run and artifact, then resolves new
  admitted secret references from the target deployment's current metadata and selected backend.
- Preserve exact replay semantics:
  - a recorded Vault reference continues using Vault even if current metadata now selects Infisical
  - a recorded Infisical reference continues using Infisical even if current metadata changes later
  - replay fails closed if exact admitted backend references cannot be resolved
- Include selected backend and non-secret runtime metadata in admitted contexts and execution
  snapshots where needed for protected/shared workers.
- Ensure service-backed submissions do not accept client-supplied Infisical tokens or secret values.
- Keep protected/shared fixture use rejected outside explicit local fixture service mode.

### 3. External prerequisites

- None for tests. Live migrations require old Vault entries to remain available until replay windows
  for Vault-admitted runs expire.

### 4. Tests to be added

- Add admission dispatch tests for Vault default, explicit Vault, and explicit Infisical.
- Add migration tests proving changing deployment metadata from Vault to Infisical does not
  reinterpret old Vault-admitted runs.
- Add replay tests proving Infisical-admitted retry/rollback reads the recorded Infisical selector
  exactly and does not substitute latest values after rotation.
- Add promotion tests proving the target deployment resolves fresh admitted references from its
  current metadata and selected backend while artifact/source selection comes from the admitted
  source run.
- Add protected/shared worker tests rejecting fixture use outside local fixture mode and rejecting
  client-supplied Infisical tokens or secret values.
- Add record/snapshot tests proving admitted secret references contain backend-qualified non-secret
  selectors but no secret material.

### 5. Docs to be added or updated

- Update deployments usage and secrets usage docs with the per-deployment migration sequence.
- Update deployment secrets API docs with backend-specific replay behavior and promotion semantics.
- Document that old Vault entries must remain until rollback/retry retention windows expire.

### 5.5. Expected regression scope

- `deployment-only`
- Keep admission, replay, snapshot, and record changes in deployment-owned modules and deployment
  tests.

### 6. Acceptance criteria

- Initial admission uses the deployment's selected backend.
- Retry and rollback use recorded admitted references.
- Promotion resolves target-backend references under lane policy from target deployment metadata
  after selecting the control-plane admitted source run and artifact.
- Backend migration is per deployment and does not mutate historical run meaning.

### 7. Risks

- Migration behavior can be subtle because current metadata and historical records may disagree.
- Promotion could accidentally reuse source-stage or source-run secret selectors.

### 8. Mitigations

- Treat admitted references as replay authority and add explicit migration and promotion tests.
- Keep target deployment metadata authoritative for promotion-time secret admission.

### 9. Consequences of not implementing this PR

Rotating a deployment to Infisical could break or silently reinterpret retries and rollbacks for old
Vault-admitted runs.

### 10. Downsides for implementing this PR

It adds backend-aware snapshot and replay behavior that must be preserved by future deployment
record changes.

## PR-6: Protected service and provider integration through the neutral runtime

### 1. Intent

Make protected/shared deployment workers and provider adapters consume Infisical only through the
generic runtime surface.

### 2. Scope of changes

- Pass Infisical runtime metadata and server-local credential references through protected/shared
  execution snapshots where the selected backend requires them.
- Activate an Infisical `DeploymentSecretContext` inside reviewed worker processes only while the
  provider lifecycle step is running.
- Update the reviewed `mini` control-plane migration path so hosts still running the
  pre-`viberoots`-rename control plane can be migrated to the current `viberoots` control plane and
  then support `secret_backend = "infisical"` for protected/shared deployments through
  `--profile mini`.
- Migrate provider publishers, provisioners, smoke runners, and release-action execution paths that
  currently call `createVaultDeploymentSecretRuntime(...)` to the neutral helper where they are not
  explicitly Vault-specific.
- Add an import-boundary guard that forbids provider code from importing
  `deployment-secret-infisical*` directly outside the backend/runtime layer.
- Preserve existing Vault direct/local paths and Vault-specific admin/bootstrap flows.
- Ensure provider credential requirements for Cloudflare, Vercel, Kubernetes, S3, OpenTofu, and
  other deployment families continue to be declared only through `secret_requirements`.

### 3. External prerequisites

- Hosted workers need server-local Universal Auth credential references for any live Infisical-backed
  protected/shared deployment.
- `mini` operators must be prepared to run the reviewed control-plane migration from the
  pre-`viberoots`-rename service identity to the current `viberoots` identity before enabling live
  Infisical-backed deployment runs.

### 4. Tests to be added

- Add protected/shared worker tests proving an Infisical deployment resolves publish/provision/smoke
  secrets through the neutral runtime.
- Add `mini` profile migration tests proving the upgraded control-plane metadata, service identity,
  and worker secret-context wiring support Infisical-backed deployments after the pre-`viberoots`
  control-plane migration.
- Add provider adapter tests for at least one existing secret-consuming publisher proving it does not
  branch on Vault versus Infisical.
- Add import-boundary tests rejecting direct provider imports of `deployment-secret-infisical*`.
- Add service snapshot tests proving Infisical credential references are non-secret and server-local.
- Add negative tests proving ambient provider tokens and ambient Infisical CLI state are not accepted
  as deployment secret sources.
- Add docs parity tests proving the `mini` migration instructions name Infisical as a supported
  deployment secrets backend after the control-plane migration.

### 5. Docs to be added or updated

- Update provider capability or deployment contract docs where they discuss backend-neutral
  `secret_requirements`.
- Update deployment secrets API docs to state that provider code consumes secrets only through the
  neutral runtime helper.
- Update protected/shared worker docs with the server-local Infisical credential boundary.
- Update [NixOS Shared Host Usage](/Users/kiltyj/Code/viberoots/docs/nixos-shared-host-usage.md)
  and the relevant `mini` setup/migration instructions so operators can migrate a `mini` host from
  the pre-`viberoots`-rename control plane to the current control plane and then run
  Infisical-backed deployments through `--profile mini`.

### 5.5. Expected regression scope

- `deployment-only`
- Keep provider integration changes in deployment-owned provider, worker, and test modules. If a
  provider integration requires a shared language macro or shared build utility change, update this
  plan and classify that separate work as `mixed-build-system`; prefer that over forcing an awkward
  deployment-owned workaround.

### 6. Acceptance criteria

- Protected/shared workers can execute a secret-consuming Infisical-backed lifecycle step without
  provider code importing the Infisical adapter.
- `mini` migration instructions and tests cover the pre-`viberoots` control-plane upgrade path and
  explicitly state that Infisical is supported as a deployment secrets backend after migration.
- Existing Vault-backed provider behavior remains covered and unchanged.
- Ambient provider credentials and Infisical CLI state remain rejected.

### 7. Risks

- Provider code may have hidden Vault-specific assumptions in test helpers or e2e fixtures.
- Passing credential references through worker snapshots could accidentally expose secret material.

### 8. Mitigations

- Add import-boundary and snapshot-content tests.
- Keep credential values in server-local context activation, not in records or snapshots.

### 9. Consequences of not implementing this PR

Infisical would work only in isolated runtime tests, not in real protected/shared deployment flows.

### 10. Downsides for implementing this PR

It touches multiple provider execution paths and may broaden regression scope.

## PR-7: Infisical diagnostics and read-only admin checks

### 1. Intent

Give operators safe read-only tools to understand and verify Infisical configuration without adding
admin mutation.

### 2. Scope of changes

- Add `deploy auth explain-secret-backend --deployment <label>`.
- Add `deploy auth explain-infisical-identity --deployment <label>`.
- Add `deploy admin infisical plan --deployment <label>`.
- Add `deploy admin infisical check --deployment <label>`.
- Ensure `plan` is local and read-only.
- Ensure `check` uses the Infisical credential context to verify:
  - project exists
  - environment exists
  - machine identity has project access where the API exposes that evidence
  - each declared contract maps to an existing secret or approved placeholder
  - metadata for required secrets can be read
  - exact permission evidence is reported when available
- Print only safe routing data:
  - backend kind
  - site URL
  - project id
  - environment
  - secret path
  - safe machine identity id or client id env-name reference
  - credential source name
  - missing env var names
  - mapped contract ids and secret names
- Do not add `deploy admin infisical sync` in this PR.
- Do not overload `deploy admin vault ...` for Infisical.

### 3. External prerequisites

- Live `check` requires reachable Infisical and reviewed Universal Auth credentials.
- `plan` works from reviewed deployment metadata without live Infisical access.

### 4. Tests to be added

- Add CLI tests for each new command and for command grouping under `auth` and `admin infisical`.
- Add fake Infisical tests for successful `check`, missing project, missing environment, missing
  secret, missing credential env, and insufficient access where detectable.
- Add redaction tests proving diagnostics never print Universal Auth client secrets, access tokens,
  secret values, personal tokens, or expanded references.
- Add docs parity tests for command names and example output fields.

### 5. Docs to be added or updated

- Update deployment secrets API docs with the new CLI commands.
- Update secrets usage docs with read-only Infisical plan/check workflows.
- Add migration docs showing `deploy auth explain-secret-backend` and
  `deploy admin infisical check` before first live deployment.

### 5.5. Expected regression scope

- `deployment-only`
- Keep CLI/admin implementation in `build-tools/tools/deployments/**` and tests in
  `build-tools/tools/tests/deployments/**`.

### 6. Acceptance criteria

- Operators can inspect selected backend and Infisical identity routing without seeing secret
  material.
- Operators can run a live read-only check of Infisical project/environment/secret readiness.
- No Infisical mutation command exists in the first implementation.

### 7. Risks

- Diagnostics can accidentally become a leak channel for token or secret values.
- Live permission checks may vary by Infisical edition or API availability.

### 8. Mitigations

- Centralize diagnostic rendering through redaction helpers and test leak cases.
- Report unavailable permission evidence as explicit unknown/unsupported diagnostics instead of
  guessing.

### 9. Consequences of not implementing this PR

Operators would have to discover Infisical setup problems only during admission or publish.

### 10. Downsides for implementing this PR

It adds CLI surface that must stay aligned with backend API and docs.

## PR-8: End-to-end Infisical deployment scenarios and final guardrails

### 1. Intent

Close the implementation with representative end-to-end coverage, stale-assumption guardrails, and
operator documentation that proves the full Infisical design is implemented.

### 2. Scope of changes

- Add a representative Infisical-backed deployment fixture or sample package using
  `secret_backend = "infisical"`, `infisical_runtime`, and at least one required publish-step
  secret.
- Exercise validate/admit/runtime flows through the public `deploy` front door where possible.
- Add final stale-name and boundary guardrails:
  - provider code may not import Infisical backend internals
  - checked-in metadata may not contain Infisical access tokens, client secrets, personal tokens,
    `.env` exports, or secret values
  - docs and examples use backend-neutral runtime helpers unless intentionally Vault-specific
  - `deploy admin infisical sync` remains absent unless a later design and plan adds it
- Add final fixture/local-service tests proving protected/shared workers reject fixtures outside
  explicit local fixture mode.
- Add final migration scenario coverage from Vault-admitted run to future Infisical admissions while
  preserving old replay behavior.
- Add final `mini` scenario coverage proving a migrated `mini` control plane can admit and execute
  an Infisical-backed deployment through the reviewed `--profile mini` path.
- Audit old Vault-specific public text and rename only generic examples to provider-neutral wording;
  leave Vault bootstrap/admin/runbook docs intact where they are intentionally Vault-specific.

### 3. External prerequisites

- None for fake-server and fixture e2e tests.
- Live Infisical smoke is optional and should be gated behind explicit operator configuration, not
  required for ordinary `v`.

### 4. Tests to be added

- Add front-door e2e or integration tests for an Infisical-backed deployment using fake Infisical:
  validate, admit, publish-step secret resolution, status/record secret redaction, and replay.
- Add migration scenario tests covering an old Vault-admitted run, metadata switch to Infisical, a
  new Infisical-admitted run, and replay of both old and new runs.
- Add `mini` profile e2e or integration tests covering the current `viberoots` control-plane
  identity after migration and an Infisical-backed deployment submission through `--profile mini`.
- Add repository guardrail tests for forbidden Infisical secret material in checked-in metadata and
  docs examples.
- Add boundary tests proving `sync` is not exposed and Infisical admin commands are read-only.
- Add final docs parity tests for the migration sequence and CLI command examples.

### 5. Docs to be added or updated

- Update deployments usage with a short pointer to choosing Vault versus Infisical per deployment.
- Update secrets usage with the full per-deployment migration sequence.
- Update deployment secrets API with final command examples, admitted reference examples, fixture
  behavior, and replay rules.
- Update `mini` migration instructions and NixOS shared-host docs with the final operator sequence
  for upgrading from the pre-`viberoots` control plane and enabling Infisical-backed deployment
  secrets on `mini`.
- Update provider-facing docs to state that Infisical does not change provider credential
  declaration through `secret_requirements`.

### 5.5. Expected regression scope

- `deployment-and-project-impact` if this PR adds or edits a checked-in
  `projects/deployments/**` fixture package.
- `deployment-only` if the representative scenario is covered entirely through deployment-owned test
  fixtures under `build-tools/tools/tests/deployments/**`.
- This PR should not require full build-system scope unless it uncovers a missing shared-path
  contract that must be handled through an explicit plan update, in which case the shared-path
  design should take precedence.

### 6. Acceptance criteria

- A representative Infisical-backed deployment validates, admits exact references, resolves runtime
  secrets, records only non-secret backend-qualified references, and replays exact admitted
  references.
- Vault-backed deployments and old Vault-admitted replay paths still work.
- The documented `mini` migration path brings a pre-`viberoots` control plane onto the current
  `viberoots` service identity and leaves `secret_backend = "infisical"` deployments supported
  through `--profile mini`.
- All functionality described in `docs/infisical-design.md` is either implemented or explicitly
  preserved as a documented non-goal for a future design, with no untested implemented behavior.
- The normal `v` validation flow covers the fake-server, runtime, admission, replay, CLI, docs, and
  guardrail tests added by this plan.

### 7. Risks

- End-to-end tests can become brittle if they depend on live Infisical.
- Final docs updates can accidentally imply Vault is deprecated.

### 8. Mitigations

- Use fake Infisical servers for required validation and gate live checks behind explicit operator
  configuration.
- State provider parity clearly and preserve Vault-specific docs where they remain authoritative.

### 9. Consequences of not implementing this PR

The implementation would have unit-level Infisical pieces without proof that the public deployment
workflow satisfies the design end to end.

### 10. Downsides for implementing this PR

It adds broad integration and guardrail coverage that may require maintaining a larger fake-backend
fixture surface.

## PR-9: Infisical API and local direct runtime conformance fixes

### 1. Intent

Close the end-of-range implementation gaps where Infisical secret reads and local direct deploy
runtime setup diverge from the design contract.

### 2. Scope of changes

- Update the Infisical secret read client to use `GET /api/v4/secrets/{secretName}`.
- Send `projectId`, optional `version`, and `viewSecretValue` as query params for admission,
  runtime acquire, diagnostics, and any shared helper that reads an Infisical secret.
- Remove the implemented `/api/v3/secrets/raw/{secretName}`, `workspaceId`, and `secretVersion`
  read shape from Infisical deployment secret paths.
- Update the fake Infisical server and fixtures so tests assert the v4 read contract required by
  the design.
- Ensure admission and diagnostics request non-secret reads with `viewSecretValue=false` whenever
  the call does not need secret material.
- Ensure runtime acquire requests exact admitted versions with `viewSecretValue=true` only when
  secret material is required.
- Route non-service-backed local direct deploys through backend-aware runtime preparation so an
  Infisical-backed deployment uses the reviewed `infisical_runtime` Universal Auth env names instead
  of unconditionally calling `prepareDeploymentVaultRuntime(...)`.
- Preserve existing Vault local direct behavior and existing service-backed Infisical behavior.
- Keep Universal Auth client ids, client secrets, access tokens, and resolved secret values out of
  records, snapshots, logs, and diagnostics.

### 3. External prerequisites

- Local direct Infisical deploys require the reviewed Universal Auth env names from
  `infisical_runtime` to be present in the operator environment.
- No live Infisical access is required for ordinary validation; fake-server coverage must exercise
  the v4 API shape.

### 4. Tests to be added

- Update fake Infisical server tests to reject the old v3 raw-secret path and require
  `/api/v4/secrets/{secretName}` with `projectId`, optional `version`, and `viewSecretValue`.
- Add admission and diagnostics tests proving Infisical metadata reads use `viewSecretValue=false`
  and do not accept or expose secret values.
- Add runtime acquire tests proving exact admitted versions are sent as `version` query params and
  secret material is requested only with `viewSecretValue=true`.
- Add regression tests for local direct Infisical deploys proving the non-service-backed CLI path
  prepares an Infisical credential context from reviewed `infisical_runtime` env names and does not
  invoke Vault runtime preparation.
- Add Vault regression tests proving local direct Vault deploys still prepare the Vault runtime.
- Add redaction tests covering errors from the corrected v4 read path and local direct Universal
  Auth setup.

### 5. Docs to be added or updated

- Update deployment secrets API docs to name the Infisical v4 secret read endpoint and query params
  used by deployment secret admission and runtime acquire.
- Update secrets usage and local direct deploy docs with the reviewed Infisical Universal Auth env
  names used by non-service-backed local direct deploys.
- Update fake-backend or testing docs, if present, so the fake Infisical server is documented as
  asserting the v4 API contract.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes in deployment-owned Infisical backend, fake-server, CLI/runtime preparation, and
  deployment test modules.

### 6. Acceptance criteria

- All Infisical deployment secret reads use `GET /api/v4/secrets/{secretName}` with `projectId`,
  optional `version`, and `viewSecretValue` query params.
- Fake Infisical tests fail if the implementation reintroduces the old v3 raw-secret path,
  `workspaceId`, or `secretVersion`.
- Local direct Infisical deploys prepare an Infisical Universal Auth runtime from reviewed
  `infisical_runtime` env names and do not prepare a Vault runtime.
- Existing Vault local direct deploys continue to work unchanged.

### 7. Risks

- API-shape correction could break existing fake-server expectations that accidentally codified the
  wrong v3 endpoint.
- Backend-aware local direct runtime preparation could weaken Vault behavior if the branch is not
  covered explicitly.

### 8. Mitigations

- Make the fake server strict about the v4 path and query params while adding separate Vault
  regression coverage for local direct deploys.
- Keep backend selection centralized in the neutral runtime helper rather than adding provider-side
  branches.

### 9. Consequences of not implementing this PR

Infisical-backed deployments would continue to target the wrong Infisical read API and local direct
deploys would still require Vault runtime preparation even when the deployment selects Infisical.

### 10. Downsides for implementing this PR

It adds another correction pass after the end-to-end PRs and requires updating tests that currently
assert the wrong API shape.
