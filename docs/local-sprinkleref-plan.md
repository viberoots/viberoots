# Local SprinkleRef Plan

This plan implements the local and clone-specific resolution model described in
[Local SprinkleRef Design](local-sprinkleref.md).

Reviewed context:

- `secret://...` remains the backend-neutral logical reference. Backend names and storage details
  stay in SprinkleRef resolver config, not in logical refs.
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
    `"awsAccountId": { "ref": "secret://control-plane/aws/account-id" }`
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
  - `secret://control-plane/aws/account-id` maps to
    `values.control-plane.aws.account-id`
  - `secret://control-plane/supabase/project-ref` maps to
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
  - redirect objects for secret-class refs that should use `category: "bootstrap"`
  - no plaintext secret placeholders that encourage token values in JSON
- Do not add a parallel `control-plane sprinkleref` command. `control-plane aws-account config-init`
  owns AWS account stack config generation; `sprinkleref` owns resolver config, local values, and
  secret add/update/remove operations.
- Keep bootstrap secret writes on existing SprinkleRef add/update semantics, for example
  `sprinkleref --update secret://control-plane/supabase/management-api-token --category bootstrap --create-missing`,
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
