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
  - `secret_backend = "infisical/default"` with non-empty `secret_requirements` requires
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
- A deployment can declare `secret_backend = "infisical/default"` and non-secret Infisical runtime metadata.
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
  then support `secret_backend = "infisical/default"` for protected/shared deployments through
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
  `secret_backend = "infisical/default"`, `infisical_runtime`, and at least one required publish-step
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
  `viberoots` service identity and leaves `secret_backend = "infisical/default"` deployments supported
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

## PR-10: Infisical fixture-service mode and secret path prefix conformance

### 1. Intent

Close the remaining end-of-range Infisical conformance gaps where protected/shared worker fixture
handling and default selector derivation do not fully match the design.

### 2. Scope of changes

- Update Infisical protected/shared worker setup so `VBR_DEPLOYMENT_SECRET_FIXTURE_PATH` remains
  rejected by default, but is accepted when `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1` explicitly marks a
  local fixture service.
- Reuse the existing local fixture service marker and policy helpers where possible instead of
  adding an Infisical-specific fixture-mode flag.
- Keep Vault protected/shared worker fixture rejection behavior unchanged unless an existing
  provider-neutral helper already carries the explicit local fixture service exception.
- Apply extracted `infisical_runtime.secret_path_prefix` during Infisical selector derivation when a
  contract has no explicit `infisical_secret_mappings` path override.
- Preserve precedence so mapping `secretPath` wins first, then runtime `secret_path` plus optional
  `secret_path_prefix`, then `/`.
- Normalize joined Infisical paths so leading/trailing slashes do not create duplicate separators,
  empty paths still resolve to `/`, and admitted references record the exact selector used.
- If implementation determines the explicit local fixture service exception should be removed
  instead of implemented, update `docs/infisical-design.md` and all public docs in the same PR to
  make fixture rejection unconditional and remove the exception from the design contract.
- Keep fixture paths, Universal Auth credentials, Infisical tokens, and resolved secret values out
  of worker logs, records, snapshots, diagnostics, and test failure output.

### 3. External prerequisites

- None for ordinary validation. Local fixture service coverage must use checked-in fixtures and the
  explicit `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1` marker.

### 4. Tests to be added

- Add Infisical protected/shared worker tests proving `VBR_DEPLOYMENT_SECRET_FIXTURE_PATH` is
  rejected when `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE` is absent or false.
- Add Infisical protected/shared worker tests proving fixture secrets are accepted only when
  `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1` explicitly marks local fixture service mode.
- Add regression tests proving the fixture-service exception does not expose fixture paths or secret
  values in worker logs, records, diagnostics, or thrown errors.
- Add selector derivation tests proving `secret_path_prefix` is applied when no mapping path
  override is present.
- Add precedence tests proving explicit mapping `secretPath` overrides runtime
  `secret_path_prefix`, and runtime `secret_path` still supplies the default base path.
- Add path normalization tests for `/`, empty prefixes, leading/trailing slashes, and contract ids
  whose derived secret names live under prefixed folders.
- Add replay/admission tests proving admitted Infisical references preserve the prefixed
  `secretPath` and exact selector used by runtime acquire.

### 5. Docs to be added or updated

- Update deployment secrets API docs to state exactly when
  `VBR_DEPLOYMENT_SECRET_FIXTURE_PATH` is allowed for Infisical protected/shared workers and that
  `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1` is required for the local fixture service exception.
- Update secrets usage docs with the `secret_path_prefix` derivation rule and the precedence order
  between mappings, runtime path metadata, and `/`.
- Update Infisical design docs only if the implementation intentionally removes the explicit local
  fixture service exception instead of implementing it.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes in deployment-owned Infisical worker setup, selector derivation, docs, and deployment
  tests.

### 6. Acceptance criteria

- Infisical protected/shared workers still fail closed on fixture secrets by default.
- `VBR_DEPLOYMENT_SECRET_FIXTURE_PATH` is accepted for Infisical protected/shared workers only when
  `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1` explicitly marks local fixture service mode, or the design
  and docs are updated to remove that exception.
- `infisical_runtime.secret_path_prefix` changes derived Infisical selectors when no mapping path
  override is present.
- Mapping `secretPath` remains the highest-precedence path override, runtime path metadata remains
  deterministic, and admitted references preserve the exact prefixed selector.
- New tests cover both fixture-service mode and `secret_path_prefix` behavior without live
  Infisical access.

### 7. Risks

- Allowing a fixture-service exception in protected/shared worker setup could accidentally broaden
  production fixture use if the marker is treated as implicit or inherited from unrelated flows.
- Path prefix normalization could change admitted references for deployments that already rely on
  the unprefixed selector behavior.

### 8. Mitigations

- Require the explicit `VBR_DEPLOY_LOCAL_FIXTURE_SERVICE=1` marker and keep all other
  protected/shared worker fixture paths rejected.
- Cover selector precedence and normalization directly so mapping overrides and existing
  unprefixed deployments remain stable.

### 9. Consequences of not implementing this PR

Infisical protected/shared workers would continue rejecting a fixture flow that the design currently
allows, and deployments using `secret_path_prefix` would keep admitting and acquiring secrets from
the wrong Infisical path.

### 10. Downsides for implementing this PR

It adds another focused conformance pass and tightens selector behavior that may require refreshing
tests that accidentally depended on ignored `secret_path_prefix` metadata.

## PR-11: Infisical Universal Auth env-name metadata validation

### 1. Intent

Close the end-of-range validation gap where Infisical deployments with required secrets can pass
metadata extraction without reviewed Universal Auth environment-variable names.

### 2. Scope of changes

- Require non-empty `infisical_runtime.machine_identity_client_id_env` and
  `infisical_runtime.machine_identity_client_secret_env` whenever an Infisical deployment declares
  non-empty `secret_requirements`.
- Preserve fixture-mode behavior so deployments using provider-neutral fixture secrets do not need
  live Universal Auth env-name metadata.
- Validate the env-name fields during deployment metadata extraction alongside the existing
  site URL, project, environment, and preferred credential-source checks.
- Reject empty, missing, non-string, or syntactically invalid env-name metadata before admission,
  provider mutation, worker setup, diagnostics, or runtime acquire can use the deployment.
- Keep validation limited to reviewed environment-variable names and continue rejecting Universal
  Auth client ids, client secrets, access tokens, personal tokens, and resolved secret values in
  metadata.
- Preserve Infisical deployments with no `secret_requirements` when they are used only for
  metadata/query coverage and do not require runtime credential preparation.

### 3. External prerequisites

- None for ordinary validation. Tests must exercise extraction and validation without live
  Infisical access.

### 4. Tests to be added

- Update the current test that accepts missing Infisical Universal Auth env-name metadata so it now
  fails for deployments with non-empty `secret_requirements`.
- Add validation tests rejecting missing, empty, non-string, and invalid
  `machine_identity_client_id_env` and `machine_identity_client_secret_env` values for
  secret-consuming Infisical deployments.
- Add fixture-mode regression tests proving provider-neutral fixture deployments can still bypass
  live Universal Auth env-name requirements only when fixture mode is explicitly active.
- Add regression tests proving Infisical deployments with no `secret_requirements` continue to pass
  metadata extraction without Universal Auth env-name metadata.
- Add redaction tests proving validation failures name only metadata field paths and env-var names,
  never Universal Auth credential values or resolved deployment secrets.

### 5. Docs to be added or updated

- Update deployment secrets API docs to state that secret-consuming Infisical deployments require
  reviewed Universal Auth env-name metadata unless fixture mode is active.
- Update secrets usage and local direct deploy docs so examples include both
  `machine_identity_client_id_env` and `machine_identity_client_secret_env`.
- Update testing or fixture docs, if present, to document the fixture-mode exception and make clear
  that ordinary Infisical metadata validation still requires env-name fields.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes in deployment-owned metadata extraction, validation, docs, and deployment tests.

### 6. Acceptance criteria

- Infisical deployments with non-empty `secret_requirements` fail extraction when either reviewed
  Universal Auth env-name field is missing, empty, non-string, or syntactically invalid.
- Explicit fixture mode remains the only path where secret-consuming Infisical deployments can omit
  Universal Auth env-name metadata.
- Infisical deployments with no `secret_requirements` remain valid without Universal Auth env-name
  metadata.
- Tests and docs agree on the required env-name metadata and the fixture-mode exception.

### 7. Risks

- Tightening extraction validation could fail existing test fixtures that omitted env-name metadata
  while declaring secret requirements.
- Env-name validation could accidentally require real credential values instead of reviewed
  variable names.

### 8. Mitigations

- Update only the affected fixtures to include reviewed env-var names or to opt into explicit
  fixture mode where that is the intended scenario.
- Validate names with the existing environment-variable-name policy and keep credential values out
  of deployment metadata entirely.

### 9. Consequences of not implementing this PR

Infisical deployments can continue passing extraction with incomplete Universal Auth routing data,
causing failures later in admission, diagnostics, or runtime preparation instead of at metadata
validation time.

### 10. Downsides for implementing this PR

It tightens metadata validation after earlier Infisical conformance work and requires refreshing
tests or fixtures that accidentally relied on missing env-name metadata.

## PR-12: Pleomino staging and production Infisical cutover

### 1. Intent

Move the Pleomino staging and production Cloudflare Pages deployments from Vault-backed deployment
secrets to Infisical-backed deployment secrets while keeping the existing `secret_requirements`
contract ids, lane governance, provider behavior, and replay guarantees intact.

### 2. Scope of changes

- Update `//projects/deployments/pleomino-staging:deploy` and
  `//projects/deployments/pleomino-prod:deploy` so they declare `secret_backend = "infisical/default"`.
- Preserve `//projects/deployments/pleomino-dev:deploy` on the existing Vault-backed shared-host
  path unless a separate plan explicitly moves dev as well.
- Refactor `projects/deployments/pleomino-shared/family.bzl` so the shared family defaults no
  longer force one Vault runtime onto every stage when staging and production need Infisical
  routing metadata.
- Depend on the containerized control-plane runtime from
  [Deployment Control Plane Containerization Plan](control-plane-plan.md). This PR is now sequenced
  after that plan so Pleomino's first Infisical staging and production rollout uses the
  horizontally scalable containerized control plane.
- Add an IaC module for Pleomino's Infisical deployment-secret backend before changing deployment
  metadata.
  - Assume no suitable Infisical project exists yet.
  - Parameterize the module by Infisical organization/account, site URL, project name/slug,
    environment slugs, secret path, secret names, machine identity names, and control-plane
    credential-file names. The `viberoots` organization and `pleomino-deployments` project are
    Pleomino inputs for this PR, not global Infisical defaults for future deployments.
  - Support both Infisical/control-plane topologies: a control plane dedicated to one Infisical
    account and a shared control plane that hosts multiple Infisical accounts. Do not assume either
    topology globally.
  - The module should own every durable non-secret Infisical object that the provider supports:
    project, environments, machine identity, project membership or role bindings, Universal Auth
    configuration, and any secret metadata or placeholders.
  - Keep real secret values out of the repo and out of ordinary IaC variables committed to git.
  - If the Infisical provider cannot manage a required object, add an explicit manual step in the
    PR with the object name, expected result, and how to import or reconcile it later.
- Add reviewed non-secret `infisical_runtime` metadata for staging and production:
  - `site_url = "https://app.infisical.com"`
  - `project_id`
  - `environment = "staging"` for `//projects/deployments/pleomino-staging:deploy`
  - `environment = "prod"` for `//projects/deployments/pleomino-prod:deploy`
  - `secret_path = "/"`
  - `preferred_credential_source = "infisical_machine_identity_universal_auth"`
  - `machine_identity_client_id_env = "PLEOMINO_STAGING_INFISICAL_CLIENT_ID"` and
    `machine_identity_client_secret_env = "PLEOMINO_STAGING_INFISICAL_CLIENT_SECRET"` for staging
  - `machine_identity_client_id_env = "PLEOMINO_PROD_INFISICAL_CLIENT_ID"` and
    `machine_identity_client_secret_env = "PLEOMINO_PROD_INFISICAL_CLIENT_SECRET"` for production
  - `machine_identity_id` for the stage-specific deployment identity when the IaC provider exposes
    it as non-secret output
- Reuse the portable deployment control-plane credential-directory abstraction from
  [Deployment Control Plane Containerization Plan](control-plane-plan.md) for Infisical Universal
  Auth. The worker secret-source contract must load credentials from file-backed service credentials
  and expose them only as in-memory runtime bindings for the reviewed env-var names. Do not require
  broad process environment injection for Infisical client secrets. On systemd/NixOS hosts, the
  preferred implementation is `LoadCredential=` with worker reads from `$CREDENTIALS_DIRECTORY`;
  equivalent file-backed service credential mechanisms are acceptable on other hosts.
  - Align this contract with
    [Deployment Control Plane Containerization](control-plane-containerization.md) so PR-12 does not
    introduce a NixOS-only or environment-file-only Infisical credential path. The full OCI image,
    NixOS container module, and non-NixOS host profile should already exist before PR-12 begins.
  - Keep credential-file lookup deployment-scoped. The control plane must be able to host multiple
    Infisical organizations/accounts and projects at the same time without assuming one global
    Infisical tenant, one global project, or one global pair of Universal Auth credentials.
  - Default credential-file names should be derived from the deployment id:
    `<deployment-id>-infisical-client-id` and `<deployment-id>-infisical-client-secret`.
    Deployment metadata or host-local service configuration may use reviewed override file names
    when the default names do not fit an existing host layout.
  - Use the deployment's reviewed `infisical_runtime.site_url`, `project_id`, `environment`,
    env-var names, and optional `machine_identity_id` when preparing the runtime. Do not derive
    those values from ambient control-plane defaults.
- Do not add `infisical_secret_mappings` for Pleomino; store the existing
  `secret://deployments/pleomino/cloudflare_api_token` contract as the Infisical shared secret
  named `cloudflare_api_token` at `/` in each environment.
- Keep the current Pleomino `secret_requirements` contract ids, steps, and required flags unchanged
  so provider code, admission evidence, and existing Vault-admitted replay records remain
  interpretable.
- Do not persist Infisical Universal Auth client ids, client secrets, access tokens, personal
  tokens, or resolved Cloudflare API tokens in `TARGETS`, docs, deployment records, diagnostics, or
  test fixtures.
- Ensure Cloudflare Pages staging and production publish/provision/preview-cleanup flows continue
  to resolve `cloudflare_api_token` through the neutral runtime after the backend switch.
- Preserve replay semantics so older Vault-admitted Pleomino staging and production runs continue
  to replay against recorded Vault references, while new admissions use Infisical references.
- Use read-only `deploy admin infisical plan`/`check` diagnostics for Pleomino staging and
  production readiness; do not add an Infisical sync or mutation workflow.

### 3. External setup and rollout work

Most of this work is not a prerequisite for completing the dev changes in this PR. It is operator
work that can happen in parallel with implementation and must be complete before staging or
production can successfully execute live Infisical-backed deploys. Because the selected sequence is
containerization first, this PR also assumes the containerized control plane from
[Deployment Control Plane Containerization Plan](control-plane-plan.md) has already landed and is
available for Pleomino rollout. The only external setup needed before PR-12 implementation starts is
confirming that a `viberoots` Infisical organization administrator can bootstrap the IaC runner
identity in the selected `https://app.infisical.com` Infisical organization.

These instructions assume no Pleomino Infisical project exists yet. Do not manually create durable
objects that the PR's IaC module is supposed to own; use manual work only for bootstrap access, real
secret values, runtime credential installation, verification, and provider gaps explicitly
documented by the implementation PR.

1. Use the settled Infisical tenant details as non-secret IaC inputs.
   - These values are settled only for the Pleomino staging and production cutover. Future
     deployments may use different Infisical organizations/accounts, API base URLs, projects,
     environments, paths, and identities through the same parameterized IaC/control-plane shape.
   - Infisical organization: `viberoots`.
   - Infisical API base URL: `https://app.infisical.com`.
   - Infisical product: Secrets Management.
   - Infisical project name and slug: `pleomino-deployments`.
   - Environment slugs: `staging` and `prod`.
   - Secret path: `/`.
   - Secret name for `secret://deployments/pleomino/cloudflare_api_token`:
     `cloudflare_api_token`.
   - Deployment identity model: one stage-specific machine identity for staging and one
     stage-specific machine identity for production.
   - Live deploy executor model: a deployment control plane is the only runtime that executes live
     Pleomino staging or production deploys. CI submits through the appropriate control plane and
     must not hold Pleomino Infisical workload credentials. The implementation must allow future
     deployments to use either one control plane per Infisical account or a shared control plane
     that hosts multiple Infisical accounts.
   - Runtime env-var names:
     `PLEOMINO_STAGING_INFISICAL_CLIENT_ID`, `PLEOMINO_STAGING_INFISICAL_CLIENT_SECRET`,
     `PLEOMINO_PROD_INFISICAL_CLIENT_ID`, and `PLEOMINO_PROD_INFISICAL_CLIENT_SECRET`.
   - Default deployment credential-file names:
     `pleomino-staging-infisical-client-id`, `pleomino-staging-infisical-client-secret`,
     `pleomino-prod-infisical-client-id`, and `pleomino-prod-infisical-client-secret`.
   - Record only these non-secret choices in the PR; do not record Cloudflare token values or
     Universal Auth client secrets.

2. Prepare the Infisical identity that will run the IaC apply.
   - Treat this as manual bootstrap work unless the organization already has an approved external
     bootstrap mechanism outside this repo. The Pleomino Infisical project cannot own the identity
     that creates itself.
   - An Infisical organization administrator in the `viberoots` organization creates
     `viberoots-iac` in the Infisical UI:
     1. Open `https://app.infisical.com` and sign in as an administrator for the `viberoots`
        organization.
     2. If the account has access to multiple organizations, switch the active organization to
        `viberoots`.
     3. Open Organization Settings.
     4. Open Access Control.
     5. Open Identities. In UI versions that label the page more specifically, open Machine
        Identities.
     6. Click Create identity.
     7. Set Name to `viberoots-iac`.
     8. Set the organization role to the least-privileged role that can manage the PR-owned
        Infisical objects: Secrets Management project, environments, machine identities, project
        identity bindings, Universal Auth configuration, folders, and secret metadata/placeholders.
     9. Click Create identity.
   - Configure Universal Auth for `viberoots-iac`:
     1. Stay on the `viberoots-iac` identity page after creation.
     2. Open the Authentication section.
     3. Keep Universal Auth enabled. Infisical enables Universal Auth by default for new identities
        as of the docs reviewed for this plan.
     4. Open or edit the Universal Auth configuration.
     5. Keep lockout enabled.
     6. Set Access Token TTL and Access Token Max TTL to short-lived values suitable for the IaC
        runner, such as `3600` seconds, unless a longer reviewed apply window is required.
     7. Leave Access Token Max Number of Uses at `0` unless the implementation PR proves a stricter
        value works for repeated provider API calls during one apply.
     8. Leave Access Token Period disabled unless a later secret-zero renewal design explicitly uses
        renewable periodic tokens.
     9. Configure Client Secret Trusted IPs and Access Token Trusted IPs only when the
        control-plane egress ranges are stable and the Infisical plan supports those controls.
     10. Save the Universal Auth configuration.
   - Create the Universal Auth client secret for `viberoots-iac`:
     1. On the `viberoots-iac` identity page, find the Universal Auth client secret area.
     2. Click Create Client Secret.
     3. Set Description to `deployment-control-plane-iac`.
     4. Leave the client secret TTL unset or `0` so the control-plane-host credential remains valid
        until the team adds an explicit rotation runbook.
     5. Leave Max Number of Uses at `0` because the IaC provider may need multiple Universal Auth
        exchanges across plan/apply attempts.
     6. Create the client secret.
     7. Copy the Client ID and Client Secret exactly once into the control-plane host's service
        credential source.
     8. Close the reveal/copy dialog after storing the values; do not paste them into notes, chat,
        tickets, shell history, PR text, or local files.
   - Store the Client ID and Client Secret only as file-backed service credentials on the deployment
     control-plane host.
   - On systemd/NixOS hosts, use `LoadCredential=` or the repo's NixOS wrapper for systemd
     credentials. Define separate credential files for the IaC client id and secret, keep the source
     files outside the repo and outside the Nix store, load them only into the control-plane service
     or tightly scoped IaC apply worker, and read them from `$CREDENTIALS_DIRECTORY` at runtime.
   - On non-systemd hosts, use the equivalent service credential facility with the same properties:
     file-backed, readable only by the control-plane service account, not inherited by unrelated
     services, and not materialized into plaintext env files.
   - Configure the control-plane IaC apply path to map those credential files to the
     provider-supported runtime bindings `INFISICAL_UNIVERSAL_AUTH_CLIENT_ID` and
     `INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET`, plus `INFISICAL_HOST=https://app.infisical.com` if
     the provider runner requires an explicit host. The mapping must happen inside the
     control-plane process or its tightly scoped child process and must not write a plaintext env
     file.
   - Do not install `viberoots-iac` credentials in CI. CI should request the reviewed IaC apply
     through the deployment control plane, matching the repository's protected/shared deployment
     model.
   - Do not put the IaC runner client secret in `.tfvars`, Nix store paths, committed files, PR
     comments, shell history, process arguments, screenshots, logs, plaintext environment files, or
     ordinary diagnostic output.

3. Apply the PR's Infisical IaC before entering any production secret values.
   - Confirm the plan creates, rather than manually assumes, the Pleomino Secrets Management
     project.
   - Confirm the plan owns the `staging` and `prod` environments, root secret path `/`, the
     stage-specific deployment machine identities, Universal Auth configuration, project identity
     membership/roles, and any non-secret secret metadata/placeholders supported by the provider.
   - Confirm the project has delete protection when the provider supports it.
   - Confirm any real `infisical_secret` values are omitted, use a provider write-only field, or are
     otherwise handled in a way that keeps values out of durable IaC state. If that cannot be proven,
     do not manage real Cloudflare token values through IaC.
   - If the provider cannot manage a required object, manually create only that object and record
     the object name, exact UI/API steps, resulting id, and future import/reconciliation command in
     the PR evidence.
   - After apply, capture the non-secret project id, environment slugs, root path `/`, secret name
     `cloudflare_api_token`, deployment machine identity ids, and client ID env-var names for the
     deployment metadata PR.

4. Enter the real Cloudflare API token values as shared Infisical secrets.
   - In Infisical, open the new Pleomino project and select the `staging` environment.
   - Navigate to the root path `/`.
   - Add or update the shared secret named `cloudflare_api_token`.
   - Paste the current trusted staging Cloudflare API token value from the approved source of truth.
   - Save the secret as a shared environment secret, not a personal override.
   - Repeat the same steps in the `prod` environment using the production Cloudflare API token
     value.
   - Do not import a broad `.env` file unless it contains only the intended Pleomino deployment
     secret and the import process is approved for production secret material.
   - Do not expose either token in commits, PR descriptions, terminal logs, diagnostics,
     screenshots, tickets, or ordinary IaC state.

5. Install the Pleomino deployment Universal Auth credentials in every runtime that can execute live
   staging or production deploys.
   - Use the deployment machine identity client IDs and client secrets created or documented by the
     IaC apply, not the separate IaC runner identity from step 2.
   - Install the values only as file-backed service credentials on the deployment control-plane
     host.
   - On systemd/NixOS hosts, use `LoadCredential=` or the repo's NixOS wrapper for systemd
     credentials. Define one credential file per value using the default deployment-derived names:
     `pleomino-staging-infisical-client-id`,
     `pleomino-staging-infisical-client-secret`, `pleomino-prod-infisical-client-id`, and
     `pleomino-prod-infisical-client-secret`. Keep the source files outside the repo and outside the
     Nix store, load them only into the control-plane worker, and read them from
     `$CREDENTIALS_DIRECTORY` when preparing the Infisical runtime.
   - Treat those credential-file names as Pleomino-specific names. Future deployments should default
     to `<deployment-id>-infisical-client-id` and `<deployment-id>-infisical-client-secret`, and may
     use reviewed override names when needed. They must not share Pleomino's bindings.
   - On non-systemd hosts, use an equivalent file-backed service credential mechanism with the same
     isolation properties.
   - Configure the control plane to map those credential files to the reviewed in-memory runtime
     bindings named below only for the worker operation that needs them.
   - Do not install the values in local developer shells, local direct-deploy profiles, CI secret
     stores, plaintext env files, process arguments, Nix store outputs, or ordinary service logs.
   - CI must submit Pleomino deployment requests to the control plane instead of resolving
     Infisical secrets directly.
   - Use `PLEOMINO_STAGING_INFISICAL_CLIENT_ID`, `PLEOMINO_STAGING_INFISICAL_CLIENT_SECRET`,
     `PLEOMINO_PROD_INFISICAL_CLIENT_ID`, and `PLEOMINO_PROD_INFISICAL_CLIENT_SECRET`.
   - Keep the staging and production client secrets separate inside the control-plane secret store
     so staging execution cannot read production with the staging credential.
   - Ensure the worker scrubs these bindings from child-process environments that do not need to
     contact Infisical.
   - Read-only metadata validation and cquery extraction must not require these credential values.

6. Verify the Infisical setup without printing secret values.
   - Run `deploy admin infisical plan` for `//projects/deployments/pleomino-staging:deploy` and
     confirm it reports the expected site URL, project id, `staging` environment, path, secret name,
     and Universal Auth env-var names.
   - Run `deploy admin infisical plan` for `//projects/deployments/pleomino-prod:deploy` and
     confirm it reports the expected site URL, project id, `prod` environment, path, secret name,
     and Universal Auth env-var names.
   - Run live `deploy admin infisical check` through the deployment control plane or a documented
     one-time operator break-glass session on the control-plane host; do not copy deployment
     Universal Auth credentials to a local laptop or CI just to run the check.
   - With only the reviewed staging Universal Auth env vars available to the control-plane runtime,
     run `deploy admin infisical check` for staging. Confirm the machine identity can authenticate
     and see the staging `cloudflare_api_token` metadata without logging the value.
   - With only the reviewed production Universal Auth env vars available to the control-plane
     runtime, run `deploy admin infisical check` for production. Confirm the machine identity can
     authenticate and see the production `cloudflare_api_token` metadata without logging the value.
   - If authentication fails, check for the documented Universal Auth failure causes first: expired
     client secret or access token, insufficient project permission, trusted-IP restriction, or an
     identity lockout.
   - Capture only non-secret evidence in the PR: project id, environment, path, secret name,
     readiness status, and machine identity access status when available.

7. Roll out in a fixed order after the PR merges.
   - Apply or confirm the Infisical IaC first.
   - Fill or rotate the actual Cloudflare API token secret values in Infisical.
   - Install Universal Auth credential files into the deployment control plane's service credential
     store only.
   - Run read-only `plan` and `check` for staging.
   - Perform the first staging deployment.
   - Run read-only `plan` and `check` for production.
   - Perform the first production deployment after staging passes.

8. Keep rollback prerequisites available until the cutover is proven stable.
   - Keep existing Vault configuration and credentials long enough to replay old Vault-admitted
     Pleomino runs.
   - Do not delete or rotate away the Vault value until the team has an explicit post-cutover
     retention decision.
   - Keep the Infisical IaC state and object ids available so operator-created gaps can be imported
     or reconciled instead of recreated.
   - Document how to restore `secret_backend = "vault/default"` for new admissions if live Infisical access
     is unavailable during rollout.

### 4. Tests to be added

- Add extraction/cquery tests proving Pleomino staging and production emit:
  - `secret_backend = "infisical/default"`
  - reviewed `infisical_runtime` metadata
  - no `infisical_secret_mappings`
  - unchanged `secret_requirements`
- Add a regression test proving Pleomino dev still emits the existing Vault backend metadata and is
  not accidentally moved to Infisical by shared-family refactoring.
- Add validation tests proving the Pleomino staging and production metadata satisfy the Infisical
  Universal Auth env-name requirements and do not contain forbidden credential material.
- Add fake-Infisical Cloudflare Pages tests proving new Pleomino staging and production admissions
  read Infisical metadata with `viewSecretValue=false` and runtime acquire resolves the admitted
  exact version with `viewSecretValue=true`.
- Add replay/migration coverage proving a previously Vault-admitted Pleomino staging or production
  run continues to replay using recorded Vault references after current metadata selects
  Infisical.
- Add read-only admin diagnostic coverage proving Pleomino staging and production `plan` output is
  non-secret and `check` reports project/environment/secret readiness without exposing secret
  values or Universal Auth credentials.
- Add portable credential-directory tests proving Pleomino Infisical Universal Auth credentials can
  be read from deployment-scoped credential files, mapped to the reviewed runtime env-var names only
  for the operation that needs them, and kept out of broad process environment injection.
- Add docs parity or checked-in metadata guardrail tests proving no Pleomino deployment metadata,
  docs example, or fixture contains Infisical client secrets, personal tokens, access tokens, or
  Cloudflare API token values.

### 5. Docs to be added or updated

- Update Pleomino or deployments usage docs with the reviewed operator steps for the staging and
  production Infisical cutover.
- Document the Infisical secret names/paths or the default mapping rule used for the Pleomino
  `cloudflare_api_token` contract, without including secret values.
- Document the required Universal Auth environment variable names for Pleomino staging and
  production operators.
- Add rollback/replay notes explaining that old Vault-admitted Pleomino runs remain replayable and
  new runs admit Infisical references after the metadata change.

### 5.5. Expected regression scope

- `deployment-and-project-impact`
- The implementation should stay in deployment-owned Pleomino project metadata, deployment tests,
  and docs. Do not change shared Infisical runtime logic unless the Pleomino cutover exposes a real
  generic bug; if it does, update this plan before expanding scope.

### 6. Acceptance criteria

- `//projects/deployments/pleomino-staging:deploy` and
  `//projects/deployments/pleomino-prod:deploy` select Infisical as their deployment secret backend.
- Pleomino dev remains Vault-backed.
- Pleomino staging and production have reviewed, non-secret Infisical Universal Auth env-name
  metadata and pass deployment metadata validation.
- Pleomino staging and production `secret_requirements` remain stable, and any mapping overrides
  are explicitly reviewed.
- Fake-Infisical tests prove new Pleomino staging and production admissions and runtime acquire use
  Infisical without live network access.
- The portable credential-directory abstraction from the containerization plan is reused, and
  Pleomino Infisical credentials resolve through deployment-scoped credential files without a
  NixOS-only, environment-file-only, or global-tenant credential path.
- Replay tests prove older Vault-admitted Pleomino runs continue to use recorded Vault references.
- Docs and diagnostics describe the cutover without leaking any secret values or Infisical
  credentials.

### 7. Risks

- Changing shared Pleomino family defaults could accidentally move dev or future stages to
  Infisical.
- Incorrect Infisical project/environment/path metadata could break staging or production deploys
  at admission or runtime acquire.
- A rushed cutover could make old Vault-admitted replay records ambiguous if contract ids or
  backend references are changed.
- Operator env-var names could accidentally imply secret values are checked into deployment
  metadata.

### 8. Mitigations

- Add explicit cquery tests for all three Pleomino stages so staging/prod move to Infisical while
  dev stays Vault-backed.
- Keep `secret_requirements` contract ids unchanged and rely on recorded admitted backend refs for
  replay authority.
- Require read-only `deploy admin infisical plan`/`check` evidence before live staging or production
  rollout.
- Store only env-var names in metadata and cover forbidden secret-material patterns with guardrail
  tests.

### 9. Consequences of not implementing this PR

Pleomino staging and production will continue depending on Vault for Cloudflare deployment secrets,
leaving the Infisical implementation unused for the concrete Pleomino release lanes that need the
backend migration.

### 10. Downsides for implementing this PR

It introduces stage-specific Pleomino secret backend metadata and requires coordinated external
Infisical setup before live staging or production deployments can use the new backend.

## PR-16: Infisical site URL contract and end-range traceability repair

### 1. Intent

Reconcile the Pleomino Infisical site URL contract with the implemented metadata/IaC defaults and
restore plan traceability for the post-PR-12 Infisical follow-up range.

Traceability note: PR-16 through PR-18 are assessment-driven follow-up sections created after the
original PR-12 range completed. Keep these headings and their implementation evidence synchronized
so future plan assessments can map the end-of-range fixes by PR number.

### 2. Scope of changes

- Decide and document the authoritative Pleomino Infisical site URL for staging and production.
- If the PR-12 contract remains authoritative, change Pleomino metadata, OpenTofu defaults, tests,
  docs, and diagnostic expectations from `https://us.infisical.com` to
  `https://app.infisical.com`.
- If `https://us.infisical.com` is the intended endpoint, explicitly amend this plan, the design
  notes, operator docs, OpenTofu defaults, metadata expectations, and tests so the regional site URL
  is a reviewed contract instead of an implementation drift.
- Add traceability notes for the completed end-of-range work after PR-12 so future assessments can
  map the implemented PR-16 through PR-18 changes to reviewed plan sections.
- Keep site URL values non-secret and continue rejecting credential material in deployment
  metadata, IaC variables, diagnostics, and test fixtures.

### 3. External prerequisites

- Operators must confirm which Infisical SaaS endpoint the Pleomino project and machine identities
  actually use before any production rollout relies on the reconciled metadata.

### 4. Tests to be added

- Add metadata extraction and validation tests proving Pleomino staging and production emit the
  reviewed site URL exactly.
- Add OpenTofu default and rendered-plan tests proving the IaC path uses the same site URL contract
  as deployment metadata.
- Add diagnostic tests proving `deploy admin infisical plan` reports the reviewed site URL without
  leaking credentials.
- Add docs/traceability guardrail coverage or a focused plan-conformance test proving the plan's
  post-PR-12 sections remain discoverable by PR number.

### 5. Docs to be added or updated

- Update Infisical operator docs, Pleomino cutover docs, and any OpenTofu README or variable docs
  to use the same reviewed site URL.
- Add a short traceability note explaining that PR-16 through PR-18 are follow-up sections created
  from the completed end-of-range assessments and must remain in sync with their implementation
  evidence.

### 5.5. Expected regression scope

- `deployment-and-project-impact`
- Keep changes to Pleomino deployment metadata, Infisical IaC defaults/tests, deployment docs, and
  plan traceability. Do not alter generic Infisical runtime behavior unless the site URL
  reconciliation exposes a shared normalization bug; if it does, update this plan before expanding
  scope.

### 6. Acceptance criteria

- The plan, design references, Pleomino metadata, OpenTofu defaults, tests, and diagnostics agree on
  one reviewed Infisical site URL.
- Assessments no longer report PR-12 noncompliance for the Pleomino site URL.
- Future plan assessments can find traceable PR-16, PR-17, and PR-18 sections in this document.
- No secret values or Infisical credentials are introduced into docs, metadata, IaC defaults, tests,
  or diagnostic output.

### 7. Risks

- Choosing the wrong endpoint could make live authentication fail even though static validation
  passes.
- Editing traceability after implementation could obscure which behavior was already shipped versus
  which behavior remains follow-up work.

### 8. Mitigations

- Require explicit operator confirmation of the Infisical endpoint before finalizing the contract.
- Keep the traceability note factual and tie it to assessment findings rather than rewriting prior
  PR intent.

### 9. Consequences of not implementing this PR

Pleomino Infisical metadata and IaC will remain noncompliant with the PR-12 contract, and future
assessments will continue losing traceability for the implemented post-PR-12 range.

### 10. Downsides for implementing this PR

It may require touching several docs, tests, and defaults for a single endpoint decision.

## PR-17: Bootstrap preflight, resolver config, and OpenTofu retry UX

### 1. Intent

Make Infisical bootstrap fail before remote mutations when operator confirmation is missing, make
resolver configuration explicit and reusable, and improve OpenTofu failure recovery instructions.

### 2. Scope of changes

- Add a non-interactive bootstrap preflight that checks `--yes` requirements before any remote
  Infisical mutation or local sink write can occur.
- Ensure all bootstrap modes that can mutate Infisical state, OpenTofu state, resolver config, or
  local sink output run the preflight before opening remote clients or writing files.
- Update bootstrap resolver-config behavior to read an existing `SprinkleRef` resolver config when
  one is present.
- Create a starter resolver config only when none exists, using explicit backend selection rather
  than hiding the backend choice in bootstrap code.
- Preserve reviewed Vault defaults while making Infisical backend selection visible in generated or
  updated resolver config.
- Improve OpenTofu init, plan, and apply failures so errors include the OpenTofu working directory,
  the saved plan path when one exists, and the exact retry command for the failed stage.
- Keep all failure output redacted and avoid printing Universal Auth client secrets, access tokens,
  personal tokens, or resolved deployment secret values.

### 3. External prerequisites

- None. The behavior must be covered by local tests and fake OpenTofu/Infisical fixtures.

### 4. Tests to be added

- Add non-interactive bootstrap tests proving missing `--yes` fails before any fake remote mutation
  or sink write.
- Add ordering tests for init/plan/apply flows proving the confirmation preflight happens before
  OpenTofu or Infisical side effects.
- Add resolver-config tests proving bootstrap reads an existing `SprinkleRef` resolver config,
  creates a starter config when none exists, and keeps backend selection explicit.
- Add OpenTofu failure tests for init, plan, and apply proving the error includes the working
  directory, saved plan path when applicable, and next retry command.
- Add redaction regression tests proving failure UX never prints credential material or secret
  values.

### 5. Docs to be added or updated

- Update bootstrap docs to describe when `--yes` is required and that confirmation is checked before
  any mutation.
- Document the resolver-config discovery and starter-config behavior, including explicit backend
  selection.
- Update OpenTofu troubleshooting docs with the working directory, saved plan path, and retry
  command format shown by failures.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes in deployment-owned bootstrap, resolver-config, OpenTofu orchestration, docs, and
  tests. If a shared `SprinkleRef` parser or writer must change, update this plan before expanding
  beyond deployment-owned paths.

### 6. Acceptance criteria

- Non-interactive bootstrap cannot mutate Infisical, OpenTofu state, resolver config, or local sink
  output before failing on missing `--yes`.
- Bootstrap reuses existing `SprinkleRef` resolver config when available and creates a starter config
  only when none exists.
- Backend selection is explicit in resolver config behavior and docs.
- OpenTofu init, plan, and apply failures give operators the working directory, saved plan path when
  available, and exact retry command.

### 7. Risks

- Moving confirmation checks earlier could accidentally reject read-only bootstrap inspection flows.
- Starter resolver config generation could overwrite an operator's existing backend selection.
- Retry commands could expose sensitive values if they include raw environment or variable content.

### 8. Mitigations

- Separate read-only inspection from mutation-capable flows in tests.
- Treat existing resolver config as authoritative unless the operator explicitly requests a change.
- Build retry commands from paths, targets, and flags only, with the existing redaction helpers
  applied to all error output.

### 9. Consequences of not implementing this PR

Bootstrap can partially mutate state before refusing to continue, resolver backend selection remains
implicit, and OpenTofu failures do not give operators enough context to retry safely.

### 10. Downsides for implementing this PR

It adds stricter bootstrap ordering and more detailed failure messages that must stay synchronized
with the CLI's actual command shape.

## PR-18: SprinkleRef explicit add and update collision modes

### 1. Intent

Make `sprinkleref` resolver-config edits explicit about create and overwrite behavior so bootstrap
and operator workflows cannot silently choose the wrong mutation mode.

### 2. Scope of changes

- Add explicit overwrite capability to `sprinkleref --add` for cases where an existing resolver
  entry should be replaced.
- Add explicit create capability to `sprinkleref --update` for cases where a missing resolver entry
  should be created deliberately.
- Keep default `--add` behavior failing when the entry already exists unless overwrite is requested.
- Keep default `--update` behavior failing when the entry is missing unless create is requested.
- Ensure bootstrap resolver-config code uses the explicit mode that matches its intent instead of
  relying on hidden create/update behavior.
- Preserve existing config formatting, comments, and unrelated entries when adding, updating,
  overwriting, or creating resolver entries.
- Keep backend selection visible in the resolver config and avoid embedding secret values in any
  resolver entry.

### 3. External prerequisites

- None.

### 4. Tests to be added

- Add `sprinkleref --add` tests proving existing entries fail by default and are replaced only with
  the explicit overwrite option.
- Add `sprinkleref --update` tests proving missing entries fail by default and are created only with
  the explicit create option.
- Add round-trip config tests proving unrelated resolver entries, comments, formatting, and explicit
  backend selection are preserved.
- Add bootstrap integration tests proving resolver-config writes call the new explicit create or
  overwrite modes as appropriate.
- Add guardrail tests proving resolver config edits reject or omit secret values.

### 5. Docs to be added or updated

- Update `sprinkleref` CLI docs with the default collision behavior and the explicit create and
  overwrite options.
- Update bootstrap docs to explain which resolver-config edit mode it uses when creating starter
  configs or modifying existing configs.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes in the `sprinkleref` CLI, deployment resolver-config helpers, and their tests/docs.
  If implementation discovers that shared config editing utilities must change, update this plan
  before expanding scope.

### 6. Acceptance criteria

- `sprinkleref --add` has an explicit overwrite mode and otherwise fails on existing entries.
- `sprinkleref --update` has an explicit create mode and otherwise fails on missing entries.
- Bootstrap uses explicit resolver-config mutation modes and does not hide backend selection in
  code.
- Resolver config edits preserve unrelated content and never write secret material.

### 7. Risks

- New flags could be confused with the existing add/update verbs if their names are too broad.
- Config rewrite logic could accidentally churn formatting or comments.

### 8. Mitigations

- Name the flags around the precise collision behavior and document the default failure modes.
- Add round-trip tests with representative resolver config comments and multiple backends.

### 9. Consequences of not implementing this PR

Operators and bootstrap flows will continue lacking explicit control over whether resolver entries
are created or overwritten.

### 10. Downsides for implementing this PR

It expands the `sprinkleref` CLI surface and requires bootstrap code to choose mutation modes
deliberately.

## PR-19: SprinkleRef repository reference checker

### 1. Intent

Add a `sprinkleref --check` command that inventories repository deployment contract references and
reports whether each `secret://`, `config://`, and `runtime://` reference is declared, mapped, and
satisfiable by the appropriate resolver or runtime configuration source.

### 2. Scope of changes

- Implement `sprinkleref --check` following [`docs/sprinkleref-check.md`](sprinkleref-check.md).
- Discover checked-in `secret://`, `config://`, and `runtime://` references while skipping generated
  output and dependency directories.
- Report source file and line information for each discovered deployment contract ref.
- Resolve `secret://` refs through the selected SprinkleRef resolver config and category, without
  printing secret values.
- Check `config://` and `runtime://` refs against deployment requirement metadata or local runtime
  config declarations instead of treating them as secret backend entries.
- Add `--target <buck-target>` support that lists contract values required by a selected app or
  deployment target, defaulting to transitive dependencies.
- Add an option such as `--no-deps` or `--deps none|direct|transitive` so operators can list only
  refs declared directly by the selected Buck target when needed.
- Distinguish direct target refs from dependency-derived refs in human and JSON output.
- Provide human-readable output and `--format json` output with matching status categories.
- Support scheme filters for `secret`, `config`, and `runtime`.
- Return stable exit codes for successful checks, missing/unmapped/invalid refs, backend/config
  access errors, and scanner/usage errors.
- Keep the command read-only. It must not create resolver config, write secret values, mutate
  backends, or modify deployment metadata.

### 3. External prerequisites

- None. The initial implementation must be covered by local fixtures and checked-in repository
  inputs only.

### 4. Tests to be added

- Add scanner tests proving tracked repository text can discover `secret://`, `config://`, and
  `runtime://` refs with file and line locations while skipping generated/dependency paths.
- Add resolver tests proving present, missing, unmapped, invalid, and unchecked refs are reported
  with the expected status.
- Add `secret://` backend tests proving presence checks never print or serialize resolved secret
  values.
- Add `config://` and `runtime://` tests proving non-secret refs are checked against declarations
  rather than secret backends.
- Add Buck target-scope tests proving `--target` reports direct and dependency-derived
  `secret://`, `config://`, and `runtime://` requirements for representative app and deployment
  targets.
- Add dependency-scope tests proving `--no-deps` or `--deps none|direct|transitive` changes only the
  target closure being inspected, not resolver semantics.
- Add target-scope error tests proving the command does not silently fall back to repo-wide text
  scanning when structured Buck/deployment metadata is unavailable.
- Add JSON output tests proving statuses, schemes, sensitivity flags, categories, backends, and
  locations, required-by targets, and direct/dependency scope are stable.
- Add CLI exit-code tests for success, missing/unmapped/invalid refs, backend/config errors, and
  scanner/usage errors.
- Add redaction regression tests for backend errors and diagnostic output.

### 5. Docs to be added or updated

- Keep [`docs/sprinkleref-check.md`](sprinkleref-check.md) synchronized with the implemented command
  flags, report shape, status categories, and exit codes.
- Update [`docs/sprinkleref.md`](sprinkleref.md) with the operator-facing `--check` workflow.
- Update deployment or secrets usage docs with guidance for running `sprinkleref --check` before
  bootstrap, deployment admission, or CI validation.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes in SprinkleRef CLI, deployment reference scanning, resolver checking, deployment
  requirement metadata readers, docs, and tests. If implementation discovers that shared deployment
  admission or runtime-config APIs must change, update this plan before expanding scope.

### 6. Acceptance criteria

- `sprinkleref --check` inventories `secret://`, `config://`, and `runtime://` deployment contract
  refs from checked-in repository files.
- `sprinkleref --check --target <buck-target>` inventories the same schemes for the selected Buck
  target and, by default, its transitive dependencies.
- Operators can exclude dependencies or choose a dependency scope and the output clearly separates
  direct target refs from dependency-derived refs.
- Secret refs are checked through the selected resolver/backend without exposing secret values.
- Non-secret config and runtime refs are checked against declarations or local runtime config
  sources, not secret stores.
- Human and JSON output agree on status categories and include source locations.
- Exit codes are stable and documented.
- The command is read-only and cannot mutate resolver config, backends, or deployment metadata.

### 7. Risks

- Text scanning may report examples in docs that are not intended to be live requirements.
- Backend presence checks can accidentally become value reads if backend adapters are not carefully
  scoped.
- `config://` and `runtime://` ownership may be ambiguous when refs appear outside structured
  deployment metadata.
- Buck target-scoped checks may be misleading if they fall back from structured metadata to broad
  text scanning without making that limitation explicit.

### 8. Mitigations

- Start with clear `Unchecked` and `Unmapped` statuses instead of guessing ownership.
- Keep backend adapters presence-only and reuse the existing redaction helpers for all diagnostics.
- Add scheme filters and JSON output so CI can adopt the checker incrementally.
- Fail clearly or report `Unchecked` for target-scoped checks when structured metadata is missing;
  do not label repo-wide text-scan results as target-specific.

### 9. Consequences of not implementing this PR

Operators and CI will continue discovering missing SprinkleRef and runtime-config references only
after bootstrap, admission, or deployment commands reach the failing backend path.

### 10. Downsides for implementing this PR

The command introduces a broader repository scanner and may need careful filtering to avoid noisy
reports from documentation examples and test fixtures.

## PR-20: Repo-wide Infisical bootstrap boundary

### 1. Intent

Separate repo-wide Infisical/SprinkleRef backend bootstrap from Pleomino-specific Infisical
deployment provisioning so operators can initialize and validate the repository's secret backend
profile registry without implicitly creating or reconciling Pleomino resources. Preserve support
for mixed backends, including the near-term Vault/Infisical split and future deployments that may
use different Infisical accounts or different Vault instances.

### 2. Scope of changes

- Introduce explicit bootstrap command modes:
  - `infisical-bootstrap repo --dry-run|--yes` initializes and validates repo-wide backend profile
    configuration without assuming a deployment family.
  - `infisical-bootstrap deployment --target <buck-target> --dry-run|--yes` provisions or
    reconciles deployment-specific Infisical resources selected by reviewed deployment metadata.
- Make repo-wide bootstrap responsible for:
  - creating or validating the `sprinkleref/` resolver config set;
  - selecting or validating one or more named backend profiles, including the default Infisical
    host/organization profile and any future Vault or Infisical profile aliases used by deployment
    metadata;
  - selecting the bootstrap credential sink for each profile that needs bootstrap credentials and
    ensuring bootstrap credentials never resolve through the same backend they unlock;
  - reporting the next commands needed to verify `sprinkleref --check --config ...`;
  - remaining read-only in dry-run mode and mutation-gated by `--yes` in non-dry-run mode.
- Represent backend instances/accounts as named SprinkleRef profiles, with categories describing
  usage lanes. Use `vault-default` for the current Vault behavior and `infisical-default` for the
  initial Infisical host/organization defaults, while allowing future aliases such as
  `infisical-regulated` or `vault-regulated`.
- Extend or document deployment metadata so deployments select both backend kind and named backend
  profile through the unified `secret_backend = "<backend>/<profile-alias>"` selector, rather than
  assuming a single repo-global Vault instance or Infisical account. Omitted `secret_backend`
  defaults to `vault/default`.
- Keep deployment metadata responsible for selecting the profile alias only. Local/CI resolver
  config owns the account-specific profile details, and admitted run metadata records the concrete
  backend kind/profile/ref used at admission time.
- Preserve a simple default profile path for current deployments so existing Vault-backed
  deployments and the Pleomino Infisical cutover do not require unnecessary per-deployment config
  churn.
- Move the current Pleomino-specific OpenTofu module, reviewed metadata reconciliation, project
  creation, environment creation, and deployment Universal Auth credential management behind an
  explicit deployment-specific mode or target selection.
- Require deployment-specific bootstrap to name its scope explicitly with `--target <buck-target>`
  before it can use
  `projects/deployments/pleomino-infisical/opentofu` or
  `projects/deployments/pleomino-shared/family.bzl`.
- Keep existing Pleomino bootstrap behavior available through the new explicit deployment-specific
  path, without changing the reviewed Pleomino metadata contract.
- Update dry-run output so repo-wide bootstrap reports no Pleomino paths, projects, or OpenTofu
  modules unless a Pleomino deployment scope was explicitly selected.
- Update `sprinkleref --check` guidance so an absent resolver config points operators at repo-wide
  bootstrap or `sprinkleref --init`, not a Pleomino provisioning command.

### 3. External prerequisites

- None beyond the existing operator access required for Infisical/Vault bootstrap. This PR adopts
  `repo` and `deployment --target <buck-target>` as the command shape, and `vault-default` /
  `infisical-default` as the initial default profile aliases.

### 4. Tests to be added

- Add repo-wide dry-run tests proving no Pleomino OpenTofu directory, reviewed metadata path, project
  slug, or deployment credential names appear unless a deployment-specific scope is selected.
- Add repo-wide non-dry-run preflight tests proving missing `--yes` fails before resolver config,
  Infisical, OpenTofu, or credential-sink mutation.
- Add repo-wide resolver-config tests proving the command creates starter configs only in the
  repo-wide bootstrap path and preserves existing authoritative resolver configs.
- Add resolver schema tests proving profiles and categories are distinct: profiles name backend
  instances/accounts, while categories such as `main` and `bootstrap` select usage lanes.
- Add backend-profile tests proving repo-wide bootstrap can validate multiple named profiles without
  forcing all deployments onto one Infisical account or one Vault instance.
- Add credential-sink tests proving bootstrap credentials cannot resolve through the same backend
  profile they unlock, including Infisical bootstrap credentials that must not use the Infisical
  `main` backend.
- Add deployment metadata tests proving existing Vault-backed deployments keep selecting the Vault
  default profile while Infisical-backed deployments select the intended Infisical profile through
  the unified selector or omitted default.
- Add admission metadata tests proving admitted runs record the concrete backend kind, profile alias,
  and backend reference used at admission time so replays do not silently switch profiles.
- Add deployment-specific selection tests proving the Pleomino OpenTofu module and reviewed
  metadata reconciliation run only when the Pleomino deployment scope is explicitly selected.
- Add regression tests proving the existing Pleomino provisioning path still reconciles against
  checked-in Pleomino metadata and manages the expected deployment credential refs.
- Add `sprinkleref --check` guidance tests proving missing resolver config diagnostics mention
  repo-wide bootstrap or `sprinkleref --init`, and do not imply that Pleomino provisioning is
  required for repo-wide validation.

### 5. Docs to be added or updated

- Update `infisical-bootstrap.md` to describe the two bootstrap layers:
  repo-wide backend-profile/bootstrap credential setup and deployment-specific Infisical project
  provisioning.
- Document the adopted operator commands:
  - `infisical-bootstrap repo --dry-run`
  - `infisical-bootstrap repo --yes`
  - `infisical-bootstrap deployment --target <buck-target> --dry-run`
  - `infisical-bootstrap deployment --target <buck-target> --yes`
- Update `docs/sprinkleref.md` and `docs/sprinkleref-check.md` with the repo-wide initialization
  workflow before running `sprinkleref --check --config ...`.
- Update `projects/deployments/pleomino-infisical/README.md` so Pleomino instructions call the
  explicit deployment-specific bootstrap path and no longer appear to be the default repo-wide
  bootstrap.
- Update `docs/infisical-design.md` and deployment metadata docs if needed to clarify that
  deployment declarations select a backend kind and profile alias, while provisioning an Infisical
  project/environment/identity remains a scoped deployment concern.
- Add resolver config examples showing:
  - `profiles.vault-default` for the existing Vault behavior;
  - `profiles.infisical-default` for the initial Infisical host/organization defaults;
  - `categories.main.profile = "infisical-default"` for ordinary Infisical-backed deployment
    secrets;
  - a non-Infisical `bootstrap` category for credentials that unlock Infisical.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes in Infisical bootstrap CLI/configuration, SprinkleRef initialization/check guidance,
  Pleomino Infisical provisioning wiring, docs, and tests. If implementation requires changes to
  generic deployment admission or runtime secret acquisition, update this plan before expanding
  scope.

### 6. Acceptance criteria

- Operators can run a repo-wide Infisical/SprinkleRef bootstrap dry-run without seeing Pleomino
  project, OpenTofu, or reviewed metadata paths.
- Repo-wide bootstrap can initialize and validate the repository backend-profile registry and
  resolver config boundary without provisioning a deployment-specific Infisical project.
- The design supports multiple named Vault or Infisical profiles while preserving a default profile
  for the current simple path.
- Existing Vault-backed deployments remain Vault-backed, and Infisical-backed deployments select the
  intended Infisical profile explicitly or through the documented default.
- Deployment metadata can set `secret_backend = "<backend>/<profile-alias>"` to select a
  non-default profile without embedding account-specific secrets or backend coordinates in
  deployment targets.
- Admitted run metadata records the selected backend kind/profile/ref so replay behavior is stable
  across later profile config changes.
- Pleomino Infisical provisioning still exists, but requires an explicit deployment-specific
  `--target` selector before it can touch the Pleomino OpenTofu module or reviewed metadata.
- `sprinkleref --check` absent-config guidance points to repo-wide initialization, and configured
  checks can distinguish present, missing, unmapped, and unchecked refs without requiring Pleomino
  provisioning.
- Bootstrap dry-run and non-dry-run confirmation semantics remain explicit and mutation-safe.

### 7. Risks

- Splitting command modes could break existing operator muscle memory for the Pleomino bootstrap
  path.
- Repo-wide bootstrap could become too abstract if it tries to infer deployment provisioning policy
  that belongs in deployment metadata.
- Resolver config creation could still look like a deployment-specific action if docs and command
  names are not precise.
- A profile registry could add unnecessary complexity if the first implementation overfits unlikely
  multi-account or multi-Vault scenarios.

### 8. Mitigations

- Preserve the current Pleomino behavior behind a compatibility path or a clearly documented
  deployment selector during the migration.
- Keep repo-wide bootstrap narrowly focused on resolver config, named backend profiles, and
  bootstrap credential sink policy.
- Implement one default Infisical profile and one default Vault profile first, but make the data
  model and docs allow additional named profiles without another CLI redesign.
- Add dry-run output assertions and docs examples that make the repo-wide/deployment-specific
  boundary visible.

### 9. Consequences of not implementing this PR

Operators will continue seeing Pleomino-specific resources in what appears to be a repo-wide
Infisical bootstrap flow, making it unclear whether setting up Infisical for the repo requires
provisioning a specific deployment family. The repo will also lack an explicit place to model
future deployments that need a different Infisical account or Vault instance.

### 10. Downsides for implementing this PR

The bootstrap CLI surface becomes more explicit and may require a short migration for existing
Pleomino bootstrap instructions and scripts. Introducing backend profile aliases adds a small
configuration concept that must be documented carefully.

## PR-21: Bootstrap operator guardrail completion

### 1. Intent

Close the post-PR-20 assessment gaps around Infisical bootstrap safety and operator-facing command
shape. Ensure repo and deployment bootstrap paths fail before mutation when resolver config
preconditions are missing or unsafe, prevent the `bootstrap` usage lane from resolving through
Infisical in all SprinkleRef entrypoints, and align the documented command surface with the
implemented operator entrypoint.

### 2. Scope of changes

- Add or expose the adopted `infisical-bootstrap` operator command surface, or explicitly amend the
  reviewed command contract to keep `infisical-iac-bootstrap.ts` as the canonical entrypoint.
- Align bootstrap CLI usage text, retry guidance, SprinkleRef missing-config diagnostics, and docs
  so they all name the same reviewed operator command and include the required `repo` or
  `deployment --target <buck-target>` mode.
- Add the missing `docs/infisical-bootstrap.md` documentation path, or redirect it intentionally to
  the existing top-level bootstrap document if that remains the canonical spec.
- Make deployment-mode bootstrap validate or create the starter `sprinkleref/` resolver config
  before Infisical identity, Universal Auth, OpenTofu, or credential-sink mutations when
  `--credential-sink auto` is selected and no resolver config exists.
- Keep dry-run read-only and non-dry-run mutation-gated by `--yes`; failures caused by missing or
  unsafe resolver config must report the remediation command without writing credentials or touching
  Infisical/OpenTofu state.
- Enforce that the SprinkleRef `bootstrap` category cannot resolve to an Infisical backend or an
  Infisical profile in every entrypoint that creates a writable store, not only the Infisical
  bootstrap credential-sink helper.
- Tighten Infisical runtime metadata validation so only reviewed non-secret runtime fields and
  Universal Auth env-name fields are accepted; reject unsupported token-style env metadata such as
  `token_env`, `access_token_env`, `personal_token_env`, and `secret_value_env`.

### 3. External prerequisites

- None. This PR is a local CLI/config/docs guardrail follow-up and must not require live Infisical,
  Vault, or OpenTofu access.

### 4. Tests to be added

- Add bootstrap CLI/usage tests proving the selected operator command text is consistent across
  `--help`, missing-`--yes` retry output, and `sprinkleref --check` missing-config guidance.
- Add deployment bootstrap preflight tests proving `--credential-sink auto` creates or validates the
  starter resolver config before any Infisical, OpenTofu, or credential-sink mutation, and preserves
  dry-run read-only behavior.
- Add SprinkleRef CLI tests proving `--category bootstrap add/update/remove/check` rejects Infisical
  backends and Infisical profiles while still allowing non-Infisical control-plane backends.
- Add deployment metadata tests proving unsupported token-style Infisical runtime env keys are
  rejected while approved Universal Auth env-name fields continue to pass validation.
- Add regression coverage for category-only resolver configs so PR-20's profile support remains
  backward-compatible with existing local/operator configs.

### 5. Docs to be added or updated

- Update `infisical-bootstrap.md`, `docs/infisical-bootstrap.md`, `docs/sprinkleref.md`, and
  `docs/sprinkleref-check.md` so the repo-wide bootstrap, deployment-specific bootstrap, and
  resolver initialization flows all use one consistent command vocabulary.
- Document that `bootstrap` is a protected control-plane credential lane and must not use Infisical
  as the storage backend for credentials that unlock Infisical.
- Document the accepted Infisical runtime metadata fields and call out rejected token-style env
  metadata as an intentional guardrail.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes in Infisical bootstrap CLI/configuration, SprinkleRef resolver validation and CLI
  store creation, deployment metadata validation, docs, and focused tests. Do not change live
  Infisical/Vault APIs or deployment execution semantics beyond the guardrails above.

### 6. Acceptance criteria

- Operators see one consistent reviewed bootstrap command surface across CLI help, docs, retry
  output, and missing-config guidance.
- Deployment bootstrap with `--credential-sink auto` cannot perform remote or credential mutations
  before resolver config creation/validation has succeeded.
- No SprinkleRef write path can use `--category bootstrap` with an Infisical backend or Infisical
  profile.
- Infisical runtime metadata rejects unsupported token/secret env-source keys and continues to
  accept reviewed Universal Auth client id/client secret env-name fields.
- Existing category-only resolver configs remain valid for edit/check flows.

### 7. Risks

- Adding a friendlier `infisical-bootstrap` entrypoint could create drift from the underlying
  TypeScript script if both are documented inconsistently.
- A global `bootstrap` category restriction could reject a niche operator config that previously
  worked but was unsafe for Infisical bootstrap credentials.
- Tightening runtime metadata validation could expose stale checked-in metadata or fixture data that
  used unsupported token-style names.

### 8. Mitigations

- Keep the operator entrypoint as a thin wrapper or single documented alias around the existing
  implementation.
- Add targeted tests for both rejected Infisical bootstrap categories and accepted local/keychain/CI
  bootstrap categories.
- Use explicit allowlists for Infisical runtime metadata so the error messages identify the
  unsupported key and the reviewed replacement fields.

### 9. Consequences of not implementing this PR

Operators could still hit mutation-after-partial-bootstrap failures, store Infisical bootstrap
credentials in Infisical through a generic SprinkleRef path, or follow stale command guidance that
the parser rejects. Deployment metadata could also continue accepting unsupported token-style env
keys that weaken the reviewed Universal Auth contract.

### 10. Downsides for implementing this PR

The bootstrap/resolver validation surface becomes stricter, and local configs that relied on unsafe
or undocumented `bootstrap` mappings will need to move those credentials to a non-Infisical control
plane backend.

## PR-22: Bootstrap validation edge-case closure

### 1. Intent

Close the final post-PR-21 assessment gaps in Infisical bootstrap validation. Make metadata
allowlists inspect raw runtime keys instead of only string-normalized values, and enforce the
documented requirement that non-interactive `--no-login` bootstrap flows name the intended
Infisical organization explicitly.

### 2. Scope of changes

- Update Infisical runtime metadata validation so unsupported key names are detected from the raw
  `infisical_runtime` object, including non-string values that would otherwise be dropped by
  string-record normalization.
- Keep accepting the reviewed non-secret runtime fields and Universal Auth env-name fields, but
  reject unsupported token/secret env-source keys regardless of value type.
- Update bootstrap argument parsing or preflight so `--no-login` requires exactly one explicit
  organization selector via `--organization-id` or `--org-name`.
- Preserve existing interactive/org-discovery behavior for login-based operator flows that do not
  use `--no-login`.
- Update any tests that currently codify `--no-login --yes` auto-selecting a single organization.

### 3. External prerequisites

- None. This PR is local validation and test coverage only.

### 4. Tests to be added

- Add deployment metadata tests proving unsupported `infisical_runtime` keys are rejected even when
  their values are non-string objects, arrays, booleans, or numbers.
- Add parser/preflight tests proving `--no-login` without `--organization-id` or `--org-name` fails
  with remediation, while `--no-login --organization-id ...` and `--no-login --org-name ...`
  continue to parse.
- Keep the existing login-based single-organization auto-selection test, or rename it to clarify it
  does not apply to `--no-login`.

### 5. Docs to be added or updated

- Update `infisical-bootstrap.md` and `docs/infisical-bootstrap.md` if needed to clarify that
  `--no-login` flows must provide an explicit organization selector and that runtime metadata key
  validation applies before value normalization.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes in bootstrap argument validation, deployment metadata validation, docs, and focused
  tests. Do not change live Infisical API calls, deployment admission behavior, or resolver storage
  semantics beyond the validation edge cases above.

### 6. Acceptance criteria

- Unsupported Infisical runtime metadata keys fail validation regardless of whether their values are
  strings or non-string JSON/Starlark values.
- `--no-login` bootstrap invocations fail before authentication or mutation when no organization
  selector is provided.
- Login-based interactive and `--yes` organization discovery remains available when `--no-login` is
  not selected.
- Focused tests cover the validation edge cases and the repository validation suite passes.

### 7. Risks

- Tightening raw-key validation could reveal malformed fixture metadata that was previously ignored
  because its value type was not a string.
- Requiring an organization selector for `--no-login` may break local scripts that relied on
  single-organization auto-selection with token-based auth.

### 8. Mitigations

- Error messages should name the unsupported key and the accepted reviewed fields.
- Parser or preflight remediation should explicitly suggest `--org-name <name>` or
  `--organization-id <id>`.
- Keep the login-based auto-selection path unchanged for operator convenience.

### 9. Consequences of not implementing this PR

Unsupported runtime metadata can evade validation by using non-string values, and CI/non-interactive
bootstrap flows can still silently choose the wrong Infisical organization when a token has access
to exactly one organization.

### 10. Downsides for implementing this PR

The bootstrap CLI becomes stricter for token-based automation, requiring scripts to pass one more
explicit flag.

## PR-23: Resolver-entry profile config closure

### 1. Intent

Close the remaining post-PR-22 design assessment gap in SprinkleRef resolver-entry editing. Ensure
operator remediation commands work against the generated starter resolver config, including
profile-backed categories inherited from `base.json`.

### 2. Scope of changes

- Update resolver-entry config validation so edits preserve and validate against the already-loaded
  `profiles` table when merging categories.
- Keep explicit `--add`, `--update`, `--overwrite-existing`, and `--create-missing` semantics
  unchanged.
- Keep the protected `bootstrap` category Infisical backend/profile guard unchanged.
- Sync the Infisical design doc with the accepted file-name runtime metadata keys already documented
  in the root bootstrap spec and implemented in validation.

### 3. External prerequisites

- None. This PR is local resolver config editing, docs, and test coverage only.

### 4. Tests to be added

- Add a focused resolver-entry regression test that initializes the generated SprinkleRef starter
  configs and updates the `bootstrap` category in `selected.local.json` while `main` remains
  profile-backed through `infisical-default`.

### 5. Docs to be added or updated

- Update `docs/infisical-design.md` to list the accepted machine identity file-name runtime keys.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to SprinkleRef resolver-entry validation, focused tests, and design-doc sync.
  Do not change resolver file generation, secret backends, bootstrap mutation behavior, or live
  Infisical API calls.

### 6. Acceptance criteria

- `sprinkleref --resolver-entry --update bootstrap ...` works against the generated
  `sprinkleref/selected.local.json` shape that extends `base.json` and keeps `main` as
  `{ "profile": "infisical-default" }`.
- Profile-backed categories remain validated against the merged profile table instead of being
  rejected as missing.
- Existing resolver-entry explicit-mode and bootstrap guard behavior remains unchanged.
- Focused tests cover the generated starter config regression and the repository validation suite
  passes.

### 7. Risks

- Passing merged profiles into validation could mask malformed local profile edits if the merged
  config is not validated consistently.

### 8. Mitigations

- Reuse the existing `readSprinkleRefConfig` resolved config and `validateConfig` path so inherited
  profiles and categories are validated by the same loader used elsewhere.
- Add the regression test against the generated starter config rather than a hand-rolled minimal
  fixture.

### 9. Consequences of not implementing this PR

Operators following the documented resolver-entry remediation path can hit a false validation
failure on the default generated config because `main` references an inherited profile.

### 10. Downsides for implementing this PR

The resolver-entry edit path depends more directly on the resolved config loader, but that is the
same source of truth used by check and resolution paths.

## PR-24: Infisical resolver and admission design closure

### 1. Intent

Close the remaining post-PR-23 design assessment gaps. Align resolver documentation with the
implemented non-secret `projectId` contract, and implement the documented Infisical admission
fallback when metadata-only reads omit exact version metadata.

### 2. Scope of changes

- Clarify that Infisical SprinkleRef resolver profiles use concrete non-secret `projectId`, not
  `projectRef`, and reject `projectRef` with remediation.
- Keep `projectId` as non-secret routing metadata, consistent with deployment runtime metadata and
  Infisical API query parameters.
- Update root bootstrap examples that still showed `projectRef`.
- Implement admission fallback: read metadata with `viewSecretValue=false` first; if the returned
  record is usable but lacks a version, perform a value read only to obtain exact metadata and
  discard `secretValue` before constructing admitted references.

### 3. External prerequisites

- None. This PR is local resolver validation, docs, fake-server support, and focused tests only.

### 4. Tests to be added

- Add a resolver config test proving Infisical `projectRef` is rejected with a `projectId`
  remediation.
- Update the Infisical admission test that previously locked in missing-version rejection so it now
  proves the value-read fallback freezes the exact version and does not include the returned secret
  value in admitted references.

### 5. Docs to be added or updated

- Update `infisical-bootstrap.md` resolver examples from `projectRef` to `projectId`.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to Infisical resolver validation/docs and the admission metadata fallback.
  Do not change deployment bootstrap side effects, OpenTofu behavior, credential sink storage, or
  runtime secret replay semantics.

### 6. Acceptance criteria

- Operators following the documented resolver examples can create a valid Infisical resolver profile
  using `projectId`.
- Resolver configs using `projectRef` fail clearly and tell the operator to use `projectId`.
- Admission still starts with `viewSecretValue=false` and only performs a value read when exact
  version metadata is missing.
- Fallback value reads discard `secretValue` and admitted references contain only non-secret
  selector/version metadata.
- Focused tests cover both edge cases and the repository validation suite passes.

### 7. Risks

- Rejecting `projectRef` may break local experimental configs copied from the older docs.
- Fallback value reads touch secret material during admission in the narrow case where Infisical
  omits version metadata from metadata-only responses.

### 8. Mitigations

- Error messages point directly to `projectId`, which is already required by validation and used by
  the Infisical API paths.
- The fallback strips `secretValue` immediately and existing redaction/no-leak assertions continue
  to cover admitted references.

### 9. Consequences of not implementing this PR

Operators can copy invalid resolver examples, and admission remains incompatible with Infisical
responses that only expose exact version metadata on ordinary value reads.

### 10. Downsides for implementing this PR

The admission path performs one extra Infisical read for servers that omit version metadata from
metadata-only responses.

## PR-25: Bootstrap credential sink category closure

### 1. Intent

Close the remaining design assessment gap that allowed bootstrap Infisical access credentials to be
written to an Infisical-backed SprinkleRef category by selecting a category other than the literal
`bootstrap` lane.

### 2. Scope of changes

- Add a bootstrap-command credential-sink guard that rejects any selected SprinkleRef category or
  profile resolving to Infisical when storing Infisical access/bootstrap credentials.
- Preserve the existing literal `bootstrap` category guard for generic SprinkleRef add/update/remove
  and check flows.
- Keep custom non-Infisical access categories supported for operators who intentionally separate
  bootstrap access credentials from the default `bootstrap` category.

### 3. External prerequisites

- None. This PR is local validation and tests only.

### 4. Tests to be added

- Add regression tests proving `--credential-sink sprinkleref --sprinkle-category main` fails when
  `main` resolves through an Infisical profile.
- Add regression tests proving a custom selected category fails when it directly uses an Infisical
  backend.
- Keep the existing custom local-file category test passing.

### 5. Docs to be added or updated

- Update this plan only unless user-facing command docs need remediation wording changes.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to bootstrap credential sink validation and focused tests. Do not change
  application secret storage, generic SprinkleRef category semantics, or Infisical API behavior.

### 6. Acceptance criteria

- Bootstrap/deployment access credentials cannot be written to Infisical through any selected
  SprinkleRef category or profile.
- Non-Infisical selected categories remain supported for access credential lifecycle handoff.
- Literal `bootstrap` category protections for generic SprinkleRef paths remain unchanged.
- Focused tests cover both profile-backed and direct Infisical-backed selected categories and the
  repository validation suite passes.

### 7. Risks

- Operators with experimental `--sprinkle-category main` flows backed by Infisical will now fail.

### 8. Mitigations

- Error messages should name the selected category and tell the operator to choose or update a
  non-Infisical category such as `bootstrap`.

### 9. Consequences of not implementing this PR

Bootstrap Universal Auth credentials can be stored in the same Infisical account they unlock,
breaking the bootstrap trust boundary.

### 10. Downsides for implementing this PR

The bootstrap credential sink path becomes stricter than generic SprinkleRef operations for
non-`bootstrap` categories, but only when the bootstrap command is storing Infisical access
credentials.

## PR-26: Bootstrap resolver validation and handoff closure

### 1. Intent

Close the remaining design assessment gaps in repo resolver validation and deployment credential
handoff metadata after the repo-wide bootstrap split.

### 2. Scope of changes

- Make repo bootstrap resolver validation reject an unsafe `bootstrap` category even when the
  selected credential sink is explicit `local-file` or `macos-keychain`.
- Keep the validation scoped to the repo resolver config contract; do not change explicit sink
  storage behavior.
- Normalize handoff reports so the default selected access credential category is materialized as
  `bootstrap` instead of omitted.

### 3. External prerequisites

- None. This PR is local validation and tests only.

### 4. Tests to be added

- Add a repo-bootstrap regression test proving `--credential-sink local-file` still rejects a
  resolver config whose `bootstrap` category resolves through Infisical.
- Add or tighten handoff report assertions proving the default selected SprinkleRef category is
  emitted as `bootstrap`.

### 5. Docs to be added or updated

- Update this plan only unless user-facing output text changes.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to repo bootstrap resolver validation and credential handoff metadata.

### 6. Acceptance criteria

- Repo bootstrap cannot report an unsafe resolver config as valid when `bootstrap` points to
  Infisical.
- The default deployment handoff JSON includes `sprinkleCategory: "bootstrap"` and
  `resolverHandoff.targetCategory: "bootstrap"`.
- Existing custom non-Infisical category behavior remains unchanged.
- Focused tests and the repository validation suite pass.

### 7. Risks

- Existing resolver configs with an unsafe `bootstrap` category will fail earlier during repo
  bootstrap, even when operators are temporarily writing credentials to an explicit local sink.

### 8. Mitigations

- Reuse the existing bootstrap credential sink remediation text so the failure names the category
  and points to a non-Infisical backend fix.

### 9. Consequences of not implementing this PR

Repo bootstrap can validate an unsafe resolver config, and deployment handoff output can omit the
default category needed to route access credential refs.

### 10. Downsides for implementing this PR

Repo bootstrap becomes stricter about resolver config validity before every repo bootstrap run.

## PR-27: Unified deployment secret backend selector

### 1. Intent

Make deployment secret backend/profile mismatches syntactically unrepresentable by replacing the
two independent deployment metadata fields with one canonical backend selector. Preserve existing
runtime shape internally while giving authors a cleaner `secret_backend` contract.

### 2. Scope of changes

- Add support for a unified `secret_backend` selector string with the shape
  `<backend>/<profile-alias>`, for example:
  - `vault/default`
  - `vault/regulated`
  - `infisical/default`
  - `infisical/regulated`
- Normalize unified selectors into the existing internal fields:
  - `vault/default` becomes `secretBackend: "vault"` and
    `secretBackendProfile: "vault-default"`.
  - `infisical/default` becomes `secretBackend: "infisical"` and
    `secretBackendProfile: "infisical-default"`.
  - Non-default aliases are prefixed by backend, such as
    `infisical/regulated` -> `infisical-regulated`.
- Keep omitted `secret_backend` defaulting to `vault/default`.
- Reject bare backend values such as `secret_backend = "vault/default"` or `"infisical"`;
  deployment metadata must use the unified selector when it declares a backend explicitly.
- Remove public deployment metadata support for `secret_backend_profile`.
- Keep resolver profile names unchanged. This PR changes only deployment metadata authoring and
  normalization, not SprinkleRef resolver config shape.

### 3. External prerequisites

- None. This PR is a metadata parser/validation compatibility improvement and does not require live
  Infisical, Vault, OpenTofu, or resolver backend access.

### 4. Tests to be added

- Add deployment metadata tests proving:
  - omitted `secret_backend` still normalizes to `vault/default`;
  - `secret_backend = "vault/default"` normalizes to `vault-default`;
  - `secret_backend = "infisical/default"` normalizes to `infisical-default`;
  - non-default aliases such as `infisical/regulated` normalize to
    `infisical-regulated`;
  - malformed selectors fail with clear remediation;
  - bare backend values and `secret_backend_profile` fail validation.
- Add admission metadata tests proving admitted contexts and admitted secret references still record
  the normalized backend kind and profile alias after unified selector parsing.
- Add cquery or contract extraction coverage for at least one checked-in or fixture deployment that
  uses the unified selector form.

### 5. Docs to be added or updated

- Update `docs/infisical-design.md` to make the unified `secret_backend =
"<backend>/<profile-alias>"` selector the only explicit backend-selection contract.
- Update `infisical-bootstrap.md`, `docs/sprinkleref.md`, and deployment metadata docs/examples
  that discuss backend profile selection.
- Update this plan only for the transition policy if implementation discovers additional
  compatibility constraints.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to deployment metadata extraction/validation, admission metadata
  normalization, focused tests, and docs. Do not change resolver config format, secret runtime
  backend behavior, Infisical/Vault API calls, or bootstrap credential sink semantics.

### 6. Acceptance criteria

- New deployment metadata can express backend and profile selection with one selector that cannot
  syntactically pair Vault with an Infisical-prefixed profile or Infisical with a Vault-prefixed
  profile.
- Bare backend values and `secret_backend_profile` are rejected on the public metadata surface.
- Internal normalized deployment contracts continue exposing `secretBackend` and
  `secretBackendProfile` so existing admission/runtime code does not need a broad refactor.
- Admitted contexts and admitted secret references continue recording the normalized backend kind
  and profile alias.
- Focused tests cover unified selectors, split-form rejection, and malformed selector remediation.

### 7. Risks

- Existing deployments or fixtures that still use bare backend values need to migrate to the
  unified selector.
- A selector string is compact but can hide the normalization rule if docs do not show examples.
- Backend-local aliases such as `default` and `regulated` must normalize deterministically to the
  existing global profile names used by resolver config.

### 8. Mitigations

- Emit validation errors that explain the preferred unified selector and the normalized profile
  name.
- Document the selector grammar and examples near deployment metadata authoring docs.
- Keep resolver profile names unchanged so operators do not need to rename resolver configs.

### 9. Consequences of not implementing this PR

Deployment metadata can continue to express contradictory backend/profile pairs that are only
detected by later validation or assessment, making backend selection harder to reason about.

### 10. Downsides for implementing this PR

The metadata parser becomes stricter and existing bare-backend fixtures must be migrated in the
same PR.
