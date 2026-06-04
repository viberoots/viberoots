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

## PR-5: Explicit category precedence over local value entries

### 1. Intent

Close the remaining explicit-category precedence gap in local SprinkleRef resolution so an explicit
stack category wins over every local value form, not only local redirect objects.

### 2. Scope of changes

- Update stack ref resolution so `categoryExplicit` prevents `config/sprinkleref/local/values.json`
  scalar entries from satisfying the ref before the explicit category is resolved.
- Apply the same explicit-category precedence to local `{ "value": ... }` entries, so local
  non-secret values cannot bypass a stack config category such as `control`, `bootstrap`, or another
  configured category.
- Preserve the PR-3 behavior where local redirect objects cannot override an explicit stack
  category for the same ref.
- Preserve PR-1 local-first resolution for stack refs that do not declare an explicit category,
  including scalar entries, `{ "value": ... }` entries, and redirect objects.
- Keep true secret plaintext rejection unchanged for local scalar values and local `{ "value": ... }`
  entries.
- Do not change category defaults, generated stack config shape, bootstrap guard behavior, or
  `selected.local.json` compatibility.

### 3. External prerequisites

- The explicit category named in stack config must already be configured in the selected
  SprinkleRef resolver config.
- Local value files remain clone-local and gitignored; this PR only changes when they are allowed
  to satisfy an explicitly categorized stack ref.

### 4. Tests to be added

- Add regression tests proving an explicit stack category wins when
  `config/sprinkleref/local/values.json` contains a matching non-secret scalar value.
- Add regression tests proving an explicit stack category wins when the local file contains a
  matching `{ "value": ... }` object.
- Keep or extend existing local redirect precedence tests proving redirect objects cannot override
  an explicit stack category.
- Add contrast tests proving local scalar values and local `{ "value": ... }` entries still satisfy
  stack refs that do not declare an explicit category.
- Add secret-class contrast coverage proving plaintext local scalar and `{ "value": ... }` entries
  are still rejected for true secrets rather than resolving locally or through the explicit category
  path.

### 5. Docs to be added or updated

- Update [Local SprinkleRef Design](local-sprinkleref.md) if the explicit-category precedence rules
  need clearer wording for scalar and `{ "value": ... }` local entries.
- Update [SprinkleRef Resolver](sprinkleref.md) to state that explicit stack categories bypass all
  local value forms for category selection, while uncategorized refs still use local-first
  resolution.
- Update [AWS Account Control Plane And Remote Builds](aws-account-control-plane-and-remote-builds.md)
  if setup examples or troubleshooting text describe local values as overriding explicitly
  categorized stack refs.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/aws-account.ts`
  - `build-tools/tools/deployments/sprinkleref*.ts`
  - `build-tools/tools/tests/deployments/aws-account-cli.test.ts`
  - `build-tools/tools/tests/deployments/sprinkleref*.test.ts`
  - `docs/**`
- Keep changes narrowly focused on explicit category precedence over local scalar and value-object
  entries.

### 6. Acceptance criteria

- A stack ref with an explicit category resolves through that category even when a matching local
  scalar value exists.
- A stack ref with an explicit category resolves through that category even when a matching local
  `{ "value": ... }` entry exists.
- Local redirect objects, local scalar values, and local `{ "value": ... }` entries cannot weaken or
  bypass an explicit stack category.
- Stack refs without an explicit category continue to use local-first resolution for all valid local
  value forms.
- Tests and docs cover scalar, `{ "value": ... }`, and redirect local value forms under explicit
  and implicit category selection.

### 7. Risks

- Tightening explicit-category precedence could surprise local setups that expected local non-secret
  values to override a generated explicit category.
- The resolver could accidentally skip local values for uncategorized refs if the explicit-category
  branch is applied too broadly.

### 8. Mitigations

- Gate the behavior only on the existing `categoryExplicit` signal passed into stack ref resolution.
- Add contrast tests for uncategorized refs to preserve PR-1 local-first behavior.
- Keep diagnostics and docs clear that local values are local-first only when the stack ref does not
  select a category explicitly.

### 9. Consequences of not implementing this PR

Explicit stack categories can still be bypassed by matching non-secret local scalar values or local
`{ "value": ... }` entries, leaving PR-3 category precedence incomplete and under-tested.

### 10. Downsides for implementing this PR

It slightly reduces local override convenience for explicitly categorized stack refs, requiring
developers to change the stack category or resolver value instead of relying on a local scalar/value
entry for those refs.

## PR-6: AWS account help output for local SprinkleRef setup

### 1. Intent

Update `control-plane aws-account --help` so its first-run guidance reflects the implemented local
SprinkleRef setup flow instead of the older direct `bootstrap --domain ... --expected-aws-account-id
...` command shape.

### 2. Scope of changes

- Replace the stale `normal first run: control-plane aws-account bootstrap --domain <domain>
--expected-aws-account-id <id>` help example with the canonical PR-1 through PR-5 setup sequence.
- Ensure the help output points developers to `control-plane aws-account config-init` and
  `sprinkleref --init-local` as the expected local setup entry points.
- Include required `awsOrganizationId` guidance in the help text alongside the existing required AWS
  account setup coordinates.
- Describe structured refs and the intended config/local/shared value sources at help level without
  duplicating the full resolver documentation.
- Keep token handling guidance accurate: local token setup belongs in local SprinkleRef bootstrap
  configuration, while non-secret coordinates such as `awsOrganizationId` use config or resolver
  values rather than secret-token write commands.
- Do not change command behavior, resolver behavior, bootstrap guard behavior, or setup file formats.

### 3. External prerequisites

- The PR-1 through PR-5 local SprinkleRef setup flow remains the canonical AWS account first-run
  model.
- Generated setup config continues to require `awsOrganizationId` as a non-secret AWS account
  coordinate.

### 4. Tests to be added

- Add focused CLI help coverage for `control-plane aws-account --help` proving the first-run
  guidance names `config-init` and `sprinkleref --init-local`.
- Assert the help output no longer advertises the stale `aws-account bootstrap --domain <domain>
--expected-aws-account-id <id>` normal-first-run example.
- Add help assertions for required `awsOrganizationId` guidance and structured ref/source language
  that distinguishes config, local, and shared resolver setup paths.
- Add help assertions proving token guidance remains scoped to local SprinkleRef bootstrap setup and
  does not suggest secret-token write commands for `awsOrganizationId`.

### 5. Docs to be added or updated

- Update [AWS Account Control Plane And Remote Builds](aws-account-control-plane-and-remote-builds.md)
  if its command-help examples or first-run wording still mirror the older bootstrap-only flow.
- Update [Local SprinkleRef Design](local-sprinkleref.md) only if the concise help wording exposes an
  unclear or missing first-run term that should also be documented.
- Keep docs aligned with command help so `config-init`, `sprinkleref --init-local`,
  `awsOrganizationId`, structured refs, config/local/shared sources, and token handling are described
  consistently.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/aws-account.ts`
  - `build-tools/tools/tests/deployments/aws-account-cli.test.ts`
  - `docs/**`
- Keep changes narrowly focused on AWS account command help and matching docs/tests.

### 6. Acceptance criteria

- `control-plane aws-account --help` presents `config-init` and `sprinkleref --init-local` as the
  normal local SprinkleRef first-run setup flow.
- The old `aws-account bootstrap --domain <domain> --expected-aws-account-id <id>` normal-first-run
  guidance is removed from help output.
- Help output identifies `awsOrganizationId` as a required non-secret coordinate.
- Help output gives concise structured ref and config/local/shared source guidance that matches the
  local SprinkleRef docs and generated setup expectations.
- Help output keeps token handling tied to local SprinkleRef bootstrap setup and does not confuse
  `awsOrganizationId` with secret-token commands.
- Focused tests cover the help output regressions and docs are aligned where they reference the same
  setup flow.

### 7. Risks

- Overloading command help with resolver details could make the output harder to scan.
- Help wording could drift from the generated setup config or resolver docs if it hardcodes too many
  examples.

### 8. Mitigations

- Keep command help as concise first-run guidance and link or point to detailed docs for resolver
  mechanics.
- Assert only stable setup terms and required coordinates in tests, while leaving detailed examples
  to docs.

### 9. Consequences of not implementing this PR

Developers can still be directed toward an obsolete first-run command shape, missing the required
local SprinkleRef setup path, `awsOrganizationId`, structured refs, source guidance, and current
token handling expectations.

### 10. Downsides for implementing this PR

It adds focused help-output assertions that may need small updates when the first-run command wording
changes, but keeps those updates isolated to AWS account setup guidance.

## PR-7: Local values resolver hardening for explicit categories and malformed roots

### 1. Intent

Close the remaining local values resolver hardening gaps so explicit stack categories cannot be
bypassed by redirecting to a different logical ref, and malformed local values roots fail clearly
instead of being treated as missing local values.

### 2. Scope of changes

- Update stack ref resolution so `categoryExplicit` also prevents local redirect objects from
  changing the logical target ref before category resolution.
- Ensure a stack config such as `{ "ref": "config://control-plane/aws/account-id", "category":
"ops" }` cannot be redirected by `config/sprinkleref/local/values.json` to another ref and then
  resolved through the explicit `ops` category.
- Preserve local redirect behavior for stack refs that do not declare an explicit category.
- Keep same-ref explicit category precedence from PR-3 and PR-5 unchanged for local redirect,
  scalar, and `{ "value": ... }` entries.
- Update resolver local values loading so a parsed scalar, array, or other non-object root in
  `config/sprinkleref/local/values.json` fails with a clear malformed-local-values diagnostic.
- Keep JSON parse errors as clear failures and keep missing local values files as non-errors.
- Align resolver behavior with `sprinkleref --init-local`, which already validates the local values
  root as an object.
- Do not change local values path conventions, stack config shape, category defaults, generated AWS
  account setup config, or `selected.local.json` compatibility.

### 3. External prerequisites

- The explicit category named in stack config must already be configured in the selected
  SprinkleRef resolver config.
- Local value files remain clone-local and gitignored; this PR only changes malformed-file handling
  and redirect eligibility under explicit category selection.

### 4. Tests to be added

- Add regression tests proving an explicit stack category wins when the local values file contains a
  redirect object for the same logical ref that points to a different target ref.
- Add contrast tests proving the same different-ref local redirect still works for a stack ref that
  does not declare an explicit category.
- Keep or extend same-ref local redirect coverage proving explicit category precedence remains
  intact for redirect objects that do not change the logical ref.
- Add malformed local values root tests for parsed scalar and array roots, asserting clear failure
  diagnostics rather than missing-value fallthrough.
- Add at least one non-object root contrast case that is not a JSON parse error, so resolver tests
  cover the gap separately from existing invalid JSON coverage.
- Keep missing-file and valid object-root tests passing to prove only malformed present files now
  fail.

### 5. Docs to be added or updated

- Update [Local SprinkleRef Design](local-sprinkleref.md) to state that explicit stack categories
  prevent local redirect target-ref changes, not just local category or value overrides.
- Update [SprinkleRef Resolver](sprinkleref.md) to document that
  `config/sprinkleref/local/values.json` must parse to an object root and that scalar, array, or
  other non-object roots fail clearly.
- Update AWS account setup docs only if their troubleshooting text describes local redirect behavior
  or malformed local values files in a way that conflicts with this hardened resolver behavior.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/sprinkleref*.ts`
  - `build-tools/tools/tests/deployments/sprinkleref*.test.ts`
  - `docs/**`
- Keep changes narrowly focused on explicit-category redirect target-ref protection and malformed
  local values root diagnostics.

### 6. Acceptance criteria

- A stack ref with an explicit category resolves through its original logical ref and explicit
  category even when local values contain a redirect to a different ref.
- Local redirect objects cannot weaken or bypass an explicit stack category by changing the logical
  target ref.
- Stack refs without an explicit category continue to support local redirect objects, including
  redirects to a different logical ref.
- A present `config/sprinkleref/local/values.json` whose parsed root is a scalar, array, or other
  non-object fails clearly.
- Missing local values files remain optional and valid object-root local values files continue to
  resolve as before.
- Tests and docs cover different-ref redirects under explicit category selection and malformed
  local values root handling.

### 7. Risks

- Tightening redirect handling could accidentally disable valid local redirects for uncategorized
  refs.
- Failing on malformed local values roots can surface previously hidden corrupt local files in
  developer clones.

### 8. Mitigations

- Gate redirect target-ref protection only on the existing `categoryExplicit` signal.
- Add contrast tests for uncategorized different-ref redirects so local-first resolution remains
  available where no explicit category was selected.
- Keep the malformed-root diagnostic specific to `config/sprinkleref/local/values.json` and the
  expected object root shape so corrupt local files are easy to repair.

### 9. Consequences of not implementing this PR

Explicit stack categories can still be bypassed by local redirects that change the logical ref, and
corrupt local values files that parse to scalar or array roots can still be silently treated as
missing local values.

### 10. Downsides for implementing this PR

It further limits local redirect convenience for explicitly categorized stack refs and turns some
previously tolerated malformed local files into resolver errors, but keeps both changes aligned with
the documented explicit-category and init-local validation contracts.

## PR-8: Source-specific local values evidence paths

### 1. Intent

Close the remaining local values evidence gap by recording and exposing the resolved hierarchical
local values path used for each local value, so evidence can distinguish the local file source from
the exact `values.*` entry that resolved the stack input.

### 2. Scope of changes

- Extend local values resolution metadata so evidence includes the resolved local hierarchical path,
  such as `values.control-plane.aws.account-id`, when a stack input is resolved from
  `config/sprinkleref/local/values.json`.
- Preserve existing evidence fields including `source`, `ref`, `localValuesPath`, and
  `valuePrinted`.
- Keep redaction behavior unchanged for secrets and preserve existing source metadata for inline,
  default, local-values, and shared SprinkleRef resolver sources.
- Record the resolved local hierarchical path for scalar local entries.
- Record the resolved local hierarchical path for local `{ "value": ... }` entries.
- Record the applicable local hierarchical path for redirect entries, preserving both local-source
  metadata and redirected backend metadata where evidence already exposes redirect resolution.
- Do not change local values file shape, stack config shape, redirect semantics, category
  precedence, generated AWS account setup config, or selected resolver compatibility.

### 3. External prerequisites

- Local values continue to live in `config/sprinkleref/local/values.json` and remain clone-local and
  gitignored.
- Existing redaction classification for stack inputs must already identify whether the resolved value
  is safe to print.

### 4. Tests to be added

- Add JSON evidence tests proving scalar local values include the resolved hierarchical local values
  path while preserving `source`, `ref`, `localValuesPath`, and `valuePrinted`.
- Add JSON evidence tests proving local `{ "value": ... }` entries include the resolved
  hierarchical local values path with unchanged redaction behavior.
- Add JSON evidence tests proving local redirect entries expose the applicable local hierarchical
  path and continue to preserve redirected ref/backend metadata.
- Add secret-value regression coverage proving the new local path metadata does not print or
  otherwise expose redacted values.
- Keep existing local resolution source assertions passing while extending them to assert the
  source-specific hierarchical path.

### 5. Docs to be added or updated

- Update [Local SprinkleRef Design](local-sprinkleref.md) to document that local-values evidence
  records both the local values file path and the resolved hierarchical `values.*` path.
- Update [SprinkleRef Resolver](sprinkleref.md) if its evidence metadata examples omit the resolved
  local hierarchical path for scalar, `{ "value": ... }`, or redirect entries.
- Update AWS account setup docs only if their evidence examples include local-values source metadata
  that would otherwise omit the resolved hierarchical path.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/sprinkleref*.ts`
  - `build-tools/tools/tests/deployments/sprinkleref*.test.ts`
  - `docs/**`
- Keep changes narrowly focused on local-values evidence metadata and matching docs/tests.

### 6. Acceptance criteria

- Evidence for scalar local values records the resolved hierarchical local values path such as
  `values.control-plane.aws.account-id`.
- Evidence for local `{ "value": ... }` entries records the same resolved hierarchical path while
  preserving redaction.
- Evidence for local redirect entries records the applicable local hierarchical path and still
  preserves redirected source metadata.
- Existing evidence fields `source`, `ref`, `localValuesPath`, and `valuePrinted` remain present and
  semantically unchanged.
- Tests assert the new source-specific local values path for scalar, `{ "value": ... }`, and redirect
  local resolution paths.
- Docs describe the distinction between the local values file path and the resolved hierarchical
  `values.*` path.

### 7. Risks

- Adding another evidence field could make local-values metadata harder to read if its name overlaps
  with the existing local file path field.
- Redirect evidence could become ambiguous if the local path and redirected backend metadata are not
  clearly separated.

### 8. Mitigations

- Use a field name and docs wording that distinguish the local values file path from the resolved
  hierarchical `values.*` path.
- Add redirect-specific evidence tests that assert both the local hierarchical path and redirected
  metadata remain visible and distinct.
- Keep redaction assertions paired with the new metadata so source-specific evidence does not leak
  secret values.

### 9. Consequences of not implementing this PR

Local-values evidence will continue to identify the source file and logical ref but not the exact
hierarchical local entry that resolved the value, leaving the design's source-specific evidence
requirement only partially implemented.

### 10. Downsides for implementing this PR

It adds one more evidence metadata field and corresponding regression assertions, but keeps the
behavior limited to source-specific local-values observability without changing resolution
semantics.

## PR-9: Track shared resolver config and remove stale token-ref CLI inputs

### 1. Intent

Close the latest end-of-range design-assessment findings by making shared SprinkleRef resolver
config trackable while keeping clone-local values ignored, and by removing the stale
`supabaseAccessTokenRef` public CLI naming from AWS account setup unless a focused migration test
proves an intentional compatibility path is still required.

### 2. Scope of changes

- Replace or anchor the broad `.gitignore` rule that ignores every directory named `sprinkleref/`
  so shared resolver config under `config/sprinkleref/` can be tracked.
- Keep only clone-local SprinkleRef values ignored, especially `config/sprinkleref/local/`.
- Ensure shared resolver policy files such as `config/sprinkleref/base.json` and
  `config/sprinkleref/selected.json` are not ignored by the repo ignore policy.
- Preserve `config/sprinkleref/selected.local.json` compatibility as an escape hatch or migration
  artifact, but do not let the ignore policy hide the shared `selected.json` default.
- Remove or rename the stale AWS account CLI flags:
  - `--supabase-access-token-ref`
  - `--supabase-access-token-ref-category`
- Prefer the current `supabaseAccessToken` structured value model for CLI/help/config surfaces.
- If removal would break a documented compatibility requirement, keep the old flags only as
  explicitly documented compatibility aliases with focused migration coverage proving their
  behavior is intentional and does not reintroduce `supabaseAccessTokenRef` into generated config.
- Keep true secret handling unchanged: no plaintext Supabase Management API token values in stack
  config, local values, generated config, command output, or evidence.
- Do not broaden this PR into resolver semantics, local values precedence, category defaults, or
  `selected.local.json` removal.

### 3. External prerequisites

- None beyond the existing local SprinkleRef setup flow and repo-local gitignore hygiene.
- Any compatibility decision for old token-ref flags must be justified by an existing documented
  user or migration requirement.

### 4. Tests to be added

- Add repository hygiene or gitignore tests proving `config/sprinkleref/base.json` and
  `config/sprinkleref/selected.json` are not ignored.
- Add gitignore coverage proving `config/sprinkleref/local/` remains ignored for clone-local values.
- Add CLI tests proving `--supabase-access-token-ref` and
  `--supabase-access-token-ref-category` are removed or rejected if no compatibility requirement
  exists.
- Add command help tests proving stale `supabaseAccessTokenRef` naming no longer appears in public
  AWS account setup help.
- If compatibility aliases are retained, add focused migration tests proving the old flags map to
  the new `supabaseAccessToken` structured model, produce deprecation guidance, and do not appear in
  generated config or normal docs.
- Keep existing secret-class tests passing for `supabaseAccessToken` redaction and plaintext
  rejection.

### 5. Docs to be added or updated

- Update `.gitignore` comments or local setup docs to explain that shared resolver config under
  `config/sprinkleref/` is tracked while `config/sprinkleref/local/` is ignored.
- Update [SprinkleRef Resolver](sprinkleref.md) to clarify that `config/sprinkleref/selected.json`
  is the tracked shared selector and `selected.local.json` is only an escape hatch or migration
  artifact.
- Update [AWS Account Control Plane And Remote Builds](aws-account-control-plane-and-remote-builds.md)
  and relevant command help so token setup uses `supabaseAccessToken` terminology and does not
  advertise stale `supabaseAccessTokenRef` inputs.
- If old token-ref CLI flags are intentionally retained as compatibility aliases, document their
  deprecated status narrowly and point users to the `supabaseAccessToken` structured value model.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `.gitignore`
  - `build-tools/tools/deployments/aws-account.ts`
  - `build-tools/tools/tests/deployments/aws-account-cli.test.ts`
  - `build-tools/tools/tests/deployments/sprinkleref*.test.ts`
  - `docs/**`
  - tracked shared resolver config examples under `config/sprinkleref/**`, if present
- Keep changes narrowly focused on ignore policy hygiene and stale token-ref CLI surface cleanup.

### 6. Acceptance criteria

- `config/sprinkleref/base.json` and `config/sprinkleref/selected.json` can be tracked by git.
- `config/sprinkleref/local/` remains ignored for clone-local values.
- Public AWS account setup CLI/help/config surfaces no longer use stale
  `supabaseAccessTokenRef` naming unless explicitly retained as a documented deprecated migration
  alias.
- Generated stack config and normal docs continue to use the `supabaseAccessToken` structured value
  model.
- Tests cover tracked shared resolver config, ignored local values, and either removal/rejection of
  old token-ref flags or their intentional compatibility mapping.

### 7. Risks

- Narrowing the ignore rule could accidentally allow clone-local secret or private values outside
  `config/sprinkleref/local/` to become visible to git.
- Removing old token-ref flags could break local scripts that used an obsolete public CLI surface.
- Keeping compatibility aliases without clear tests could prolong stale naming and confuse setup
  docs.

### 8. Mitigations

- Anchor the ignore policy to the intended clone-local path and add hygiene tests for both tracked
  shared files and ignored local values.
- Prefer removal or rename of old token-ref flags when no compatibility requirement is documented.
- If aliases are retained, make them deprecated, tested, and absent from generated config and normal
  docs.

### 9. Consequences of not implementing this PR

Shared resolver policy such as `config/sprinkleref/selected.json` can remain silently ignored by
git, forcing per-clone selector drift, while public AWS account setup continues exposing stale
token-ref CLI names that conflict with the planned `supabaseAccessToken` structured config model.

### 10. Downsides for implementing this PR

It tightens repository ignore hygiene and CLI naming in ways that may require small updates to local
setup scripts or fixtures, but keeps the change limited to tracked shared config policy and stale
public token-ref inputs.
