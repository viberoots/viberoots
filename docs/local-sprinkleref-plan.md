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

## PR-10: Infisical storage mapping and production control profile

### 1. Intent

Close the newly identified Infisical backend mismatch by keeping SprinkleRef refs backend-neutral
while mapping them onto Infisical's native folder/key model, and simplify the tracked control-plane
resolver profile so the `control` category uses the existing `prod` Infisical environment instead
of a separate `control` environment.

### 2. Scope of changes

- Keep logical SprinkleRef refs unchanged, such as
  `secret://control-plane/supabase/management-api-token`, `config://control-plane/aws/account-id`,
  and `runtime://...`.
- Do not write the full logical URI into Infisical's `Key` / `secretName` field.
- Derive Infisical storage coordinates from the logical ref by stripping the URI scheme:
  - `secret://control-plane/supabase/management-api-token`
  - backend storage key `/control-plane/supabase/management-api-token`
  - Infisical `secretPath` `/control-plane/supabase`
  - Infisical `secretName` / UI `Key` `management-api-token`
- Preserve the full logical ref in Infisical metadata when the API supports metadata, for example
  `sprinkleref=secret://control-plane/supabase/management-api-token`, so reverse lookup and audit
  evidence can recover the original backend-neutral ref.
- Apply the same path/name derivation to Infisical read, presence check, add, update, and remove
  paths.
- Avoid the current last-segment-only mapping that writes every logical ref into the backend
  default path and risks collisions between refs with the same final segment.
- Keep non-Infisical backends unchanged unless their docs need to clarify that only the Infisical
  adapter splits logical refs into `secretPath` and `secretName`.
- Update tracked SprinkleRef config so the `control` category/profile uses the `prod` Infisical
  environment for now instead of `control`.
- Update docs that currently describe or show `defaultEnvironment: "control"` so they explain that
  the `control` category is a resolver lane backed by the `prod` Infisical environment until a
  separate control environment is introduced deliberately.
- Do not remove the `control` category itself; keep it as an explicit, reviewable resolver lane for
  control-plane setup refs.
- Do not infer backend paths from UI folder state outside the deterministic logical-ref mapping.

### 3. External prerequisites

- Infisical projects must allow secrets to be created under folder paths such as
  `/control-plane/supabase`.
- Operators may need to move existing manually created root-level Infisical secrets into the derived
  folder path if they were created with the previous last-segment-only mapping.
- The tracked resolver config can continue to use the existing Infisical project and machine
  identity credentials.

### 4. Tests to be added

- Add Infisical adapter tests proving a ref such as
  `secret://control-plane/supabase/management-api-token` calls the API with
  `secretName=management-api-token` and `secretPath=/control-plane/supabase`.
- Add tests proving two refs with the same final segment but different logical paths do not collide
  because they use different Infisical `secretPath` values.
- Add read, add/update, has, and remove coverage so all Infisical operations use the same derived
  `secretPath`/`secretName` mapping.
- Add metadata tests proving the full logical SprinkleRef ref is included in Infisical
  `secretMetadata` or the closest supported metadata/comment field without printing secret values.
- Add regression tests proving non-Infisical backends keep their existing storage behavior.
- Add config tests proving the tracked `control` resolver profile points to the `prod` Infisical
  environment and that generated control-plane refs still explicitly select `category: "control"`.
- Add docs or config fixture tests proving no current docs imply that the Infisical UI `Key` should
  contain a `secret://` URI.

### 5. Docs to be added or updated

- Update [Local SprinkleRef Design](local-sprinkleref.md) to describe the Infisical-specific
  backend mapping from logical refs to folder path plus key.
- Update [SprinkleRef Resolver](sprinkleref.md) to document that Infisical's UI `Key` is the final
  logical-ref segment and the folder breadcrumb is the rest of the stripped logical ref path.
- Update AWS account setup docs if they show the Supabase Management API token location, using the
  example:
  - environment `prod`
  - folder `/control-plane/supabase`
  - key `management-api-token`
- Update tracked config examples under `config/sprinkleref/**` so the `control` profile uses
  `defaultEnvironment: "prod"` until a separate control environment is intentionally introduced.
- Document that the `control` category remains distinct from `main` as resolver policy, even when
  both categories currently target the same Infisical environment.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/sprinkleref-infisical.ts`
  - `build-tools/tools/tests/deployments/sprinkleref-infisical.test.ts`
  - `build-tools/tools/tests/deployments/infisical.test-server.ts`
  - `config/sprinkleref/**`
  - `docs/**`
- Keep changes narrowly focused on Infisical storage coordinate mapping and the tracked control
  profile environment.

### 6. Acceptance criteria

- Infisical API calls never use a full `secret://`, `config://`, or `runtime://` URI as
  `secretName`.
- `secret://control-plane/supabase/management-api-token` maps to Infisical folder
  `/control-plane/supabase` and key `management-api-token`.
- The full logical SprinkleRef ref is preserved in Infisical metadata or documented equivalent
  metadata/comment field when creating or updating secrets.
- Existing Infisical read, write, update, check, and remove flows use the same mapping and pass
  focused tests.
- Refs with the same final segment but different logical paths do not collide in Infisical.
- The tracked `control` profile uses Infisical environment `prod`, and docs explain that `control`
  remains a resolver lane rather than an Infisical environment name.
- Existing local-file, macOS Keychain, and CI backend behavior is unchanged.

### 7. Risks

- Existing Infisical secrets created under the previous root-path, last-segment-only mapping may not
  be found after the mapping changes.
- Infisical metadata support could differ between API versions or deployments.
- Pointing both `main` and `control` resolver lanes at `prod` could blur operational separation if
  docs are not clear that the lane is still intentional resolver policy.

### 8. Mitigations

- Document the migration clearly and include a one-time operator note for moving existing secrets
  from root-level keys to derived folder paths.
- If metadata writes are unavailable, fail clearly or use an explicitly documented fallback such as
  `secretComment` while keeping the logical ref out of the secret value and key.
- Keep the `control` category explicit in generated stack config and resolver config, even while it
  targets the `prod` Infisical environment.

### 9. Consequences of not implementing this PR

Infisical storage will continue using only the final logical-ref segment as the secret key in a
single default path, which can collide and does not match the folder/key model operators see in the
Infisical UI. The tracked resolver config will also continue pointing the `control` lane at an
Infisical environment that is not expected to work for the current setup.

### 10. Downsides for implementing this PR

The change may require moving existing manually created Infisical secrets into derived folders, but
it aligns the backend adapter with Infisical's native model and keeps SprinkleRef logical refs
backend-neutral and collision-resistant.

## PR-11: Infisical cleanup note and scheme regression coverage

### 1. Intent

Close the latest end-of-range plan-assessment gaps for PR-10 by documenting the one-time operator
cleanup for root-level, last-segment-only Infisical test keys from earlier experiments, and by
extending focused regression coverage so Infisical storage coordinates are proven for `secret://`,
`config://`, and `runtime://` logical refs.

### 2. Scope of changes

- Add a clear operator cleanup note for existing Infisical test secrets that were manually created
  under the previous root-level, last-segment-only mapping.
- Explain that existing root-level keys such as `management-api-token` may need to be moved into the
  derived folder path, for example `/control-plane/supabase` with key `management-api-token`.
- State that SprinkleRef does not search both the old root-level location and the new derived
  coordinates.
- Keep the cleanup note limited to existing Infisical test data; do not imply that logical
  SprinkleRef refs, runtime behavior, or non-Infisical backends should change.
- Extend Infisical adapter regression tests so non-`secret://` schemes strip their URI scheme before
  deriving `secretPath` and `secretName`.
- Add docs/config fixture regression coverage proving docs do not imply that Infisical UI keys
  contain full `secret://`, `config://`, or `runtime://` URIs.
- Do not add new storage mapping behavior beyond what PR-10 already specified.

### 3. External prerequisites

- Operators with old root-level Infisical test secrets from earlier experiments need access to move
  or recreate those records under the derived folder paths.
- No new Infisical project, environment, or credential requirements are introduced.

### 4. Tests to be added

- Add Infisical adapter tests proving `config://control-plane/aws/account-id` calls the API with
  `secretPath=/control-plane/aws` and `secretName=account-id`.
- Add Infisical adapter tests proving a representative `runtime://...` ref calls the API with the
  URI scheme stripped and only the final path segment used as `secretName`.
- Ensure the scheme coverage applies to the same Infisical operations covered by PR-10, or to a
  shared derivation helper used by all those operations.
- Add docs or config fixture tests proving examples do not instruct operators to create Infisical UI
  keys containing full logical URI schemes such as `secret://`, `config://`, or `runtime://`.

### 5. Docs to be added or updated

- Update [Local SprinkleRef Design](local-sprinkleref.md), [SprinkleRef Resolver](sprinkleref.md),
  or the AWS account setup docs with a one-time cleanup note for root-level Infisical test keys
  created under the previous last-segment-only mapping.
- Include an example that shows the old root key and the new derived Infisical folder plus key.
- Keep docs clear that the full logical ref remains the SprinkleRef identifier and metadata value,
  while the Infisical UI `Key` is only the final stripped path segment.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/tests/deployments/sprinkleref-infisical.test.ts`
  - `build-tools/tools/tests/deployments/infisical.test-server.ts`
  - `docs/**`
- Keep changes narrowly focused on cleanup documentation and regression tests for Infisical
  scheme stripping.

### 6. Acceptance criteria

- Docs include a one-time operator cleanup note for moving root-level, last-segment-only Infisical
  test secrets into derived folder paths, and they state the tool does not search the old location.
- Infisical API calls never use a full `secret://`, `config://`, or `runtime://` URI as
  `secretName`, with focused tests covering all three schemes.
- Docs or config fixture tests prove current docs do not imply that Infisical UI keys should contain
  full logical URI schemes.
- No non-Infisical backend behavior changes.

### 7. Risks

- Cleanup docs could be too broad and make operators think every backend or every new secret needs
  manual movement.
- Docs fixture tests could become brittle if they scan broad prose without anchoring on Infisical UI
  key examples.

### 8. Mitigations

- Frame the cleanup note as a one-time Infisical-only step for root-level test secrets created before
  the PR-10 mapping change.
- Anchor docs regression tests to the specific Infisical UI key examples and setup fixtures that
  operators use.

### 9. Consequences of not implementing this PR

Operators with existing root-level Infisical test keys may not understand why the new folder/key
mapping cannot find those old records, and regression tests may still miss accidental use of full
`config://` or `runtime://` URIs as Infisical `secretName` values.

### 10. Downsides for implementing this PR

The added docs and fixture tests introduce a small amount of maintenance around examples, but keep
the PR focused on closing PR-10 documentation and acceptance-test gaps without changing storage
behavior.

## PR-12: Canonical projects config shared/local split

### 1. Intent

Simplify SprinkleRef and control-plane setup configuration around a project-owned canonical config
directory under `projects/`, so future `projects` submodule usage carries repo-specific deployment
coordinates with the project tree. Replace the current spread of tracked resolver files and
gitignored local values under root `config/sprinkleref/` with one committed shared config file and
one gitignored individual-user config file.

### 2. Scope of changes

- Introduce `projects/config/` as the canonical project configuration directory.
- Add committed `projects/config/shared.json` as the shared, repo-wide configuration source.
- Add gitignored `projects/config/local.json` as the single individual-user configuration source.
- Move shared non-secret values into `projects/config/shared.json`, including:
  - shared SprinkleRef resolver categories and profile policy;
  - shared Infisical host, project id, project name, environment names, and default paths;
  - shared logical refs such as Infisical Universal Auth bootstrap credential refs;
  - shared control-plane coordinates when they are repo-wide rather than operator-specific.
- Model multiple deployment/control environments inside `projects/config/shared.json` as named
  shared environment profiles, for example `staging`, `prod`, and future control-specific
  environments. Categories and deployment lanes should select these named environments rather than
  requiring separate resolver files.
- Model multiple runtime hosts inside `projects/config/shared.json` as named runtime profiles, for
  example `local-macos`, `local-file`, `github-actions`, `jenkins`, `gitlab-ci`, and
  `bitbucket-pipelines`. Runtime profiles describe shared backend shape such as backend kind,
  scope, and naming prefixes.
- Move individual-user values into `projects/config/local.json`, including:
  - local bootstrap sink selection and local credential file paths;
  - local selection of the active runtime host when it cannot be inferred from environment;
  - local AWS account and organization ids when they are operator-specific;
  - one-off local Supabase coordinates when they are not shared repo infrastructure;
  - raw local-only escape hatch values only when they must remain outside a secret backend.
- Update SprinkleRef config loading so the default project config is the overlay of
  `projects/config/shared.json` plus `projects/config/local.json` when present.
- Add runtime host selection that can choose an explicit local setting, a CI environment-detected
  host such as GitHub Actions or Jenkins, or a CLI/env override without requiring separate checked-in
  `ci.*.json` and `local.*.json` resolver files.
- Use simple deep-merge semantics where `projects/config/local.json` always overrides
  `projects/config/shared.json` on overlapping fields.
- While merging, record every path where shared and local both define a different value.
- Report those recorded paths as active local overrides in config inspection, missing-value
  diagnostics, and setup/apply commands. Redact secret-like values in override output.
- Add one coarse safety guard, such as `--no-local-overrides` or
  `VBR_DISALLOW_LOCAL_OVERRIDES=1`, that fails when any local override is active. Do not require a
  maintained list of protected versus unprotected fields.
- Update `sprinkleref --init-local` or its replacement to create/update
  `projects/config/local.json`, not `config/sprinkleref/local/values.json`.
- Update `control-plane aws-account check` and related missing-value diagnostics so they classify
  missing values as either shared project config gaps or local operator setup gaps based on the new
  shared/local source file.
- Retire root `config/sprinkleref/selected.local.json` as the normal operator path.
- Treat root `config/sprinkleref/**` as migration input or generated compatibility only during this
  PR, with `projects/config/**` becoming the canonical path advertised by docs and command output.
- Do not add additional per-provider config files unless they are generated artifacts from the two
  canonical project config files.
- Preserve support for multiple environments and multiple runtime hosts through named entries in the
  two canonical files, not through a growing set of root-level selected config variants.

### 3. External prerequisites

- Operators need to move any existing uncommitted local values from
  `config/sprinkleref/local/values.json` or `config/sprinkleref/selected.local.json` into
  `projects/config/local.json`.
- The checked-in shared Infisical project id and name remain valid shared repo infrastructure for
  all operators using this clone.
- If `projects` later becomes a submodule, the parent repository must preserve
  `projects/config/local.json` as a parent-clone local file or document where that ignored file
  should live.

### 4. Tests to be added

- Add config loader tests proving the default config path loads `projects/config/shared.json` and
  overlays `projects/config/local.json` when present.
- Add tests proving committed shared values such as Infisical `projectId`, `projectName`, host, and
  environments are read from `projects/config/shared.json`.
- Add tests proving local values such as bootstrap sink choice and local AWS coordinates are read
  from `projects/config/local.json`.
- Add tests proving multiple shared environments can coexist and that categories or deployment lanes
  resolve the intended Infisical environment without separate resolver files.
- Add tests proving multiple runtime host profiles can coexist in `projects/config/shared.json` and
  that local, GitHub Actions, Jenkins, GitLab CI, and Bitbucket-style bootstrap backends can be
  selected by explicit local config, CI environment detection, or CLI/env override.
- Add precedence tests proving local config always overrides shared config on overlapping fields.
- Add diagnostics tests proving every changed overlap path is reported as an active local override,
  with secret-like values redacted.
- Add safety-guard tests proving `--no-local-overrides` or `VBR_DISALLOW_LOCAL_OVERRIDES=1` fails
  when any local override is active and passes when local config only fills previously missing
  values.
- Add missing-value classification tests proving shared config gaps and local setup gaps are reported
  differently, including for `control-plane aws-account check`.
- Add `--init-local` tests proving it creates or updates `projects/config/local.json` and preserves
  existing local entries.
- Add gitignore or repository hygiene tests proving `projects/config/shared.json` is tracked or
  trackable and `projects/config/local.json` remains ignored.
- Add regression tests proving commands no longer recommend `config/sprinkleref/local/values.json`
  as the canonical local setup file.

### 5. Docs to be added or updated

- Update [Local SprinkleRef Design](local-sprinkleref.md) to describe `projects/config/shared.json`
  and `projects/config/local.json` as the canonical shared/local split.
- Update [SprinkleRef Resolver](sprinkleref.md) to describe default project config loading from
  `projects/config/` and to demote root `config/sprinkleref/**` paths to migration or compatibility
  status.
- Update AWS account setup docs and command help examples so operators edit
  `projects/config/local.json` for individual setup values.
- Document the classification rule:
  - committed shared config contains repo-wide non-secret coordinates and logical refs;
  - gitignored local config contains individual operator settings;
  - secret backends contain credentials and tokens.
- Document how one shared/local config pair supports multiple environments and runtime hosts:
  shared config defines the available named environments and runtime profiles, while local config or
  runtime detection selects the active host for the current operator or CI job.
- Document local override semantics: local config always wins, every changed overlap is reported as
  an active local override, and operators can opt into a coarse no-local-overrides guard for stricter
  runs.
- Add a migration note showing how to move existing values from
  `config/sprinkleref/local/values.json` and `config/sprinkleref/selected.local.json` into
  `projects/config/local.json`.
- Add migration examples showing how current `local.macos.json`, `local.file.json`,
  `ci.github.json`, `ci.jenkins.json`, `ci.gitlab.json`, and `ci.bitbucket.json` settings map into
  named runtime host profiles under `projects/config/shared.json`.
- Document why this layout supports a future `projects` submodule: project-specific shared config
  lives under `projects/`, while user-specific config remains one ignored file in the same canonical
  directory.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `projects/config/shared.json`
  - `.gitignore`
  - `build-tools/tools/deployments/sprinkleref-config-select.ts`
  - `build-tools/tools/deployments/sprinkleref-config.ts`
  - `build-tools/tools/deployments/sprinkleref-templates.ts`
  - `build-tools/tools/deployments/aws-account-local-values.ts`
  - `build-tools/tools/deployments/aws-account-inputs.ts`
  - `build-tools/tools/deployments/aws-account-utils.ts`
  - `build-tools/tools/deployments/sprinkleref-check*.ts`
  - `build-tools/tools/tests/deployments/**`
  - `docs/**`
- Keep the PR focused on the canonical shared/local project config split and the resulting
  diagnostics. Avoid broader backend behavior changes.

### 6. Acceptance criteria

- `projects/config/shared.json` is the committed canonical shared project config.
- `projects/config/local.json` is the single canonical gitignored individual-user config file.
- Default SprinkleRef and control-plane setup commands use the overlay of shared plus local project
  config without requiring `SPRINKLEREF_CONFIG` for the normal path.
- Shared Infisical project coordinates remain checked in because they are repo-wide non-secret
  infrastructure.
- Multiple shared environments can be represented in `projects/config/shared.json`, and categories
  or deployment lanes can select the intended environment without introducing per-environment
  selected config files.
- Multiple runtime hosts can be represented in `projects/config/shared.json`, and local/CI execution
  can select `local-macos`, `local-file`, `github-actions`, `jenkins`, `gitlab-ci`, or
  `bitbucket-pipelines` behavior without introducing per-host selected config files.
- Individual operator settings are absent from tracked files and can be supplied through
  `projects/config/local.json`.
- Local config always wins on overlapping fields, and every changed overlap is visible in active
  local override diagnostics.
- A single no-local-overrides guard can fail any command when local config changes a shared value,
  without maintaining a protected-field list.
- Missing-value output clearly distinguishes shared project config gaps from local operator setup
  gaps.
- Docs and command output no longer present `config/sprinkleref/local/values.json` or
  `selected.local.json` as the normal local setup path.
- Focused tests cover loader precedence, init-local behavior, gitignore policy, diagnostics, and
  migration docs.

### 7. Risks

- Moving canonical paths may break operator muscle memory and existing local files.
- Local override warnings can become noisy if `local.json` intentionally overrides many shared
  fields.
- A single shared file could become cluttered if environments, runtime hosts, resolver categories,
  and local-value schema are not grouped clearly.
- Future `projects` submodule usage may require parent-repo guidance for ignored files inside the
  submodule working tree.
- Combining resolver policy and local values into one schema could blur the boundary between
  shared routing metadata, local setup values, and credentials.

### 8. Mitigations

- Keep the schema small and explicit: one shared object, one local object, and local-wins merge
  semantics.
- Group shared config by purpose, for example shared environments, runtime host profiles, resolver
  categories, and shared values, so adding a host or environment does not require another file.
- Keep local override diagnostics compact, path-based, and redacted for secret-like values.
- Provide the coarse no-local-overrides guard for strict validation or CI jobs that want to prove the
  shared config is being used without local drift.
- Emit direct migration diagnostics when old root `config/sprinkleref/**` files are present with
  values that should move to `projects/config/local.json`.
- Keep credentials represented as logical refs by default and reserve raw local values for an
  explicitly documented escape hatch.
- Add tests around override reporting so local config cannot silently change required shared
  Infisical coordinates.

### 9. Consequences of not implementing this PR

SprinkleRef setup will remain split across root-level resolver files, legacy selected-local config,
and a nested local values file. That makes the system harder to explain, keeps project-specific
values outside the `projects` tree, and works against the longer-term goal of making `projects`
portable as a submodule.

### 10. Downsides for implementing this PR

The migration touches several setup paths and docs at once, and operators with existing local files
will need to move values into the new canonical file. The resulting model is simpler after the
migration because normal setup has exactly one committed shared file and one ignored local file.

## PR-13: Deployment contexts for shared provider topology

### 1. Intent

Allow multiple deployments in the same repo to use different shared AWS accounts, Infisical
projects, environments, and provider coordinates without reintroducing scattered app or
deployment-local resolver config. Use one easy-to-reason-about selector:
`deployment_context = "<name>"`. Keep `projects/config/shared.json` as the source of shared
deployment context definitions, keep `projects/config/local.json` as the individual-user overlay,
and keep apps backend-neutral.

### 2. Scope of changes

- Extend `projects/config/shared.json` with a `deploymentContexts` object keyed by names such as
  `pleomino-prod`, `pleomino-staging`, or `admin-prod`.
- Each deployment context may contain typed provider sections for shared non-secret topology, for
  example:
  - `aws`: account id, organization id, default region, optional expected role ARN, and other
    non-secret AWS coordinates;
  - `infisical`: host, project id/name, environment, default path, and logical refs for bootstrap
    credentials required to access that Infisical project;
  - `supabase`: organization id, project ref, region, or other non-secret managed-service
    coordinates;
  - `cloudflare`: account id, zone id, project name/id, and logical refs for provider API tokens;
  - future typed provider sections when they have clear validation rules.
- Keep deployment contexts intentionally shallow and typed. Do not add a generic arbitrary
  `projects/config` overlay inside each context, and do not split contexts into a graph of reusable
  subprofiles unless real duplication later justifies it.
- Add deployment metadata support for selecting exactly one context, for example
  `deployment_context = "pleomino-prod"`.
- Resolve deployment context names by loading `projects/config/shared.json` plus the local overlay.
  Shared config provides repo-wide non-secret topology; local config may fill missing values or
  temporarily override values with the existing active-local-override diagnostics and guardrails.
- Preserve the existing deployment `secret_backend = "<backend>/<profile-alias>"` selector while
  the migration is in progress, but document how it relates to the selected deployment context.
  In this PR, keep explicit `secret_backend` as the authoritative deployment secret-backend
  selector for existing secret runtime paths. A deployment context may include a `secretBackend`
  default such as `infisical/pleomino-prod`, but that default should only fill an omitted
  deployment `secret_backend`; if both are present and disagree, fail closed rather than silently
  choosing one.
- Treat deployment context provider sections as shared defaults/constraints for provider topology,
  not as replacements for every existing `provider_target` field. Context values may fill missing
  non-secret fields such as account id, organization id, zone id, region, or Infisical project id.
  If a deployment also declares the same field in `provider_target`, `infisical_runtime`, or another
  provider-native metadata object, the values must match unless that field has an explicitly
  documented override rule. Prefer fail-closed mismatch diagnostics over hidden precedence.
- Keep raw credentials and token values out of deployment metadata, shared config, and local config.
  Deployment contexts may contain logical secret refs such as
  `secret://bootstrap/pleomino-prod/infisical/client-secret` or
  `secret://deployments/pleomino/prod/cloudflare-api-token`, but never the secret value itself.
- Route bootstrap secret refs, such as Infisical Universal Auth client id/client secret refs, through
  the selected runtime host/bootstrap lane. These refs are named by the context, but their values
  live in macOS Keychain, CI secret storage, an explicitly selected local file, or another allowed
  bootstrap backend.
- Route provider/runtime secret refs, such as Cloudflare API tokens, through the selected
  deployment context's secret backend. Secret values remain in Infisical, Vault, or another
  configured secret backend.
- Decide whether existing deployment `infisical_runtime` fields are:
  - durable deployment identity/replay metadata that should remain on deployment records or
    admission evidence; or
  - duplicated resolver topology that should move into the selected deployment context.
- Where `infisical_runtime` is only duplicated resolver topology, replace raw project id,
  environment, path, and credential ref duplication with a selected deployment context plus
  generated or resolved runtime evidence.
- Where `infisical_runtime` is needed for exact replay/audit identity, keep it as evidence derived
  from the selected deployment context at admission time rather than as hand-maintained deployment
  resolver configuration.
- Add validation that apps under `projects/apps/**` cannot define SprinkleRef backend topology,
  `deployment_context`, `secret_backend`, Infisical project ids, provider account ids, or similar
  deployment resolver selection fields. App code and app metadata should declare logical refs and
  build/runtime requirements only.
- Update deployment extraction, admission, bootstrap, and secret runtime paths so they preserve
  existing behavior while sourcing shared provider topology from the selected deployment context
  where appropriate.
- Add a small typed validator for deployment contexts instead of relying on broad string scans.
  Validate known provider sections and known secret-ref fields explicitly so non-secret ids that
  contain words like `key`, `token`, or `secret` in a field name are not accidentally rejected.
- Keep the implementation focused on the single context selector. Do not add per-app config
  overlays, per-deployment arbitrary `projects/config` overrides, or another file hierarchy below
  `projects/config/`.

### 3. External prerequisites

- The repo's shared provider coordinates that are common to all operators must be known and safe to
  commit as non-secret shared topology.
- Any deployment that should use a different AWS account, Infisical project, Supabase project,
  Cloudflare account, or similar provider coordinate needs a named deployment context added to
  `projects/config/shared.json`.
- Secret values referenced by a context must already exist in the selected secret backend or
  bootstrap backend, or the deployment setup flow must create/check them without writing plaintext
  into JSON config.
- Operators with clone-specific account experiments can continue using `projects/config/local.json`
  overrides, with active override diagnostics making that drift visible.

### 4. Tests to be added

- Add project config schema/loader tests proving multiple named deployment contexts can coexist in
  `projects/config/shared.json`.
- Add deployment metadata tests proving one deployment can select `deployment_context =
"pleomino-prod"` and another can select `deployment_context = "admin-prod"`, with each resolving
  distinct typed provider sections.
- Add tests proving two deployments can use different AWS account ids and different Infisical
  project ids through deployment contexts.
- Add tests proving missing, misspelled, or malformed deployment context names fail closed with
  actionable diagnostics.
- Add tests proving deployment metadata rejects inline context objects, inline resolver profile
  objects, inline Infisical project credentials, unsupported `secret_backend_profile`, and malformed
  selector names.
- Add tests proving shared and local deployment contexts reject secret-looking plaintext values and
  allow logical `secret://...` refs in provider sections, with field-aware validation rather than
  broad substring matching.
- Add tests proving context `secretBackend` defaults fill omitted `secret_backend` values and fail
  closed when an explicit deployment `secret_backend` disagrees with the selected context.
- Add tests proving context-derived provider values fill missing deployment metadata fields and
  fail closed when duplicated explicit deployment metadata disagrees.
- Add local overlay tests proving `projects/config/local.json` can fill a missing shared account
  coordinate or temporarily override a shared coordinate, and that override reporting/redaction still
  works for deployment-selected contexts.
- Add bootstrap tests proving context-owned Infisical bootstrap refs resolve through the bootstrap
  runtime host rather than requiring the same Infisical project before authentication.
- Add provider secret tests proving context-owned runtime refs, such as Cloudflare API token refs,
  resolve through the selected secret backend without writing values to JSON.
- Add admission or runtime tests proving Infisical replay evidence records the concrete project,
  environment, path, and secret identity derived from the selected deployment context without
  requiring hand-maintained duplicated resolver topology in deployment metadata.
- Add repository hygiene or lint tests proving app packages cannot declare backend topology fields
  such as `deployment_context`, `secret_backend`, `infisical_runtime`, provider account ids,
  Infisical project ids, or raw SprinkleRef resolver profile definitions.
- Add regression tests proving existing deployments using `secret_backend = "infisical/default"`
  keep working during the migration and have a documented relationship to the selected deployment
  context.

### 5. Docs to be added or updated

- Update [SprinkleRef Resolver](sprinkleref.md) to explain the boundary:
  - apps declare logical refs and requirements;
  - deployments select one `deployment_context`;
  - `projects/config/shared.json` defines what that context means;
  - `projects/config/local.json` provides individual-user fills or temporary overrides.
- Update [Local SprinkleRef Design](local-sprinkleref.md) with real examples showing two deployments
  in one repo using different AWS accounts and different Infisical projects by selecting different
  deployment contexts.
- Update deployment authoring docs to document `deployment_context = "<name>"` and show a concrete
  `projects/config/shared.json` example with typed `aws`, `infisical`, `supabase`, and `cloudflare`
  sections.
- Document the secret-value rule: deployment contexts may contain ids, names, regions, paths, URLs,
  and logical secret refs, but must not contain API tokens, client secrets, passwords, private keys,
  or other secret values.
- Document how bootstrap refs named by a context resolve through runtime hosts and how runtime
  provider refs resolve through the selected deployment secret backend.
- Document context/default precedence: deployment context values fill omitted deployment metadata,
  duplicated explicit deployment metadata must match by default, and any intentionally supported
  override must be documented field-by-field.
- Document that deployment contexts are typed provider topology records, not arbitrary config
  overlays.
- Document how exact Infisical replay/audit evidence is derived from selected deployment contexts
  and where durable identity metadata belongs after admission.
- Add an explicit anti-pattern section showing why app-level resolver config, deployment-local
  inline backend profiles, and plaintext secret values in JSON config are not supported.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `projects/config/shared.json`
  - `build-tools/deployments/*.bzl`
  - `build-tools/tools/deployments/project-config.ts`
  - deployment context resolution helpers under `build-tools/tools/deployments/`
  - `build-tools/tools/deployments/deployment-secret-backend-selector.ts`
  - `build-tools/tools/deployments/deployment-secret-metadata.ts`
  - `build-tools/tools/deployments/deployment-secret-infisical*.ts`
  - `build-tools/tools/deployments/infisical-iac-bootstrap-*.ts`
  - AWS account/deployment metadata helpers under `build-tools/tools/deployments/`
  - repository hygiene or lint tests under `build-tools/tools/tests/`
  - `projects/deployments/**`
  - `docs/**`
- Avoid app implementation changes except for guardrail tests proving apps do not own resolver
  topology.

### 6. Acceptance criteria

- `projects/config/shared.json` can define multiple named deployment contexts with typed provider
  sections.
- Deployment metadata can select exactly one deployment context without defining raw resolver
  topology inline.
- Two deployments in the same repo can select different AWS accounts and different Infisical
  projects/accounts through different deployment contexts.
- Deployment contexts allow logical secret refs but reject or flag plaintext secret values.
- Context `secretBackend` defaults can fill omitted `secret_backend`, and explicit mismatches fail
  closed.
- Context provider values can fill omitted provider metadata, and duplicated explicit provider
  metadata must match unless an override is documented for that field.
- Bootstrap refs named by a deployment context resolve through the selected runtime host/bootstrap
  lane, while runtime provider refs resolve through the selected secret backend.
- App packages do not gain resolver override capability and are prevented from declaring backend
  topology fields.
- Existing `secret_backend = "infisical/default"` deployments continue to work through the named
  shared profile path during the migration.
- `secret_backend_profile` remains unsupported.
- Duplicated `infisical_runtime` resolver topology is either removed in favor of selected shared
  deployment contexts or clearly limited to generated/admission-time replay evidence.
- Missing, malformed, or unknown deployment context selectors fail closed with diagnostics that
  point to `projects/config/shared.json` or `projects/config/local.json` as appropriate.
- Local overrides of selected shared topology remain visible in active local override diagnostics
  and continue to respect the no-local-overrides guard.
- Docs clearly explain why apps declare logical refs, deployments select one context, shared project
  config defines the context, and secret values stay in secret backends.

### 7. Risks

- Deployment contexts could become an arbitrary override system if the schema allows untyped nested
  config instead of validated provider sections.
- Moving duplicated Infisical runtime metadata too aggressively could weaken replay or audit
  evidence if exact project/environment/path identity is not recorded elsewhere.
- Deployment context naming could conflict with existing environment-stage or provider-target
  concepts if the selector is not introduced carefully.
- App-level guardrails could reject legitimate app documentation examples if the lint is too broad.
- Secret refs inside contexts could be confused with secret values unless docs and validators draw a
  clear line.

### 8. Mitigations

- Keep the deployment metadata selector to one string field, `deployment_context`, and validate it
  against named shared config entries.
- Keep context provider sections shallow, typed, and validated per provider.
- Preserve concrete backend identity in admission evidence and replay records even when deployment
  metadata only selects a deployment context.
- Introduce deployment context resolution through the existing deployment metadata/extraction layer
  so provider-specific fields and context-derived fields have one documented precedence rule.
- Add validators and docs that distinguish allowed logical secret refs from forbidden plaintext
  secret values.
- Prefer field-aware validation over broad secret-looking substring scans for deployment contexts.
- Scope app guardrails to active app metadata/source patterns that would actually affect resolver
  topology, and allow historical docs only through explicit test fixtures or allowlists.
- Add tests for positive multi-account/multi-Infisical cases, context-owned secret refs, bootstrap
  secret resolution, and negative inline-override/plaintext-secret cases.

### 9. Consequences of not implementing this PR

Deployments can already choose a secret backend profile, but broader account and provider topology
selection will remain inconsistent. Teams may duplicate Infisical project ids, environments, AWS
account ids, Supabase project refs, Cloudflare account ids, and credential refs in deployment
metadata, or push those choices down into app directories. That would undermine the
`projects/config` shared/local split and make multi-account repos harder to audit.

### 10. Downsides for implementing this PR

The PR adds one explicit selector concept to deployment metadata and requires careful migration of
existing Infisical runtime fields. The payoff is a clearer boundary: shared project config owns
typed deployment contexts, deployments choose one context, apps stay backend-neutral, and secret
values remain in secret backends rather than JSON config.

## PR-14: Move Pleomino deployments onto deployment contexts

### 1. Intent

Finish the PR-13 migration on the checked-in real deployment path by moving Pleomino's deployment
family off hand-maintained Infisical resolver topology and onto selected deployment contexts.
Pleomino should use `deployment_context = "<stage-context>"` for its shared provider topology, with
concrete Infisical project/environment/path identity derived from the selected context for
admission/replay evidence rather than duplicated by hand in deployment metadata.

### 2. Scope of changes

- Update `projects/deployments/pleomino/shared/family.bzl` so staging and prod deployment stages
  select deployment contexts such as `pleomino-staging` and `pleomino-prod`.
- Move Pleomino's shared non-secret Infisical topology that currently lives in
  `_pleomino_infisical_runtime(stage)` into `projects/config/shared.json` deployment context
  sections.
- Move Cloudflare account, zone, project, and custom-domain shared coordinates into the selected
  Pleomino deployment contexts when those values are shared topology rather than stage-local
  provider target identity.
- Remove hand-maintained `infisical_runtime = _pleomino_infisical_runtime(stage)` from Pleomino
  stage metadata when the same topology can be derived from the selected deployment context.
- Keep any exact replay/audit fields that must remain durable as generated/admission-time evidence,
  not as manually duplicated resolver configuration in the deployment family.
- Preserve existing `secret_backend = "infisical/default"` behavior only where it is still needed as
  an explicit migration-compatible selector. Prefer letting the selected deployment context provide
  the same default when that does not change existing secret runtime behavior.
- Ensure context-derived `provider_target` and Infisical runtime values fail closed if a stage still
  declares a conflicting explicit value.
- Keep logical secret refs, such as Cloudflare API token refs and Infisical bootstrap refs, as refs.
  Do not write plaintext secret values into Pleomino deployment metadata or project config.
- Update any bootstrap, admission, check, or extraction paths that currently assume the real
  Pleomino deployment family carries explicit `infisical_runtime` fields.

### 3. External prerequisites

- The existing Pleomino Infisical project id/name/slug, environment slugs, Cloudflare coordinates,
  and logical secret refs must be safe to commit as shared non-secret deployment context topology.
- Existing Pleomino deployment secrets must already live in the selected secret backend under the
  same logical refs and derived Infisical coordinates, or setup/check commands must clearly report
  what is missing without printing secret values.

### 4. Tests to be added

- Add tests proving the checked-in Pleomino staging and prod deployment targets select deployment
  contexts and no longer hand-maintain duplicated Infisical resolver topology.
- Add tests proving context-derived Pleomino Infisical runtime evidence matches the previous
  project id, project name/slug, environment, path, credential refs, and machine identity metadata.
- Add tests proving Pleomino Cloudflare provider target values are filled or checked from the
  selected deployment context without changing provider target identity.
- Add tests proving a conflict between a Pleomino deployment stage and its selected context fails
  closed with an actionable diagnostic.
- Add regression tests proving Pleomino secret admission/replay evidence still records concrete
  Infisical project/environment/path/secret identity derived from the selected context.
- Add docs or fixture tests proving Pleomino remains an example of the app/deployment/config
  boundary: the app declares refs/requirements, the deployment selects a context, and shared config
  defines provider topology.

### 5. Docs to be added or updated

- Update deployment authoring docs and SprinkleRef docs to use Pleomino as the concrete example for
  `deployment_context = "pleomino-staging"` / `deployment_context = "pleomino-prod"`.
- Document where the former Pleomino `infisical_runtime` values now live in
  `projects/config/shared.json` and how admission evidence preserves concrete replay identity.
- Update any Pleomino or Infisical bootstrap docs that still imply deployment families should define
  raw Infisical runtime topology directly.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `projects/config/shared.json`
  - `projects/deployments/pleomino/shared/family.bzl`
  - deployment extraction/admission helpers under `build-tools/tools/deployments/`
  - `build-tools/tools/tests/deployments/**`
  - `docs/**`
- Keep the PR focused on migrating the real Pleomino deployment path onto PR-13's deployment context
  machinery. Do not introduce new context abstractions or app-level override behavior.

### 6. Acceptance criteria

- Pleomino staging and prod deployment stages select deployment contexts.
- Pleomino no longer hand-maintains duplicated Infisical resolver topology in deployment metadata
  when that topology is available from the selected context.
- Pleomino's context-derived Infisical runtime/admission evidence preserves the same concrete
  project, environment, path, and secret identity needed for replay.
- Pleomino Cloudflare provider topology is filled or checked from deployment contexts without
  changing provider target identity.
- Existing Pleomino secret admission and deployment tests continue to pass.
- Docs show Pleomino as the real checked-in example of the app/deployment/context boundary.

### 7. Risks

- Removing explicit Pleomino `infisical_runtime` fields too early could weaken exact replay evidence
  if derived context metadata is not recorded in admission outputs.
- Moving Cloudflare coordinates into contexts could accidentally change provider target identity if
  context-derived fields and stage-specific fields are not compared carefully.
- Tests that inspect Pleomino metadata may need updates from explicit runtime fields to
  context-derived evidence.

### 8. Mitigations

- Keep conflict checks fail-closed whenever context-derived values disagree with explicit stage
  metadata.
- Preserve concrete Infisical identity in generated/admission-time evidence before removing
  hand-maintained deployment runtime fields.
- Add targeted Pleomino fixture tests before relying on broad final validation.

### 9. Consequences of not implementing this PR

PR-13's deployment context machinery would exist, but the main checked-in deployment family would
still model the old duplicated Infisical runtime pattern. That would keep the design split between
fixture coverage and real deployment usage.

### 10. Downsides for implementing this PR

This adds a second migration step after PR-13 and touches real Pleomino deployment metadata, but it
keeps the risk focused on one deployment family and proves the deployment-context model on the path
operators actually use.

## PR-15: Use deployment contexts for bootstrap resolver profile discovery

### 1. Intent

Close the remaining gap between PR-13/PR-14 deployment context extraction and `repo bootstrap`
profile discovery. Bootstrap profile discovery must apply selected deployment-context defaults
before deciding which resolver backend profiles are required, so a deployment that omits
`secret_backend` because its selected context supplies `secretBackend = "infisical"` requires the
Infisical profile, not the legacy default backend profile.

### 2. Scope of changes

- Update the Infisical IaC bootstrap resolver/profile discovery path so it resolves the same
  deployment-context defaults used by deployment extraction before computing required backend
  profiles.
- Ensure graph nodes shaped like the checked-in Pleomino deployments, with
  `deployment_context = "pleomino-staging"` or `deployment_context = "pleomino-prod"`, omitted
  `secret_backend`, and empty raw `infisical_runtime`, materialize the Infisical resolver profile
  from the selected context.
- Remove stale assumptions or tests that treat omitted deployment `secret_backend` as sufficient to
  choose the legacy default backend when a selected deployment context provides a concrete
  `secretBackend`.
- Keep the behavior fail-closed when a selected context and an explicit deployment backend conflict.
- Do not add compatibility shims for old context-less Pleomino metadata shapes. There are no users
  yet, so this PR should clean up stale assumptions rather than preserving them.

### 3. External prerequisites

- `projects/config/shared.json` must contain the checked-in deployment contexts that define the
  shared Pleomino secret backend and Infisical topology.
- Local user secrets and runtime secret values remain outside the checked-in config files; this PR
  only changes non-secret profile discovery.

### 4. Tests to be added

- Add a regression test for `requiredBackendProfiles` or the repo bootstrap profile-materialization
  path using a deployment node shaped like current Pleomino: selected deployment context, secret
  requirements, omitted `secret_backend`, and empty raw `infisical_runtime`.
- Assert that the required backend profile is the context-derived Infisical profile, not the legacy
  default backend profile.
- Update any stale unified-selector tests that locked omitted `secret_backend` to the old default
  without considering a selected deployment context.
- Add or update a conflict regression proving an explicit deployment backend that disagrees with the
  selected context still fails closed.

### 5. Docs to be added or updated

- Update Infisical bootstrap docs to state that `repo bootstrap` applies deployment context defaults
  before deciding required resolver profiles.
- Update SprinkleRef or deployment authoring docs if they still imply bootstrap resolver profile
  selection reads only raw deployment metadata.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/infisical-iac-bootstrap-resolver.ts`
  - deployment context resolver/extraction helpers under `build-tools/tools/deployments/`
  - `build-tools/tools/tests/deployments/**`
  - `docs/infisical-bootstrap.md`
  - `docs/sprinkleref.md` or `docs/local-sprinkleref.md` if needed
- Keep the PR focused on bootstrap resolver profile discovery. Do not introduce new context
  inheritance, profile layering, or app/deployment override semantics.

### 6. Acceptance criteria

- `repo bootstrap` profile discovery applies selected deployment-context defaults before computing
  required resolver backend profiles.
- Pleomino-shaped raw graph nodes require the context-derived Infisical backend profile even when
  raw deployment metadata omits `secret_backend`.
- Legacy default backend selection is no longer applied ahead of an explicit selected deployment
  context.
- Conflicts between explicit deployment backend values and selected context backend values remain
  fail-closed.
- Focused resolver/bootstrap tests and final validation pass.

### 7. Risks

- Reusing extraction helpers in bootstrap discovery could accidentally pull in admission-only
  behavior or make bootstrap depend on fields it does not need.
- Changing default backend selection may expose tests that were relying on raw graph metadata rather
  than the canonical context-resolved deployment model.

### 8. Mitigations

- Share the smallest context-resolution helper needed to compute backend profile identity.
- Add narrow regression tests for the Pleomino-shaped node and the explicit-conflict path before
  relying on broad final validation.
- Remove stale tests or expectations that encode the pre-context behavior instead of layering
  compatibility around them.

### 9. Consequences of not implementing this PR

PR-13/PR-14 deployment contexts would be correct for extraction/admission, but `repo bootstrap`
could still ask operators for the wrong backend profile or skip the needed Infisical profile for
context-based Pleomino deployments.

### 10. Downsides for implementing this PR

This adds one more follow-up PR after moving Pleomino onto contexts, but it closes the last known
bootstrap gap and keeps resolver profile discovery aligned with the canonical deployment model.

## PR-16: Tighten deployment context provider schemas and stale secret docs

### 1. Intent

Close the remaining documentation and validation gaps from the deployment context rollout. Deployment
contexts should expose shallow typed provider sections, not arbitrary provider config overlays, and
all docs should describe the context-resolved secret backend behavior implemented by PR-15.

### 2. Scope of changes

- Update deployment context validation so provider sections reject unknown or misspelled non-secret
  fields per provider instead of accepting any object shape.
- Keep provider section schemas shallow and explicit. Do not introduce deep provider config overlays
  or generic pass-through bags.
- Preserve existing secret-safety validation for provider sections, including plaintext secret
  rejection and logical secret ref classification.
- Update stale deployment secret docs that still say omitted `secret_backend` always becomes
  `vault` / `vault-default` or that Infisical identity only comes from raw `infisical_runtime`.
- Document that selected deployment contexts are applied before bootstrap profile discovery and may
  provide the effective backend profile and Infisical identity.
- Do not add backwards compatibility for misspelled or unknown context provider fields. There are no
  users yet, so invalid shared config should fail closed.

### 3. External prerequisites

- Existing checked-in deployment contexts must use only the reviewed provider fields.
- Operators should continue storing individual secret values outside checked-in config files.

### 4. Tests to be added

- Add validation tests proving unknown non-secret fields in typed provider sections are rejected with
  actionable diagnostics.
- Add coverage for at least the currently used provider sections, including Cloudflare and
  Infisical, so misspelled shared topology fields fail closed.
- Keep or update existing tests for plaintext secret rejection and allowed logical secret refs.
- Add or update docs tests if this repository has a docs drift check for deployment secret docs.

### 5. Docs to be added or updated

- Update `docs/deployment-secrets-api.md` so context-resolved deployments are described correctly:
  omitted `secret_backend` is filled from the selected context when present, bootstrap profile
  discovery uses the context-resolved model, and Infisical identity may come from deployment
  contexts.
- Cross-reference the updated Infisical bootstrap docs where useful.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/deployment-context-validation.ts`
  - `build-tools/tools/tests/deployments/**`
  - `docs/deployment-secrets-api.md`
  - `docs/infisical-bootstrap.md` only if wording needs alignment
- Keep this PR focused on schema tightening and stale docs. Do not change runtime context merge
  semantics beyond rejecting invalid provider fields.

### 6. Acceptance criteria

- Deployment context provider sections are shallow typed schemas with fail-closed unknown-field
  validation.
- Current checked-in deployment contexts pass the stricter validation.
- Misspelled Cloudflare or Infisical provider fields in a context are rejected by tests.
- Deployment secret docs no longer contradict PR-15 context-resolved backend/profile behavior.
- Focused validation and final validation pass.

### 7. Risks

- A provider schema may accidentally omit a currently valid checked-in field.
- Tightening validation can expose fixture data that was previously accepted only because provider
  sections were generic objects.

### 8. Mitigations

- Build allowed provider fields from the existing typed context model and current checked-in
  `projects/config/shared.json` usage.
- Add targeted unknown-field tests before relying on broad final validation.

### 9. Consequences of not implementing this PR

Docs would continue describing pre-context bootstrap behavior, and typoed provider context fields
could silently survive validation, weakening the typed shared-config model.

### 10. Downsides for implementing this PR

This is another cleanup PR after the main context work, but it keeps the change bounded to validation
and documentation and removes the last known ambiguity in the plan.

## PR-17: Apply deployment contexts during bootstrap fan-out discovery

### 1. Intent

Close the remaining bootstrap gap for graph-only Infisical fan-out discovery. Repo bootstrap fan-out
must recognize deployments whose raw graph metadata now selects a deployment context with
Infisical topology, even when raw deployment metadata omits `secret_backend` and carries an empty
`infisical_runtime`.

### 2. Scope of changes

- Update Infisical bootstrap deployment fan-out discovery so it applies selected deployment context
  defaults before deciding whether a graph node is Infisical-backed.
- Ensure Pleomino-shaped raw graph nodes with `deployment_context`, omitted `secret_backend`, empty
  raw `infisical_runtime`, and secret requirements are included in Infisical bootstrap fan-out.
- Remove stale fan-out fixture assumptions that require non-empty raw `infisical_runtime` for
  context-based Pleomino deployments.
- Keep behavior fail-closed when context resolution reports conflicts or invalid context metadata.
- Do not add compatibility shims for pre-context Pleomino metadata shapes.

### 3. External prerequisites

- Checked-in deployment contexts must continue to define the shared Pleomino Infisical backend and
  runtime topology in `projects/config/shared.json`.

### 4. Tests to be added

- Add or update fan-out tests using a graph node shaped like current Pleomino: selected context,
  omitted `secret_backend`, empty raw `infisical_runtime`, and secret requirements.
- Assert that fan-out includes the deployment and derives the Infisical project/environment/path from
  the selected context.
- Add a conflict/error regression proving invalid or conflicting context data prevents fan-out with
  an actionable diagnostic.

### 5. Docs to be added or updated

- Update Infisical bootstrap docs if they still describe fan-out discovery as depending only on raw
  `secret_backend` or raw `infisical_runtime`.

### 5.5. Expected regression scope

- `deployment-only`
- Expected implementation paths:
  - `build-tools/tools/deployments/infisical-iac-bootstrap-deployments.ts`
  - `build-tools/tools/tests/deployments/infisical-iac-bootstrap.deployment-fanout.test.ts`
  - `docs/infisical-bootstrap.md` if wording needs alignment
- Keep this PR focused on bootstrap fan-out discovery. Do not change profile materialization,
  admission, or provider schema behavior unless directly required by the fan-out fix.

### 6. Acceptance criteria

- Bootstrap fan-out discovery applies selected deployment contexts before classifying Infisical
  deployments.
- Current Pleomino-shaped graph metadata is included in Infisical bootstrap fan-out without raw
  duplicated `infisical_runtime`.
- Stale fan-out fixtures no longer encode the pre-context Pleomino shape.
- Focused fan-out tests and final validation pass.

### 7. Risks

- Fan-out discovery could accidentally diverge from the context resolution used by profile
  materialization and deployment extraction.

### 8. Mitigations

- Reuse the smallest existing deployment-context resolution helper needed by fan-out discovery.
- Add direct regression coverage for the Pleomino-shaped graph node and context error path.

### 9. Consequences of not implementing this PR

Profile discovery would be context-aware, but bootstrap fan-out could still skip the real Pleomino
deployments after PR-14 removed raw duplicated `infisical_runtime` metadata.

### 10. Downsides for implementing this PR

This is another cleanup PR, but it is narrow and aligns the last known bootstrap path with the
context-resolved deployment model.
