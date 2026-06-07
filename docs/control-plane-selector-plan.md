# Control Plane Selector Plan

This plan implements [Control Plane Selector Design](control-plane-selector.md).

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
- Do not change `--control-plane-url`, `VBR_DEPLOY_CONTROL_PLANE_URL`, or `--remote mini` execution
  behavior in this PR.

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

- Update [Control Plane Selector Design](control-plane-selector.md) if the normalized field names or
  validation rules differ from the design while implementing.
- Update [SprinkleRef Resolver](sprinkleref.md) to list `controlPlanes` as checked-in shared
  topology and to reinforce the `secret://`/`runtime://` classification for service tokens.
- Update deployment context docs in [SprinkleRef Resolver](sprinkleref.md) so `controlPlane` is
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
- Update [Control Plane Selector Design](control-plane-selector.md) if the final override flag name
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

- Update [Control Plane Selector Design](control-plane-selector.md) with any final command-surface
  details discovered while cutting over repo examples.
- Update [SprinkleRef Resolver](sprinkleref.md) and deployment usage docs so `controlPlanes` and
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
