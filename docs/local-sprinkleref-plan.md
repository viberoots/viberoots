# Local SprinkleRef Plan

This plan implements the local and clone-specific resolution model described in
[Local SprinkleRef Design](local-sprinkleref.md).

Reviewed context:

- `secret://...` remains the backend-neutral logical reference for true secrets. Non-secret
  setup coordinates use `config://...`, and runtime-derived values may use `runtime://...`.
  Backend names and storage details stay in SprinkleRef resolver config, not in logical refs.
- `bootstrap` is an existing SprinkleRef category/lane for root credentials needed to access a
  primary secret manager such as Infisical or Vault. It is not a URI scheme and not a backend kind.
- `macos-keychain`, `local-file`, `infisical`, and `vault` are backend kinds.
- Clone-local values should be conventional and easy to use without requiring every developer to
  maintain a different resolver selector.
- True secrets, including the Supabase Management API token used by AWS account setup, must not be
  accepted as plaintext inline stack config or plaintext local values.
- Supabase organization plan remains API-derived and must not become a user-supplied stack config
  value.
- The generated AWS account stack config should stay minimal: no obvious defaults, derived hostnames,
  evidence paths, state backend names, token env/category defaults, or optional hardening fields.

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no new `bootstrap://` URI scheme
- no generated `supabaseProjectRefRef` or other `*RefRef` fields
- no automatic global keychain fallback across every clone
- no plaintext local storage path for true secrets
- no direct AWS resource mutation or other infrastructure provisioning changes
- no replacement of Infisical, Vault, or existing SprinkleRef backend implementations
- no removal of existing `selected.local.json` compatibility until a migration path is implemented
  and tested

Verify-scope organization:

- The implementation should stay under:
  - `build-tools/tools/deployments/**`
  - `build-tools/tools/tests/deployments/**`
  - `docs/**`
  - `config/**` only for reviewed templates/examples or gitignore-safe local path conventions
- If implementation requires a shared CLI/helper change under `build-tools/tools/lib/**`, keep it
  narrow and document why it is shared utility rather than deployment/control-plane-specific logic.
- Do not hide broad build-system or Nix changes inside this PR.

Each PR below must update this plan if implementation changes invalidate the remaining scope or
assumptions.

## PR-1: Local SprinkleRef values and structured AWS stack input resolution

### 1. Intent

Make AWS account setup values resolve cleanly from inline stack config, structured SprinkleRef refs,
one conventional gitignored local values file, and existing SprinkleRef categories, while keeping
secret material out of plaintext local JSON and preserving the compact setup UX.

### 2. Scope of changes

- Add stack config value parsing for three accepted field forms:
  - plain scalar inline values, such as `"domain": "example.com"`
  - explicit inline values, such as `"domain": { "value": "example.com" }`
  - SprinkleRef-backed values, such as
    `"awsAccountId": { "ref": "config://control-plane/aws/account-id" }`
- Reject invalid stack field shapes:
  - objects containing both `value` and `ref`
  - empty refs for required values
  - unsupported ref schemes
  - backend-specific refs that violate existing backend-neutral `secret://...` rules
- Replace the AWS account setup token config shape with `supabaseAccessToken` using the same
  structured value model.
- Remove `supabaseAccessTokenRef` from generated config and new documentation. Because there are no
  external users yet, the implementation does not need to preserve it as a compatibility alias unless
  a local migration test proves doing so is useful.
- Keep `supabaseAccessToken` secret-class:
  - reject inline scalar values
  - reject `{ "value": ... }`
  - reject plaintext local values
  - allow setup-shell env fallback
  - allow `{ "ref": "secret://control-plane/supabase/management-api-token" }`
- Add one conventional gitignored local values file path:
  - `config/sprinkleref/local/values.json`
- Add hierarchical local values lookup:
  - `config://control-plane/aws/account-id` maps to
    `values.control-plane.aws.account-id`
  - `config://control-plane/supabase/project-ref` maps to
    `values.control-plane.supabase.project-ref`
- Treat the local values file as an implicit local-first resolver for stack refs so developers can
  share the same tracked selector config.
- Add local redirect object support:
  - `{ "ref": "secret://...", "category": "bootstrap" }` resolves the target ref through that
    SprinkleRef category
  - `{ "ref": "secret://..." }` resolves through the current/default category chain
  - `category` must name a configured SprinkleRef category
  - ref redirects must have cycle detection
- Preserve existing bootstrap guardrails:
  - `bootstrap` remains a category/lane
  - `bootstrap` must not use Infisical when it stores credentials needed to access Infisical
  - `macos-keychain` remains a backend kind selected by resolver config
- Update `control-plane aws-account config-init` to generate the new minimal shape:
  - `domain` as an empty scalar
  - `awsAccountId`, `awsOrganizationId`, `supabaseOrgId`, `supabaseProjectRef`, and
    `supabaseAccessToken` as structured `secret://control-plane/...` refs
  - no generated `expectedAwsRoleArn`
  - no generated defaults or derived values
- Keep existing explicit override support for:
  - `stackName`
  - `region`
  - service names
  - derived hostnames
  - evidence directory
  - state backend names
  - Supabase API base URL
  - optional `expectedAwsRoleArn`
- Keep Supabase organization plan API-derived and reject any user-supplied plan input.
- Add `sprinkleref --init-local` support, following the existing standalone SprinkleRef command
  ownership and flag-oriented CLI style, so it writes or updates
  `config/sprinkleref/local/values.json` with:
  - placeholders for private coordinates
  - non-plaintext ref objects for secret-class refs, with `category: "bootstrap"` only when a
    clone explicitly opts into bootstrap
  - no plaintext secret placeholders that encourage token values in JSON
- Do not add a parallel `control-plane sprinkleref` command. `control-plane aws-account config-init`
  owns AWS account stack config generation; `sprinkleref` owns resolver config, local values, and
  secret add/update/remove operations.
- Keep secret writes on existing SprinkleRef add/update semantics, for example
  `sprinkleref --update secret://control-plane/supabase/management-api-token --create-missing`;
  add `--category bootstrap` only for explicit bootstrap opt-in,
  instead of inventing a new `set` verb.
- Ensure `.gitignore` or the repo-local ignore policy excludes `config/sprinkleref/local/`.
- Update `control-plane aws-account check` output to remain compact and source-aware:
  - show missing fields by logical field name
  - show whether missing values belong in local values, the shared resolver, or bootstrap category
  - show resolved sources without printing secret values
- Add source metadata to JSON evidence for resolved stack inputs:
  - inline/default/local-values/sprinkleref source
  - local values path when applicable
  - ref and category when applicable
  - backend description when applicable and non-secret
  - `valuePrinted: false` for true secrets
- Keep generated `inputs.json`, status output, and evidence redacted for true secrets.
- Update existing setup docs so `config/sprinkleref/selected.json` is the preferred shared selector
  and `config/sprinkleref/selected.local.json` is described only as an escape hatch or migration
  artifact.

### 3. External prerequisites

- macOS Keychain is available only on macOS when the selected `bootstrap` category uses the
  `macos-keychain` backend.
- Infisical/Vault remote resolver access remains whatever the selected resolver config requires.
- Existing setup-shell env fallback for the Supabase Management API token remains available for
  early bootstrap runs.

### 4. Tests to be added

- Add parser tests for scalar, `{ "value": ... }`, and `{ "ref": ... }` stack field forms.
- Add negative parser tests rejecting both `value` and `ref`, unsupported schemes, empty required
  refs, and backend-specific logical refs.
- Add AWS account config tests proving `config-init` writes the new structured minimal stack config
  and omits defaults, derived values, `expectedAwsRoleArn`, `supabaseAccessTokenRef`, and
  user-supplied Supabase plan.
- Add AWS account config tests proving defaults and derived hosts still resolve at runtime from the
  minimal structured config.
- Add local values lookup tests proving hierarchical paths resolve from
  `config/sprinkleref/local/values.json`.
- Add local values negative tests proving missing files are tolerated when remote resolvers can
  satisfy the value, malformed local JSON fails clearly, and malformed local value objects fail
  closed.
- Add secret-class tests proving `supabaseAccessToken` rejects inline stack values, `{ "value": ... }`,
  plaintext local scalar values, and plaintext local `{ "value": ... }`.
- Add redirect tests proving `{ "ref": "secret://...", "category": "bootstrap" }` uses the
  configured bootstrap category and records source metadata.
- Add redirect negative tests for unknown categories and redirect cycles.
- Add source precedence tests:
  - CLI flag beats config/ref
  - inline stack config beats local/remote ref resolution
  - local values beat remote resolver for non-secret private coordinates
  - secret-class local plaintext is rejected rather than beating remote resolver
  - remote resolver is used when the local value is absent
  - setup-shell env var beats `supabaseAccessToken` ref
- Add `check` human-output tests proving missing values are grouped compactly and do not mention
  stale fields such as `supabaseAccessTokenRef`, `supabasePlan`, or `expectedAwsRoleArn`.
- Add JSON evidence tests proving secret values are redacted and non-secret source metadata is
  present.
- Add `sprinkleref --init-local` tests proving it writes the canonical hierarchical local values file,
  preserves existing values, adds missing placeholders, and never writes plaintext secret defaults.
- Add gitignore or repository hygiene tests, if this repo has existing guardrails for generated/local
  config paths, proving `config/sprinkleref/local/` is ignored.

### 5. Docs to be added or updated

- Update [Local SprinkleRef Design](local-sprinkleref.md) if implementation discovers a better field
  name, source precedence, or command shape.
- Update [SprinkleRef Resolver](sprinkleref.md) with:
  - the conventional local values file
  - hierarchical local values mapping
  - local redirect objects with `category: "bootstrap"`
  - shared `config/sprinkleref/selected.json` as the preferred selector
  - `selected.local.json` as an escape hatch/migration path, not the normal local override path
- Update [AWS Account Control Plane And Remote Builds](aws-account-control-plane-and-remote-builds.md)
  with the new generated stack config shape, secret-class token handling, `sprinkleref --init-local`
  flow, and
  compact check output.
- Update any command help text emitted by `control-plane aws-account --help`, `config-init`, and the
  relevant SprinkleRef command surface.
- Update `.gitignore` comments or local setup docs to explain `config/sprinkleref/local/`.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/aws-account.ts`
  - `build-tools/tools/deployments/sprinkleref*.ts`
  - `build-tools/tools/tests/deployments/aws-account-cli.test.ts`
  - `build-tools/tools/tests/deployments/sprinkleref*.test.ts`
  - `docs/**`
  - `.gitignore` or reviewed config examples
- If the implementation needs broader shared CLI parsing utilities, keep those changes narrow and
  justify them in the implementation report.

### 6. Acceptance criteria

- `control-plane aws-account config-init` generates a compact structured stack config that can be
  filled without checking clone-specific account/project coordinates into git.
- `config/sprinkleref/local/values.json` can satisfy clone-local private coordinates through
  hierarchical `secret://...` path lookup.
- A local value can explicitly redirect a true secret to the existing `bootstrap` category without
  adding a new URI scheme or triggering global keychain fallback.
- `supabaseAccessToken` cannot be supplied as plaintext stack config or plaintext local values.
- `supabaseAccessTokenRef`, `supabasePlan`, `expectedAwsRoleArn`, defaults, and derived values are
  not presented as required generated stack config fields.
- Existing explicit overrides and runtime default derivation still work.
- `check` output remains concise and actionable, and JSON/evidence output records source metadata
  without leaking true secrets.
- Documentation, generated config, local init output, command help, tests, and evidence all use the
  same field names and resolution order.
- Local values initialization and bootstrap secret writes use the standalone `sprinkleref` command,
  while AWS account stack initialization remains under `control-plane aws-account`.

### 7. Risks

- The local values file could become an accidental plaintext secret store.
- Structured value parsing could make config precedence hard to reason about.
- Redirects could create confusing cycles or accidentally resolve through the wrong category.
- Migrating away from `selected.local.json` could break existing local operator habits.
- Treating local values as an implicit resolver could hide where values came from unless evidence is
  explicit.

### 8. Mitigations

- Mark true secret fields explicitly and reject plaintext stack/local values for them.
- Keep resolution order documented, tested, and reflected in human output.
- Require cycle detection and unknown-category failures for redirects.
- Keep `selected.local.json` as an escape hatch during migration while making the shared-selector plus
  local-values path the preferred default.
- Record source metadata in evidence for every resolved setup input.
- Make `sprinkleref --init-local` preserve existing values and only add missing placeholders so it is
  safe to rerun.

### 9. Consequences of not implementing this PR

Control-plane fresh-account setup will keep relying on either checked-in-ish local stack values,
manual env variables, or per-clone resolver selectors. That makes onboarding harder, makes
multi-account clone setup less reproducible, and increases the chance that developers put secret or
private deployment values in the wrong place.

### 10. Downsides for implementing this PR

It adds a richer config value grammar, local values resolution, and redirect semantics that must be
kept consistent across docs, command output, and evidence.

## PR-2: Local bootstrap redirect classification and init-local follow-ups

### 1. Intent

Close the remaining local SprinkleRef implementation gaps found by the completed end-of-range plan
and design assessments, so bootstrap token guidance, local redirect source metadata, and
`sprinkleref --init-local` behavior match the reviewed design.

### 2. Scope of changes

- Update `control-plane aws-account check` missing-value classification so a missing
  `supabaseAccessToken` is reported as a bootstrap-category action when the token stack field or
  local redirect resolves through `category: "bootstrap"`, instead of always reporting
  `local-values-or-shared-resolver`.
- Preserve local redirect origin metadata for `{ "ref": "...", "category": "..." }` entries loaded
  from `config/sprinkleref/local/values.json`:
  - retain the local values file path as the source path
  - report the redirected ref
  - report the redirect category
  - report the backend used by the redirected resolution when available
  - keep `valuePrinted: false` for true secrets
- Update `sprinkleref --init-local` so generated local coordinate placeholders are empty values, not
  non-empty placeholder strings that count as resolved values.
- Update `sprinkleref --init-local` output to print the next command required to write the
  Supabase Management API token to the selected/default resolver, using the existing update
  semantics:
  `sprinkleref --update secret://control-plane/supabase/management-api-token --create-missing`.
  The default init-local output must not print bootstrap token guidance.
- Keep true secret handling unchanged: `sprinkleref --init-local` must not write plaintext secret
  values into `config/sprinkleref/local/values.json`.
- Do not start broader resolver migration work, remove `selected.local.json` compatibility, or add a
  new `bootstrap://` URI scheme.

### 3. External prerequisites

- A configured `bootstrap` SprinkleRef category is required only when the operator explicitly opts
  the token ref into `category: "bootstrap"`.
- The selected bootstrap backend requirements, such as macOS Keychain availability on macOS, remain
  unchanged from PR-1.

### 4. Tests to be added

- Add `check` tests proving a missing `supabaseAccessToken` is classified as bootstrap when its
  structured ref or local redirect includes `category: "bootstrap"`.
- Add negative or contrast coverage proving non-bootstrap missing refs still use the local-values or
  shared resolver guidance.
- Add JSON evidence tests proving local redirects preserve the
  `config/sprinkleref/local/values.json` source path while also reporting ref, category, backend,
  and `valuePrinted: false` for secret-class values.
- Add `sprinkleref --init-local` tests proving generated local coordinate placeholders are empty and
  therefore still treated as unresolved until the developer fills them.
- Add `sprinkleref --init-local` CLI-output tests proving the default token update command is
  printed without a category and bootstrap command guidance is absent by default.
- Keep existing redaction tests passing for true secrets and add focused regression coverage if the
  metadata changes alter evidence output.

### 5. Docs to be added or updated

- Update [Local SprinkleRef Design](local-sprinkleref.md) if any command text or placeholder wording
  needs to be clarified after implementation.
- Update [SprinkleRef Resolver](sprinkleref.md) to show empty local coordinate placeholders and the
  default token update command emitted by `sprinkleref --init-local`.
- Update [AWS Account Control Plane And Remote Builds](aws-account-control-plane-and-remote-builds.md)
  if check guidance or evidence metadata examples include the stale
  `local-values-or-shared-resolver` classification for bootstrap token refs.
- Update relevant `sprinkleref --help` or `control-plane aws-account check` help text if the
  user-facing command output changes.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/aws-account.ts`
  - `build-tools/tools/deployments/sprinkleref*.ts`
  - `build-tools/tools/tests/deployments/aws-account-cli.test.ts`
  - `build-tools/tools/tests/deployments/sprinkleref*.test.ts`
  - `docs/**`
- Keep changes narrowly focused on assessment follow-ups and avoid unrelated resolver or AWS account
  setup refactors.

### 6. Acceptance criteria

- Missing bootstrap Supabase Management API token guidance points developers to the bootstrap
  category whenever the unresolved token ref resolves through `category: "bootstrap"`.
- JSON evidence for local redirects preserves both the local values source path and redirected
  SprinkleRef metadata without printing true secret values.
- `sprinkleref --init-local` writes empty coordinate placeholders that remain visibly unresolved
  until filled by the developer.
- `sprinkleref --init-local` prints the default token write command using
  `sprinkleref --update ... --create-missing` and does not print bootstrap command guidance by
  default.
- Tests and docs cover the four assessment findings without expanding the PR into unrelated
  implementation work.

### 7. Risks

- Bootstrap classification could become inconsistent between human check output and JSON evidence.
- Empty placeholders could be mistaken for intentionally blank coordinates if diagnostics are not
  clear.
- Preserving both local source and redirected backend metadata could make evidence shape more complex
  than callers expect.

### 8. Mitigations

- Drive bootstrap classification from the same resolved ref/category metadata used for source
  evidence.
- Keep empty placeholders paired with check output that treats them as missing required values.
- Add focused evidence-shape regression tests for local redirects that include source path, ref,
  category, backend, and redaction fields together.

### 9. Consequences of not implementing this PR

Fresh local setup will continue to produce misleading bootstrap-token guidance, local redirect
evidence will obscure that values originated in `config/sprinkleref/local/values.json`, and
`sprinkleref --init-local` will continue generating placeholders that can be mistaken for real
resolved coordinates while omitting the token write command for the selected/default resolver.

### 10. Downsides for implementing this PR

It adds a small amount of metadata and CLI-output coupling that must stay aligned across check
diagnostics, evidence JSON, docs, and tests.

## PR-3: Control-plane category defaults and explicit category precedence

### 1. Intent

Close the remaining local SprinkleRef design-assessment gaps around control-plane setup ref category
selection and ref schemes, so generated control-plane refs explicitly show the `control` category,
non-secret values are not mislabeled as secrets, and explicit stack categories cannot be weakened by
clone-local redirects.

### 2. Scope of changes

- Emit generated control-plane setup refs with explicit `category: "control"` instead of inferring
  category from `control-plane` ref prefixes or resolver defaults.
- Update `control-plane aws-account config-init` output, starter configs, missing-value guidance,
  and setup docs so control-plane setup refs visibly use the `control` category.
- Use `config://...` for non-secret configuration coordinates such as AWS account id, AWS
  organization id, Supabase organization id, and Supabase project ref.
- Reserve `secret://...` for true secrets such as `supabaseAccessToken`; use `runtime://...` for
  runtime/environment-derived values if they are introduced in this setup path.
- Keep explicit category overrides supported for generated control-plane setup refs:
  - a stack value with `category: "bootstrap"` continues to resolve through `bootstrap`
  - a stack value with another configured category resolves through that configured category
  - missing or unknown categories still fail clearly
- Harden stack-ref resolution so an explicit stack config category wins before local values
  resolution where required, including `supabaseAccessToken` resolution.
- Prevent a local values redirect object from overriding an explicit category declared on the stack
  config value for the same ref.
- Preserve local values redirects for stack refs that do not declare an explicit category; those
  redirects may still provide their own `category` according to the PR-1 model.
- Keep setup-shell environment fallback behavior unchanged for the Supabase Management API token.
- Do not infer category from any `secret://...`, `config://...`, or `runtime://...` scheme/path
  prefix, add a `bootstrap://` URI scheme, or remove existing `selected.local.json`
  compatibility.

### 3. External prerequisites

- A configured `control` SprinkleRef category is required for generated control-plane setup refs
  that are resolved remotely.
- A configured `bootstrap` category is required only when the stack config explicitly selects
  `category: "bootstrap"` or an allowed local redirect selects bootstrap for a ref without an
  explicit stack category.

### 4. Tests to be added

- Add `config-init` tests proving generated control-plane setup refs include explicit
  `category: "control"` and non-secret setup coordinates use `config://...`.
- Add starter config or fixture tests proving docs/templates no longer hide generated
  control-plane setup ref category selection behind `main` or prefix inference.
- Add remote resolution tests proving a bare `config://control-plane/...` or
  `secret://control-plane/...` stack ref does not infer `control` from its prefix, while generated
  explicit `category: "control"` refs use the control lane.
- Add override tests proving an explicit stack category such as `bootstrap` or another configured
  category still wins over the `control` default.
- Add hardening tests for `resolveSupabaseAccessToken` proving a stack config ref with
  `category: "bootstrap"` resolves through bootstrap before local redirects can affect category
  selection.
- Add local values precedence tests proving a local redirect with its own category cannot override
  an explicit stack category, while the same local redirect can still provide a category when the
  stack ref has no explicit category.
- Add negative tests proving unknown categories and malformed local redirect category overrides
  still fail closed.

### 5. Docs to be added or updated

- Update [Local SprinkleRef Design](local-sprinkleref.md) if the final implementation needs sharper
  wording for default category selection or explicit category hardening.
- Update [SprinkleRef Resolver](sprinkleref.md) to document that generated control-plane setup refs
  declare `category: "control"` explicitly unless a stack config value selects another category.
- Update [AWS Account Control Plane And Remote Builds](aws-account-control-plane-and-remote-builds.md)
  with corrected starter config examples, setup guidance, and category precedence examples for
  `supabaseAccessToken`.
- Update relevant `control-plane aws-account config-init`, `check`, and `sprinkleref` help text if
  command output mentions default categories or local redirect precedence.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/aws-account.ts`
  - `build-tools/tools/deployments/sprinkleref*.ts`
  - `build-tools/tools/tests/deployments/aws-account-cli.test.ts`
  - `build-tools/tools/tests/deployments/sprinkleref*.test.ts`
  - `docs/**`
  - reviewed starter config examples under `config/**`, if present
- Keep changes narrowly focused on category defaults and precedence hardening.

### 6. Acceptance criteria

- Generated control-plane setup refs include explicit `category: "control"` and resolve through
  that category unless the stack config explicitly selects another configured category.
- Starter configs, docs, command help, and tests no longer teach hidden prefix-based or `main`
  category selection for generated control-plane setup refs.
- Missing-value output no longer labels non-secret setup coordinates as `secret://...`; it uses
  `config://...` and shows the relevant category when known.
- An explicit stack config category for `supabaseAccessToken` or another control-plane setup ref
  cannot be overridden by `config/sprinkleref/local/values.json`.
- Local redirect category selection still works for stack refs that have no explicit category.
- Tests cover explicit generated category selection, absence of prefix-based category inference,
  explicit category overrides, local redirect precedence, and failure cases for unknown or
  malformed categories.

### 7. Risks

- Making generated stack config explicitly select `control` could surprise existing local setups
  that implicitly relied on `main`.
- Category precedence can be hard to diagnose if human output and evidence do not show the winning
  category clearly.
- Hardening explicit stack categories could make some existing local redirect shortcuts stop
  working when they were masking a mismatched stack config.

### 8. Mitigations

- Keep the change scoped to generated control-plane setup refs and document the migration from
  `main` to `control` in the setup docs.
- Reuse the same resolved ref/category metadata in diagnostics and evidence so the winning category
  is visible without printing secret values.
- Add contrast tests that preserve local redirect category behavior when no explicit stack category
  is present.

### 9. Consequences of not implementing this PR

Generated control-plane setup refs will continue resolving through the selected resolver default or
starter-config `main` defaults instead of the design-specified `control` category, and explicit token
stack categories can still be weakened by clone-local redirects.

### 10. Downsides for implementing this PR

It tightens category precedence in a way that may require local setup docs and diagnostics to be more
explicit about which category is used for each control-plane setup ref.

## PR-4: AWS account check guardrails and required organization coordinate

### 1. Intent

Close the latest end-of-range design-assessment findings in AWS account setup by applying the
existing bootstrap-category safety guard to AWS account stack ref resolution and by making
`awsOrganizationId` a blocking required setup coordinate in `control-plane aws-account check`.

### 2. Scope of changes

- Harden AWS account stack ref resolution so explicit stack refs and local-value redirects that
  select `category: "bootstrap"` go through the same bootstrap-category guard used by generic
  SprinkleRef paths.
- Prevent AWS account setup from resolving Infisical access credentials through an Infisical-backed
  `bootstrap` category when the ref is reached through AWS account-specific resolution helpers.
- Keep valid bootstrap-category usage working when the configured bootstrap backend satisfies the
  existing guardrail, such as `macos-keychain`, `local-file`, or another allowed non-Infisical
  bootstrap backend.
- Reuse the existing bootstrap guard implementation or a narrow shared wrapper instead of adding a
  second AWS account-only guard with different behavior.
- Update `control-plane aws-account check` required-coordinate handling so missing
  `awsOrganizationId` is reported as a blocking missing value, matching generated config and design
  expectations.
- Ensure missing `awsOrganizationId` guidance points to the correct source based on the configured
  stack value:
  - local values when the generated or selected ref is meant to be clone-local
  - shared resolver/category guidance when remote resolution is expected
  - config guidance when the stack field is absent or malformed
- Keep `awsOrganizationId` non-secret: use `config://...` examples, do not redact it as a true
  secret, and do not suggest secret-token write commands for it.
- Do not broaden this PR into resolver migration work, Supabase plan handling, direct AWS
  provisioning, or removal of `selected.local.json` compatibility.

### 3. External prerequisites

- Existing resolver category configuration remains the source of truth for whether `bootstrap`
  uses Infisical or an allowed bootstrap backend.
- AWS Organizations access is still required only for real account checks that validate the
  coordinate against AWS; this PR only makes the configured `awsOrganizationId` presence check
  consistent with setup requirements.

### 4. Tests to be added

- Add AWS account stack ref tests proving a structured stack ref with `category: "bootstrap"` fails
  closed when the configured bootstrap category is Infisical-backed for Infisical access
  credentials.
- Add AWS account local redirect tests proving a local value redirect with `category: "bootstrap"`
  also triggers the same bootstrap guard before resolving through an Infisical-backed bootstrap
  category.
- Add contrast tests proving allowed bootstrap backends still resolve through AWS account stack ref
  resolution and preserve category/source metadata.
- Add regression coverage proving AWS account-specific ref resolution cannot bypass
  `sprinkleref-bootstrap-guard.ts` by calling lower-level backend/store helpers directly.
- Add `control-plane aws-account check` human-output tests proving a missing `awsOrganizationId` is
  listed as a blocking missing coordinate alongside other required account setup values.
- Add check guidance tests for `awsOrganizationId` covering absent stack config, unresolved local
  values, and unresolved shared resolver/category paths.
- Add JSON evidence or status tests proving unresolved `awsOrganizationId` is represented as a
  missing required non-secret coordinate without secret redaction fields or token guidance.

### 5. Docs to be added or updated

- Update [Local SprinkleRef Design](local-sprinkleref.md) if the AWS account resolver wrapper or
  guard flow needs clearer wording after implementation.
- Update [SprinkleRef Resolver](sprinkleref.md) to clarify that the bootstrap guard applies to
  higher-level AWS account stack ref resolution, not only standalone `sprinkleref` commands.
- Update [AWS Account Control Plane And Remote Builds](aws-account-control-plane-and-remote-builds.md)
  with `awsOrganizationId` as a required setup coordinate in `check` output examples and setup
  troubleshooting guidance.
- Update relevant `control-plane aws-account check` help text or diagnostics if they list required
  coordinates or source-specific remediation commands.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/aws-account.ts`
  - `build-tools/tools/deployments/sprinkleref-bootstrap-guard.ts`
  - `build-tools/tools/deployments/sprinkleref*.ts`
  - `build-tools/tools/tests/deployments/aws-account-cli.test.ts`
  - `build-tools/tools/tests/deployments/sprinkleref*.test.ts`
  - `docs/**`
- Keep changes narrowly focused on AWS account setup ref guardrails and missing-coordinate
  diagnostics.

### 6. Acceptance criteria

- AWS account stack ref resolution cannot resolve Infisical access credentials through an
  Infisical-backed `bootstrap` category, whether `bootstrap` is selected directly in stack config or
  through `config/sprinkleref/local/values.json`.
- AWS account ref resolution and generic SprinkleRef resolution share the same bootstrap guard
  behavior and test coverage.
- Allowed bootstrap backends still work for explicit bootstrap opt-in and retain useful
  source/category metadata.
- `control-plane aws-account check` treats missing `awsOrganizationId` as a blocking required
  coordinate.
- Human output, JSON/status evidence, docs, and help text guide developers to fill
  `awsOrganizationId` through config, local values, or the shared resolver as appropriate.
- `awsOrganizationId` remains modeled as a non-secret `config://...` coordinate and is not confused
  with Supabase token guidance.

### 7. Risks

- Wiring the bootstrap guard too low in the resolver stack could accidentally block unrelated
  bootstrap-category reads that are not Infisical access credentials.
- Adding `awsOrganizationId` to blocking check output could expose stale local setup fixtures that
  never populated the generated coordinate.
- Source-specific missing-value guidance could drift from the actual resolution path if it is
  implemented separately from ref metadata.

### 8. Mitigations

- Reuse the existing bootstrap guard at the AWS account ref-resolution boundary where the credential
  purpose is known.
- Update fixtures and tests that represent valid generated setup config to include the required
  organization id ref or an explicit missing-value expectation.
- Drive `awsOrganizationId` guidance from the same resolution metadata used for other required
  coordinates.

### 9. Consequences of not implementing this PR

AWS account setup can still bypass the design's bootstrap safety guard when resolving account stack
refs, and `control-plane aws-account check` can continue passing or under-guiding incomplete setup
state that lacks the required AWS organization id.

### 10. Downsides for implementing this PR

It adds another required missing-coordinate diagnostic and tightens bootstrap resolution in AWS
account setup, which may require existing local fixtures and docs to become more explicit about
their intended resolver category and organization id source.
