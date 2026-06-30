# Control Plane Selector Plan

Status: historical implementation plan. The active operator-facing model is documented in
[Control Plane Selector Design](../../control-plane-selector.md),
[Deployments Usage](../../deployments-usage.md), and
[AWS Control Plane Setup Guide](../../control-plane-guide.md). Keep this file for implementation
traceability; do not treat older PR sections in this file as current setup instructions.

This plan implements [Control Plane Selector Design](../../control-plane-selector.md).

Reviewed context:

- This is a clean cut-over. There are no backwards-compatibility shims for the current ambient
  `VBR_DEPLOY_CONTROL_PLANE_URL`, `--remote mini`, or single repo-global endpoint behavior when a
  deployment context selects a control plane.
- `projects/config/shared.json` is the checked-in source of shared deployment topology.
  `projects/config/local.json` remains the gitignored per-operator override file.
- `secret://...` is required for control-plane service tokens stored in SprinkleRef, Infisical,
  Vault, Keychain, or another secret backend.
- `runtime://...` is allowed for control-plane service tokens supplied by the selected runtime host
  contract, such as mounted credentials or CI secret bindings.
- Control-plane URLs, domains, account ids, organization ids, project refs, regions, and selected
  control-plane names are shared config, not secrets.

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no backwards-compatibility aliases for old control-plane selection behavior
- no plaintext control-plane service tokens in shared config, local config, command output, or
  evidence
- no app-package-owned control-plane selection
- no broad provider rewrite beyond protected/shared front-door selection
- no infrastructure provisioning changes for creating new control-plane hosts
- no replacement of SprinkleRef, Infisical, Vault, or current runtime-host credential delivery

Verify-scope organization:

- The implementation should stay under:
  - `build-tools/tools/deployments/**`
  - `build-tools/tools/tests/deployments/**`
  - `projects/config/**`
  - `docs/**`
- If a shared CLI helper change under `build-tools/tools/lib/**` is needed, keep it narrow and
  document why it is generic CLI behavior rather than deployment-control-plane-specific logic.
- Do not hide build-system, Nix, or provider-IaC changes inside this plan.

Each PR below must update this plan if implementation changes invalidate the remaining scope or
assumptions.

## PR-1: Control-plane profiles in project config and deployment context resolution

### 1. Intent

Add first-class control-plane profiles to canonical project config and make deployment context
resolution attach a normalized selected control-plane service client to deployment graph nodes,
without yet changing protected/shared execution routing.

### 2. Scope of changes

- Extend the project config type to include a checked-in `controlPlanes` section.
- Define the accepted control-plane profile shape:
  - `serviceClient.controlPlaneUrl`
  - `serviceClient.controlPlaneTokenRef`
  - optional `records.backend`, initially accepting only `service`
- Extend deployment context validation to accept and validate `controlPlane`.
- Resolve `deploymentContexts.<name>.controlPlane` against `controlPlanes`.
- Attach derived graph-node metadata:
  - `control_plane.name`
  - `control_plane.service_client.control_plane_url`
  - `control_plane.service_client.control_plane_token_ref`
  - `control_plane.records.backend`
- Keep app packages backend-neutral. App metadata must not set `control_plane`, `controlPlane`,
  `controlPlaneUrl`, or token refs directly.
- Reject unknown control-plane selectors.
- Reject malformed `controlPlanes` entries:
  - missing `serviceClient`
  - missing or invalid `controlPlaneUrl`
  - missing `controlPlaneTokenRef`
  - token refs that are not `secret://...` or `runtime://...`
  - plaintext token-shaped fields such as `controlPlaneToken`, `token`, or `bearerToken`
  - unsupported `records.backend` values
- Reuse the existing protected/shared service transport validator for `controlPlaneUrl` validation
  where possible.
- Preserve current local override detection and redaction for `projects/config/local.json`.
- Do not change `--control-plane-url` or `VBR_DEPLOY_CONTROL_PLANE_URL` execution behavior in this
  PR. Later PRs intentionally cut `--remote <name>` over to named control-plane profile selection.

### 3. External prerequisites

- None. This PR only adds config parsing, validation, normalized graph metadata, tests, and docs.
- Existing deployment extraction and graph-node tests must be available to assert resolved context
  metadata.

### 4. Tests to be added

- Add project config tests proving valid `controlPlanes` entries are accepted.
- Add deployment context resolution tests proving a context selector attaches normalized
  `control_plane` metadata to a deployment graph node.
- Add tests proving two deployment contexts can resolve to two different control-plane profiles in
  the same repo.
- Add negative tests for unknown `deploymentContexts.<name>.controlPlane`.
- Add negative tests for malformed profile shape, missing URL, missing token ref, unsupported
  `records.backend`, and invalid URL transport.
- Add secret-classification tests proving plaintext token-shaped fields are rejected in shared and
  local project config.
- Add token-ref tests proving `secret://...` and `runtime://...` are accepted, while `config://...`
  and plaintext token strings are rejected.
- Add local override diagnostics tests proving local overrides of control-plane profile fields are
  reported with redaction for token-like fields.
- Add app-boundary tests proving app packages cannot declare control-plane selection directly.

### 5. Docs to be added or updated

- Update [Control Plane Selector Design](../../control-plane-selector.md) if the normalized field names or
  validation rules differ from the design while implementing.
- Update [SprinkleRef Resolver](../../sprinkleref.md) to list `controlPlanes` as checked-in shared
  topology and to reinforce the `secret://`/`runtime://` classification for service tokens.
- Update deployment context docs in [SprinkleRef Resolver](../../sprinkleref.md) so `controlPlane` is
  documented alongside `secretBackend`, `aws`, `infisical`, `supabase`, and `cloudflare`.
- Update this plan if implementation discovers a narrower or broader required graph-node shape.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/project-config.ts`
  - `build-tools/tools/deployments/deployment-contexts.ts`
  - `build-tools/tools/deployments/deployment-context-validation.ts`
  - `build-tools/tools/tests/deployments/deployment-contexts*.ts`
  - `docs/**`
- Keep changes focused on config loading, context validation, normalized metadata, and docs/tests.

### 6. Acceptance criteria

- `projects/config/shared.json` can define named `controlPlanes`.
- A deployment context can select one control plane by name.
- Resolved deployment graph nodes contain normalized selected control-plane metadata.
- Two deployment contexts can select different control planes in one repo.
- Unknown or malformed control-plane profiles fail closed during context resolution.
- Control-plane service tokens are represented only by `secret://...` or `runtime://...` refs.
- Tests and docs cover the new config shape, validation behavior, and ref classification.

### 7. Risks

- Adding another context-derived graph-node field could blur the boundary between deployment
  metadata and app metadata.
- Transport validation could reject local/dev URLs that current tests expect to be valid fixtures.
- Token-like redaction could hide useful diagnostics if it is too broad.

### 8. Mitigations

- Keep `control_plane` derived-only and add explicit app-boundary tests.
- Reuse existing transport-policy fixture allowances rather than inventing a new URL validator.
- Redact values for token-like keys while still printing the config path and expected ref shape.

### 9. Consequences of not implementing this PR

Deployment contexts cannot express which control plane owns protected/shared mutation, so different
deployment projects can only use different control planes through ambient operator flags or env vars.

### 10. Downsides for implementing this PR

Project config becomes more structured and validation grows stricter. Local fixtures that use
unreviewed URLs or placeholder token fields may need to be updated to the new explicit profile
shape.

## PR-2: Context-selected protected/shared service routing

### 1. Intent

Make protected/shared deploy front doors use the context-selected control-plane service by default,
so deployment projects route to their configured control plane without relying on ambient
`VBR_DEPLOY_CONTROL_PLANE_URL` or repeated CLI flags.

### 2. Scope of changes

- Update protected/shared front doors to consume normalized `control_plane` metadata from resolved
  deployment nodes.
- Apply the selection order for protected/shared deployment commands:
  - context-selected `control_plane`
  - explicit override only when the operator passes `--allow-control-plane-override`
  - explicit `--control-plane-url` for commands without deployment context
  - ambient `VBR_DEPLOY_CONTROL_PLANE_URL` only for commands without deployment context
- Add `--allow-control-plane-override` to relevant deploy command surfaces that currently accept
  `--control-plane-url`.
- Fail closed when a deployment context selects a control plane and a provided
  `--control-plane-url` or `VBR_DEPLOY_CONTROL_PLANE_URL` disagrees without the explicit override
  flag.
- Resolve `controlPlaneTokenRef` according to its scheme:
  - `secret://...` reads through the selected SprinkleRef secret backend without printing the value
  - `runtime://...` validates the selected runtime-host binding and obtains the token through the
    existing runtime credential contract where available
- Keep token values out of command output, JSON evidence, submission payloads where only the service
  client needs the value, and diagnostic errors.
- Replace direct local `recordsRoot` or `control-plane-database-url` use for protected/shared
  context-selected deployments with service-routed reads and writes.
- Keep local-only deployments on the existing local records path.
- Do not add compatibility behavior that silently lets ambient env vars override a
  context-selected control plane.
- Do not broaden this PR into creating new control-plane profiles or provisioning control-plane
  hosts.

### 3. External prerequisites

- PR-1 must have landed so resolved deployment graph nodes include normalized `control_plane`
  metadata.
- Test fixtures need a protected/shared service endpoint stub or existing service-client test
  harness capable of asserting selected URL and token handling without live provider mutation.

### 4. Tests to be added

- Add protected/shared front-door tests proving context-selected `control_plane.service_client`
  supplies the service URL when no CLI/env URL is present.
- Add tests proving two deployments with different contexts route to different control-plane URLs.
- Add mismatch tests proving `--control-plane-url` fails closed when it disagrees with the selected
  context and `--allow-control-plane-override` is absent.
- Add override tests proving `--allow-control-plane-override` is required and produces clear
  selected-source evidence.
- Add env fallback tests proving `VBR_DEPLOY_CONTROL_PLANE_URL` is accepted only when no context
  selected control plane exists.
- Add token tests proving `secret://...` token refs are resolved without printing the token.
- Add token tests proving `runtime://...` token refs validate the runtime binding and do not get
  treated as SprinkleRef secret keys.
- Add negative tests proving `config://...` token refs and plaintext token values fail before
  provider mutation.
- Add records-path tests proving protected/shared context-selected deployments reject direct
  `recordsRoot` and `control-plane-database-url` mutation paths.
- Keep existing local-only deployment tests passing.

### 5. Docs to be added or updated

- Update deployment usage docs to show protected/shared deploys relying on
  `deployment_context -> controlPlane` instead of requiring repeated `--control-plane-url`.
- Update [Control Plane Selector Design](../../control-plane-selector.md) if the final override flag name
  or selection evidence shape changes.
- Update troubleshooting docs that currently say missing `--control-plane-url` is always the fix for
  protected/shared targets; after this PR, the first fix should be selecting a valid deployment
  context and control-plane profile.
- Update command help text for `--control-plane-url`, `VBR_DEPLOY_CONTROL_PLANE_URL`, and
  `--allow-control-plane-override`.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/*front-door*.ts`
  - `build-tools/tools/deployments/*service-client*.ts`
  - `build-tools/tools/deployments/deployment-service-client-profile.ts`
  - `build-tools/tools/tests/deployments/*front-door*.ts`
  - `docs/**`
- Keep changes focused on protected/shared service-client selection, token ref resolution, command
  help, docs, and tests.

### 6. Acceptance criteria

- Protected/shared deployments with a selected context use the context-selected control-plane URL by
  default.
- Two deployment projects in one repo can route to different control planes based on their selected
  contexts.
- Ambient env vars and `--control-plane-url` do not silently override context-selected control
  planes.
- Explicit overrides require `--allow-control-plane-override` and are visible in selected-source
  evidence.
- Control-plane service tokens are resolved only through `secret://...` or `runtime://...` paths and
  are never printed.
- Protected/shared context-selected deployments use service-routed records instead of direct local
  records or direct backend database access.
- Tests and docs cover default selection, override behavior, token handling, and records routing.

### 7. Risks

- Routing protected/shared commands through selected profiles could break workflows that currently
  rely on ambient `VBR_DEPLOY_CONTROL_PLANE_URL`.
- Runtime token binding for `runtime://...` may not be uniformly implemented across all runtime
  hosts yet.
- Rejecting direct records/database paths for context-selected protected/shared deploys can expose
  stale test fixtures.

### 8. Mitigations

- This is an intentional clean cut-over; remove stale ambient assumptions in the same PR rather
  than carrying compatibility branches.
- Keep `runtime://...` validation explicit and fail with host/profile-specific diagnostics when a
  runtime host cannot supply the requested binding.
- Update fixtures to model selected control planes instead of bypassing the service through local
  records/database paths.

### 9. Consequences of not implementing this PR

Control-plane selection would be documented and resolved in graph metadata, but protected/shared
deploys would still depend on ambient operator flags and env vars, leaving multi-control-plane repos
fragile and hard to reason about.

### 10. Downsides for implementing this PR

Existing local commands and tests that relied on ambient control-plane URLs will need to select
deployment contexts or pass explicit override flags. The front-door routing logic becomes stricter
because authority selection is now part of deployment topology.

## PR-3: Clean cut-over repo config, command surfaces, and stale global endpoint removal

### 1. Intent

Complete the clean cut-over by moving checked-in repo examples and command surfaces onto named
control-plane profiles, removing stale single-global-endpoint assumptions, and making the new model
the only documented protected/shared path.

### 2. Scope of changes

- Add checked-in control-plane profiles to `projects/config/shared.json` for the current repo
  examples.
- Add `controlPlane` selectors to existing deployment contexts.
- Move any remaining shared non-secret control-plane coordinates into canonical
  `projects/config/shared.json` values or profiles rather than ambient docs or one-off config files.
- Remove or replace docs and help text that imply protected/shared deploys should normally be run
  with a single repo-global `VBR_DEPLOY_CONTROL_PLANE_URL`.
- Replace magic `--remote mini` behavior with a named control-plane profile lookup, or reject it
  unless a matching `controlPlanes.mini` profile exists.
- Update `sprinkleref --check` or equivalent reference scanning/classification so
  `controlPlaneTokenRef` is classified as secret-backed or runtime-backed, never config-backed.
- Ensure missing-value displays classify:
  - control-plane URL as shared config
  - control-plane token ref as `secret://` or `runtime://`
  - selected control-plane profile name as shared config
- Remove files, fixtures, examples, or generated defaults made irrelevant by the new selected
  control-plane model.
- Do not add a migration command or compatibility shim for old global endpoint behavior.
- Do not create real infrastructure or mutate external services.

### 3. External prerequisites

- PR-1 and PR-2 must have landed.
- The repo must have enough checked-in context information to name the intended control-plane
  profiles without requiring live provider provisioning.
- Any real token values remain outside checked-in files and are provided through the selected
  `secret://` or `runtime://` contract.

### 4. Tests to be added

- Add repo config fixture tests proving existing deployment contexts select valid control-plane
  profiles.
- Add command help tests proving new default guidance points users to `deployment_context` and
  `controlPlanes`, not a single global `VBR_DEPLOY_CONTROL_PLANE_URL`.
- Add `--remote mini` tests proving it resolves through `controlPlanes.mini` or fails clearly when
  no matching profile exists.
- Add SprinkleRef/check classification tests proving `controlPlaneTokenRef` refs are reported under
  `secret://` or `runtime://` handling and never as non-secret `config://` values.
- Add missing-value display tests proving control-plane URL/profile names are classified as shared
  config while service-token refs are classified as secret/runtime credentials.
- Add stale-file or stale-doc regression coverage for removed global endpoint examples if an
  existing stale-name/doc-link test harness can cover it without introducing a docs-only PR.
- Keep protected/shared routing tests from PR-2 passing against the checked-in repo config shape.

### 5. Docs to be added or updated

- Update [Control Plane Selector Design](../../control-plane-selector.md) with any final command-surface
  details discovered while cutting over repo examples.
- Update [SprinkleRef Resolver](../../sprinkleref.md) and deployment usage docs so `controlPlanes` and
  `deploymentContexts.*.controlPlane` are the primary path.
- Update troubleshooting docs to replace single global endpoint fixes with context/profile
  diagnostics.
- Update docs that mention `--remote mini` so they describe named-profile selection or explicit
  rejection when no profile exists.
- Update this plan if the clean cut-over removes additional files or command surfaces.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `projects/config/shared.json`
  - `build-tools/tools/deployments/sprinkleref-check*.ts`
  - `build-tools/tools/deployments/*usage*.ts`
  - `build-tools/tools/deployments/*service-client*.ts`
  - `build-tools/tools/tests/deployments/**`
  - `docs/**`
- Keep changes focused on repo config cut-over, stale endpoint cleanup, missing-value
  classification, docs, and tests.

### 6. Acceptance criteria

- Existing checked-in deployment contexts select valid named control-plane profiles.
- Protected/shared command help and docs no longer present a single repo-global control-plane URL as
  the normal path.
- `--remote mini` is no longer a hidden magic endpoint; it is profile-backed or rejected.
- Missing-value output classifies control-plane URL/profile values as shared config and service
  tokens as `secret://` or `runtime://` credentials.
- Stale files, examples, or docs made irrelevant by the selected control-plane model are removed or
  rewritten.
- Tests and docs cover the final checked-in repo shape and user-facing command behavior.

### 7. Risks

- Cleaning up global endpoint docs can remove useful troubleshooting guidance if the new diagnostics
  are not concrete enough.
- Existing examples may need placeholder profile names before real control-plane endpoints are
  provisioned.
- Stale `--remote mini` assumptions may be spread across docs and tests.

### 8. Mitigations

- Replace removed global endpoint guidance with concrete context/profile diagnostics and commands.
- Use checked-in non-secret placeholder profile coordinates only where they are intentionally
  examples; real repo contexts should point at the selected shared profile names.
- Search docs and tests for `VBR_DEPLOY_CONTROL_PLANE_URL`, `--control-plane-url`, and
  `--remote mini` during implementation and update the relevant call sites in the same PR.

### 9. Consequences of not implementing this PR

The code path could support context-selected control planes, but repo examples, command help, and
missing-value output would still steer operators toward the old single-global-endpoint model.

### 10. Downsides for implementing this PR

The clean cut-over removes familiar ambient endpoint shortcuts and may require local developers to
fill proper control-plane profile/token refs before protected/shared deploy commands work.

## PR-4: Remote profile token resolution and protected/shared fail-closed selection

### 1. Intent

Close the remaining clean cut-over gaps by making `--remote <name>` resolve a complete named
`controlPlanes.<name>` service-client profile from the resolved workspace root, including its token
ref, and by making protected/shared deployments fail closed whenever their selected deployment
context cannot resolve a valid control plane.

### 2. Scope of changes

- Treat `--remote <name>` as a named `controlPlanes.<name>` selector across protected/shared
  provider front doors.
- Resolve both `serviceClient.controlPlaneUrl` and `serviceClient.controlPlaneTokenRef` from the
  selected remote profile.
- Ensure authenticated `--remote <name>` flows no longer depend on ambient token material or
  explicit token flags when the selected profile has a resolvable token ref.
- Make `readRemoteControlPlaneProfile` read from the resolved workspace root instead of
  `process.cwd()`.
- Update protected/shared front-door option plumbing so the named remote selector is passed
  consistently through provider dispatch, service-client construction, and selected-source
  evidence.
- When a protected/shared deployment has a `deployment_context`, require that context to resolve a
  valid `controlPlane`.
- Fail closed for protected/shared context-selected deployments when the context is missing
  `controlPlane`, names an unknown profile, has an invalid profile shape, or has an unresolvable
  token ref.
- Do not fall back to explicit `--control-plane-url`, ambient `VBR_DEPLOY_CONTROL_PLANE_URL`, or
  ambient token material for protected/shared deployments whose context exists but lacks a resolved
  control plane.
- Preserve explicit override behavior only for the PR-2 override path where a valid selected
  control plane already exists and `--allow-control-plane-override` is present.
- Do not edit provider internals beyond the protected/shared front-door selection and
  service-client wiring needed for this fail-closed behavior.

### 3. External prerequisites

- PR-1, PR-2, and PR-3 must have landed.
- Existing protected/shared provider front-door tests must be able to assert selected-source
  evidence, service URL selection, and token-ref resolution without live provider mutation.
- Workspace-root resolution must be available from the deployment command context or a narrow shared
  CLI helper.

### 4. Tests to be added

- Add `--remote <name>` tests proving the selected `controlPlanes.<name>` profile supplies both the
  control-plane URL and token ref.
- Add authenticated remote-profile tests proving `controlPlaneTokenRef` resolves through
  `secret://...` or `runtime://...` handling without relying on ambient or explicit token material.
- Add tests proving `readRemoteControlPlaneProfile` reads from the resolved workspace root when the
  command is invoked from a nested directory.
- Add protected/shared provider front-door tests proving `--remote <name>` is forwarded as a named
  profile selector through each relevant provider command surface.
- Add fail-closed tests proving protected/shared deployments with a `deployment_context` and no
  resolved `controlPlane` reject ambient `VBR_DEPLOY_CONTROL_PLANE_URL` and explicit
  `--control-plane-url` fallback.
- Add negative tests for missing `deploymentContexts.<name>.controlPlane`, unknown named profiles,
  invalid profile shape, and unresolvable token refs.
- Keep existing local-only deployment and no-context explicit URL tests passing where the plan still
  allows commands without deployment context to use explicit or ambient control-plane URLs.

### 5. Docs to be added or updated

- Update deployment usage docs so `--remote <name>` is documented as selecting
  `controlPlanes.<name>` and resolving both URL and token ref.
- Update troubleshooting docs to state that protected/shared deployments with a deployment context
  must select a valid control plane and will not fall back to ambient or explicit URL/token values
  when that selection is missing or invalid.
- Update command help or examples for provider front doors that accept `--remote <name>` so the
  selector behavior is consistent across protected/shared providers.
- Update [Control Plane Selector Design](../../control-plane-selector.md) if the selected-source evidence
  shape or workspace-root lookup behavior differs from the prior design.
- Update this plan if implementation discovers additional protected/shared front doors that need
  the same named-profile selector plumbing.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/*front-door*.ts`
  - `build-tools/tools/deployments/*service-client*.ts`
  - `build-tools/tools/deployments/*remote*.ts`
  - `build-tools/tools/tests/deployments/**`
  - `docs/**`
- Keep changes focused on remote-profile lookup, workspace-root resolution, protected/shared
  fail-closed selection, docs, and tests.

### 6. Acceptance criteria

- `--remote <name>` consistently selects `controlPlanes.<name>` across protected/shared provider
  front doors.
- Remote profile lookup resolves both control-plane URL and `controlPlaneTokenRef`.
- Authenticated remote-profile flows do not require ambient or explicit token material when the
  selected profile has a valid token ref.
- Remote profile lookup works from nested command directories by reading config from the resolved
  workspace root.
- Protected/shared deployments with a deployment context fail closed when no valid selected
  control plane is resolved.
- Protected/shared context-selected deployments do not fall back to explicit or ambient
  control-plane URLs or tokens when their context lacks a valid `controlPlane`.
- Tests and docs cover named remote selection, token-ref resolution, workspace-root lookup, and
  fail-closed protected/shared behavior.

### 7. Risks

- Tightening protected/shared fallback behavior can surface stale contexts that previously worked
  only because ambient endpoint or token material was present.
- Provider front doors may have inconsistent option plumbing that hides one command surface from
  the named-profile selector path.
- Workspace-root lookup changes can expose tests that accidentally depended on `process.cwd()`.

### 8. Mitigations

- Make fail-closed diagnostics name the deployment context, expected `controlPlane` field, selected
  profile name if present, and the rejected fallback source.
- Search protected/shared provider command surfaces for `--remote`, `--control-plane-url`, and
  service-client construction during implementation and add provider-specific forwarding tests.
- Add nested-directory fixtures so workspace-root lookup behavior is asserted directly instead of
  inferred from the process working directory.

### 9. Consequences of not implementing this PR

The plan would still leave authenticated `--remote <name>` flows dependent on ambient token
material, and protected/shared deployments could silently use explicit or ambient control-plane
values even when their deployment context failed to select a valid control plane.

### 10. Downsides for implementing this PR

Operators with incomplete protected/shared deployment contexts must add valid `controlPlane`
selectors and token refs before those commands run. Tests and command wiring become stricter
because remote profile selection is now a complete service-client selection path rather than only a
URL shortcut.

## PR-5: Non-fixture control-plane token ref resolution through selected SprinkleRef backend

### 1. Intent

Close the protected/shared authentication gap by making `secret://` control-plane token refs resolve
through the selected deployment context's real SprinkleRef secret backend and project-config
resolver path, not through the fixture-only registered deployment secret backend.

### 2. Scope of changes

- Update `deployment-control-plane-token-ref.ts` so `secret://...` token refs use the selected
  deployment context's `DeploymentSecretContext` and configured SprinkleRef backend.
- Ensure the resolver can load the selected project's shared/local config needed to resolve
  non-fixture Infisical, Vault, Keychain, or other registered SprinkleRef backend refs.
- Preserve fixture backend support only for tests or explicitly fixture-scoped contexts; do not let
  fixture fallback mask missing real backend context in protected/shared paths.
- Resolve checked-in profile token refs such as
  `secret://control-plane/.../service-token` for `pleomino-prod` and `pleomino-staging` through the
  same non-fixture path used by real protected/shared deploys.
- Fail closed with redacted diagnostics when a `secret://` token ref lacks a selected deployment
  context, cannot construct a `DeploymentSecretContext`, or cannot resolve through the selected
  backend.
- Keep `runtime://...` behavior separate from SprinkleRef secret resolution.
- Keep token values out of command output, JSON evidence, logs, diagnostics, and test snapshots.
- Do not broaden this PR into changing provider mutation behavior, provisioning secret backends, or
  adding plaintext token fallbacks.

### 3. External prerequisites

- PR-1 through PR-4 must have landed.
- Project config and deployment context resolution must expose enough information to construct the
  selected `DeploymentSecretContext` for protected/shared command paths.
- Tests must be able to exercise non-fixture SprinkleRef backend selection without live secret
  service mutation, using mocked backend adapters or existing registered backend test harnesses.

### 4. Tests to be added

- Add protected/shared token-ref tests proving `secret://control-plane/.../service-token` resolves
  through the selected SprinkleRef backend with a real `DeploymentSecretContext`.
- Add tests for `pleomino-prod` and `pleomino-staging` profile token refs proving they enter the
  non-fixture backend resolver path instead of `createRegisteredDeploymentSecretBackend` without
  context.
- Add Infisical/Vault-style backend tests proving selected backend config from project config is
  honored when resolving control-plane service tokens.
- Add negative tests proving missing deployment context, missing secret backend selection, invalid
  backend config, and unresolved `secret://` token refs fail before provider mutation.
- Add regression tests proving fixture backend success alone is not sufficient for protected/shared
  `secret://` token resolution.
- Add redaction tests proving resolved token values and backend secret payloads are never printed in
  errors, evidence, logs, or snapshots.
- Keep existing `runtime://...` token-ref tests passing and add coverage proving runtime refs do
  not enter the SprinkleRef secret backend resolver.

### 5. Docs to be added or updated

- Update [SprinkleRef Resolver](../../sprinkleref.md) to document that control-plane
  `secret://...` service-token refs resolve through the selected deployment context's SprinkleRef
  backend and require a valid `DeploymentSecretContext`.
- Update deployment usage and troubleshooting docs to explain failures for missing secret backend
  context, unresolved control-plane service-token refs, and redacted diagnostics.
- Update [Control Plane Selector Design](../../control-plane-selector.md) if the concrete
  `DeploymentSecretContext` handoff or resolver ownership differs from the prior design.
- Update this plan if implementation discovers additional protected/shared token resolver call
  sites that need the same selected-backend behavior.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/deployment-control-plane-token-ref.ts`
  - `build-tools/tools/deployments/*secret*.ts`
  - `build-tools/tools/deployments/*sprinkleref*.ts`
  - `build-tools/tools/deployments/project-config.ts`
  - `build-tools/tools/tests/deployments/**`
  - `docs/**`
- Keep changes focused on selected-backend token resolution, fail-closed diagnostics, docs, and
  tests.

### 6. Acceptance criteria

- Protected/shared `secret://` control-plane token refs resolve through the selected
  `DeploymentSecretContext` and SprinkleRef backend.
- Checked-in profiles such as `pleomino-prod` and `pleomino-staging` can use
  `secret://control-plane/.../service-token` refs without relying on fixture-only backend behavior.
- Fixture backend tests do not mask missing real backend context for protected/shared paths.
- Infisical/Vault-style non-fixture token refs have direct regression coverage.
- Missing or invalid backend context fails closed before provider mutation with redacted
  diagnostics.
- Token values are never printed in output, evidence, logs, diagnostics, or snapshots.

### 7. Risks

- Real backend context construction may expose protected/shared command paths that currently do not
  carry full deployment context or workspace-root information.
- Existing positive tests may pass only because fixture backend resolution is too permissive.
- Redacted errors can become too vague if they omit the selected context, profile, or backend name.

### 8. Mitigations

- Thread the existing resolved deployment context and workspace-root data into token resolution
  instead of adding a second config-loading path.
- Keep fixture-only behavior explicitly scoped and add regression tests that fail when
  protected/shared paths resolve without a real backend context.
- Include non-secret diagnostic fields such as deployment context name, control-plane profile name,
  token-ref path, and backend type while redacting token values and secret payloads.

### 9. Consequences of not implementing this PR

Protected/shared deployments can select the right control-plane URL while still failing to
authenticate for real `secret://` service-token refs used by checked-in profiles such as
`pleomino-prod` and `pleomino-staging`.

### 10. Downsides for implementing this PR

Token resolution becomes stricter and requires protected/shared command paths to provide complete
deployment context and secret backend information. Fixtures that relied on context-free registered
secret backend behavior will need to be narrowed or rewritten to model the selected backend path.

## PR-6: Post-cutover fail-closed validation hardening

### 1. Intent

Close the remaining validation gaps found by the end-of-range assessments by making protected/shared
control-plane selection fail closed before front-door, read-only, or mutation code can fall back to
fixtures or partially validated config.

### 2. Scope of changes

- Require protected/shared `secret://` control-plane token resolution to receive a selected real
  `DeploymentSecretContext`.
- Reject protected/shared `secret://` token resolution when `secretContext` is missing, even if the
  fixture backend could resolve the same ref.
- Keep fixture backend success scoped to explicitly fixture-only tests and contexts; fixture success
  must not mask missing selected backend context in remote-profile, context-selected, or
  protected/shared paths.
- Add repo, front-door, and read-only project-config validation that rejects protected/shared
  deployment contexts without a selected `controlPlane`.
- Ensure validation fails before later context-resolution or mutating provider selection code when a
  protected/shared context lacks `controlPlane`.
- Validate every merged `controlPlanes` entry from shared and local project config, not only the
  profile selected by a deployment context or named remote selector.
- Reject plaintext token-shaped fields and malformed `controlPlaneTokenRef` values in unreferenced
  shared and local control-plane profiles.
- Preserve valid local-only contexts that do not require a protected/shared control-plane selection.
- Keep diagnostics redacted while naming the config path, deployment context, profile name, and
  rejected fallback source where applicable.
- Do not broaden this PR into provider routing changes, secret backend provisioning, or new
  control-plane profile features.

### 3. External prerequisites

- PR-1 through PR-5 must have landed.
- Existing project-config validation, deployment context validation, protected/shared front-door
  validation, and token-ref tests must be available to extend.
- The merged shared/local project-config representation must expose all `controlPlanes` entries
  before context selection filters are applied.

### 4. Tests to be added

- Add protected/shared token-ref tests proving `secret://` resolution without `secretContext`
  fails, even when a fixture backend would return a token.
- Add remote-profile and context-selected regression tests proving fixture backend success cannot
  mask missing selected backend context.
- Add front-door validation tests proving protected/shared contexts without `controlPlane` are
  rejected before provider mutation.
- Add read-only validation tests proving protected/shared repo inspection or planning paths reject
  missing `controlPlane` instead of deferring failure to mutating selection.
- Add project-config validation tests proving all merged `controlPlanes` entries are checked,
  including unreferenced shared profiles and unreferenced local override profiles.
- Add negative tests proving plaintext token-shaped fields and malformed token refs in unreferenced
  profiles fail validation.
- Add local-only regression tests proving contexts that are not protected/shared remain valid
  without a selected control plane.
- Add redaction tests proving diagnostics identify invalid paths and rejected fallback sources
  without printing token values.

### 5. Docs to be added or updated

- Update [Control Plane Selector Design](../../control-plane-selector.md) to state that protected/shared
  contexts must select a valid control plane during repo, front-door, read-only, and mutation
  validation.
- Update [SprinkleRef Resolver](../../sprinkleref.md) to state that protected/shared control-plane
  `secret://` refs require selected real backend context and cannot be satisfied by fixture fallback.
- Update deployment troubleshooting docs with diagnostics for missing `controlPlane`, missing
  `secretContext`, rejected fixture fallback, and invalid unreferenced `controlPlanes` profiles.
- Update this plan if implementation discovers another protected/shared validation entrypoint that
  must share the same fail-closed rules.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/deployment-control-plane-token-ref.ts`
  - `build-tools/tools/deployments/deployment-context-validation.ts`
  - `build-tools/tools/deployments/project-config.ts`
  - `build-tools/tools/deployments/*front-door*.ts`
  - `build-tools/tools/deployments/*read-only*.ts`
  - `build-tools/tools/tests/deployments/**`
  - `docs/**`
- Keep changes focused on fail-closed validation, merged profile validation, token-context
  enforcement, docs, and tests.

### 6. Acceptance criteria

- Protected/shared `secret://` token resolution fails when selected real backend context is missing,
  regardless of fixture backend behavior.
- Fixture token resolution cannot satisfy remote-profile, context-selected, or protected/shared
  paths unless the path is explicitly fixture-scoped.
- Repo, front-door, read-only, and mutation validation all reject protected/shared contexts without
  a selected valid `controlPlane`.
- Every merged `controlPlanes` entry is validated for shape, token-ref scheme, and plaintext
  token-shaped fields whether or not it is selected.
- Unreferenced invalid shared or local control-plane profiles fail validation.
- Local-only contexts that do not require protected/shared service routing remain valid.
- Tests and docs cover the fail-closed behavior and redacted diagnostics.

### 7. Risks

- Validating every merged profile can surface stale local override profiles that were previously
  ignored because no context selected them.
- Moving protected/shared missing-control-plane failures earlier can require test fixtures to model
  repo/front-door/read-only validation more completely.
- Tight fixture scoping can break positive tests that accidentally relied on context-free fixture
  token resolution.

### 8. Mitigations

- Make diagnostics point to the exact shared or local profile path that failed validation and the
  accepted token-ref schemes.
- Update fixtures in the same PR so protected/shared contexts include explicit control-plane
  selectors where the test is not about missing-selection failure.
- Keep fixture resolution tests under clearly named fixture-only helpers or contexts, and add
  negative regression coverage for all protected/shared entrypoints.

### 9. Consequences of not implementing this PR

Protected/shared deployments can still pass through validation with missing selected control-plane
context, unresolved real secret context, or invalid unreferenced profiles, allowing fixture fallback
or later mutation-time failures to hide configuration errors.

### 10. Downsides for implementing this PR

Validation becomes stricter for both checked-in and local config. Operators with stale local
profiles or protected/shared contexts missing `controlPlane` must fix those entries before
front-door, read-only, or mutation commands proceed.

## PR-7: Workspace-root project-config validation for extraction

### 1. Intent

Make deployment-context extraction load canonical project config from the CLI workspace root, not
from the process working directory, so repo, front-door, and read-only validation behave the same
from nested directories as they do from the repository root.

### 2. Scope of changes

- Thread the resolved workspace root into shared deployment extraction before
  `resolveDeploymentContextNodes` reads `projects/config`.
- Remove or narrow any remaining `process.cwd()` fallback in deployment-context extraction paths
  that already know the workspace root.
- Preserve existing explicit workspace-root behavior in `--remote <name>` profile resolution.
- Keep local-only contexts valid when project config is absent, while ensuring protected/shared
  contexts still fail closed when canonical repo config is missing or invalid.
- Do not add backwards compatibility shims or alternate config search paths; this is a clean
  cut-over to canonical workspace-root config loading.

### 3. External prerequisites

- PR-1 through PR-6 must have landed.
- CLI/provider extraction entrypoints must already resolve the repository workspace root.
- The canonical project config directory remains `projects/config` under the workspace root.

### 4. Tests to be added

- Add a read-only or validate-only regression test that runs extraction from a nested working
  directory and proves `projects/config/shared.json` is still loaded from the workspace root.
- Add a protected/shared negative test proving a missing or invalid selected control plane is still
  rejected from nested directories.
- Add a local-only regression test proving omitted or absent `projects/config` does not break valid
  local-only extraction.
- Keep or extend `--remote <name>` workspace-root coverage to prove the remote-profile path remains
  aligned with deployment-context extraction.

### 5. Docs to be added or updated

- Update [Control Plane Selector Design](../../control-plane-selector.md) if needed to state that all
  deployment-context extraction and read-only validation load `projects/config` from the workspace
  root.
- Update troubleshooting or deployment usage docs if diagnostics change for nested-directory
  invocations or missing canonical project config.
- Update this plan if another extraction entrypoint still reads project config relative to
  `process.cwd()`.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/contract-extract-shared.ts`
  - `build-tools/tools/deployments/deployment-contexts.ts`
  - `build-tools/tools/deployments/*contract-extract*.ts`
  - `build-tools/tools/tests/deployments/**`
  - `docs/**`
- Keep changes focused on root propagation, validation determinism, tests, and docs.

### 6. Acceptance criteria

- Deployment-context extraction reads `projects/config` from the resolved workspace root, regardless
  of the process working directory.
- `deploy --validate-only`, read-only inspection, and provider front-door extraction reject
  protected/shared invalid config consistently from nested directories.
- Local-only extraction continues to degrade gracefully when `projects/config` is absent.
- `--remote <name>` and context-selected control-plane resolution use the same canonical project
  config root.
- Tests and docs cover the nested-directory behavior.

### 7. Risks

- Some tests may have accidentally depended on running from a temporary current working directory
  with ad hoc `projects/config` content.
- Moving config loading to the canonical workspace root can surface real checked-in config issues in
  read-only paths that were previously hidden by nested invocation behavior.

### 8. Mitigations

- Update tests to create explicit workspace roots instead of relying on ambient `process.cwd()`.
- Keep diagnostics path-oriented so failures identify the canonical `projects/config` path.
- Limit fallback behavior to valid local-only cases where project config is intentionally absent.

### 9. Consequences of not implementing this PR

Protected/shared repo and read-only validation remains dependent on the current shell directory,
allowing nested invocations to miss canonical project config and bypass PR-6 fail-closed checks.

### 10. Downsides for implementing this PR

Extraction becomes less tolerant of ad hoc nested-directory config. Callers must provide or resolve
the repository workspace root before deployment-context validation runs.

## PR-8: Dynamic Nix cache fallback for PR validation

### 1. Intent

Keep repo build and validation scripts usable when a configured Nix cache is temporarily
unreachable, without hardcoding any cache domain or silently changing global Nix daemon
configuration.

### 2. Scope of changes

- Add a shared Nix cache health helper that discovers configured substituters from effective Nix
  config, probes HTTP(S) caches dynamically, and rewrites only the current process `NIX_CONFIG`.
- Wire the helper into `v` before seed builds and into `b`/prelude setup before Nix builds.
- Wire equivalent cache-health behavior into Buck Nix action bootstrap so generated actions do not
  fail only because a configured cache endpoint is unavailable.
- Preserve non-HTTP(S) substituters and reachable caches, keep `cache.nixos.org` available when it
  is configured, and do not write user, daemon, or checked-in config files.
- Support `VBR_NIX_CACHE_POLICY=auto` as the default fallback mode,
  `VBR_NIX_CACHE_POLICY=strict` for hard cache enforcement, and `VBR_NIX_CACHE_POLICY=off` for
  debugging with untouched Nix config.

### 3. External prerequisites

- Nix remains the source of truth for configured substituters and trusted public keys.
- `curl` or the TypeScript fetch runtime is available in the relevant script/action environment.

### 4. Tests to be added

- Add unit coverage proving auto mode removes only unreachable configured substituters discovered
  dynamically and preserves unrelated `NIX_CONFIG` entries.
- Add strict-mode coverage proving an unreachable configured cache fails closed.
- Add off-mode coverage proving the helper leaves `NIX_CONFIG` unchanged.
- Extend verify orchestration coverage so the cache-health phase runs before later local setup or
  seed/build side effects.

### 5. Docs to be added or updated

- Update remote-build setup docs to describe configured-cache fallback policy without naming any
  local/private cache domain.
- Update PR handbook validation guidance to explain when to use `auto`, `strict`, and `off`.

### 5.5. Expected regression scope

- `build-system`
- Expected implementation paths:
  - `build-tools/tools/dev/verify/**`
  - `build-tools/tools/dev/dev-build/**`
  - `build-tools/tools/bin/devshell.sh`
  - `build-tools/lang/**`
  - `build-tools/tools/tests/dev/**`
  - `build-tools/tools/tests/remote-exec/**`
  - `build-tools/docs/**`
  - `docs/handbook/**`
- Keep changes focused on per-process cache handling, validation reliability, tests, and docs.

### 6. Acceptance criteria

- `i`, `b`, `v`, and Buck Nix actions can proceed when a configured HTTP(S) cache is
  unreachable, as long as remaining substituters or local builds can satisfy Nix.
- The implementation discovers configured cache URLs dynamically and contains no hardcoded local
  cache domain.
- Strict mode makes cache availability a hard failure for tests that intentionally validate cache
  health.
- Off mode leaves Nix config untouched for debugging.
- Tests and docs cover the cache policy behavior.

### 7. Risks

- Auto mode can hide a cache outage by falling back to source builds or lower-priority public
  substituters, which may make validation slower.
- Shell bootstrap and TypeScript bootstrap logic can drift if they parse effective Nix config
  differently.

### 8. Mitigations

- Emit concise diagnostics when unreachable substituters are removed and when a reduced
  substituter set is used.
- Keep strict mode available for CI lanes or targeted tests where cache availability is the
  behavior under test.
- Keep the shell implementation minimal and aligned with the TypeScript unit-tested behavior.

### 9. Consequences of not implementing this PR

Transient DNS or network failures for a configured cache can make unrelated PR validation
fail before the repository's actual build or test behavior is exercised.

### 10. Downsides for implementing this PR

Validation may continue after a cache outage and take longer than expected. Developers need to read
the emitted cache-health diagnostics when a run unexpectedly slows down.
