# Infisical Deployment Secrets Plan

This plan implements the Infisical deployment secrets model described in
[Infisical Deployment Secrets Design](../designs/infisical-design.md).

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
  [Deployment Verify Scope](../migrations/deployment-verify-scope.md):
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
  `infisical:fixture:secret://deployments/sample-webapp/cloudflare_api_token@fixture-v1`.
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
- Update [NixOS Shared Host Usage](../../nixos-shared-host-usage.md)
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
- All functionality described in `docs/history/designs/infisical-design.md` is either implemented or explicitly
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
  instead of implemented, update `docs/history/designs/infisical-design.md` and all public docs in the same PR to
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

## PR-12: Sample webapp staging and production Infisical cutover

### 1. Intent

Move the Sample webapp staging and production Cloudflare Pages deployments from Vault-backed deployment
secrets to Infisical-backed deployment secrets while keeping the existing `secret_requirements`
contract ids, lane governance, provider behavior, and replay guarantees intact.

### 2. Scope of changes

- Update `//projects/deployments/sample-webapp/staging:deploy` and
  `//projects/deployments/sample-webapp/prod:deploy` so they declare `secret_backend = "infisical/default"`.
- Preserve `//projects/deployments/sample-webapp/dev:deploy` on the existing Vault-backed shared-host
  path unless a separate plan explicitly moves dev as well.
- Refactor `projects/deployments/sample-webapp/shared/family.bzl` so the shared family defaults no
  longer force one Vault runtime onto every stage when staging and production need Infisical
  routing metadata.
- Depend on the containerized control-plane runtime from
  [Deployment Control Plane Containerization Plan](../plans/control-plane-plan.md). This PR is now sequenced
  after that plan so Sample webapp's first Infisical staging and production rollout uses the
  horizontally scalable containerized control plane.
- Add an IaC module for Sample webapp's Infisical deployment-secret backend before changing deployment
  metadata.
  - Assume no suitable Infisical project exists yet.
  - Parameterize the module by Infisical organization/account, site URL, project name/slug,
    environment slugs, secret path, secret names, machine identity names, and control-plane
    credential-file names. The `viberoots` organization and `sample-webapp-deployments` project are
    Sample webapp inputs for this PR, not global Infisical defaults for future deployments.
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
  - `environment = "staging"` for `//projects/deployments/sample-webapp/staging:deploy`
  - `environment = "prod"` for `//projects/deployments/sample-webapp/prod:deploy`
  - `secret_path = "/"`
  - `preferred_credential_source = "infisical_machine_identity_universal_auth"`
  - `machine_identity_client_id_env = "SAMPLE_WEBAPP_STAGING_INFISICAL_CLIENT_ID"` and
    `machine_identity_client_secret_env = "SAMPLE_WEBAPP_STAGING_INFISICAL_CLIENT_SECRET"` for staging
  - `machine_identity_client_id_env = "SAMPLE_WEBAPP_PROD_INFISICAL_CLIENT_ID"` and
    `machine_identity_client_secret_env = "SAMPLE_WEBAPP_PROD_INFISICAL_CLIENT_SECRET"` for production
  - `machine_identity_id` for the stage-specific deployment identity when the IaC provider exposes
    it as non-secret output
- Reuse the portable deployment control-plane credential-directory abstraction from
  [Deployment Control Plane Containerization Plan](../plans/control-plane-plan.md) for Infisical Universal
  Auth. The worker secret-source contract must load credentials from file-backed service credentials
  and expose them only as in-memory runtime bindings for the reviewed env-var names. Do not require
  broad process environment injection for Infisical client secrets. On systemd/NixOS hosts, the
  preferred implementation is `LoadCredential=` with worker reads from `$CREDENTIALS_DIRECTORY`;
  equivalent file-backed service credential mechanisms are acceptable on other hosts.
  - Align this contract with
    [Deployment Control Plane Containerization](../designs/control-plane-containerization.md) so PR-12 does not
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
- Do not add `infisical_secret_mappings` for Sample webapp; store the existing
  `secret://deployments/sample-webapp/cloudflare_api_token` contract as the Infisical shared secret
  named `cloudflare_api_token` at `/` in each environment.
- Keep the current Sample webapp `secret_requirements` contract ids, steps, and required flags unchanged
  so provider code, admission evidence, and existing Vault-admitted replay records remain
  interpretable.
- Do not persist Infisical Universal Auth client ids, client secrets, access tokens, personal
  tokens, or resolved Cloudflare API tokens in `TARGETS`, docs, deployment records, diagnostics, or
  test fixtures.
- Ensure Cloudflare Pages staging and production publish/provision/preview-cleanup flows continue
  to resolve `cloudflare_api_token` through the neutral runtime after the backend switch.
- Preserve replay semantics so older Vault-admitted Sample webapp staging and production runs continue
  to replay against recorded Vault references, while new admissions use Infisical references.
- Use read-only `deploy admin infisical plan`/`check` diagnostics for Sample webapp staging and
  production readiness; do not add an Infisical sync or mutation workflow.

### 3. External setup and rollout work

Most of this work is not a prerequisite for completing the dev changes in this PR. It is operator
work that can happen in parallel with implementation and must be complete before staging or
production can successfully execute live Infisical-backed deploys. Because the selected sequence is
containerization first, this PR also assumes the containerized control plane from
[Deployment Control Plane Containerization Plan](../plans/control-plane-plan.md) has already landed and is
available for Sample webapp rollout. The only external setup needed before PR-12 implementation starts is
confirming that a `viberoots` Infisical organization administrator can bootstrap the IaC runner
identity in the selected `https://app.infisical.com` Infisical organization.

These instructions assume no Sample webapp Infisical project exists yet. Do not manually create durable
objects that the PR's IaC module is supposed to own; use manual work only for bootstrap access, real
secret values, runtime credential installation, verification, and provider gaps explicitly
documented by the implementation PR.

1. Use the settled Infisical tenant details as non-secret IaC inputs.
   - These values are settled only for the Sample webapp staging and production cutover. Future
     deployments may use different Infisical organizations/accounts, API base URLs, projects,
     environments, paths, and identities through the same parameterized IaC/control-plane shape.
   - Infisical organization: `viberoots`.
   - Infisical API base URL: `https://app.infisical.com`.
   - Infisical product: Secrets Management.
   - Infisical project name and slug: `sample-webapp-deployments`.
   - Environment slugs: `staging` and `prod`.
   - Secret path: `/`.
   - Secret name for `secret://deployments/sample-webapp/cloudflare_api_token`:
     `cloudflare_api_token`.
   - Deployment identity model: one stage-specific machine identity for staging and one
     stage-specific machine identity for production.
   - Live deploy executor model: a deployment control plane is the only runtime that executes live
     Sample webapp staging or production deploys. CI submits through the appropriate control plane and
     must not hold Sample webapp Infisical workload credentials. The implementation must allow future
     deployments to use either one control plane per Infisical account or a shared control plane
     that hosts multiple Infisical accounts.
   - Runtime env-var names:
     `SAMPLE_WEBAPP_STAGING_INFISICAL_CLIENT_ID`, `SAMPLE_WEBAPP_STAGING_INFISICAL_CLIENT_SECRET`,
     `SAMPLE_WEBAPP_PROD_INFISICAL_CLIENT_ID`, and `SAMPLE_WEBAPP_PROD_INFISICAL_CLIENT_SECRET`.
   - Default deployment credential-file names:
     `sample-webapp-staging-infisical-client-id`, `sample-webapp-staging-infisical-client-secret`,
     `sample-webapp-prod-infisical-client-id`, and `sample-webapp-prod-infisical-client-secret`.
   - Record only these non-secret choices in the PR; do not record Cloudflare token values or
     Universal Auth client secrets.

2. Prepare the Infisical identity that will run the IaC apply.
   - Treat this as manual bootstrap work unless the organization already has an approved external
     bootstrap mechanism outside this repo. The Sample webapp Infisical project cannot own the identity
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
   - Confirm the plan creates, rather than manually assumes, the Sample webapp Secrets Management
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
   - In Infisical, open the new Sample webapp project and select the `staging` environment.
   - Navigate to the root path `/`.
   - Add or update the shared secret named `cloudflare_api_token`.
   - Paste the current trusted staging Cloudflare API token value from the approved source of truth.
   - Save the secret as a shared environment secret, not a personal override.
   - Repeat the same steps in the `prod` environment using the production Cloudflare API token
     value.
   - Do not import a broad `.env` file unless it contains only the intended Sample webapp deployment
     secret and the import process is approved for production secret material.
   - Do not expose either token in commits, PR descriptions, terminal logs, diagnostics,
     screenshots, tickets, or ordinary IaC state.

5. Install the Sample webapp deployment Universal Auth credentials in every runtime that can execute live
   staging or production deploys.
   - Use the deployment machine identity client IDs and client secrets created or documented by the
     IaC apply, not the separate IaC runner identity from step 2.
   - Install the values only as file-backed service credentials on the deployment control-plane
     host.
   - On systemd/NixOS hosts, use `LoadCredential=` or the repo's NixOS wrapper for systemd
     credentials. Define one credential file per value using the default deployment-derived names:
     `sample-webapp-staging-infisical-client-id`,
     `sample-webapp-staging-infisical-client-secret`, `sample-webapp-prod-infisical-client-id`, and
     `sample-webapp-prod-infisical-client-secret`. Keep the source files outside the repo and outside the
     Nix store, load them only into the control-plane worker, and read them from
     `$CREDENTIALS_DIRECTORY` when preparing the Infisical runtime.
   - Treat those credential-file names as Sample webapp-specific names. Future deployments should default
     to `<deployment-id>-infisical-client-id` and `<deployment-id>-infisical-client-secret`, and may
     use reviewed override names when needed. They must not share Sample webapp's bindings.
   - On non-systemd hosts, use an equivalent file-backed service credential mechanism with the same
     isolation properties.
   - Configure the control plane to map those credential files to the reviewed in-memory runtime
     bindings named below only for the worker operation that needs them.
   - Do not install the values in local developer shells, local direct-deploy profiles, CI secret
     stores, plaintext env files, process arguments, Nix store outputs, or ordinary service logs.
   - CI must submit Sample webapp deployment requests to the control plane instead of resolving
     Infisical secrets directly.
   - Use `SAMPLE_WEBAPP_STAGING_INFISICAL_CLIENT_ID`, `SAMPLE_WEBAPP_STAGING_INFISICAL_CLIENT_SECRET`,
     `SAMPLE_WEBAPP_PROD_INFISICAL_CLIENT_ID`, and `SAMPLE_WEBAPP_PROD_INFISICAL_CLIENT_SECRET`.
   - Keep the staging and production client secrets separate inside the control-plane secret store
     so staging execution cannot read production with the staging credential.
   - Ensure the worker scrubs these bindings from child-process environments that do not need to
     contact Infisical.
   - Read-only metadata validation and cquery extraction must not require these credential values.

6. Verify the Infisical setup without printing secret values.
   - Run `deploy admin infisical plan` for `//projects/deployments/sample-webapp/staging:deploy` and
     confirm it reports the expected site URL, project id, `staging` environment, path, secret name,
     and Universal Auth env-var names.
   - Run `deploy admin infisical plan` for `//projects/deployments/sample-webapp/prod:deploy` and
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
     Sample webapp runs.
   - Do not delete or rotate away the Vault value until the team has an explicit post-cutover
     retention decision.
   - Keep the Infisical IaC state and object ids available so operator-created gaps can be imported
     or reconciled instead of recreated.
   - Document how to restore `secret_backend = "vault/default"` for new admissions if live Infisical access
     is unavailable during rollout.

### 4. Tests to be added

- Add extraction/cquery tests proving Sample webapp staging and production emit:
  - `secret_backend = "infisical/default"`
  - reviewed `infisical_runtime` metadata
  - no `infisical_secret_mappings`
  - unchanged `secret_requirements`
- Add a regression test proving Sample webapp dev still emits the existing Vault backend metadata and is
  not accidentally moved to Infisical by shared-family refactoring.
- Add validation tests proving the Sample webapp staging and production metadata satisfy the Infisical
  Universal Auth env-name requirements and do not contain forbidden credential material.
- Add fake-Infisical Cloudflare Pages tests proving new Sample webapp staging and production admissions
  read Infisical metadata with `viewSecretValue=false` and runtime acquire resolves the admitted
  exact version with `viewSecretValue=true`.
- Add replay/migration coverage proving a previously Vault-admitted Sample webapp staging or production
  run continues to replay using recorded Vault references after current metadata selects
  Infisical.
- Add read-only admin diagnostic coverage proving Sample webapp staging and production `plan` output is
  non-secret and `check` reports project/environment/secret readiness without exposing secret
  values or Universal Auth credentials.
- Add portable credential-directory tests proving Sample webapp Infisical Universal Auth credentials can
  be read from deployment-scoped credential files, mapped to the reviewed runtime env-var names only
  for the operation that needs them, and kept out of broad process environment injection.
- Add docs parity or checked-in metadata guardrail tests proving no Sample webapp deployment metadata,
  docs example, or fixture contains Infisical client secrets, personal tokens, access tokens, or
  Cloudflare API token values.

### 5. Docs to be added or updated

- Update Sample webapp or deployments usage docs with the reviewed operator steps for the staging and
  production Infisical cutover.
- Document the Infisical secret names/paths or the default mapping rule used for the Sample webapp
  `cloudflare_api_token` contract, without including secret values.
- Document the required Universal Auth environment variable names for Sample webapp staging and
  production operators.
- Add rollback/replay notes explaining that old Vault-admitted Sample webapp runs remain replayable and
  new runs admit Infisical references after the metadata change.

### 5.5. Expected regression scope

- `deployment-and-project-impact`
- The implementation should stay in deployment-owned Sample webapp project metadata, deployment tests,
  and docs. Do not change shared Infisical runtime logic unless the Sample webapp cutover exposes a real
  generic bug; if it does, update this plan before expanding scope.

### 6. Acceptance criteria

- `//projects/deployments/sample-webapp/staging:deploy` and
  `//projects/deployments/sample-webapp/prod:deploy` select Infisical as their deployment secret backend.
- Sample webapp dev remains Vault-backed.
- Sample webapp staging and production have reviewed, non-secret Infisical Universal Auth env-name
  metadata and pass deployment metadata validation.
- Sample webapp staging and production `secret_requirements` remain stable, and any mapping overrides
  are explicitly reviewed.
- Fake-Infisical tests prove new Sample webapp staging and production admissions and runtime acquire use
  Infisical without live network access.
- The portable credential-directory abstraction from the containerization plan is reused, and
  Sample webapp Infisical credentials resolve through deployment-scoped credential files without a
  NixOS-only, environment-file-only, or global-tenant credential path.
- Replay tests prove older Vault-admitted Sample webapp runs continue to use recorded Vault references.
- Docs and diagnostics describe the cutover without leaking any secret values or Infisical
  credentials.

### 7. Risks

- Changing shared Sample webapp family defaults could accidentally move dev or future stages to
  Infisical.
- Incorrect Infisical project/environment/path metadata could break staging or production deploys
  at admission or runtime acquire.
- A rushed cutover could make old Vault-admitted replay records ambiguous if contract ids or
  backend references are changed.
- Operator env-var names could accidentally imply secret values are checked into deployment
  metadata.

### 8. Mitigations

- Add explicit cquery tests for all three Sample webapp stages so staging/prod move to Infisical while
  dev stays Vault-backed.
- Keep `secret_requirements` contract ids unchanged and rely on recorded admitted backend refs for
  replay authority.
- Require read-only `deploy admin infisical plan`/`check` evidence before live staging or production
  rollout.
- Store only env-var names in metadata and cover forbidden secret-material patterns with guardrail
  tests.

### 9. Consequences of not implementing this PR

Sample webapp staging and production will continue depending on Vault for Cloudflare deployment secrets,
leaving the Infisical implementation unused for the concrete Sample webapp release lanes that need the
backend migration.

### 10. Downsides for implementing this PR

It introduces stage-specific Sample webapp secret backend metadata and requires coordinated external
Infisical setup before live staging or production deployments can use the new backend.

## PR-16: Infisical site URL contract and end-range traceability repair

### 1. Intent

Reconcile the Sample webapp Infisical site URL contract with the implemented metadata/IaC defaults and
restore plan traceability for the post-PR-12 Infisical follow-up range.

Traceability note: PR-16 through PR-18 are assessment-driven follow-up sections created after the
original PR-12 range completed. Keep these headings and their implementation evidence synchronized
so future plan assessments can map the end-of-range fixes by PR number.

### 2. Scope of changes

- Decide and document the authoritative Sample webapp Infisical site URL for staging and production.
- If the PR-12 contract remains authoritative, change Sample webapp metadata, OpenTofu defaults, tests,
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

- Operators must confirm which Infisical SaaS endpoint the Sample webapp project and machine identities
  actually use before any production rollout relies on the reconciled metadata.

### 4. Tests to be added

- Add metadata extraction and validation tests proving Sample webapp staging and production emit the
  reviewed site URL exactly.
- Add OpenTofu default and rendered-plan tests proving the IaC path uses the same site URL contract
  as deployment metadata.
- Add diagnostic tests proving `deploy admin infisical plan` reports the reviewed site URL without
  leaking credentials.
- Add docs/traceability guardrail coverage or a focused plan-conformance test proving the plan's
  post-PR-12 sections remain discoverable by PR number.

### 5. Docs to be added or updated

- Update Infisical operator docs, Sample webapp cutover docs, and any OpenTofu README or variable docs
  to use the same reviewed site URL.
- Add a short traceability note explaining that PR-16 through PR-18 are follow-up sections created
  from the completed end-of-range assessments and must remain in sync with their implementation
  evidence.

### 5.5. Expected regression scope

- `deployment-and-project-impact`
- Keep changes to Sample webapp deployment metadata, Infisical IaC defaults/tests, deployment docs, and
  plan traceability. Do not alter generic Infisical runtime behavior unless the site URL
  reconciliation exposes a shared normalization bug; if it does, update this plan before expanding
  scope.

### 6. Acceptance criteria

- The plan, design references, Sample webapp metadata, OpenTofu defaults, tests, and diagnostics agree on
  one reviewed Infisical site URL.
- Assessments no longer report PR-12 noncompliance for the Sample webapp site URL.
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

Sample webapp Infisical metadata and IaC will remain noncompliant with the PR-12 contract, and future
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

- Implement `sprinkleref --check` following [`docs/sprinkleref-check.md`](../../sprinkleref-check.md).
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

- Keep [`docs/sprinkleref-check.md`](../../sprinkleref-check.md) synchronized with the implemented command
  flags, report shape, status categories, and exit codes.
- Update [`docs/sprinkleref.md`](../../sprinkleref.md) with the operator-facing `--check` workflow.
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

Separate repo-wide Infisical/SprinkleRef backend bootstrap from Sample webapp-specific Infisical
deployment provisioning so operators can initialize and validate the repository's secret backend
profile registry without implicitly creating or reconciling Sample webapp resources. Preserve support
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
  deployments and the Sample webapp Infisical cutover do not require unnecessary per-deployment config
  churn.
- Move the current Sample webapp-specific OpenTofu module, reviewed metadata reconciliation, project
  creation, environment creation, and deployment Universal Auth credential management behind an
  explicit deployment-specific mode or target selection.
- Require deployment-specific bootstrap to name its scope explicitly with `--target <buck-target>`
  before it can use
  `projects/deployments/sample-webapp/infisical/opentofu` or
  `projects/deployments/sample-webapp/shared/family.bzl`.
- Keep existing Sample webapp bootstrap behavior available through the new explicit deployment-specific
  path, without changing the reviewed Sample webapp metadata contract.
- Update dry-run output so repo-wide bootstrap reports no Sample webapp paths, projects, or OpenTofu
  modules unless a Sample webapp deployment scope was explicitly selected.
- Update `sprinkleref --check` guidance so an absent resolver config points operators at repo-wide
  bootstrap or `sprinkleref --init`, not a Sample webapp provisioning command.

### 3. External prerequisites

- None beyond the existing operator access required for Infisical/Vault bootstrap. This PR adopts
  `repo` and `deployment --target <buck-target>` as the command shape, and `vault-default` /
  `infisical-default` as the initial default profile aliases.

### 4. Tests to be added

- Add repo-wide dry-run tests proving no Sample webapp OpenTofu directory, reviewed metadata path, project
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
- Add deployment-specific selection tests proving the Sample webapp OpenTofu module and reviewed
  metadata reconciliation run only when the Sample webapp deployment scope is explicitly selected.
- Add regression tests proving the existing Sample webapp provisioning path still reconciles against
  checked-in Sample webapp metadata and manages the expected deployment credential refs.
- Add `sprinkleref --check` guidance tests proving missing resolver config diagnostics mention
  repo-wide bootstrap or `sprinkleref --init`, and do not imply that Sample webapp provisioning is
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
- Update `projects/deployments/sample-webapp/infisical/README.md` so Sample webapp instructions call the
  explicit deployment-specific bootstrap path and no longer appear to be the default repo-wide
  bootstrap.
- Update `docs/history/designs/infisical-design.md` and deployment metadata docs if needed to clarify that
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
  Sample webapp Infisical provisioning wiring, docs, and tests. If implementation requires changes to
  generic deployment admission or runtime secret acquisition, update this plan before expanding
  scope.

### 6. Acceptance criteria

- Operators can run a repo-wide Infisical/SprinkleRef bootstrap dry-run without seeing Sample webapp
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
- Sample webapp Infisical provisioning still exists, but requires an explicit deployment-specific
  `--target` selector before it can touch the Sample webapp OpenTofu module or reviewed metadata.
- `sprinkleref --check` absent-config guidance points to repo-wide initialization, and configured
  checks can distinguish present, missing, unmapped, and unchecked refs without requiring Sample webapp
  provisioning.
- Bootstrap dry-run and non-dry-run confirmation semantics remain explicit and mutation-safe.

### 7. Risks

- Splitting command modes could break existing operator muscle memory for the Sample webapp bootstrap
  path.
- Repo-wide bootstrap could become too abstract if it tries to infer deployment provisioning policy
  that belongs in deployment metadata.
- Resolver config creation could still look like a deployment-specific action if docs and command
  names are not precise.
- A profile registry could add unnecessary complexity if the first implementation overfits unlikely
  multi-account or multi-Vault scenarios.

### 8. Mitigations

- Preserve the current Sample webapp behavior behind a compatibility path or a clearly documented
  deployment selector during the migration.
- Keep repo-wide bootstrap narrowly focused on resolver config, named backend profiles, and
  bootstrap credential sink policy.
- Implement one default Infisical profile and one default Vault profile first, but make the data
  model and docs allow additional named profiles without another CLI redesign.
- Add dry-run output assertions and docs examples that make the repo-wide/deployment-specific
  boundary visible.

### 9. Consequences of not implementing this PR

Operators will continue seeing Sample webapp-specific resources in what appears to be a repo-wide
Infisical bootstrap flow, making it unclear whether setting up Infisical for the repo requires
provisioning a specific deployment family. The repo will also lack an explicit place to model
future deployments that need a different Infisical account or Vault instance.

### 10. Downsides for implementing this PR

The bootstrap CLI surface becomes more explicit and may require a short migration for existing
Sample webapp bootstrap instructions and scripts. Introducing backend profile aliases adds a small
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

- Update `docs/history/designs/infisical-design.md` to list the accepted machine identity file-name runtime keys.

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
- Reject bare backend values such as `secret_backend = "vault"` or `"infisical"`;
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

- Update `docs/history/designs/infisical-design.md` to make the unified `secret_backend =
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

## PR-28: Repo bootstrap backend profile materialization

### 1. Intent

Make repo-wide bootstrap responsible for making shared resolver profiles and bootstrap credential
sinks operational. If deployments select `secret_backend = "infisical/default"` or
`secret_backend = "vault/default"`, repo bootstrap should not leave the corresponding profile as a
placeholder or require each deployment bootstrap to solve account login, Vault address/mount
selection, organization selection, default project wiring, or local bootstrap sink setup
independently.

### 2. Scope of changes

- Extend `infisical-bootstrap repo` so confirmed non-dry-run execution performs the backend-specific
  profile materialization or validation required by every repo-wide resolver profile.
- For Infisical-backed profiles, run the Infisical login or token-based authentication flow when an
  Infisical-backed repo profile is required.
- Resolve the Infisical organization through the existing explicit selector, interactive selector,
  or `--yes` single-organization path. Preserve the existing `--no-login` requirement that
  token-based flows provide an explicit `--organization-id` or `--org-name`.
- Create, select, or validate the repo-level Infisical project/account backing shared resolver
  profiles such as `infisical-default`.
- For Vault-backed profiles, validate or materialize the repo-level Vault profile metadata needed by
  deployments, such as address, namespace, mount/path defaults, auth env names, and any required
  local profile naming convention.
- Materialize non-secret resolver metadata for shared backend profiles:
  - `host`;
  - Vault address or namespace when applicable;
  - `projectId`;
  - Vault mount/path defaults when applicable;
  - default environment;
  - default path when needed;
  - backend credential environment variable names.
- Materialize or validate the configured bootstrap credential sink, including local-file paths and
  macOS Keychain services, so root/bootstrap access credentials are stored only through the
  configured non-Infisical bootstrap credential sink category.
- Remove deployment-specific placeholders from generated repo-wide starter configs. Generated
  `sprinkleref/base.json` and sibling templates must not mention Sample webapp names, Sample webapp project
  ids, Sample webapp secret paths, or any other deployment-specific value.
- Keep deployment bootstrap focused on deployment-specific backend resources and application secret
  lifecycle. It should consume repo-level resolver profiles instead of asking every deployment to
  independently establish the shared account/project/Vault/profile/bootstrap-sink boundary.
- Preserve dry-run behavior as read-only. Dry-run should report whether repo bootstrap would need
  backend login, project/mount/profile materialization, or bootstrap sink setup, but it must not
  write resolver config, credential sinks, or backend resources.

### 3. External prerequisites

- Live backend access is required only for non-dry-run repo bootstrap paths that create or validate
  real backend account/project/mount/profile state.
- Tests must continue to use fake Infisical API/CLI fixtures, fake Vault fixtures, and fake local
  credential sinks rather than depending on live backend accounts.

### 4. Tests to be added

- Add fake Infisical login/API tests proving repo bootstrap:
  - prompts or uses `--yes`/`--no-login` consistently with existing authentication rules;
  - selects the intended organization;
  - creates or selects the repo-level project for `infisical-default`;
  - writes the real non-secret `projectId` into resolver config;
  - stores bootstrap credentials only in a non-Infisical bootstrap sink.
- Add Vault profile tests proving repo bootstrap validates or materializes `vault-default` with
  real non-secret resolver metadata and rejects placeholder Vault profile values with remediation.
- Add local credential sink tests proving repo bootstrap validates or materializes the selected
  bootstrap sink, including macOS Keychain service names and restrictive local-file paths, without
  routing bootstrap credentials through Infisical.
- Add starter-template regression tests proving generated resolver configs contain no
  deployment-specific names, Sample webapp placeholders, Sample webapp project ids, or example refs.
- Add dry-run tests proving repo bootstrap reports planned backend profile and bootstrap sink
  materialization without calling login, writing resolver files, writing credential sinks, or
  mutating backends.
- Add validation tests proving existing configured resolver profiles are treated as authoritative
  and are validated rather than overwritten.
- Keep focused tests for `infisical-bootstrap repo`, `sprinkleref --init`, and resolver config
  parsing under the strict file-size gate.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md` with the repo-bootstrap profile and credential-sink ownership
  boundary.
- Update `infisical-bootstrap.md` to explain that repo bootstrap owns shared backend account,
  organization/project or Vault profile, resolver-profile setup, and bootstrap sink validation,
  while deployment bootstrap owns deployment-specific resources.
- Update `docs/sprinkleref.md` and generated config examples to avoid project-specific starter
  values and explain how repo bootstrap fills or validates backend profile metadata.

### 5.5. Expected regression scope

- `deployment-only`
- Changes should be limited to repo bootstrap, backend profile materialization/validation,
  SprinkleRef starter templates, resolver config validation/materialization, focused tests, and
  docs. Do not change deployment runtime secret acquisition or provider publish/provision behavior.

### 6. Acceptance criteria

- Running confirmed `infisical-bootstrap repo` for a repo that requires `infisical-default` or
  `vault-default` performs the necessary backend login/org/project/profile or Vault profile setup,
  or fails with clear remediation.
- Generated repo-wide starter configs are generic and contain no deployment-specific placeholders
  such as Sample webapp project ids.
- Resolver config written by repo bootstrap contains real non-secret profile metadata for required
  backend profiles, not fake project ids, fake Vault addresses, or hidden sink assumptions.
- Repo bootstrap validates or materializes the selected bootstrap credential sink before reporting
  success.
- Deployment bootstrap can assume shared resolver profiles are already real and focuses on
  deployment-specific reconciliation.
- Dry-run remains read-only and accurately reports planned repo-profile and bootstrap sink
  materialization.
- Focused tests and the repository validation suite pass.

### 7. Risks

- Repo bootstrap becomes a live backend operation instead of only local resolver scaffolding when
  live backend profiles are required.
- Operators may need to choose between creating new repo-level backend resources and binding
  existing ones.
- Existing local generated starter configs may contain old placeholders and need remediation.

### 8. Mitigations

- Keep dry-run read-only and explicit about the live operations a confirmed run would perform.
- Require explicit prompts or `--yes` before live repo bootstrap mutations.
- Prefer preserving existing resolver configs when present; validate and report remediation instead
  of overwriting operator-owned config.
- Emit clear migration guidance for old generated placeholders.

### 9. Consequences of not implementing this PR

Repo-wide profiles such as `infisical-default` and `vault-default`, plus bootstrap sinks such as
macOS Keychain or local-file, remain partially fictional after repo bootstrap. That pushes backend
account/profile/sink setup confusion into each deployment and can generate project-specific
placeholders in supposedly repo-wide config.

### 10. Downsides for implementing this PR

Repo bootstrap becomes more capable and therefore more sensitive: a confirmed non-dry-run invocation
may need live backend access and local credential-sink validation, so it must have strong prompts,
dry-run output, and fake-server/fake-sink test coverage.

## PR-29: Assessment cleanup for bootstrap profile boundaries

### 1. Intent

Close the post-PR-28 assessment gaps so the shipped Infisical resolver and bootstrap surfaces match
the reviewed first-release model. Infisical resolver profiles should expose only Universal Auth
workload credentials, repo bootstrap retry/default guidance should not leak Sample webapp deployment
paths, and bootstrap docs should consistently distinguish interactive confirmation from
non-interactive `--yes` automation.

### 2. Scope of changes

- Remove public SprinkleRef Infisical `tokenEnv` profile support. Infisical resolver profiles must
  require Universal Auth `clientIdEnv` and `clientSecretEnv`, plus project and environment
  metadata.
- Remove any Infisical resolver runtime path that turns a raw token environment variable into an
  access-token credential for normal SprinkleRef profile resolution.
- Keep Vault `tokenEnv` support unchanged. This PR only removes raw-token support from Infisical
  resolver profiles.
- Split repo-mode bootstrap defaults and retry guidance from deployment-mode OpenTofu defaults.
  Repo-mode retry output must not include `--tofu-dir`, Sample webapp paths, or other deployment-only
  flags unless a deployment scope is explicitly selected.
- Ensure repo bootstrap config defaults and dry-run output remain repo-wide and generic; Sample webapp
  OpenTofu defaults may exist only on the explicit deployment bootstrap path.
- Update bootstrap documentation so mutation-capable local operator flows may either pass `--yes`
  for non-interactive confirmation or answer the interactive `Y/n` prompt, while CI and
  non-interactive flows still require `--yes`.
- Preserve the existing dry-run guarantee: no Infisical login, backend mutation, resolver write, or
  credential-sink write during dry-run.

### 3. External prerequisites

- None for tests. Runtime behavior should continue to use fake Infisical, fake Vault, and fake sink
  fixtures in focused tests.
- Operators with old Infisical resolver configs that use `tokenEnv` must migrate those profiles to
  Universal Auth env names before running normal SprinkleRef resolution.

### 4. Tests to be added

- Add SprinkleRef config validation tests proving Infisical profiles reject `tokenEnv` and require
  both `clientIdEnv` and `clientSecretEnv`.
- Add Infisical resolver/runtime tests proving no normal SprinkleRef profile path accepts raw access
  token credentials, while Universal Auth credential acquisition still works.
- Add bootstrap preflight/retry tests proving repo-mode retry guidance omits `--tofu-dir` and
  Sample webapp deployment paths, while deployment-mode retry guidance keeps explicit deployment
  OpenTofu flags.
- Add docs or starter regression coverage proving repo-mode dry-run and operator examples do not
  mention Sample webapp unless the explicit deployment mode is selected.
- Keep existing interactive confirmation tests for `Y/n` local operator flows and add docs
  consistency coverage if a suitable docs regression test exists.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md` to state that Infisical SprinkleRef profiles use Universal Auth
  env names only and do not accept raw token profile credentials.
- Update `infisical-bootstrap.md` and `docs/infisical-bootstrap.md` so `--yes` means
  non-interactive pre-confirmation, while interactive local operators may confirm at the prompt.
- Update `docs/sprinkleref.md` examples so Infisical profiles show only Universal Auth credential
  fields.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to SprinkleRef config validation/runtime, Infisical resolver credential
  acquisition, bootstrap default/retry reporting, focused tests, and docs. Do not change deployment
  metadata parsing, provider publish/provision behavior, Vault resolver semantics, or Infisical
  deployment resource reconciliation.

### 6. Acceptance criteria

- Infisical SprinkleRef profiles cannot be configured with raw token credentials.
- Universal Auth remains the only operator-visible Infisical workload credential source for normal
  resolver profiles.
- Repo-mode bootstrap retry guidance and dry-run/operator output contain no Sample webapp OpenTofu path
  or deployment-only flag leakage.
- Deployment-mode bootstrap still carries the deployment OpenTofu defaults and flags it needs.
- Bootstrap docs consistently describe `--yes` as non-interactive pre-confirmation and preserve
  interactive `Y/n` confirmation for local operators.
- Focused tests and the repository validation suite pass.

### 7. Risks

- Existing local resolver configs using Infisical `tokenEnv` will fail validation and require
  migration.
- Shared bootstrap argument defaults may currently be used by tests that assume deployment defaults
  are always present.

### 8. Mitigations

- Emit a validation error that names Universal Auth `clientIdEnv` and `clientSecretEnv` as the
  remediation for old Infisical `tokenEnv` profiles.
- Keep deployment-mode defaults explicit and covered by tests so removing repo-mode leakage does
  not break deployment bootstrap behavior.
- Document the interactive versus `--yes` confirmation split in both bootstrap docs.

### 9. Consequences of not implementing this PR

The repo would continue to expose an unreviewed raw-token Infisical resolver path, repo bootstrap
guidance would still imply Sample webapp/OpenTofu during repo-wide setup, and docs would contradict the
implemented interactive confirmation behavior.

### 10. Downsides for implementing this PR

This is a breaking cleanup for any local Infisical resolver profile that still uses `tokenEnv`, but
the stricter surface matches the first-release security model and avoids carrying unsupported
credential modes.

## PR-30: Infisical metadata and bootstrap docs final alignment

### 1. Intent

Close the final plan-assessment gaps by making the public Infisical deployment metadata contract
and bootstrap resolver examples match the reviewed first-release surface. Deployment authors should
only be able to select the backend-qualified Infisical credential source, and every documented
Infisical SprinkleRef resolver example should be valid under Universal Auth-only profile
validation.

### 2. Scope of changes

- Reject public `infisical_runtime.preferred_credential_source =
"machine_identity_universal_auth"` on Infisical-backed deployments.
- Continue normalizing the reviewed public value
  `infisical_machine_identity_universal_auth` to the existing internal
  `machine_identity_universal_auth` runtime enum.
- Preserve any internal runtime code that expects `machine_identity_universal_auth`; this PR only
  tightens the operator-visible metadata contract.
- Update tests and checked-in deployment fixtures/docs that currently use the unqualified public
  value.
- Update root bootstrap resolver examples so every Infisical resolver profile includes
  `clientIdEnv` and `clientSecretEnv`.
- Extend docs guard coverage so stale Infisical resolver examples in `infisical-bootstrap.md` and
  `docs/history/designs/infisical-design.md` fail when they omit required Universal Auth fields.

### 3. External prerequisites

- None. This is a metadata validation/docs/test cleanup and should not require live Infisical,
  Vault, OpenTofu, or resolver backend access.

### 4. Tests to be added

- Add deployment metadata validation tests proving the backend-qualified
  `infisical_machine_identity_universal_auth` source is accepted and the unqualified
  `machine_identity_universal_auth` source is rejected with clear remediation.
- Update cquery or checked-in metadata tests to use the backend-qualified public source.
- Add or extend docs guard tests proving documented Infisical resolver examples include Universal
  Auth `clientIdEnv` and `clientSecretEnv` fields and do not show raw-token or incomplete
  Infisical profiles.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md`, `docs/deployments-schema.md`, `docs/secrets-usage.md`, and any
  other metadata authoring docs that still show the unqualified credential source.
- Update `infisical-bootstrap.md` resolver examples so they validate against the PR-29
  Universal Auth-only profile contract.
- Update this plan only if implementation discovers another public metadata spelling that must be
  resolved at the same boundary.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to deployment secret metadata parsing/validation, deployment metadata tests,
  docs guard tests, and docs. Do not change deployment runtime secret acquisition, provider
  publish/provision behavior, resolver backend semantics, repo bootstrap materialization, or
  Infisical/Vault API behavior.

### 6. Acceptance criteria

- Public deployment metadata accepts only
  `infisical_runtime.preferred_credential_source =
"infisical_machine_identity_universal_auth"` for Infisical-backed deployments.
- The unqualified `machine_identity_universal_auth` value fails validation before runtime with
  remediation naming the backend-qualified value.
- Internal runtime behavior still receives the existing `machine_identity_universal_auth` enum after
  public metadata normalization.
- Root bootstrap and design docs contain no invalid Infisical resolver profile examples missing
  `clientIdEnv` or `clientSecretEnv`.
- Focused tests and the repository validation suite pass.

### 7. Risks

- Any local fixture or operator metadata still using the unqualified source will fail validation.
- Docs guard parsing can become brittle if it tries to be a general Markdown JSON parser.

### 8. Mitigations

- Keep the validation error explicit and name the exact backend-qualified replacement.
- Keep docs guard checks focused on the known Infisical resolver examples and required field names.
- Preserve the internal normalized enum so runtime code does not need a broad refactor.

### 9. Consequences of not implementing this PR

The repo would continue to accept a credential-source spelling that the plan intended to reserve
away from the public Infisical metadata contract, and bootstrap docs would keep showing resolver
examples that fail the current Universal Auth-only validation.

### 10. Downsides for implementing this PR

This removes a lenient public metadata spelling, so any uncommitted local deployment metadata using
it must be updated to the backend-qualified value.

## PR-31: Deployment family directory inference

### 1. Intent

Make deployment family metadata harder to mismatch by deriving `deployment_family` from canonical
family-oriented deployment paths when the field is not explicitly supplied. Explicit
`deployment_family` values should remain supported as true overrides for non-canonical layouts,
shared infrastructure directories, and future migrations.

### 2. Scope of changes

- Add deployment-family inference for targets under canonical family directories such as
  `projects/deployments/<family>/...`.
- Preserve explicit `deployment_family` as the highest-precedence value. If an explicit family is
  present, use it even when it differs from the inferred directory name.
- Keep flat legacy deployment packages such as `projects/deployments/sample-webapp/prod` working with no
  inferred family unless they explicitly pass `deployment_family`.
- Keep `environment_stage` explicit. Do not infer stages from target names or directories in this
  PR.
- Keep stable deployment IDs separate from family inference. This PR must not rename deployment
  IDs, generated records, prerequisite IDs, or published target labels.
- Update SprinkleRef check/report enrichment to consume the effective family value, whether it came
  from explicit metadata or directory inference.
- Document the precedence rule: explicit `deployment_family` wins, otherwise canonical family path
  inference applies, otherwise the family remains unset.

### 3. External prerequisites

- None. This is a metadata inference, reporting, and documentation change and should not require
  live Infisical, Vault, OpenTofu, or provider access.

### 4. Tests to be added

- Add metadata/cquery tests proving a target under `projects/deployments/<family>/...` receives the
  inferred family when `deployment_family` is omitted.
- Add tests proving an explicit `deployment_family` overrides the inferred directory family without
  error.
- Add tests proving flat legacy packages do not accidentally infer a family from names such as
  `sample-webapp-prod`.
- Add SprinkleRef report tests proving missing values show the effective family for both explicit
  and inferred family metadata.
- Add docs or schema guard coverage for the explicit-overrides-inferred precedence rule if a
  suitable deployment metadata docs test exists.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md` and any deployment metadata authoring docs that describe
  `deployment_family` so they document family directory inference and explicit override
  precedence.
- Update this plan's Infisical/SprinkleRef sections only if implementation finds additional
  family-path constraints needed to keep repo scans deterministic.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to deployment metadata inference/export, focused metadata tests,
  SprinkleRef family-aware reporting, and docs. Do not change provider provisioning, deployment
  IDs, prerequisite semantics, Infisical/Vault resolver behavior, or bootstrap credential
  materialization.

### 6. Acceptance criteria

- Targets under canonical family directories receive an effective deployment family without
  requiring duplicate explicit metadata.
- Explicit `deployment_family` remains a valid override and does not fail merely because it differs
  from the directory name.
- Flat legacy deployment packages keep their current behavior unless they explicitly set
  `deployment_family`.
- `environment_stage` remains explicit and unaffected by family inference.
- SprinkleRef missing-value output shows the effective family when known.
- Focused tests and the repository validation suite pass.

### 7. Risks

- Path inference can accidentally classify helper packages as deployment families if the canonical
  directory rule is too broad.
- Future directory moves could change inferred family values if deployment authors rely on implicit
  family inference without noticing.
- Existing tests may assume family metadata is always explicit.

### 8. Mitigations

- Limit inference to actual deployment targets under `projects/deployments/<family>/...`, not helper
  files or arbitrary nested source paths.
- Keep explicit `deployment_family` as the escape hatch and document it as the way to represent
  non-canonical layouts.
- Add negative tests for flat legacy packages and explicit override cases.

### 9. Consequences of not implementing this PR

Family membership remains duplicated metadata for canonical family layouts, so future deployment
families can drift between target path and `deployment_family` value. SprinkleRef and bootstrap
reporting will keep depending on manual family metadata even when the directory structure already
expresses the family.

### 10. Downsides for implementing this PR

Deployment metadata extraction becomes slightly more path-aware, and authors must understand that
moving a target under a canonical family directory can affect its effective family unless they set
an explicit override.

## PR-32: Repo bootstrap deployment fan-out and command entrypoint closure

### 1. Intent

Close the remaining operator-DX gap after the repo/deployment bootstrap split. A confirmed
`infisical-bootstrap repo` run should make the repo-wide resolver and backend profile boundary
operational, then offer to run the deployment-specific bootstrap scopes that are required to clear
managed deployment outputs. Operators who only want repo-wide setup should opt out explicitly with
`--without-deployments`. The public command examples must also be executable as written, and
SprinkleRef remediation output should keep pointing at the interactive repo bootstrap path instead
of implying that `--yes` is required.

### 2. Scope of changes

- Add a `--without-deployments` flag to repo bootstrap mode.
- After confirmed non-dry-run `infisical-bootstrap repo` completes repo-level resolver/profile and
  bootstrap credential-sink materialization, discover the deployment bootstrap scopes that should be
  offered for this repo and run them unless `--without-deployments` is present.
- Gate deployment fan-out with an explicit interactive `Y/n` prompt after the repo-level phase.
  When `--yes` is present, treat the deployment fan-out prompt as pre-confirmed.
- Keep `repo --dry-run` read-only. It should report the deployment bootstrap targets it would offer
  and note that `--without-deployments` suppresses the deployment fan-out, but it must not open
  Infisical, run OpenTofu, write resolver files, write credential sinks, or mutate deployments.
- Derive deployment bootstrap targets from reviewed deployment metadata or the exported deployment
  graph rather than hardcoding operator command text. It is acceptable for this PR to run only the
  currently supported Sample webapp deployment bootstrap targets, but unsupported targets must be
  reported clearly rather than silently ignored.
- Ensure failures from a deployment bootstrap run are reported with the target that failed and do
  not claim the repo bootstrap fully cleared managed deployment outputs.
- Preserve the explicit `deployment --target <buck-target>` path for operators who want to run or
  retry a single deployment scope directly.
- Fix the public command entrypoint mismatch. Either make
  `build-tools/tools/deployments/infisical-bootstrap.ts` executable in git or update every
  operator-facing example and retry/remediation message to invoke the reviewed executable command
  form, such as `zx-wrapper build-tools/tools/deployments/infisical-bootstrap.ts ...`, so copied
  commands do not fail with `zsh: permission denied`.
- Keep SprinkleRef missing-config and unchecked-secret guidance aligned with the interactive repo
  bootstrap flow: recommend `infisical-bootstrap repo` after `repo --dry-run`, mention `--yes` only
  as the optional non-interactive prompt skip, and keep `sprinkleref --init sprinkleref` as the
  resolver-only alternative.
- Preserve the multiline missing-value report shape:
  - each missing `secret://...` ref appears once per grouped backend context;
  - `required by:` is a multiline indented list;
  - example/documentation refs and test-configured refs remain excluded from repo checks.

### 3. External prerequisites

- Live Infisical/OpenTofu/provider access is required only for the confirmed deployment fan-out or
  explicit `deployment --target` paths.
- Tests must use fake Infisical CLI/API, fake OpenTofu/provider runners, and temp resolver configs;
  they must not depend on live Infisical, Vault, macOS Keychain, or provider accounts.

### 4. Tests to be added

- Add repo-bootstrap flow tests proving confirmed `repo` runs repo-level setup and then prompts to
  fan out to discovered deployment bootstrap targets.
- Add tests proving `repo --without-deployments` performs only repo-level setup and does not call
  deployment bootstrap, OpenTofu, deployment credential creation, or reviewed deployment
  reconciliation.
- Add tests proving `repo --yes` pre-confirms both repo-level mutation and deployment fan-out, while
  interactive `Y/n` can decline deployment fan-out after repo-level setup succeeds.
- Add dry-run tests proving `repo --dry-run` reports the deployment targets it would offer and
  remains read-only.
- Add target-discovery tests proving the deployment fan-out target list comes from reviewed
  metadata or graph data and reports unsupported deployment targets clearly.
- Add error-path tests proving a failed deployment bootstrap names the failing target and leaves
  follow-up `sprinkleref --check` guidance honest about remaining managed outputs.
- Add command-entrypoint tests or docs guard tests proving operator-facing bootstrap commands are
  executable as written and do not reference a non-executable path without `zx-wrapper`.
- Add SprinkleRef guidance/report regression tests covering missing resolver config text,
  unchecked-secret hints, and multiline `required by:` output.

### 5. Docs to be added or updated

- Update `infisical-bootstrap.md`, `docs/infisical-bootstrap.md`, `docs/sprinkleref.md`, and
  `docs/sprinkleref-check.md` to document the default repo bootstrap flow:
  repo setup first, optional deployment fan-out second, and `--without-deployments` as the opt-out.
- Update operator examples to use the executable command form chosen in this PR.
- Update the docs to explain when to use `repo --without-deployments`, when to retry
  `deployment --target <buck-target>`, and why managed bootstrap outputs may still appear until the
  deployment fan-out or explicit deployment bootstrap succeeds.
- Update this plan only if implementation discovers another public command surface that still
  contradicts the reviewed bootstrap flow.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to Infisical bootstrap CLI parsing/control flow, deployment bootstrap target
  discovery, operator prompts, user-facing guidance/report strings, focused tests, docs, and file
  mode or wrapper-command alignment. Do not change runtime secret acquisition, provider publish
  semantics, resolver backend semantics, deployment metadata contracts, or Infisical/Vault API
  behavior beyond invoking the already-reviewed deployment bootstrap path.

### 6. Acceptance criteria

- Running confirmed `infisical-bootstrap repo` performs repo-level bootstrap and then offers to run
  discovered deployment bootstrap targets by default.
- `infisical-bootstrap repo --without-deployments` suppresses deployment fan-out and leaves the
  explicit `deployment --target` retry path available.
- `repo --dry-run` remains read-only and shows both repo-level planned work and the deployment
  targets that a confirmed run would offer.
- `--yes` is consistently treated as non-interactive pre-confirmation, not as the only way to run a
  mutation-capable command.
- Managed deployment bootstrap outputs are no longer surprising after a default confirmed repo
  bootstrap: either the deployment fan-out created them or the output clearly states which
  deployment target still needs explicit bootstrap.
- Operator-facing command examples and remediation messages are executable as written and do not
  produce `permission denied` for the canonical bootstrap command.
- SprinkleRef missing-config and unchecked-secret guidance points to the interactive repo bootstrap
  flow and keeps `sprinkleref --init sprinkleref` as the resolver-only path.
- Missing-value output keeps one line per missing ref with multiline `required by:` details.
- Focused tests and the repository validation suite pass.

### 7. Risks

- Default deployment fan-out makes `repo` bootstrap broader and more mutation-capable than the
  earlier strict repo/deployment split.
- Automatically discovered target ordering could become nondeterministic if it is not sorted.
- A partially successful fan-out can confuse operators if the summary does not distinguish
  repo-level success from deployment-level failure.
- Making a TypeScript file executable may conflict with existing repo conventions if wrappers are
  preferred.

### 8. Mitigations

- Keep a visible second prompt for deployment fan-out in interactive mode and document
  `--without-deployments` prominently.
- Sort discovered deployment targets and report unsupported targets explicitly.
- Print a final summary with separate repo-level and per-deployment outcomes.
- Prefer one canonical command surface and enforce it with docs/usage tests so examples do not
  drift between raw `.ts` paths and wrapper invocations.

### 9. Consequences of not implementing this PR

Operators will continue expecting `repo` bootstrap to clear managed deployment outputs, then see
those outputs remain because only explicit deployment bootstrap creates them. The documented command
surface will also remain inconsistent with executable permissions, producing avoidable
`permission denied` failures for copied examples.

### 10. Downsides for implementing this PR

The repo bootstrap path becomes a two-stage operation with more prompts and more live side effects
by default. Operators who only want resolver/profile setup must learn the new
`--without-deployments` opt-out.

## PR-33: Canonical deployment family directory migration

### 1. Intent

Move the real deployment packages out of the current flat legacy layout and into canonical
family-oriented directories so the repository structure matches the family inference model added in
PR-31. The goal is to make family membership visible in paths, reduce duplicated
`deployment_family` metadata for canonical packages, and keep Infisical bootstrap fan-out operating
against the new labels instead of relying on the old `projects/deployments/<family>-<stage>`
package names.

### 2. Scope of changes

- Migrate Sample webapp deployment packages from flat legacy paths such as
  `projects/deployments/sample-webapp-staging`, `projects/deployments/sample-webapp-prod`,
  `projects/deployments/sample-webapp-dev`, `projects/deployments/sample-webapp-shared`, and
  `projects/deployments/sample-webapp-infisical` into canonical family paths under
  `projects/deployments/sample-webapp/...`.
- Preserve stable deployment IDs, environment stages, prerequisite IDs, published records, secret
  contract IDs, and provider-facing resource names. This PR may change Buck labels and source paths,
  but it must not rename live deployment identities unless a specific existing identity is already
  label-derived and the migration documents that exception.
- Remove explicit `deployment_family = "sample-webapp"` from canonical Sample webapp deployment targets when
  directory inference supplies the same effective value. Keep explicit overrides only where the
  package is intentionally non-canonical or where shared/provider helper code needs one during the
  migration.
- Update every repo-owned reference to the moved Buck labels and paths, including deployment
  provider tests, SprinkleRef source reporting, Infisical bootstrap target discovery, reviewed
  metadata paths, docs, examples, and remediation text.
- Keep compatibility aliases out of the public deployment surface unless they are needed as a
  temporary internal migration helper for tests. The canonical labels should be the labels that
  operator-facing docs, bootstrap output, and SprinkleRef reports show.
- Evaluate other deployment families such as `platform-*` and `sample-webapp-*` during implementation.
  If they can be migrated with the same mechanical pattern and low risk, include them; otherwise
  document why this PR intentionally limits the first migration to Sample webapp and leaves follow-up
  family migrations explicit.

### 3. External prerequisites

- None for the code migration itself. This should be a source-tree, Buck label, metadata, docs, and
  test update.
- Live provider, Infisical, Vault, OpenTofu, and macOS Keychain access must not be required for the
  tests in this PR.

### 4. Tests to be added

- Add cquery tests proving the moved canonical Sample webapp targets infer `deployment_family =
"sample-webapp"` without explicit metadata and retain their expected `environment_stage` values.
- Add regression tests proving moved targets preserve stable deployment IDs, prerequisite IDs,
  secret requirement IDs, secret paths, and provider-facing identifiers.
- Add tests proving Infisical repo bootstrap fan-out discovers and reports the new canonical
  Sample webapp labels, and does not keep hardcoded references to the old flat labels.
- Add SprinkleRef tests proving missing-value output, `required by:` source details, managed
  bootstrap output grouping, and target filtering use the new canonical labels and inferred family.
- Add docs/guard tests or stale-name checks that fail if operator-facing docs still reference the
  old flat Sample webapp deployment package paths except in an intentional migration note.
- Update existing deployment provider, front-door, promotion, admission, and reviewed-source tests
  whose fixtures or assertions reference the old labels so they validate the canonical labels
  instead of preserving stale paths.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md` to state that the real Sample webapp deployments now use canonical
  family directories and that flat packages are only legacy support for not-yet-migrated families.
- Update `docs/infisical-bootstrap.md`, `infisical-bootstrap.md`, `docs/sprinkleref.md`, and
  `docs/sprinkleref-check.md` so command examples, retry guidance, and report examples use the new
  canonical labels.
- Update any Sample webapp deployment README or bootstrap handoff docs that mention
  `projects/deployments/sample-webapp-*` paths.
- Add a short migration note documenting old-to-new path and label mapping for operators and future
  code reviewers.

### 5.5. Expected regression scope

- `deployment-only`
- Expect broad deployment test churn because Buck labels and repo paths are visible in fixtures,
  docs, cquery assertions, SprinkleRef source reports, and bootstrap target discovery. Keep the
  change mechanical and avoid modifying provider behavior, runtime secret acquisition, resolver
  semantics, deployment admission policy, or live resource names.

### 6. Acceptance criteria

- Sample webapp deployment targets live under canonical `projects/deployments/sample-webapp/...` family
  directories, and operator-facing labels use those canonical paths.
- Canonical Sample webapp targets infer `deployment_family = "sample-webapp"` without duplicate explicit
  family metadata, while `environment_stage` remains explicit.
- Stable deployment IDs, prerequisite IDs, secret contract IDs, managed bootstrap output paths, and
  provider-facing names remain unchanged unless an exception is explicitly justified in the PR.
- Infisical repo bootstrap fan-out and explicit `deployment --target` retry guidance use the new
  canonical Sample webapp labels.
- SprinkleRef missing-value and managed-output reports show the inferred family and canonical
  `required by:` labels.
- Repo docs no longer present the old flat Sample webapp labels as the current command surface.
- Focused tests and the repository validation suite pass.

### 7. Risks

- Buck label moves can invalidate many tests, docs, and operator muscle memory at once.
- Existing deployment IDs or provider resource names may accidentally be derived from labels or
  paths in some older helper, causing unintended live identity churn.
- Migration aliases could accidentally keep stale labels alive and hide incomplete updates.
- Moving shared family code can break load paths for all stages if not updated atomically.

### 8. Mitigations

- Start by mapping every old Sample webapp path and label to its canonical replacement, then update
  references mechanically with focused review of any non-mechanical exceptions.
- Add explicit stable-identity tests before or alongside the move so label churn cannot silently
  change deployment identities or secret contract paths.
- Prefer direct canonical label updates over compatibility aliases. If a temporary alias is needed,
  keep it internal, tested, documented with a removal condition, and absent from operator-facing
  output.
- Keep implementation limited to one family if broader `platform-*` or `sample-webapp-*` migration
  exposes unrelated provider-specific risk.

### 9. Consequences of not implementing this PR

The repository will continue to support family directory inference only in tests and future
packages, while real deployments remain in the flat legacy layout. Operators will keep seeing
labels such as `//projects/deployments/sample-webapp/staging:deploy`, and family membership will remain
partly duplicated in shared metadata instead of being expressed by the source tree.

### 10. Downsides for implementing this PR

This is mostly mechanical but high-churn. It will touch many tests and docs, and any external
operator notes, local scripts, or saved commands that use the old flat labels will need to be
updated to the canonical labels.

## PR-34: Repo bootstrap credential namespace decoupling

### 1. Intent

Remove the remaining Sample webapp-specific credential namespace from repo-wide Infisical profile
materialization. Repo bootstrap should be able to create and validate generic repo backend profiles
without storing normal profile auth refs under `secret://deployments/sample-webapp/...`, while
deployment bootstrap remains responsible for Sample webapp managed workload credentials.

### 2. Scope of changes

- Replace the current hardcoded Sample webapp bootstrap credential refs used for repo-wide
  `infisical-default` profile materialization with a repo-scoped credential namespace such as
  `secret://viberoots/bootstrap/infisical-default/client-id` and
  `secret://viberoots/bootstrap/infisical-default/client-secret`, or another explicit repo-wide
  namespace chosen during implementation.
- Keep deployment managed outputs, including
  `secret://deployments/sample-webapp/<stage>/infisical-client-id` and
  `secret://deployments/sample-webapp/<stage>/infisical-client-secret`, owned by deployment bootstrap
  and grouped as managed deployment outputs in SprinkleRef.
- Ensure repo-mode bootstrap profile materialization, dry-run JSON, generated resolver config, and
  operator-facing summaries contain no Sample webapp family names, Sample webapp project paths, Sample webapp
  secret paths, or deployment-only OpenTofu values unless an explicit deployment target is selected.
- Preserve support for multiple Infisical accounts/projects or Vault instances through separate
  repo profile aliases without requiring those profiles to reuse a deployment family namespace.
- Update any helper names or docs that currently imply the repo credential refs are deployment
  bootstrap credentials when they are actually repo bootstrap profile credentials.

### 3. External prerequisites

- None for tests. The implementation must not require live Infisical, Vault, Keychain, OpenTofu, or
  macOS access for validation.
- Operators may need to rerun repo bootstrap after the change to materialize the new repo-scoped
  credential refs in local resolver state.

### 4. Tests to be added

- Add repo-bootstrap profile materialization tests proving `infisical-default` uses repo-scoped
  credential refs and does not contain `secret://deployments/sample-webapp/...`.
- Add regression tests proving deployment bootstrap still reports Sample webapp managed workload outputs
  under the deployment namespace and does not confuse them with repo profile credentials.
- Add dry-run and generated-config tests proving repo mode contains no Sample webapp-specific values
  unless deployment fan-out or an explicit deployment target is selected.
- Add negative stale-string or guard coverage for the generic profile helper so future repo-wide
  profiles cannot accidentally reintroduce a deployment-family credential namespace.
- Update any existing SprinkleRef or bootstrap tests whose expected resolver output currently
  assumes Sample webapp-scoped repo profile credentials.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md`, `docs/infisical-bootstrap.md`, and `infisical-bootstrap.md` to
  distinguish repo profile credentials from deployment managed workload credentials.
- Document the repo-scoped credential namespace and the operator action needed when old local
  resolver state still points at the previous Sample webapp-scoped refs.
- Keep Sample webapp deployment bootstrap docs focused on deployment-created workload credentials, not
  repo-wide profile auth refs.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to Infisical bootstrap profile materialization, credential-ref helpers,
  resolver config expectations, SprinkleRef reporting/tests, and docs. Do not change runtime secret
  acquisition, deployment admission semantics, provider publish behavior, or live resource naming.

### 6. Acceptance criteria

- Repo-wide `infisical-default` profile materialization no longer references
  `secret://deployments/sample-webapp/...`.
- Repo-mode bootstrap output and generated resolver config remain repo-wide and generic when no
  deployment target is selected.
- Sample webapp deployment bootstrap still owns and reports the stage-specific managed Infisical client
  ID/secret refs under the deployment namespace.
- Tests cover both the new generic repo credential namespace and the preservation of deployment
  managed outputs.
- Updated docs clearly explain the distinction and migration path for old local resolver state.
- Focused tests and the repository validation suite pass.

### 7. Risks

- Existing local `sprinkleref/selected.local.json` files may still contain the old Sample webapp-scoped
  repo profile refs until operators rerun repo bootstrap or update local state.
- Renaming helper functions could obscure the distinction between profile credentials and managed
  deployment workload credentials if the code remains too implicit.
- A broad stale-string guard could accidentally flag legitimate historical migration notes or
  deployment-owned managed output refs.

### 8. Mitigations

- Treat local resolver state as regenerated local output and document the rerun path instead of
  attempting backward compatibility for the old public surface.
- Name helper functions around repo profile credentials and deployment managed outputs separately.
- Scope stale-string guards to active repo bootstrap/profile materialization output and allow
  intentional deployment managed-output refs and historical notes.

### 9. Consequences of not implementing this PR

Repo-wide Infisical bootstrap will remain coupled to Sample webapp, contradicting the repo/deployment
boundary and making future non-Sample webapp profiles or alternate Infisical accounts look like they
belong under a Sample webapp deployment namespace.

### 10. Downsides for implementing this PR

Operators who already generated local resolver state may need to rerun repo bootstrap or refresh
their local config. The implementation also adds one more credential namespace concept that docs and
tests must keep distinct from deployment managed workload outputs.

## PR-35: Operator-authored resolver profile preservation

### 1. Intent

Make repo bootstrap respect existing operator-authored Infisical resolver profiles as authoritative.
Repo bootstrap may materialize missing starter profiles or replace known generated placeholders, but
it must not silently overwrite an existing real profile's credential refs, endpoint, path prefix, or
other operator-chosen fields after validating that the profile's `projectId` still matches the
selected repo profile.

### 2. Scope of changes

- Update Infisical repo profile materialization so an existing operator-authored profile is
  validated for compatible `projectId` and preserved as-is instead of being rebuilt with generated
  repo bootstrap credential refs.
- Define the supported marker or structural rule that distinguishes starter/generated profiles from
  operator-authored profiles. The rule must be deterministic, documented, and narrow enough that
  arbitrary real profiles are not treated as generated just because they use the repo bootstrap
  credential namespace.
- Continue materializing missing profiles and replacing only generated starter/placeholders with the
  current repo-scoped bootstrap credential refs from PR-34.
- Preserve the PR-34 boundary: repo-generated profile refs remain under
  `secret://viberoots/bootstrap/...`, while deployment managed workload refs remain under
  `secret://deployments/sample-webapp/<stage>/...`.
- Ensure dry-run and result summaries distinguish `validatedExistingProfiles` from
  `materializedProfiles` so operators can tell whether bootstrap preserved existing local state or
  wrote a generated profile.

### 3. External prerequisites

- None for tests. The implementation must not require live Infisical, Vault, Keychain, OpenTofu, or
  macOS access.
- Operators with existing local resolver profiles should not need to regenerate or edit them unless
  the selected profile points at a different Infisical project than the selected repo profile.

### 4. Tests to be added

- Add tests proving an existing real Infisical profile with matching `projectId` and custom
  credential refs is validated and preserved byte-for-byte or semantically without being replaced by
  generated repo bootstrap refs.
- Add tests proving an existing profile with mismatched `projectId` fails closed and reports the
  mismatch without rewriting the profile.
- Add tests proving missing profiles and explicitly generated starter/placeholders are materialized
  with the repo-scoped PR-34 credential refs.
- Add dry-run/result summary tests for `validatedExistingProfiles` versus `materializedProfiles`.
- Update any tests that currently encode unconditional overwrite behavior so they assert
  preservation for operator-authored profiles and materialization only for missing/generated ones.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md`, `docs/infisical-bootstrap.md`, and `infisical-bootstrap.md` to
  state that existing operator-authored Infisical resolver profiles are authoritative once their
  `projectId` validates.
- Document how generated starter profiles are identified, when repo bootstrap will rewrite them, and
  how operators can intentionally regenerate a profile.
- Clarify that rerunning repo bootstrap after PR-34 does not force existing real profiles onto the
  generated repo bootstrap credential refs.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to Infisical resolver profile materialization, generated-profile detection,
  bootstrap result/dry-run reporting, tests, and docs. Do not change runtime secret acquisition,
  deployment admission semantics, provider publish behavior, deployment fan-out, or live resource
  naming.

### 6. Acceptance criteria

- Existing operator-authored Infisical resolver profiles with matching `projectId` in the selected
  organization are preserved and reported as validated, not materialized.
- Profiles with mismatched `projectId` fail closed without being rewritten.
- Missing or explicitly generated starter profiles are still materialized with repo-scoped
  `secret://viberoots/bootstrap/...` refs.
- Dry-run and confirmed result summaries make profile preservation versus materialization explicit.
- Dry-run reports unresolved operator-authored `projectIdEnv` profiles separately instead of
  classifying them as validated when confirmed bootstrap would fail closed.
- Tests cover preservation, mismatch failure, starter materialization, unresolved `projectIdEnv`,
  and summary reporting.
- Updated docs match the implemented rule and the repository validation suite passes.

### 7. Risks

- A weak generated-profile detector could accidentally preserve stale generated placeholders or
  overwrite real operator profiles.
- Preserving arbitrary operator-authored profile fields may leave unsupported combinations in place
  if validation checks are too narrow.
- Adding summary fields could create churn in bootstrap JSON tests and operator examples.

### 8. Mitigations

- Prefer an explicit generated marker in starter profiles over broad heuristic detection where the
  existing config format can support it.
- Validate the fields that are required for safe repo bootstrap use, especially backend kind and
  `projectId`, while preserving non-conflicting operator choices.
- Keep summary schema additions additive and update examples/tests together.

### 9. Consequences of not implementing this PR

Repo bootstrap will continue rewriting real operator-authored resolver profiles, contradicting the
design's resolver authority model and making custom Infisical credential refs or alternate account
setups fragile.

### 10. Downsides for implementing this PR

Bootstrap profile materialization becomes slightly more stateful because it must classify existing
profiles before deciding whether to preserve or rewrite them. Operators and tests also need one more
summary concept to distinguish validation from materialization.

## PR-36: Repo bootstrap dry-run profile selection parity

### 1. Intent

Make repo bootstrap dry-run select and report the same resolver profiles that confirmed repo
bootstrap will validate or materialize. Dry-run must include active category-selected profiles from
the existing resolver config, not only profiles inferred from the deployment requirement graph, so
operators can see unresolved operator-authored profile blockers before running a mutation-capable
bootstrap.

### 2. Scope of changes

- Update repo dry-run planning so profile selection mirrors confirmed repo bootstrap: include
  graph-required profiles and active profiles selected by configured resolver categories.
- Preserve PR-35 behavior for operator-authored Infisical profiles: dry-run should report resolved
  existing profiles in `validatedExistingProfiles`, generated/missing profiles in
  `materializedProfiles`, and unresolved operator-authored `projectIdEnv` profiles in
  `unresolvedExistingProfiles` with `validationBlocked: true`.
- Ensure confirmed and dry-run selection stay deterministic, sorted, and use the same category
  interpretation for the repo bootstrap profile set.
- Keep repo dry-run read-only and keep deployment fan-out planning separate from repo profile
  validation/materialization.

### 3. External prerequisites

- None. Tests must not require live Infisical, Vault, Keychain, OpenTofu, or macOS access.

### 4. Tests to be added

- Add dry-run tests proving an active category-selected Infisical profile is reported even when the
  graph only requires a different backend profile such as `vault/default`.
- Add tests proving an operator-authored category-selected profile with unresolved `projectIdEnv`
  appears in `unresolvedExistingProfiles` during dry-run and fails closed in confirmed bootstrap
  without being rewritten.
- Add tests proving dry-run and confirmed bootstrap agree on the profile set for graph-required plus
  category-selected profiles.
- Update existing dry-run/profile selection tests whose expected profile lists only include
  graph-derived profiles.

### 5. Docs to be added or updated

- Update `docs/infisical-bootstrap.md` and `infisical-bootstrap.md` to state that repo dry-run
  reports both graph-required profiles and active category-selected resolver profiles.
- Clarify that dry-run can surface unresolved operator-authored profiles even if the current graph
  does not require that backend, because confirmed bootstrap validates active category selections.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to repo bootstrap dry-run planning, shared profile-selection helpers if
  needed, profile summary tests, and docs. Do not change runtime secret acquisition, deployment
  admission semantics, provider publish behavior, deployment fan-out execution, or live resource
  naming.

### 6. Acceptance criteria

- Repo dry-run and confirmed repo bootstrap use the same deterministic profile set for validation
  and materialization.
- Active category-selected Infisical profiles are surfaced in dry-run even when graph requirements
  alone would not include them.
- Unresolved operator-authored `projectIdEnv` profiles are reported in dry-run before confirmed
  bootstrap would fail closed.
- Tests cover graph-only, category-only, and combined graph/category profile selection.
- Updated docs match the implemented dry-run behavior and the repository validation suite passes.

### 7. Risks

- Dry-run output may become noisier by reporting active category-selected profiles that are not
  currently graph-required.
- Duplicating profile-selection logic between dry-run and confirmed bootstrap could reintroduce
  drift.
- Category selection may include legacy or partially configured local profiles that operators did
  not expect dry-run to validate.

### 8. Mitigations

- Prefer a shared helper for dry-run and confirmed profile selection where practical.
- Sort and de-duplicate profiles before reporting.
- Keep summary grouping explicit so operators can distinguish graph-required materialization from
  active resolver profile validation.

### 9. Consequences of not implementing this PR

Dry-run can keep reporting a clean plan while confirmed repo bootstrap later fails on an active
operator-authored profile, undermining dry-run as a reliable preview of repo bootstrap behavior.

### 10. Downsides for implementing this PR

Dry-run may mention profiles that are active in local resolver categories but not currently needed by
the graph. That is a small DX cost in exchange for making dry-run match the mutation-capable command.

## PR-37: Exact legacy generated-profile detection

### 1. Intent

Tighten Infisical resolver profile generated/starter detection so repo bootstrap only rewrites
profiles with an explicit `generatedBy: "viberoots-repo-bootstrap"` marker or the exact historical
starter profile shape. Operator-authored profiles that happen to use old `VBR_INFISICAL_*` env names
plus any additional metadata or custom fields must be treated as operator-authored and preserved
after validation.

### 2. Scope of changes

- Update the generated-profile classifier so the legacy starter path requires an exact key/value
  match for the old starter object, not just matching old env-var field values.
- Preserve explicit generated profiles marked with `generatedBy: "viberoots-repo-bootstrap"` as the
  modern rewrite/materialization path.
- Ensure non-secret extra fields such as `namespace`, custom markers, or other future resolver
  metadata disqualify the legacy starter fallback and force operator-authored preservation behavior.
- Keep PR-35 and PR-36 behavior intact: operator-authored profiles validate before preservation,
  generated/missing profiles materialize with repo-scoped refs, and dry-run/confirmed profile sets
  remain aligned.

### 3. External prerequisites

- None. Tests must not require live Infisical, Vault, Keychain, OpenTofu, or macOS access.

### 4. Tests to be added

- Add tests proving the exact historical starter object is still classified as generated and can be
  rewritten/materialized.
- Add tests proving profiles with the old `VBR_INFISICAL_*` env names plus extra fields such as
  `namespace` are classified as operator-authored, validated, and preserved rather than rewritten.
- Add negative tests proving custom refs or metadata are not erased by the legacy starter fallback.
- Keep or update generated marker tests proving `generatedBy: "viberoots-repo-bootstrap"` remains
  the supported explicit generated-profile marker.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md`, `docs/infisical-bootstrap.md`, and `infisical-bootstrap.md` to
  define the exact legacy starter shape and clarify that additional fields make a profile
  operator-authored.
- Document that operators can opt into regeneration by using the explicit generated marker or by
  removing/recreating the profile through repo bootstrap.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to generated-profile classification, profile materialization tests, and docs.
  Do not change runtime secret acquisition, deployment admission semantics, provider publish
  behavior, deployment fan-out, dry-run profile selection, or live resource naming.

### 6. Acceptance criteria

- Legacy starter detection requires an exact historical starter shape.
- Profiles with old env names plus extra fields are preserved as operator-authored profiles after
  validation.
- Explicit generated marker behavior remains supported.
- Tests cover exact legacy starter rewrite, extra-field preservation, and explicit marker rewrite.
- Updated docs match the implemented classification rule and the repository validation suite passes.

### 7. Risks

- Tightening legacy detection may preserve a previously generated local profile if it was manually
  edited with extra fields.
- The exact key set may need updates if the resolver profile schema gains new generated-only fields.

### 8. Mitigations

- Treat manually edited generated profiles as operator-authored unless they keep the explicit
  generated marker.
- Prefer the explicit marker for all newly generated profiles so the legacy fallback remains a narrow
  compatibility path.

### 9. Consequences of not implementing this PR

Repo bootstrap can still silently rewrite some operator-authored profiles that use legacy env names
with extra metadata, contradicting the resolver authority model introduced in PR-35.

### 10. Downsides for implementing this PR

Some locally edited legacy starter profiles may stop being regenerated automatically. Operators who
want regeneration must use the explicit generated marker or recreate the profile through repo
bootstrap.

## PR-38: Remove speculative non-Sample webapp deployment packages

### 1. Intent

Remove checked-in deployment packages that are not current Sample webapp deployments. The repository
should not contain speculative Data Room, Phase 0, or platform-foundation deployment targets until
those projects are explicitly approved as real deployments. Deployment capability tests must use
temp-repo fixtures or purpose-built hermetic test workspaces instead of polluting
`projects/deployments` with future-looking operator surfaces.

### 2. Scope of changes

- Delete the checked-in non-Sample webapp deployment packages under `projects/deployments`, including
  `example-console-*`, `example-web-*`, `example-worker-*`, `platform-foundation-*`, and
  `platform-shared`.
- Leave `projects/deployments` containing only active Sample webapp deployment packages and shared
  Sample webapp support, plus any repo-root `TARGETS` file needed for package discovery.
- Remove placeholder OpenTofu files and stack metadata associated with the speculative Phase 0
  packages, including `replace-me` state backend identities, empty `plan.tfplan` placeholders, and
  `*.example.invalid` deployment URLs.
- Move any capability coverage that currently cqueries those checked-in packages into temp-repo
  fixtures or local test workspaces created during the tests. This includes provider, admission,
  release-readiness, prerequisite, smoke, secret-contract, and migration-bundle coverage that still
  matters for deployment tooling.
- Remove or rewrite tests whose only purpose is to assert the existence of Data Room or Phase 0
  checked-in deployment packages.
- Update any code, docs, examples, and guardrails that present `sample-webapp-*` or
  `platform-foundation-*` labels as current operator-facing deployments.

### 3. External prerequisites

- None. This cleanup must be source-tree and test-fixture work only.
- No live Infisical, Vault, OpenTofu, Vercel, Kubernetes, Supabase, macOS Keychain, or provider
  access should be required.

### 4. Tests to be added

- Add a repository guard test proving `projects/deployments` contains only approved live deployment
  families, initially Sample webapp, and fails if future speculative deployment packages are checked in
  without an explicit allowlist update.
- Add or update temp-repo fixture tests for deployment capability behavior currently covered by the
  Phase 0 packages, including admission prerequisites, readiness-secret contracts, smoke metadata,
  provider target metadata, and OpenTofu foundation metadata.
- Add docs/usage stale-reference tests or extend existing stale-name checks so operator-facing docs
  do not advertise removed Data Room or platform-foundation deployment labels as runnable current
  commands.
- Add regression coverage proving deleted package labels are not selected by repo bootstrap,
  SprinkleRef scans, deployment-family inference tests, or deployment-domain cquery sweeps.
- Keep Sample webapp deployment tests passing and ensure the cleanup does not weaken real Sample webapp
  metadata, secret, bootstrap, or provider coverage.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md`, `docs/infisical-bootstrap.md`, and `infisical-bootstrap.md` to
  state that the only checked-in live deployment family is Sample webapp.
- Update deployment docs such as `docs/deployments-usage.md`, `docs/history/designs/deployment-adjustment.md`,
  `docs/secrets-usage.md`, `docs/deployments-schema.md`, and troubleshooting docs so Data Room and
  Phase 0 deployment labels are not presented as current operator commands or concrete package
  inventory.
- Where capability examples are still useful, mark them clearly as temp-repo/test-fixture examples
  or convert them to generic illustrative snippets that do not imply live repo packages.
- Add a short cleanup note explaining why the speculative packages were removed and how future
  deployment families should be introduced only after product approval.

### 5.5. Expected regression scope

- `deployment-only`
- Expect broad deployment test and docs churn because these packages are referenced by cquery tests,
  release/admission tests, deployment docs, and secret-contract examples. Keep the cleanup focused on
  removing speculative checked-in deployments and relocating required capability coverage to
  temp-repo fixtures. Do not change Sample webapp runtime behavior, Infisical/Vault backend semantics,
  deployment provider implementations, reviewed-source admission policy, or live Sample webapp resource
  names.

### 6. Acceptance criteria

- `projects/deployments` contains only Sample webapp deployment packages and any necessary Sample webapp/shared
  package discovery files.
- No checked-in Data Room, Phase 0, or platform-foundation deployment packages, placeholder OpenTofu
  plans, or speculative provider stack configs remain.
- Deployment capability tests that still matter run from temp repos or hermetic test workspaces, not
  from speculative checked-in deployment packages.
- Operator-facing docs no longer list removed Data Room or platform-foundation labels as current
  deployments or runnable commands.
- Guard coverage prevents future speculative deployment packages from being added under
  `projects/deployments` without an explicit allowlist change.
- Sample webapp deployment, Infisical bootstrap, SprinkleRef, and deployment-domain validation continue
  to pass.
- Focused tests and the repository validation suite pass.

### 7. Risks

- Removing the packages can break many tests that currently rely on their real labels instead of
  constructing temp repos.
- Some docs may use Data Room examples for broader deployment concepts and need careful rewriting so
  useful concepts are not lost.
- A too-strict allowlist guard could make it awkward to add approved future deployment families.

### 8. Mitigations

- First map every existing Data Room, Phase 0, and platform-foundation reference to either
  delete, convert to temp fixture, or rewrite as generic documentation.
- Preserve deployment capability coverage by moving behavior-focused cases into temp repos before
  deleting the real packages.
- Keep the allowlist guard explicit and documented so future approved families can be added with a
  deliberate plan PR.

### 9. Consequences of not implementing this PR

The repo will continue to advertise speculative Data Room and platform-foundation deployments as if
they were real operator surfaces, and deployment tests will keep depending on checked-in future
project packages instead of isolated fixtures.

### 10. Downsides for implementing this PR

This cleanup is high-churn across deployment tests and docs. It may temporarily obscure some
end-to-end deployment examples until the useful parts are rebuilt as temp-repo fixtures or generic
illustrations.

## PR-39: Post-cleanup Infisical assessment closure

### 1. Intent

Close the post-PR-38 assessment gaps so the implemented Infisical secret replay and repo bootstrap
behavior fully match the design documents. Tighten live Infisical replay evidence so incomplete
provider responses fail closed, restore repo bootstrap parity for implicit `vault/default`
deployments, and repair remaining operator docs that still describe stale bootstrap confirmation or
command forms.

### 2. Scope of changes

- Require live Infisical read responses used for admission/runtime replay to include complete
  non-secret identity evidence before freezing or comparing the backend reference. The required
  fields are the provider secret id, project id, environment, secret path, secret name, and version
  when the response shape supports versioned reads.
- Stop filling missing Infisical response identity fields from the requested selector in a way that
  makes incomplete live responses indistinguishable from provider-confirmed evidence.
- Ensure admission fails closed when Infisical does not return the required identity fields for a
  secret that will later be replayed.
- Ensure runtime replay compares all frozen identity fields and continues to fail closed on id,
  project, environment, path, name, reference, or version drift.
- Update repo bootstrap profile discovery so deployments with omitted `secret_backend` still
  contribute the implicit `vault/default` profile when they have secret requirements or otherwise
  need backend materialization.
- Replace tests that assert missing selectors are ignored with tests that prove omitted selectors
  resolve to `vault-default` where the deployment graph requires a backend.
- Keep explicit backend selector behavior from PR-27 through PR-38 unchanged: `vault/<profile>` and
  `infisical/<profile>` remain the only public selector forms, category-selected Infisical profiles
  still materialize as designed, and generated profile preservation remains exact.
- Fix stale docs that still say `--yes` is required for every non-dry-run bootstrap. `--yes` should
  be documented as non-interactive pre-confirmation, while local interactive operators may confirm
  at the prompt.
- Fix shorthand bootstrap command references so operator-facing remediation uses the canonical repo
  command form, `build-tools/tools/deployments/infisical-bootstrap.ts repo`, with `zx-wrapper` only
  where the surrounding doc explicitly explains wrapper usage.

### 3. External prerequisites

- None. Tests must use fixture Infisical clients, fixture deployment graph metadata, and hermetic
  temp workspaces.
- No live Infisical, Vault, macOS Keychain, OpenTofu, provider, or browser access should be
  required.

### 4. Tests to be added

- Add Infisical replay tests proving admission rejects live read responses that omit the provider
  secret id, project id, environment, secret path, secret name, or required version evidence.
- Add runtime replay tests proving frozen identity fields are compared exactly and that omitted
  frozen fields cannot silently weaken the replay check.
- Add client-normalization tests proving selector values are not used as substitutes for missing
  provider identity evidence in replay-bearing responses.
- Add repo bootstrap resolver tests proving graph nodes with omitted `secret_backend` and secret
  requirements resolve to `vault-default`.
- Update existing unified-selector tests that intentionally ignored omitted selectors so they only
  ignore graph nodes that truly do not require a secret backend.
- Add docs regression coverage for the stale `--yes` sentence and shorthand bootstrap command form
  if an existing docs/stale-name guard can express those checks without broad false positives.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md` to clarify that live Infisical replay evidence must come from
  the provider response, not from the caller's requested selector, before it can be frozen or
  compared.
- Update `docs/infisical-bootstrap.md`, `infisical-bootstrap.md`, and `docs/deployments-usage.md`
  so `--yes` is consistently described as non-interactive pre-confirmation rather than a mandatory
  flag for local interactive mutation-capable runs.
- Replace shorthand `infisical-bootstrap.ts repo` remediation text with the canonical executable
  path in operator-facing docs.
- Document that omitted deployment `secret_backend` still means `vault/default`, including in repo
  bootstrap profile discovery and resolver profile validation.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to Infisical secret client/admission replay validation, repo bootstrap
  resolver profile discovery, targeted deployment tests, and documentation. Do not change Sample webapp
  deployment metadata, live resource names, deployment fan-out ordering, generated profile
  materialization semantics, provider publish behavior, or the public backend selector syntax.

### 6. Acceptance criteria

- Infisical admission fails closed when provider responses lack complete non-secret identity
  evidence needed for replay.
- Runtime replay compares complete frozen Infisical identity evidence and cannot be weakened by
  absent fields.
- Repo bootstrap discovers `vault-default` for deployment graph requirements that omit
  `secret_backend`.
- Explicit `vault/<profile>` and `infisical/<profile>` selectors continue to work, and no old public
  selector surface is reintroduced.
- Operator docs consistently describe `--yes` and the canonical bootstrap command.
- Focused Infisical replay, bootstrap resolver, docs guard, and deployment validation tests pass.
- The repository validation suite passes.

### 7. Risks

- Infisical API response shapes may vary by endpoint or CLI/API version, so requiring fields too
  aggressively could reject otherwise valid reads.
- Treating omitted backend selectors as implicit Vault may surface missing local Vault config in repo
  bootstrap runs that previously skipped those graph nodes.
- Docs guards for command text can become brittle if they scan illustrative snippets too broadly.

### 8. Mitigations

- Centralize Infisical response identity extraction and make the required-field error message name
  the missing provider field and requested selector.
- Limit implicit Vault discovery to graph nodes that actually require secret backend resolution.
- Scope docs regression checks to operator-facing bootstrap/remediation docs instead of all
  historical planning text.

### 9. Consequences of not implementing this PR

Infisical replay can keep accepting incomplete live identity evidence, repo bootstrap can keep
missing implicit Vault requirements, and operator docs will continue to contain stale bootstrap
confirmation guidance.

### 10. Downsides for implementing this PR

The stricter Infisical identity check may require adapting fixtures if the current test client
omitted fields that real replay should require. Repo bootstrap may also become noisier for
deployments that still rely on the implicit Vault default and have not configured local Vault
validation inputs.

## PR-40: First-bootstrap metadata handoff and single-command setup flow

### 1. Intent

Remove the first-run chicken-and-egg failure where deployment bootstrap successfully creates the
Infisical project and identities, then fails reconciliation because checked-in reviewed metadata
still contains placeholders. Provide one top-level operator invocation that can take a fresh repo
from no local resolver config, no bootstrap credentials, and no Sample webapp Infisical project to a
usable reviewed state without requiring operators to reverse-engineer the intermediate outputs.

### 2. Scope of changes

- Add an explicit first-bootstrap metadata handoff state for deployment bootstrap. When OpenTofu
  creates or adopts Infisical resources and reconciliation only fails because reviewed metadata
  still contains known placeholder IDs or empty first-bootstrap values, the tool must classify the
  result as a pending reviewed-metadata handoff rather than an unexpected deployment bootstrap
  failure.
- Generate a deterministic, non-secret metadata patch or patch file for
  `projects/deployments/sample-webapp/shared/family.bzl` containing the live Infisical project id,
  machine identity ids, site URL, and credential file names returned by OpenTofu.
- Keep the stable secret refs unchanged during metadata handoff unless the reviewed naming
  convention itself changes.
- Add a single top-level repo bootstrap flow that runs repo resolver/profile setup, repo bootstrap
  credential creation or rotation, deployment bootstrap fan-out, first-bootstrap metadata handoff,
  reviewed metadata verification, and final SprinkleRef checks from one operator command.
- Make the top-level flow pause at an explicit review/apply gate before modifying checked-in
  reviewed metadata. Interactive local operators should get a clear `[Y/n]` gate; non-interactive
  use must require an explicit flag for metadata patch application.
- Ensure the top-level command can resume idempotently after the metadata patch is applied. A second
  run should treat the same live Infisical resources as expected, avoid duplicate project/identity
  creation, reuse or rotate credentials according to flags, and continue through final validation.
- Preserve the strict reconciliation guard for real drift. If live OpenTofu output differs from
  already-reviewed non-placeholder metadata, the command must still fail closed and require a human
  decision instead of overwriting reviewed constants.
- Improve fan-out result reporting so a first-bootstrap handoff is shown separately from hard
  deployment failures and so duplicate per-target reconciliation messages are collapsed into one
  actionable handoff summary.
- Keep standalone `deployment --target <buck-target>` behavior available, but make the repo-level
  command the recommended first-run path.
- Keep generated local files, OpenTofu state, and SprinkleRef local resolver config out of git
  unless an existing repo policy explicitly allows a specific generated file such as a provider lock
  file.

### 3. External prerequisites

- A live first-bootstrap smoke test requires an Infisical organization and operator login, but
  automated repository tests must not require live Infisical, macOS Keychain, OpenTofu network
  access, Vault, Cloudflare, or browser automation.
- The implementation may use fixture OpenTofu outputs and temp-repo workspaces to prove the
  first-bootstrap handoff, metadata patching, and resume behavior.

### 4. Tests to be added

- Add unit tests for classifying reconciliation mismatches into first-bootstrap placeholder handoff
  versus hard drift. Placeholder reviewed IDs should allow handoff; non-placeholder reviewed IDs
  should fail closed.
- Add tests proving the generated `family.bzl` metadata patch updates only reviewed non-secret
  constants: `_INFISICAL_SITE_URL`, `_INFISICAL_PROJECT_ID`,
  `_INFISICAL_MACHINE_IDENTITY_IDS`, and `_INFISICAL_CREDENTIAL_FILE_NAMES`.
- Add tests proving stable secret refs, secret names, environment slugs, project name/slug, and
  Cloudflare secret requirements are not changed by the handoff patch.
- Add repo bootstrap fan-out tests proving first-bootstrap handoff results are aggregated once and
  reported separately from hard deployment failures.
- Add idempotency tests proving the top-level flow can resume after metadata application without
  trying to recreate existing Infisical resources or re-failing the placeholder reconciliation.
- Add CLI tests for the new top-level flags and gates, including interactive metadata patch
  confirmation, non-interactive required flags, `--without-deployments`, and existing rotation
  flags.
- Add final-check tests proving the single top-level flow runs or reports the canonical
  `sprinkleref --check --config sprinkleref/selected.local.json` and bootstrap-category check after
  reviewed metadata reconciliation succeeds.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md` to describe first-bootstrap as a two-phase reviewed metadata
  handoff: create/adopt live resources, review/apply non-secret metadata, then re-run or resume
  reconciliation.
- Update `docs/infisical-bootstrap.md` and `infisical-bootstrap.md` so the recommended fresh-start
  path is one repo-level command, with standalone deployment bootstrap documented as an advanced
  retry/debug path.
- Document the difference between expected first-bootstrap metadata handoff and unexpected drift,
  including when it is safe to apply the generated metadata patch and when an operator must stop.
- Document which generated local files are expected during bootstrap, which files should not be
  committed, and whether the OpenTofu provider lock file is intentionally tracked or local-only.
- Update troubleshooting guidance for stale Keychain credentials, deleted remote Universal Auth
  records, and first-run metadata reconciliation so operators do not confuse expected handoff with a
  failed bootstrap.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes focused on Infisical repo bootstrap orchestration, deployment fan-out result
  classification, reviewed metadata patch generation, and docs. Do not change public backend
  selector syntax, Sample webapp secret ref naming, Cloudflare deployment semantics, provider publish
  behavior, Vault behavior, or the Infisical OpenTofu resource model except where required for
  idempotent first-bootstrap adoption.

### 6. Acceptance criteria

- A fresh Infisical bootstrap that creates the Sample webapp project and identities no longer ends with a
  hard reconciliation error solely because reviewed metadata still contains first-bootstrap
  placeholders.
- The tool generates a deterministic reviewed metadata patch or patch file with the live Infisical
  project and identity IDs and clearly gates applying it.
- One top-level repo bootstrap invocation can drive resolver setup, credential setup, deployment
  fan-out, metadata handoff, resume/reconciliation, and final SprinkleRef checks.
- Real drift against already-reviewed non-placeholder metadata still fails closed and is not
  auto-applied.
- Re-running the command after applying the metadata patch is idempotent and reaches final checks
  without duplicate project or identity creation.
- Standalone deployment retry remains available for failed individual targets.
- Focused bootstrap orchestration, metadata handoff, fan-out, docs, and regression tests pass.
- The repository validation suite passes.

### 7. Risks

- Automatically editing reviewed metadata can weaken the review boundary if the patch gate is too
  permissive or if hard drift is misclassified as first-bootstrap placeholder replacement.
- Patch generation for Starlark metadata can become brittle if the family file structure changes.
- A single top-level flow can hide useful intermediate state if reporting is too terse.
- OpenTofu local state and generated resolver files can confuse operators if the command does not
  clearly explain which generated artifacts are expected and which should remain untracked.

### 8. Mitigations

- Only allow automatic handoff for known placeholder or empty first-bootstrap reviewed values, and
  require exact live output fields from OpenTofu before generating the patch.
- Generate a minimal textual patch with before/after values and require an explicit review gate
  before applying it to checked-in metadata.
- Keep drift errors separate from first-bootstrap handoff errors in code and tests.
- Print a concise phase summary at the end of the top-level flow showing resolver config, credential
  sink, deployment resources, metadata patch status, final checks, and generated local artifacts.

### 9. Consequences of not implementing this PR

Every fresh Infisical project bootstrap will keep hitting an expected but alarming reconciliation
failure after resource creation, forcing operators to manually copy IDs from OpenTofu output into
reviewed metadata and rerun the command. The repo will also lack a single reliable first-run path
that gets an operator from a clean local state to a usable Infisical-backed deployment setup.

### 10. Downsides for implementing this PR

The bootstrap command becomes more stateful and needs careful reporting around phases, generated
patches, local OpenTofu state, and reruns. The first-bootstrap handoff logic also adds another
classification path that must be kept narrow so it does not mask real live-resource drift.

## PR-41: Constant-scoped Infisical metadata handoff patching

### 1. Intent

Close the PR-40 assessment gap where the reviewed metadata handoff patch is deterministic in
content but not deterministic in edit target. The handoff patch must update only the intended
reviewed Infisical constants in `projects/deployments/sample-webapp/shared/family.bzl`, even when the
same placeholder, empty string, site URL, identity id, or credential file name appears elsewhere in
the file.

### 2. Scope of changes

- Replace value-based metadata handoff patch application with constant-scoped or Starlark-aware
  edits keyed by the intended reviewed constants.
- Scope scalar replacements to the exact `_INFISICAL_SITE_URL` and `_INFISICAL_PROJECT_ID`
  assignments.
- Scope map replacements to the exact stage entries inside `_INFISICAL_MACHINE_IDENTITY_IDS` and
  `_INFISICAL_CREDENTIAL_FILE_NAMES`.
- Preserve `_INFISICAL_PROJECT_NAME`, `_INFISICAL_PROJECT_SLUG`, environment slugs, secret path,
  Cloudflare secret name, stable secret refs, Vault runtime metadata, comments, unrelated strings,
  and any future reviewed constants with duplicate values.
- Fail closed with a clear error if a required constant or stage entry is missing, duplicated in an
  ambiguous way, or cannot be rewritten without touching unrelated content.
- Keep the generated patch preview minimal and deterministic, but make its application use the
  constant/stage path rather than the first matching quoted value.
- Keep PR-40 handoff classification, metadata gate behavior, fan-out aggregation, final checks, and
  generated artifact ignore behavior unchanged except where needed to use the safer patcher.

### 3. External prerequisites

- None. This is source-only hardening with hermetic tests.
- No live Infisical, OpenTofu, macOS Keychain, Vault, Cloudflare, or browser access should be
  required.

### 4. Tests to be added

- Add a regression test where duplicate placeholder values appear before the intended Infisical
  constants and prove the patcher updates only the named constants and stage entries.
- Add a regression test where duplicate live or placeholder values appear in unrelated constants,
  comments, Vault metadata, or stable secret refs and prove they remain unchanged.
- Add tests proving missing or ambiguous required constants fail closed with actionable errors.
- Keep existing metadata handoff, fan-out handoff, repo-flow resume, and metadata gate tests passing
  against the constant-scoped patcher.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md` to state that first-bootstrap metadata handoff patching is
  scoped by reviewed constant and stage key, not by globally replacing old values.
- Update `docs/infisical-bootstrap.md` or `infisical-bootstrap.md` if operator-facing
  troubleshooting should mention that duplicate placeholder values outside the reviewed Infisical
  constants are intentionally ignored.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to metadata handoff patch construction/application, targeted tests, and small
  docs clarification. Do not change live Infisical resource creation, reviewed metadata values,
  public bootstrap flags, deployment fan-out behavior, final SprinkleRef checks, or secret ref
  naming.

### 6. Acceptance criteria

- Metadata handoff patch application is keyed to reviewed constants and stage entries rather than
  the first matching quoted value.
- Duplicate old values elsewhere in `family.bzl` cannot cause the patcher to update the wrong
  field.
- Missing or ambiguous metadata structures fail closed with clear errors.
- Existing PR-40 first-bootstrap handoff behavior, patch gate behavior, repo-flow resume behavior,
  and final checks continue to work.
- Focused metadata handoff and repo-flow tests pass.
- The repository validation suite passes.

### 7. Risks

- A narrow textual patcher can become brittle if `family.bzl` formatting changes.
- A full Starlark parser or formatter may be excessive for the small reviewed metadata surface.
- Strict ambiguity checks could reject harmless formatting variations.

### 8. Mitigations

- Use small constant-scoped helpers with explicit tests for the current Starlark shapes instead of
  broad global replacement.
- Keep error messages specific to the missing or ambiguous constant/stage path.
- Preserve original formatting outside the exact quoted value being replaced.

### 9. Consequences of not implementing this PR

First-bootstrap handoff can silently patch the wrong string if duplicate placeholder or reviewed
values appear earlier in `family.bzl`, weakening the reviewed metadata boundary that PR-40 was meant
to preserve.

### 10. Downsides for implementing this PR

The patcher becomes more specialized to the current Sample webapp reviewed metadata file shape, so future
metadata layout changes may need a deliberate patcher update rather than benefiting from generic
value replacement.

## PR-42: Fail closed on incomplete live Infisical handoff output

### 1. Intent

Close the post-PR-41 assessment gap where first-bootstrap handoff can be classified as safe when
reviewed metadata contains placeholders but OpenTofu did not return the live values needed to
produce a complete reviewed metadata patch. A handoff is safe only when every required live
Infisical field is present and can be written into the reviewed metadata patch.

### 2. Scope of changes

- Require exact live OpenTofu output fields before returning or applying
  `metadata_handoff_required`.
- Validate that live metadata includes the Infisical project id, site URL when it is part of the
  handoff patch, each required stage identity id, and each required stage credential file name before
  generating the handoff patch.
- Treat missing live values as hard reconciliation failures with clear errors naming the missing
  field and stage, not as first-bootstrap handoff.
- Stop silently dropping metadata replacements whose `after` value is absent. Patch generation must
  either include every required handoff replacement or fail closed before reporting a handoff patch.
- Preserve PR-41 constant-scoped patch application and PR-40 hard drift behavior.
- Keep optional or unchanged fields out of the patch when they are not required for the reviewed
  metadata mismatch, but do not allow required live values for placeholder-reviewed fields to be
  missing.

### 3. External prerequisites

- None. This is hermetic validation and test work only.
- No live Infisical, OpenTofu network access, macOS Keychain, Vault, Cloudflare, or browser
  automation should be required.

### 4. Tests to be added

- Add reconciliation tests proving missing live project id does not produce
  `metadata_handoff_required` and instead fails closed with an actionable error.
- Add tests proving missing live stage identity ids fail closed rather than producing partial
  `_INFISICAL_MACHINE_IDENTITY_IDS` patch entries.
- Add tests proving missing live credential file names fail closed rather than producing partial
  `_INFISICAL_CREDENTIAL_FILE_NAMES` patch entries.
- Add patch-generation tests proving absent `after` values cannot be silently dropped for required
  handoff replacements.
- Keep the successful first-bootstrap handoff, metadata gate, repo-flow resume, and constant-scoped
  patch tests passing.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md` to state that first-bootstrap handoff requires complete live
  OpenTofu output for every reviewed metadata field being handed off.
- Update `docs/infisical-bootstrap.md` or `infisical-bootstrap.md` troubleshooting to distinguish
  incomplete OpenTofu output from ordinary first-bootstrap reviewed metadata handoff.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to reconciliation classification, metadata handoff patch generation,
  targeted tests, and small docs clarifications. Do not change public bootstrap flags, live
  Infisical resource definitions, constant-scoped patch application, generated artifact policy,
  deployment fan-out ordering, or secret ref naming.

### 6. Acceptance criteria

- `metadata_handoff_required` is emitted only when all live values needed for the reviewed metadata
  patch are present.
- Missing live project id, stage identity id, or credential file name fails closed with clear
  operator-facing errors.
- Patch generation no longer silently drops required replacements with missing `after` values.
- Existing first-bootstrap handoff success, hard drift failure, metadata gate, repo-flow resume, and
  PR-41 constant-scoped patch tests continue to pass.
- Focused reconciliation and metadata handoff tests pass.
- The repository validation suite passes.

### 7. Risks

- Strict live-field validation may expose provider or OpenTofu output shape gaps that previously
  produced partial handoff reports.
- If optional fields are treated as required too broadly, legitimate handoffs could fail
  unnecessarily.

### 8. Mitigations

- Require only fields that are necessary to replace placeholder or empty reviewed metadata values.
- Include the missing field path and stage in errors so malformed OpenTofu output is easy to
  diagnose.
- Keep successful fixture outputs unchanged to avoid widening the behavior beyond the missing-live
  guard.

### 9. Consequences of not implementing this PR

A malformed or incomplete OpenTofu output can be reported as a normal first-bootstrap handoff even
though the generated patch is incomplete and cannot make reconciliation pass on rerun.

### 10. Downsides for implementing this PR

Operators may see a hard failure earlier in the bootstrap flow if provider outputs are incomplete,
but that is preferable to accepting an incomplete reviewed metadata patch.

## PR-43: Fan-out metadata handoff patch consistency

### 1. Intent

Close the post-PR-42 assessment gap where repo bootstrap deployment fan-out can collect multiple
metadata handoff patches but report and apply only the first one. Fan-out may collapse duplicate
handoff messages into one actionable summary only after proving every handoff target produced the
same reviewed metadata patch, or after deterministically merging compatible patches without
weakening the reviewed metadata boundary.

### 2. Scope of changes

- Add a fan-out handoff patch consistency check before reporting or applying a repo-level metadata
  patch.
- For the current Sample webapp fan-out, require every metadata handoff target to produce an identical
  patch payload before collapsing the handoff into one summary.
- Fail closed with a clear error naming the divergent targets if fan-out handoff patches differ.
- Do not apply any metadata patch when divergent handoff patches are detected.
- Keep duplicate handoff messages collapsed when all patches are identical.
- Preserve PR-40 through PR-42 behavior for single-target handoff, identical multi-target handoff,
  metadata patch gating, repo-flow resume, final SprinkleRef checks, constant-scoped patching, and
  missing-live-output failures.

### 3. External prerequisites

- None. This is hermetic fan-out aggregation and test work only.
- No live Infisical, OpenTofu network access, macOS Keychain, Vault, Cloudflare, or browser
  automation should be required.

### 4. Tests to be added

- Add fan-out aggregation tests proving identical handoff patches from multiple targets are
  collapsed into one actionable metadata handoff summary.
- Add tests proving divergent handoff patches from different targets fail closed and name the
  affected targets.
- Add tests proving the metadata gate does not apply a patch when fan-out handoff patches diverge.
- Keep repo-flow resume and metadata handoff tests passing for the current identical Sample webapp
  fan-out.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md` to state that repo fan-out collapses first-bootstrap handoff
  summaries only when the target patches are identical.
- Update `docs/infisical-bootstrap.md` or `infisical-bootstrap.md` troubleshooting to describe a
  divergent fan-out handoff as a hard stop requiring operator review.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to fan-out handoff aggregation/reporting, metadata gate input validation,
  targeted tests, and small docs clarification. Do not change OpenTofu resource definitions,
  constant-scoped patch application, incomplete-live-output validation, public bootstrap flags, or
  secret ref naming.

### 6. Acceptance criteria

- Repo fan-out applies or reports a metadata handoff patch only when all handoff targets agree on
  the patch payload.
- Divergent handoff patches fail closed before metadata patch application and identify the affected
  targets.
- Identical multi-target handoffs continue to collapse into one actionable summary.
- Current Sample webapp repo-flow handoff/resume behavior remains unchanged.
- Focused fan-out handoff and repo-flow tests pass.
- The repository validation suite passes.

### 7. Risks

- Strict equality could reject harmless formatting or ordering differences in independently
  generated but semantically equivalent patches.
- A merge-based approach could accidentally hide real disagreement if it is too permissive.

### 8. Mitigations

- Compare deterministic patch payloads after PR-41 constant-scoped patch generation, not raw console
  text.
- Prefer fail-closed identical-patch equality for the current Sample webapp fan-out; add a future merge
  design only if multiple independent deployment families need compatible partial patches.
- Include target labels in divergence errors so operators can inspect the conflicting OpenTofu
  outputs.

### 9. Consequences of not implementing this PR

Repo bootstrap can silently apply the first metadata handoff patch when different deployment targets
reported conflicting reviewed metadata patches, leaving the reviewed metadata boundary dependent on
fan-out ordering.

### 10. Downsides for implementing this PR

Fan-out can fail in a new hard-stop state if future targets produce equivalent but differently
ordered patch payloads. That is acceptable until a deterministic merge format is deliberately
designed.

## PR-44: Per-machine Universal Auth credential bootstrap

### 1. Intent

Replace the current shared-local-secret Universal Auth bootstrap model with a durable per-machine
local credential model. Infisical identities remain shared deployment or repo identities, but each
operator machine should get its own labeled client-secret record and store only that machine's
secret in its local credential sink. A fresh machine should be able to run the top-level setup flow
and become usable without manually importing another user's secret, without rotating shared
credentials out from under other machines, and without treating existing remote client-secret
records as a conflict.

### 2. Scope of changes

- Change repo and deployment bootstrap credential creation so an existing remote Universal Auth
  client-secret record no longer blocks setup when the current machine has no local secret.
- Create a new Infisical Universal Auth client-secret record for the current machine when local
  credentials are missing and the operator confirms or passes the required non-interactive flag.
- Label created client-secret records with deterministic, human-readable local context such as
  repo, identity name, credential purpose, operator-supplied machine label, system hostname, and
  creation timestamp where appropriate.
- Add a `--machine-label` or equivalent option for operators who want a stable explicit label
  instead of relying only on hostname-derived descriptions.
- Store the resulting client id and client secret under the existing stable local SprinkleRef refs
  for that machine's selected sink. Do not commit machine-specific refs or generated local
  credential files.
- Preserve existing local credentials by default. If a valid local secret exists, bootstrap should
  validate enough remote identity state to proceed without creating a replacement secret.
- Replace the current remote-record/local-secret mismatch failure with a per-machine branch:
  create a new local machine secret when local credentials are absent, and reserve hard failures for
  ambiguous local state, failed creation, missing identity/client id evidence, or explicit drift.
- Keep rotation explicit. `--rotate-bootstrap-credentials` and `--rotate-deployment-credentials`
  should rotate the current machine's local credential by creating a new remote client-secret record
  and overwriting the local sink only after the existing overwrite/confirmation gate passes.
- Remove the old shared-secret import-oriented public behavior and messages. Backwards
  compatibility is not required because there are no external users yet.
- Update the top-level repo bootstrap and any future `i`-invoked secret readiness path so it can
  ensure required repo and deployment Universal Auth credentials idempotently for the current
  machine without changing values that already exist for other machines.
- Keep the reviewed metadata handoff model from PR-40 through PR-43 unchanged. Per-machine client
  secrets must not change reviewed Infisical project ids, machine identity ids, credential file
  names, stable secret refs, or deployment family layout.
- Add clear reporting that distinguishes reused local credentials, newly created current-machine
  credentials, rotated current-machine credentials, and remote records that belong to other
  machines.
- If the Infisical API exposes client-secret record ids or descriptions, surface enough information
  to help operators revoke stale machine credentials manually without printing secret values.

### 3. External prerequisites

- Live smoke testing requires an Infisical organization and operator login, but automated tests must
  not require live Infisical, macOS Keychain, OpenTofu network access, Vault, Cloudflare, browser
  automation, or real host-specific state.
- Tests may use fixture host labels, fake clocks, temp local sinks, and mocked Infisical Universal
  Auth client-secret APIs.

### 4. Tests to be added

- Add unit tests proving a missing local secret with existing remote client-secret records creates a
  new current-machine client secret instead of failing with an import/rotate error.
- Add tests proving an existing local secret is preserved by default and no new remote
  client-secret record is created.
- Add tests proving current-machine rotation creates a replacement remote client-secret record and
  overwrites only the current local sink after the explicit rotation/overwrite gate.
- Add CLI tests for the machine label option, interactive confirmation, non-interactive required
  flags, and failure messages when the label is invalid or required identity evidence is missing.
- Add tests proving repo bootstrap fan-out reuses a single authenticated operator session where the
  implementation supports it while still creating separate per-machine Universal Auth client
  secrets for repo bootstrap and deployment identities.
- Add idempotency tests proving repeated top-level setup, including any `i`-invoked secret
  readiness path, leaves existing current-machine credentials unchanged and does not affect other
  mocked machine records.
- Keep existing first-bootstrap metadata handoff, constant-scoped patch, incomplete-output,
  fan-out consistency, SprinkleRef check, and docs regression tests passing.

### 5. Docs to be added or updated

- Update `docs/history/designs/infisical-design.md` to describe the final credential model: shared Infisical
  identities, per-machine Universal Auth client-secret records, and local-only storage of the
  current machine's secret.
- Update `docs/infisical-bootstrap.md` and `infisical-bootstrap.md` so fresh-start guidance no
  longer tells operators to import another user's shared secret when remote records already exist.
- Document how a second user or a second machine should run the top-level setup flow, what gets
  created remotely, what is stored locally, and why other machines are not affected.
- Document rotation and revocation semantics for current-machine credentials, including when to use
  `--machine-label`, when to rotate, and how to clean up stale remote client-secret records in the
  Infisical UI or API if supported.
- Update troubleshooting for deleted local credentials, deleted remote client-secret records,
  hostname changes, and reruns after a local reset.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes focused on Universal Auth credential lifecycle, repo/deployment bootstrap
  orchestration, top-level setup idempotency, reporting, and docs. Do not change public backend
  selector syntax, reviewed metadata handoff patching, Sample webapp project/resource definitions,
  Cloudflare secret requirements, Vault behavior, or stable secret ref names except where needed to
  remove the obsolete shared-secret mismatch public behavior.

### 6. Acceptance criteria

- A fresh machine can run the top-level Infisical setup flow when remote client-secret records
  already exist and receive its own local Universal Auth credentials without manual secret import.
- Existing local credentials are preserved by default and repeated setup is idempotent for the
  current machine.
- Rotation affects only the current machine's local credential and creates a clearly labeled new
  remote client-secret record.
- Existing remote client-secret records for other machines are reported as context, not treated as
  conflicts.
- Old shared-secret import-oriented errors and public guidance are removed or replaced with the
  per-machine setup model.
- Focused repo/deployment bootstrap credential lifecycle tests pass.
- The repository validation suite passes.

### 7. Risks

- Creating a new client-secret record for every fresh machine can leave stale records in Infisical
  if operators frequently reset local state or change machine labels.
- Hostname-derived labels may be unstable across machine renames or CI environments.
- If Infisical does not expose enough metadata for existing client-secret records, revocation
  guidance may remain partly manual.
- Reusing one operator login across repo and deployment fan-out can couple phases if session
  isolation is handled carelessly.

### 8. Mitigations

- Require explicit current-machine rotation for overwrites and print concise summaries of created
  client-secret labels.
- Support an explicit `--machine-label` so operators can choose stable labels independent of
  hostname.
- Keep secret values local-only and never print or commit generated secret material.
- Keep session reuse behind a narrow authenticated-client abstraction with tests proving one login
  can serve the full top-level flow without leaking local credential values between identities.
- Document stale-record cleanup as an operator task until an audited revocation command is designed.

### 9. Consequences of not implementing this PR

Every additional machine or user will keep hitting a confusing remote-record/local-secret mismatch:
the remote Infisical identity has a client-secret record, but the local machine cannot recover the
secret value and is told to import or rotate shared credentials. That makes the first-run path feel
fragile and encourages manual sharing of long-lived secrets.

### 10. Downsides for implementing this PR

The bootstrap credential lifecycle becomes more explicit and may create more remote client-secret
records over time. Operators will need clear cleanup guidance for stale machine credentials, and
the implementation must avoid presenting per-machine records as reviewed deployment metadata.

## PR-45: Bootstrap retry command preserves credential intent

### 1. Intent

Close the post-PR-44 assessment gap where bootstrap preflight retry guidance can drop the
operator's credential intent. A retry command printed after a blocked non-interactive run must
preserve PR-44 credential lifecycle flags such as the machine label, bootstrap credential rotation,
deployment credential rotation, and local overwrite confirmation so following the command cannot
silently switch to a different per-machine credential setup path.

### 2. Scope of changes

- Update bootstrap retry command construction so it carries forward credential-affecting flags from
  the original invocation when suggesting a mutation-capable retry.
- Preserve `--machine-label <value>` in generated retry commands when the operator supplied one.
- Preserve `--rotate-bootstrap-credentials`, `--rotate-deployment-credentials`, and
  `--force-overwrite-local-credentials` when those flags were present on the original command.
- Continue adding the required `--yes` confirmation for non-interactive mutation-capable retry
  guidance.
- Preserve existing mode and target behavior for `repo` and `deployment --target ...` retry
  commands.
- Do not include dry-run-only flags, generated local paths, secret values, environment variable
  values, or unrelated diagnostic options in retry guidance.
- Keep PR-44 per-machine credential lifecycle behavior unchanged; this PR only fixes retry command
  fidelity and coverage.

### 3. External prerequisites

- None. This is hermetic command-construction and test work.
- No live Infisical, OpenTofu network access, macOS Keychain, Vault, Cloudflare, browser
  automation, or real host-specific state should be required.

### 4. Tests to be added

- Add preflight retry-command tests proving `--machine-label` is preserved with proper argument
  quoting/escaping.
- Add tests proving bootstrap and deployment rotation flags are preserved in retry guidance.
- Add tests proving `--force-overwrite-local-credentials` is preserved only when supplied.
- Add tests for both repo mode and deployment target mode so target/mode behavior stays intact.
- Add negative tests proving dry-run-only or unrelated flags are not copied into mutation retry
  guidance.
- Keep existing preflight resolver, args-auth, PR-44 credential lifecycle, and repo-flow tests
  passing.

### 5. Docs to be added or updated

- Update `docs/infisical-bootstrap.md` or `infisical-bootstrap.md` troubleshooting if the retry
  command examples mention machine labels or rotation flags.
- No broad design-doc rewrite is expected unless implementation reveals a new retry-command
  invariant that should be captured.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to bootstrap retry command construction, targeted tests, and small docs
  clarification if needed. Do not change Universal Auth credential creation, local sink storage,
  reviewed metadata handoff, deployment fan-out execution, public backend selector syntax, stable
  secret refs, or Infisical OpenTofu resource definitions.

### 6. Acceptance criteria

- A blocked bootstrap run that includes `--machine-label` prints a retry command with the same
  machine label and required `--yes`.
- A blocked bootstrap run that includes credential rotation or local overwrite flags prints a retry
  command preserving those credential-affecting flags.
- Retry commands still preserve repo/deployment mode and deployment target selection.
- Retry commands do not copy dry-run-only, secret-bearing, or unrelated flags.
- Focused preflight retry-command tests pass.
- The repository validation suite passes.

### 7. Risks

- Copying too many original flags can make retry guidance noisy or accidentally expose local-only
  paths.
- Copying too few flags can keep producing semantic drift between the original invocation and the
  suggested retry.
- Shell quoting can become brittle for machine labels containing spaces or punctuation.

### 8. Mitigations

- Maintain an explicit allowlist of retry-preserved flags instead of copying arbitrary argv.
- Treat credential-affecting flags as the only PR-44-specific retry-preserved flags.
- Reuse the existing retry command quoting helper or add focused tests for labels that require
  quoting.

### 9. Consequences of not implementing this PR

Operators can follow a generated retry command after a blocked non-interactive bootstrap and
accidentally omit the machine label or rotation intent from their original command. That can create
or rotate per-machine credentials under a different label or with different lifecycle semantics than
the operator requested.

### 10. Downsides for implementing this PR

Retry guidance becomes slightly longer when credential-affecting flags are present. The command
construction also needs a small allowlist that must be updated if future credential lifecycle flags
are added.

## PR-46: Retry allowlist and setup idempotency closure

### 1. Intent

Close the post-PR-45 assessment gaps by making retry guidance strictly credential-intent-only for
preserved flags and by proving the top-level per-machine setup path is idempotent across repeated
runs. Also remove remaining Sample webapp Infisical README guidance that still implies operators should
recover or import old shared local credential values.

### 2. Scope of changes

- Tighten bootstrap retry command construction so it preserves only mode/target selection,
  credential-affecting PR-44 flags, and the required `--yes` confirmation.
- Remove `--tofu-dir`, `--tofu-plan-file`, custom `--local-credential-file`, and any other local
  path flags from generated mutation retry guidance.
- Keep preserving `--machine-label`, `--rotate-bootstrap-credentials`,
  `--rotate-deployment-credentials`, and `--force-overwrite-local-credentials` when supplied.
- Add or adjust tests so generated retry commands prove local/generated path flags are omitted even
  when the original invocation used custom paths.
- Add a focused repeated top-level setup test around repo bootstrap plus deployment fan-out proving
  a second run reuses existing current-machine repo and deployment credentials, creates no new
  remote client-secret records, and leaves mocked other-machine remote records untouched.
- Keep the lower-level PR-44 credential lifecycle behavior unchanged.
- Update `projects/deployments/sample-webapp/infisical/README.md` so missing local deployment
  credential guidance matches the per-machine model: rerun top-level setup to create current-machine
  credentials, rotate explicitly when desired, and do not import another user's shared secret.
- Preserve the PR-45 docs section in `docs/history/plans/infisical-plan.md` and add this PR as the only new plan
  section required by the assessments.

### 3. External prerequisites

- None. This is hermetic retry-command, repo-flow test, and documentation cleanup work.
- No live Infisical, OpenTofu network access, macOS Keychain, Vault, Cloudflare, browser
  automation, or real host-specific state should be required.

### 4. Tests to be added

- Add retry-command negative tests proving `--tofu-dir`, `--tofu-plan-file`, and custom
  `--local-credential-file` are not copied into mutation retry guidance.
- Keep positive retry-command tests for mode, target, `--machine-label`, rotation flags,
  overwrite flag, and `--yes`.
- Add a repeated repo bootstrap fan-out test showing current-machine repo/deployment credentials are
  reused on rerun and no extra remote client-secret creations occur.
- In the repeated setup test, include existing mocked other-machine remote records and prove they are
  not modified or treated as conflicts.
- Keep focused preflight retry-command, repo-flow, PR-44 credential lifecycle, and taxonomy tests
  passing.

### 5. Docs to be added or updated

- Update `projects/deployments/sample-webapp/infisical/README.md` to remove stale import/recover
  language for missing local Universal Auth credentials.
- Update `docs/infisical-bootstrap.md` or `infisical-bootstrap.md` only if the implementation
  changes operator-facing retry or rerun guidance beyond what PR-44 and PR-45 already documented.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to retry command allowlisting, top-level setup idempotency tests, and
  Sample webapp Infisical README cleanup. Do not change Universal Auth credential creation semantics,
  reviewed metadata handoff, deployment resource definitions, public backend selector syntax,
  stable secret refs, Vault behavior, or Cloudflare secret requirements.

### 6. Acceptance criteria

- Retry commands no longer include `--tofu-dir`, `--tofu-plan-file`, custom
  `--local-credential-file`, or other local/generated path flags.
- Retry commands still preserve mode/target selection, `--machine-label`, rotation flags,
  overwrite flag, and `--yes`.
- Repeated top-level repo bootstrap plus deployment fan-out reuses existing current-machine
  credentials without creating new remote client-secret records.
- Existing mocked other-machine remote records remain untouched and non-conflicting on rerun.
- Sample webapp Infisical README no longer tells operators to recover/import old shared local credential
  values for the per-machine setup path.
- Focused retry-command, repo-flow, and docs/taxonomy tests pass.
- The repository validation suite passes.

### 7. Risks

- Removing local path flags from retry guidance can make advanced debugging retries less exact for
  operators who intentionally passed custom OpenTofu paths.
- A top-level rerun test can become fixture-heavy if it tries to simulate too much live bootstrap
  behavior.
- README cleanup could accidentally remove useful recovery guidance for unrelated OpenTofu state or
  application secrets.

### 8. Mitigations

- Keep retry guidance focused on the normal mutation path; advanced local path overrides can remain
  documented as explicit manual rerun options if needed, but should not be copied automatically.
- Build the repeated setup test around the narrow repo bootstrap and deployment credential fan-out
  seams already used by PR-44 tests.
- Edit only the Universal Auth local credential guidance in the Sample webapp README and leave unrelated
  OpenTofu or application secret guidance intact.

### 9. Consequences of not implementing this PR

Generated retry commands can continue to carry local machine paths forward and the PR-44 top-level
idempotency guarantee remains indirectly tested. Operators may also keep seeing stale README
guidance that suggests recovering or importing shared credential values instead of creating
current-machine credentials.

### 10. Downsides for implementing this PR

The retry command becomes less exhaustive for unusual manual invocations, and the repo-flow tests
gain another fixture path that must be maintained as bootstrap orchestration changes.

## PR-47: Lazy Infisical readiness from install-deps

### 1. Intent

Make `i` the normal first-run and daily-run entrypoint for local Infisical readiness so operators do
not need to know or type deep bootstrap script paths. The install step should lazily ensure only
local resolver and per-machine Universal Auth readiness, prompt to run repo bootstrap only when
those local prerequisites are missing, and remain fast and non-surprising once the machine is ready.

### 2. Scope of changes

- Add a narrow secret-readiness phase to `build-tools/tools/dev/install-deps.ts` after normal
  dependency setup or at another low-surprise point in the `i` flow.
- The readiness phase must check only local setup needed for repo/deployment secret resolution:
  `sprinkleref/selected.local.json` or equivalent resolver config, repo bootstrap Universal Auth
  credentials in the selected local sink, and Sample webapp deployment Universal Auth credentials for the
  current machine.
- Do not use full `sprinkleref --check` as the lazy readiness gate. Application secrets such as
  Cloudflare tokens may still be intentionally missing and must not force `i` to fail or bootstrap.
- If the local readiness check passes, `i` should produce no extra noisy output beyond optional
  verbose diagnostics and should not run browser/login-capable bootstrap.
- If local readiness is missing and the shell is interactive, prompt once with a concise `[Y/n]`
  gate to run the repo bootstrap flow internally.
- If confirmed, invoke the existing repo bootstrap implementation as an internal helper in repo mode
  with deployment fan-out enabled by default so it can create this machine's repo and deployment
  Universal Auth credentials.
- Reuse PR-44 through PR-46 per-machine behavior: existing local credentials are preserved, missing
  current-machine credentials are created, other-machine records are not conflicts, and retry
  guidance preserves credential intent without local path leakage.
- If local readiness is missing in a non-interactive shell, fail with a short actionable message
  unless the operator supplied an explicit install flag such as `i --yes` or an environment variable
  explicitly allowing setup.
- Add install-deps flags for secret readiness control:
  `--without-secrets` to skip the readiness/setup phase, `--yes` to allow non-interactive setup,
  `--machine-label <label>` to forward the per-machine label, and rotation flags only if they are
  explicitly useful from `i`.
- Forward credential-affecting flags from `i` to the internal repo bootstrap call; do not expose or
  require deep bootstrap script paths for normal use.
- Keep the deep `build-tools/tools/deployments/infisical-bootstrap.ts` commands available as
  advanced/debug entrypoints, but make docs treat `i` as the canonical setup path.
- Ensure CI, test workers, and non-deployment-focused local runs can opt out cleanly with
  `--without-secrets` or a documented environment variable so ordinary dependency setup does not
  unexpectedly require Infisical access.

### 3. External prerequisites

- Live first-run smoke testing requires an Infisical organization and operator login, but automated
  tests must not require live Infisical, macOS Keychain, OpenTofu network access, Vault, Cloudflare,
  browser automation, or real host-specific state.
- Tests may use fake local sinks, temp repo workspaces, mocked readiness probes, and mocked
  bootstrap invocation seams.

### 4. Tests to be added

- Add install-deps tests proving a ready machine skips bootstrap and produces minimal output.
- Add tests proving missing local resolver config or missing per-machine Universal Auth credentials
  triggers an interactive prompt and, when confirmed, calls repo bootstrap with deployment fan-out.
- Add tests proving declining the prompt leaves dependency install successful or failed according to
  the chosen UX, but prints a clear command-free remediation path through `i`.
- Add non-interactive tests proving missing readiness fails with a concise message unless `--yes` or
  the documented environment override is supplied.
- Add tests proving `--without-secrets` skips readiness and bootstrap calls entirely.
- Add tests proving `--machine-label`, rotation flags if supported, and `--yes` are forwarded to the
  internal repo bootstrap call without forwarding local path or debug-only flags.
- Add tests proving full application secret absence does not trigger or fail the `i` readiness phase
  when resolver config and local Universal Auth credentials are present.
- Keep existing install-deps dependency setup tests, PR-44 credential lifecycle tests, PR-45/46 retry
  tests, and bootstrap repo-flow tests passing.

### 5. Docs to be added or updated

- Update `docs/infisical-bootstrap.md`, `infisical-bootstrap.md`, and any concise onboarding docs so
  the recommended local setup path is `i`, not the deep bootstrap script path.
- Document `i --without-secrets`, `i --yes`, and `i --machine-label <label>` behavior.
- Keep deep bootstrap commands documented as advanced recovery/debug commands, not the normal new
  user path.
- Document that `i` checks only local resolver and per-machine Universal Auth readiness, not
  application secret completeness.
- Update troubleshooting for fresh machines, missing local Keychain entries, stale local
  credentials, and CI/non-interactive runs to point at the new lazy `i` behavior.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes focused on `i`/install-deps orchestration, a narrow local secret-readiness helper,
  bootstrap invocation wiring, tests, and docs. Do not change Universal Auth credential lifecycle,
  reviewed metadata handoff, deployment resource definitions, public backend selector syntax,
  stable secret refs, Vault behavior, Cloudflare secret requirements, or the normal build/verify
  behavior beyond the explicit lazy readiness phase.

### 6. Acceptance criteria

- A fresh interactive machine can run `i`, accept the prompt, complete Infisical repo bootstrap, and
  end with local resolver plus current-machine repo/deployment Universal Auth credentials ready.
- A ready machine can run `i` repeatedly without prompting, opening browser login, creating new
  credentials, or producing noisy secret setup output.
- Non-interactive `i` fails clearly when local secret readiness is missing unless explicitly allowed
  with `--yes` or the documented override.
- `i --without-secrets` skips all secret readiness and bootstrap work.
- `i` never fails merely because application secrets such as Cloudflare tokens are absent.
- Machine label and any supported credential lifecycle flags are forwarded to repo bootstrap.
- Deep bootstrap commands remain available for advanced recovery.
- Focused install-deps and bootstrap orchestration tests pass.
- The repository validation suite passes.

### 7. Risks

- Adding secret readiness to `i` can make a high-frequency command feel surprising if prompts appear
  too often or checks are too slow.
- The boundary between local credential readiness and full application secret completeness can be
  confusing if output is not precise.
- CI and temp-repo tests can break if the readiness phase is not easy to disable or mock.
- Invoking browser/login-capable bootstrap from `i` can be disruptive if the interactivity check is
  too permissive.

### 8. Mitigations

- Make the readiness probe local and cheap, and print nothing on the happy path unless verbose mode
  is enabled.
- Keep bootstrap behind an explicit interactive `[Y/n]` gate or an explicit non-interactive allow
  flag.
- Provide `--without-secrets` and a documented environment opt-out for automation.
- Test the readiness phase through a small injected seam so install-deps tests do not require live
  Infisical or real keychain state.
- Make operator-facing messages distinguish "local credentials are not ready" from "application
  secrets are missing."

### 9. Consequences of not implementing this PR

New users will still need to discover and run a deep deployment bootstrap script before ordinary
repo validation works against Infisical-backed deployment tooling. That keeps the setup path
unnecessarily procedural even though PR-44 through PR-46 made the underlying credential model safe
for multi-user lazy setup.

### 10. Downsides for implementing this PR

`i` becomes responsible for one more local readiness concern and will need careful tests to avoid
making dependency installation depend on live deployment services. Some advanced operators may also
need to learn `--without-secrets` when they intentionally want dependency setup without any secret
readiness checks.

## PR-48: Slice-safe lazy Infisical readiness

### 1. Intent

Close the PR-47 sliceability gap so adding lazy Infisical readiness to `i` does not make dependency
installation fail in minimized, sparse, or partial-clone workspaces that do not include the
Sample webapp deployment family or Infisical bootstrap implementation files. Secret readiness should be
capability-gated by checked-out deployment metadata: if the checkout does not contain the Infisical
deployment family, `i` should treat secret readiness as not applicable rather than missing.

### 2. Scope of changes

- Add an applicability check before any Infisical/deployment-specific readiness imports or file
  reads. The check should use cheap filesystem probes for the deployment metadata needed by PR-47,
  especially `projects/deployments/sample-webapp/shared/family.bzl`.
- If the required deployment metadata is absent, skip the lazy Infisical readiness phase without
  error. In non-verbose mode this should be quiet; in verbose mode it may print a concise
  "not applicable in this checkout" diagnostic.
- Ensure `i --glue-only`, `i --dry-run`, and `i --without-secrets` continue to skip the readiness
  phase before any deployment-specific imports or probes that could fail in partial clones.
- Convert static deployment/Infisical imports in the install-deps readiness path to dynamic imports
  after the applicability gate, or otherwise isolate them so sparse clones missing deployment-owned
  files do not fail at module load time.
- Keep full checkout behavior unchanged: when the Sample webapp deployment metadata is present,
  PR-47 readiness should still check resolver config and current-machine Universal Auth credentials,
  prompt or bootstrap when missing, and ignore application secret completeness.
- Preserve PR-44 through PR-46 credential lifecycle and retry behavior. This PR is only about making
  the PR-47 lazy integration safe for slices that do not contain deployment metadata.
- Keep any existing partial-clone language/importer discovery behavior intact. Do not broaden
  install-deps language discovery, provider sync, or dependency setup scope.

### 3. External prerequisites

- None. This is hermetic install-deps gating and test work.
- Automated tests must not require live Infisical, macOS Keychain, OpenTofu network access, Vault,
  Cloudflare, browser automation, or a full repository checkout.

### 4. Tests to be added

- Add a temp partial-clone or minimized-workspace test where `projects/deployments/sample-webapp/` is
  absent and `i` or the install-deps secret-readiness phase succeeds without `sprinkleref`,
  Infisical credentials, deployment metadata, or bootstrap files.
- Add a test proving the absent-deployment-metadata path does not call the readiness probe,
  credential sink, or bootstrap invocation seam.
- Add a verbose-mode test proving the absent-deployment-metadata path reports a concise
  not-applicable diagnostic without treating the checkout as misconfigured.
- Add tests proving `--glue-only`, `--dry-run`, and `--without-secrets` skip before dynamic
  deployment imports.
- Keep PR-47 full-checkout tests passing, including ready-machine quiet path, missing resolver
  prompt, non-interactive `--yes`/environment override, and application-secret absence behavior.
- Keep existing partial-clone/importer discovery tests passing.

### 5. Docs to be added or updated

- Update `docs/infisical-bootstrap.md`, `infisical-bootstrap.md`, or concise onboarding docs to
  state that lazy `i` secret readiness is capability-gated by checked-out deployment metadata.
- Document that partial clones or minimized workspaces without the Sample webapp Infisical deployment
  family skip Infisical readiness automatically and do not require `--without-secrets`.
- Keep `--without-secrets` documented as an explicit opt-out for full checkouts or automation that
  intentionally wants dependency setup without secret readiness.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to install-deps secret-readiness applicability gating, dynamic import or
  module-boundary isolation, targeted partial-clone tests, and small docs updates. Do not change
  Universal Auth credential lifecycle, bootstrap resource creation, reviewed metadata handoff,
  deployment resource definitions, public backend selector syntax, stable secret refs, Vault
  behavior, Cloudflare secret requirements, or language/importer discovery semantics.

### 6. Acceptance criteria

- A partial clone or minimized workspace without `projects/deployments/sample-webapp/shared/family.bzl`
  can run `i`/install-deps without Infisical readiness errors.
- The absent-deployment-metadata path is quiet by default and does not prompt, open browser login,
  read credential sinks, or call repo bootstrap.
- Verbose mode reports a concise not-applicable reason when readiness is skipped because deployment
  metadata is absent.
- `i --glue-only`, `i --dry-run`, and `i --without-secrets` skip secret readiness before
  deployment-specific imports.
- Full checkout PR-47 behavior remains unchanged.
- Focused partial-clone and install-deps readiness tests pass.
- The repository validation suite passes.

### 7. Risks

- A too-broad applicability gate could skip secret readiness in a full checkout where deployment
  metadata exists but local resolver or credential state is actually missing.
- Dynamic imports can make errors less obvious if import failures are accidentally swallowed after
  the feature is applicable.
- Partial-clone tests can become brittle if they depend on an exact sparse workspace fixture shape.

### 8. Mitigations

- Gate only on clear absence of the reviewed deployment metadata file or directory, not on missing
  local resolver config or credentials.
- After the applicability gate passes, treat import failures and malformed metadata as real
  readiness/setup errors instead of not-applicable skips.
- Keep the partial-clone fixture minimal and assert behavior through the install-deps readiness seam
  rather than depending on unrelated language providers.

### 9. Consequences of not implementing this PR

PR-47 can make `i` less partial-clone-friendly than the existing install flow by assuming Sample webapp
deployment metadata and Infisical bootstrap modules exist in every checkout. That would break the
repo's sliceability expectations and force users of minimized workspaces to learn secret-specific
opt-outs even when deployment secrets are irrelevant to their slice.

### 10. Downsides for implementing this PR

The install-deps readiness path gains an additional applicability layer and dynamic import boundary.
This adds a small amount of complexity, but it keeps the common `i` entrypoint safe for both full
deployment workspaces and narrow partial clones.

## PR-49: Fail closed on malformed lazy readiness metadata

### 1. Intent

Close the PR-48 assessment gap where lazy `i` secret readiness correctly gates on absent Sample webapp
deployment metadata, but can still collapse malformed present metadata into a generic "missing local
credentials" state. Once the slice applicability gate has established that
`projects/deployments/sample-webapp/shared/family.bzl` is present, parse errors, import errors, and
malformed reviewed constants must be treated as repository metadata defects rather than as
not-ready local machine state.

### 2. Scope of changes

- Narrow the `probeLocalSecretReadiness` error handling so only actual resolver/credential absence
  is reported as local secret readiness missing.
- Let reviewed metadata parsing failures from
  `build-tools/tools/deployments/infisical-iac-bootstrap-reviewed-metadata.ts` propagate with their
  original error messages after the applicability gate passes.
- Preserve PR-48 absent-metadata behavior: minimized workspaces missing
  `projects/deployments/sample-webapp/shared/family.bzl` still skip readiness quietly by default and
  report a concise not-applicable reason in verbose mode.
- Preserve PR-47 local readiness behavior for valid full checkouts: missing resolver config or
  missing current-machine Universal Auth credentials should still prompt or fail with the existing
  local-credentials remediation.
- Do not change Universal Auth credential lifecycle, bootstrap resource creation, reviewed metadata
  handoff semantics, deployment resource definitions, public backend selector syntax, stable secret
  refs, Vault behavior, Cloudflare secret requirements, or partial-clone language/importer
  discovery.

### 3. External prerequisites

- None. This is hermetic install-deps error-classification and test work.
- Automated tests must not require live Infisical, macOS Keychain, OpenTofu network access, Vault,
  Cloudflare, browser automation, or real host-specific state.

### 4. Tests to be added

- Add an install-deps secret-readiness test with present
  `projects/deployments/sample-webapp/shared/family.bzl` containing malformed reviewed metadata, proving
  the original metadata parse error propagates instead of returning `ready: false`.
- Add or update a test proving valid present metadata with missing local credentials still reports
  missing local credentials and triggers the existing prompt/bootstrap path.
- Keep the PR-48 absent-metadata, verbose not-applicable, metadata access-failure, `--glue-only`,
  `--dry-run`, and `--without-secrets` tests passing.
- Keep PR-47 full-checkout tests passing, including ready-machine quiet path, missing resolver
  prompt, non-interactive `--yes`/environment override, and application-secret absence behavior.

### 5. Docs to be added or updated

- Update `docs/infisical-bootstrap.md`, `infisical-bootstrap.md`, or concise onboarding docs only if
  operator-facing troubleshooting text needs to distinguish malformed checked-in metadata from
  missing local credentials.
- Keep existing partial-clone and `--without-secrets` documentation unchanged unless the error text
  changes.

### 5.5. Expected regression scope

- `deployment-only`
- Keep changes limited to lazy install-deps secret-readiness error classification, targeted tests,
  and any necessary troubleshooting doc clarification.

### 6. Acceptance criteria

- In a full checkout where `family.bzl` is present but reviewed Infisical metadata is malformed,
  `i`/install-deps fails with a metadata/configuration error rather than prompting for local
  credentials or invoking repo bootstrap.
- In a minimized checkout where `family.bzl` is absent, `i`/install-deps still treats Infisical
  readiness as not applicable.
- In a valid full checkout with missing local resolver or Universal Auth credentials,
  `i`/install-deps still follows the PR-47 prompt/bootstrap path.
- Focused install-deps secret-readiness tests pass.
- The repository validation suite passes.

### 7. Risks

- Over-tightening error handling could turn genuine local credential absence into a hard metadata
  error, making fresh-machine setup harder.
- Over-broad error propagation could leak implementation details in user-facing `i` output.

### 8. Mitigations

- Classify errors at the narrowest seam: metadata parsing/import failures propagate, while explicit
  resolver and credential lookup absence remains a local readiness miss.
- Assert both malformed-metadata and missing-local-credential cases in focused tests so the two
  paths cannot regress into each other.
- Keep user-facing error messages concise and non-secret.

### 9. Consequences of not implementing this PR

Malformed checked-in Sample webapp Infisical metadata can be masked as a local machine setup problem.
That makes repository defects harder to diagnose and can send users into unnecessary bootstrap or
credential rotation flows.

### 10. Downsides for implementing this PR

The readiness probe needs slightly more precise error classification. That is a small increase in
complexity, but it preserves the important distinction between partial-clone non-applicability,
fresh-machine local readiness, and real repository metadata defects.

## PR-50: Adopt existing Infisical deployment projects during lazy bootstrap

### 1. Intent

Fix the live first-run failure where `i` can successfully create local repo bootstrap credentials
and then fail during deployment fan-out because the reviewed `sample-webapp-deployments` Infisical
project already exists remotely but is not present in the local OpenTofu state. Lazy bootstrap should
be idempotent for both fresh repos and repos where an operator has already created the reviewed
Infisical project.

### 2. Scope of changes

- Before deployment OpenTofu planning, query Infisical for a project matching the reviewed Sample webapp
  project name or slug in the selected organization.
- When that project exists, pass its project id into the OpenTofu module and skip creating the
  `infisical_project` resource.
- Detect reviewed environments that already exist and skip creating only those environment
  resources, while still creating missing reviewed environments.
- Preserve normal create behavior when the reviewed project does not exist.
- Preserve repo bootstrap credential lifecycle, per-machine Universal Auth secrets, deployment
  credential storage, metadata handoff, reviewed secret refs, and deployment target discovery.

### 3. External prerequisites

- None beyond the existing authenticated Infisical bootstrap session.
- The fix must be covered with hermetic tests and must not require a live Infisical account.

### 4. Tests to be added

- Add focused tests proving existing project lookup by reviewed slug/name returns an adoption id and
  existing environment slugs.
- Add focused tests proving OpenTofu receives adoption variables and therefore plans against an
  existing project instead of always attempting `infisical_project` creation.
- Keep existing bootstrap repo fan-out, metadata handoff, retry command, and OpenTofu failure tests
  passing.

### 5. Docs to be added or updated

- Update this plan to record the idempotency follow-up.
- Update operator docs only if user-facing bootstrap output or remediation text changes.

### 5.5. Expected regression scope

- `deployment-only`
- Changes should be limited to deployment Infisical bootstrap project adoption, the Sample webapp
  OpenTofu module, and targeted tests.

### 6. Acceptance criteria

- If `sample-webapp-deployments` already exists remotely but is absent from local OpenTofu state, `i`
  does not fail with `A project with the slug "sample-webapp-deployments" already exists`.
- If reviewed `staging` or `prod` environments already exist, bootstrap does not attempt to create
  duplicates for those environments.
- If the project does not exist, bootstrap still creates the project and reviewed environments.
- Focused bootstrap/OpenTofu adoption tests pass.
- The repository validation suite passes.

### 7. Risks

- Adopting an existing project by name or slug could hide a wrong project if an operator created an
  unrelated project with the reviewed slug.
- Skipping existing environments means OpenTofu will not manage already-created environment
  metadata in state.

### 8. Mitigations

- Only adopt projects in the selected organization that match the reviewed name or slug.
- Continue reconciling reviewed deployment metadata after apply so wrong project ids still surface
  as metadata handoff/drift.
- Keep the adoption path narrow and limited to the reviewed Sample webapp bootstrap project and
  environments.

### 9. Consequences of not implementing this PR

Fresh-machine setup through `i` remains brittle after manual cleanup or partial remote setup. Users
can hit a remote slug uniqueness error even though the desired reviewed project already exists and
should be reused.

### 10. Downsides for implementing this PR

The OpenTofu module becomes slightly more conditional because it supports both create and adopt
paths. This is a reasonable tradeoff for making the single top-level `i` path resilient.
