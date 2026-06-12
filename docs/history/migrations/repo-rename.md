# Repository Rename Plan

This plan migrates the repository from the temporary `bucknix`, `bnx`, and deployment-facing
`common` names to `viberoots`.

Reviewed context:

- `bucknix` appears in repository/package metadata, the ESLint plugin name, artifact metadata,
  temp/cache path prefixes, test fixtures, generated logs, and docs.
- `bnx` appears as the short prefix for environment variables, temp files, debug tags, globals, and
  Kubernetes labels.
- `common` is overloaded. Some occurrences are ordinary shared-code terminology, such as
  `defs_common.bzl`, `templates-common.nix`, local variables named `common`, and prose like
  "common failures". Those should not be blindly renamed. The deployment-facing uses that mean the
  temporary repository/service identity should move to `viberoots`, including `/srv/common`,
  `kiltyj/common`, and `git@github.com:kiltyj/common.git`.
- Repository identity also appears as `bucknix-fresh`, `kiltyj/bucknix-fresh`, absolute local paths
  containing `/bucknix-fresh/`, and possible Git remote URLs derived from those strings.
- The GitHub-side owner namespace is also temporary. Earlier rename PRs land the repo at
  `kiltyj/viberoots`, but the final canonical home is the `viberoots` organization
  (`viberoots/viberoots`). The `kiltyj` user namespace must not retain a copy of the repo, a fork, or
  load-bearing redirects once the org-level move is complete.
- Active code and tests also contain completed-plan and completed-phase references such as
  `pr14_latency`, `deployment-auth-session.pr90.docs.test.ts`, `PR-7 zero-wasm default`, and
  `Phase-5 PR-10 policy`. These PR and phase numbers should not remain in code-facing identifiers
  once the related plans have been implemented.
- Active code also contains pre-launch compatibility and migration-era labels such as `legacy*`,
  internal `v1`/`v2` helper or contract names, and first-version schema names. Because this repo has
  not launched and has no external users, these labels should either become canonical behavior names
  or be removed when they only exist to preserve an abandoned migration path.
- The in-house `SprinkleRef` concept names the contract layer for required deployment inputs
  (secrets through `secret://`, plus non-secret runtime config through `config://` and
  `runtime://`). `SprinkleRef` is the canonical name for identifiers and prose.

Canonical replacements:

- `bucknix` -> `viberoots`
- `Bucknix` -> `Viberoots`
- `BUCKNIX` -> `VIBEROOTS`
- `bnx` -> `vbr`
- `Bnx` -> `Vbr`
- `BNX` -> `VBR`
- repo identity `bucknix-fresh` -> `viberoots`
- repository slug `kiltyj/bucknix-fresh` -> `kiltyj/viberoots`
- repository remote URL `git@github.com:kiltyj/bucknix-fresh.git` ->
  `git@github.com:kiltyj/viberoots.git`
- deployment repo path `/srv/common` -> `/srv/viberoots`
- deployment repository `kiltyj/common` -> `kiltyj/viberoots`
- deployment remote URL `git@github.com:kiltyj/common.git` -> `git@github.com:kiltyj/viberoots.git`
- GitHub owner namespace `kiltyj/viberoots` -> `viberoots/viberoots`
- GitHub remote URL `git@github.com:kiltyj/viberoots.git` -> `git@github.com:viberoots/viberoots.git`

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no compatibility aliases for old names or old public env vars
- no blind replacement of ordinary `common` helper names, prose, or shared utility filenames
- no renaming of unrelated product names such as `pleomino`
- no generated build output churn unless the source that produces it is also updated in the same PR
- no broad rewrite of historical plan documents solely to remove `PR-N` section headings
- no broad replacement of real protocol, package, tool, or third-party version strings such as
  `/api/v1`, Vault `/v1` or `kv-v2`, Go/npm module versions, Buck `buck-out/v2`, or Git porcelain
  `v1`

Each PR below must update this plan if implementation changes invalidate the remaining sequence,
scope, or assumptions.

## PR-1: Public package, plugin, artifact, and temp-name rename

### 1. Intent

Move repository-facing `bucknix` names to `viberoots` where they do not require changing the `BNX`
runtime contract yet.

### 2. Scope of changes

- Rename package and flake-facing identity from `bucknix-fresh` to `viberoots`.
- Rename repository slug and remote identity strings such as `kiltyj/bucknix-fresh` and
  `git@github.com:kiltyj/bucknix-fresh.git` to the `viberoots` equivalents.
- Rename the local ESLint plugin directory, import binding, plugin key, and rule names from
  `bucknix` to `viberoots`.
- Rename active uppercase `BUCKNIX` variables and sentinels such as `_BUCKNIX_DEVSHELL_ACTIVE` and
  `_BUCKNIX_DEVSHELL_ROOT` to `_VIBEROOTS_*`.
- Rename artifact marker files and metadata such as `bucknix.json` to `viberoots.json`.
- Rename temp/cache/lock prefixes such as `bucknix-patch-*`, `bucknix-verify*`,
  `bucknix-test-*`, `bucknix-locks`, `bucknix-pnpm*`, and `bucknix-reaper-*` to
  `viberoots-*`.
- Update source tests, fixtures, and docs that assert these names.
- Audit file and directory names containing `bucknix` and rename them when they are checked-in
  source paths rather than historical generated output.

### 3. External prerequisites

- Developers should be ready to recreate local temp/cache state under the new prefixes.
- Any local scripts referring to the repository directory as `bucknix-fresh` must be updated outside
  this repo.

### 4. Tests to be added

- Update ESLint plugin tests or enforcement tests so only the `viberoots/...` plugin key is accepted.
- Update artifact contract tests to assert `viberoots.json` and reject stale `bucknix.json` output.
- Update temp path, lock path, seed path, patch path, and reaper tests to assert `viberoots-*`
  prefixes.
- Add or update a no-stale-name enforcement test for checked-in source files that fails on
  `bucknix`, `Bucknix`, `BUCKNIX`, `bucknix-fresh`, `kiltyj/bucknix-fresh`, and old remote URLs
  outside explicitly allowed historical docs.

### 5. Docs to be added or updated

- Update build-system docs that mention temp workspaces, lock directories, verifier roots, or
  artifact metadata.
- Update testing docs that mention `bucknix-*` temp paths.
- Update app and deployment docs that contain absolute local paths under `bucknix-fresh` or
  repository slugs containing `bucknix-fresh`.

### 6. Acceptance criteria

- Checked-in source no longer uses `bucknix`, `Bucknix`, `BUCKNIX`, or `bucknix-fresh` for active
  package, plugin, artifact, temp, or cache naming.
- Active source and operator docs no longer use `kiltyj/bucknix-fresh`, old `bucknix-fresh` remote
  URLs, or absolute local paths containing `/bucknix-fresh/`.
- The ESLint config loads the renamed plugin and existing lint rules still run.
- Tests that previously asserted `bucknix-*` active behavior now assert `viberoots-*`.

### 7. Risks

- Temp path changes can leave stale local locks, caches, or reaper state behind.
- Plugin rename can silently disable lint rules if config and rule IDs are not updated together.
- Some docs contain historical log paths where changing them may reduce diagnostic value.

### 8. Mitigations

- Add explicit stale-name enforcement for active source surfaces.
- Keep historical build-log documents out of mechanical source assertions unless they describe active
  commands.
- Run targeted plugin, artifact, temp-path, and verifier tests before the full suite.

### 9. Consequences of not implementing this PR

The repository would continue exposing the old name in package metadata, lint rule IDs, artifact
files, and developer-visible temp paths.

### 10. Downsides for implementing this PR

It invalidates local caches and any private scripts that refer to old temp or plugin names.

## PR-2: Short-prefix runtime contract rename from BNX/bnx to VBR/vbr

### 1. Intent

Replace the `bnx` abbreviation and `BNX` environment-variable namespace with the `vbr`/`VBR`
namespace across active build, verify, deployment, and developer tooling.

### 2. Scope of changes

- Rename all active `BNX_*` environment variables to `VBR_*`.
- Rename shell temp files and command fragments such as `bnx-nix-outpaths.txt`,
  `bnx-workspace-root.phys`, `bnx-flk-root.*`, and `bnx-flake-*` to `vbr-*`.
- Rename debug tags such as `[BNX-BUNDLE-DEBUG]` to `[VBR-BUNDLE-DEBUG]`.
- Rename internal globals and sentinels such as `__bnxVerifyProcessRegistered` and
  `__bnx_impure_env_probe__` to `__vbr...`.
- Rename labels and metadata prefixes such as `bnx.componentId` and `bnx.artifactPath` to
  `vbr.componentId` and `vbr.artifactPath`.
- Update all call sites, tests, docs, fixtures, and generated examples in the same PR.
- Decide during implementation whether any generated artifacts need source regeneration or can be
  ignored as build output.

### 3. External prerequisites

- CI, developer shells, deployment workers, Vault/bootstrap runbooks, and any local `.env` files must
  be prepared to use `VBR_*` variables.
- Operators should treat this as a breaking env-var rename.

### 4. Tests to be added

- Update verifier, seed-store, requested-scope, deployment-scope, materialization, safehouse,
  deployment, and node/Nix tests to use `VBR_*`.
- Add negative tests proving stale `BNX_*` variables are not accepted for active runtime paths after
  migration.
- Update command-assembly tests to assert `vbr-*` temp files and `VBR_*` exported variables.
- Update Kubernetes publisher tests to assert `vbr.*` labels.

### 5. Docs to be added or updated

- Update `TESTING.md`, build-system docs, deployment docs, secrets docs, Vault bootstrap docs, and
  NixOS shared-host docs for the `VBR_*` runtime contract.
- Add a concise migration note listing the old `BNX_*` variables and their `VBR_*` replacements.

### 6. Acceptance criteria

- Active source, tests, and operator docs use `VBR_*`, `vbr-*`, and `vbr.*` instead of
  `BNX_*`, `bnx-*`, and `bnx.*`.
- Stale `BNX_*` usage is blocked by enforcement or explicit negative tests.
- The normal `i && b && v` validation flow runs using the new environment namespace.

### 7. Risks

- This PR touches many shell-command strings, so partial rename failures can appear only at runtime.
- External CI and operator environments may break immediately if not updated with the code.
- Some uppercase `BNX` hits can appear inside third-party lockfile integrity strings and must not be
  changed.

### 8. Mitigations

- Use structured searches and targeted tests for every env-var family.
- Exclude third-party lockfiles and content-addressed integrity strings from mechanical replacement.
- Document the breaking env-var migration in the same PR that changes the code.

### 9. Consequences of not implementing this PR

The public runtime namespace would continue to carry the old abbreviation even after the repository
and package name have moved.

### 10. Downsides for implementing this PR

It is a broad breaking change for scripts, CI, deployment workers, and operator muscle memory.

## PR-3: Deployment repository identity rename from common to viberoots

### 1. Intent

Replace deployment-facing uses of the temporary `common` repository identity with `viberoots`
without disturbing ordinary shared-helper uses of the word "common".

### 2. Scope of changes

- Replace reviewed repository metadata from `kiltyj/common` to `kiltyj/viberoots`.
- Replace reviewed remote URLs from `git@github.com:kiltyj/common.git` to
  `git@github.com:kiltyj/viberoots.git`.
- Replace remote host repository paths from `/srv/common` to `/srv/viberoots`.
- Update NixOS shared-host defaults, prompts, command assembly, docs, and fixtures.
- Update deployment auth, governance, control-plane, remote execution, and Vault tests that assert
  repository identity claims.
- Leave ordinary `common` helper names unchanged, including `defs_common.bzl`,
  `templates-common.nix`, `node-modules/common.nix`, local variables named `common`, and prose that
  uses "common" in its normal English meaning.

### 3. External prerequisites

- Shared hosts must have the repository checked out or mounted at `/srv/viberoots`.
- GitHub repository identity and deployment identity claims must be updated to
  `kiltyj/viberoots`.
- Any existing remote service config that points at `/srv/common` must be migrated with the code
  rollout.

### 4. Tests to be added

- Update NixOS shared-host install, prompt, remote-plan, remote-exec, Jenkins, and operator-docs
  tests to assert `/srv/viberoots`.
- Update deployment control-plane, auth diagnostics, admin Vault, and remote execution tests to
  assert `kiltyj/viberoots` and the new remote URL.
- Add a targeted stale-identity test that fails on active deployment fixtures containing
  `/srv/common`, `kiltyj/common`, or `git@github.com:kiltyj/common.git`.

### 5. Docs to be added or updated

- Update NixOS shared-host setup, usage, technician checklist, Vault bootstrap, deployments usage,
  scenarios, secrets, and deployment contract docs that describe reviewed repo identity or remote
  host paths.
- Update operator examples to use `/srv/viberoots` and `kiltyj/viberoots`.
- Update this plan if implementation discovers another concrete deployment identity string that must
  be renamed with this PR.

### 6. Acceptance criteria

- Active deployment code and tests no longer use `/srv/common`, `kiltyj/common`, or the old Git
  remote URL.
- Shared-host docs and prompts consistently instruct operators to use `/srv/viberoots`.
- Ordinary helper names containing `common` remain stable where they describe shared code rather than
  repository identity.

### 7. Risks

- A blind `common` replacement would rename many shared helper surfaces incorrectly.
- Remote hosts and identity-provider claims may be updated out of order with the repo change.
- Historical docs can contain examples that look active but are actually design history.

### 8. Mitigations

- Restrict replacement to concrete identity strings and reviewed remote path defaults.
- Add stale-identity tests scoped to deployment fixtures and active operator docs.
- Keep design-history changes limited to active instructions or examples that are still referenced.

### 9. Consequences of not implementing this PR

Deployment flows would continue to refer to the temporary repository name even after the codebase is
renamed.

### 10. Downsides for implementing this PR

It requires synchronized host-path, repository-claim, and operator-runbook updates.

## PR-4: Final stale-name enforcement, migration-label cleanup, and generated surface cleanup

### 1. Intent

Close rename gaps after the active code migrations by enforcing the new naming contract, removing
completed-plan PR-number and phase-number references from active code surfaces, removing pre-launch
`legacy` and internal version labels where they are only migration scaffolding, and cleaning up any
generated or scaffold surfaces that still emit old names.

### 2. Scope of changes

- Add or tighten repository-wide stale-name checks for active source, tests, templates, scaffolds,
  docs, and checked-in generated examples.
- Regenerate or update scaffold outputs that still emit `bucknix`, `bnx`, `BNX`, or deployment
  identity `common`.
- Rename active targets, test files, test names, fixtures, helper files, convention allowlists, and
  inventories that encode completed plan or phase numbers, such as `pr14_latency`, `phase0`,
  `deployment-control-plane.pr92.docs.test.ts`, `deployment-service-pr88.docs.test.ts`, and
  `webapp.phase4-regression-contract.pr1.test.ts`, to durable behavior-based names.
- Remove or rename active compatibility surfaces labeled `legacy` when there is no current external
  compatibility requirement. Examples to review include legacy command aliases, legacy manifest
  fallback readers, legacy deployment metadata fallbacks, legacy template ids, and legacy
  single-module watcher paths.
- Rename internal `v1`/`v2` names when they mean "old helper", "new helper", "first contract", or
  "preferred version" rather than a real external protocol/schema/tool version. Preferred helper
  surfaces should be versionless canonical names; older surfaces should be removed or explicitly
  quarantined behind behavior names if still needed for tests.
- Keep real external version identifiers unchanged, including HTTP API paths, Vault API and KV
  versions, package/module versions, Buck output-layout versions, Git porcelain versions, and
  intentionally versioned long-lived schemas whose version number is part of the contract.
- During PR-4 implementation, use a temporary reviewed rename inventory for active code-facing
  identifiers that need coordinated replacement across files. Each entry should include the stale
  token, path, target, or command surface; the chosen behavior-based replacement; the owning PR; and
  whether mechanical replacement is safe.
- Use the temporary rename inventory to keep code, tests, Buck targets, docs, convention allowlists,
  and command inventories aligned when a stale identifier appears in multiple places.
- Do not use the temporary rename inventory as a blind global replacement source. Context-sensitive
  terms such as `common`, `legacy`, `v1`/`v2`, `PR-N`, and `phase<N>` still require reviewed
  classification and explicit allowlist entries when retained.
- Resolve every temporary rename inventory entry before PR-4 is complete. Each entry must end as
  renamed, removed, or retained in the enforcement allowlist with a narrow reason.
- Delete the temporary rename inventory before PR-4 merges. Long-term state belongs in enforcement
  rules, tests, and explicit allowlists, not an old-name-to-new-name migration database.
- Add a fast repo-name, completed-plan/phase-number, and migration-label lint command that can run on
  a scoped path list for pre-commit and on the full active-source set for verify/CI.
- Wire the lint command into `.husky/pre-commit` through the existing `lint-staged` flow so staged
  active-source files cannot introduce old names, completed plan/phase-numbered identifiers, or
  unapproved migration labels.
- Wire the same lint command into the verify/test suite, preferably through the existing verify lint
  preflight plus explicit Buck/Node tests, so bypassing hooks still fails in normal validation.
- Update any active docs or command inventories that reference the renamed targets or files.
- Keep `PR-N` headings in plan documents where they are the document's planning structure, but avoid
  copying those numbers, or completed phase numbers such as `phase0` / `Phase-0`, into code
  identifiers, test descriptions, target names, fixtures, or operational commands.
- Review `docs/design-history`, `docs/build-history`, and checked-in app `dist` files and either
  update active instructions or explicitly exclude inert historical/generated content from
  stale-name checks.
- Update repo-skill, handbook, methodology exception, and plugin docs if they surface old names.
- Add a short contributor convention documenting the canonical name and abbreviation:
  `viberoots` / `Viberoots` / `VIBEROOTS` and `vbr` / `Vbr` / `VBR`.

### 3. External prerequisites

- PR-1 through PR-3 should be merged first so enforcement can be strict without blocking active
  migration work.
- Generated artifacts should be reproducible from current source before refreshing them.
- The lint command should be cheap enough to run in pre-commit on staged files without noticeably
  slowing normal commits.

### 4. Tests to be added

- Add a repository-wide stale-name enforcement test with explicit allowlists for third-party
  lockfile integrity strings and inert historical records.
- Add an active-code plan-number enforcement test or extend the stale-name enforcement test to
  reject behaviorally meaningless `pr<N>` / `PR-<N>` and `phase<N>` / `Phase-<N>` identifiers in
  source paths, Buck target names, test names, fixture names, and active command examples.
- Add active-code migration-label enforcement for unapproved `legacy` names and internal
  `v1`/`v2` labels, with allowlists only for reviewed external versions and intentionally versioned
  long-lived schema boundaries.
- Add tests or fixtures for the temporary rename inventory proving duplicate stale identifiers
  resolve to one reviewed replacement and context-sensitive entries cannot be applied as blind
  replacements while the inventory exists.
- Add closeout validation proving the temporary rename inventory has been deleted and any retained
  entries have moved to explicit enforcement allowlists with narrow reasons.
- Add pre-commit wiring tests proving `.husky/pre-commit` / `lint-staged` invokes the new lint command
  for relevant staged file types.
- Add verify-preflight tests proving the normal `v` path runs the new lint command and reports
  actionable diagnostics for old names, completed plan/phase-numbered identifiers, and unapproved
  migration labels.
- Add scaffold rendering tests proving new projects emit `viberoots` and `VBR_*` where applicable.
- Add docs-link or docs-contract tests for active operator docs that previously contained old
  absolute paths or completed plan/phase-numbered target/file references.

### 5. Docs to be added or updated

- Update contributor and tooling docs with the canonical naming rules and the stale-name allowlist
  policy.
- Document that completed-plan PR numbers and completed phase numbers must not be used in active code
  identifiers, test names, target names, fixture names, or operational command examples; use behavior
  names instead.
- Document that active `legacy` compatibility paths are not kept solely for hypothetical pre-launch
  users. Remove them where possible; otherwise rename them to the behavior they preserve and record a
  narrow reason.
- Document when internal version labels are allowed. Version labels are acceptable for external
  protocols, third-party APIs, package/module versions, tool-owned layouts, and reviewed long-lived
  schemas; they are not acceptable for "current preferred helper" or one-off migration surfaces.
- Document the temporary rename inventory format and review policy, including how to record the stale
  identifier, chosen replacement, owning PR, mechanical-replacement safety, and final resolution.
- Document that the temporary rename inventory is deleted before PR-4 merges and that long-term
  exceptions live only in enforcement allowlists with narrow reasons.
- Document that the same enforcement runs in pre-commit and verify/CI, and include the command to run
  it manually when cleaning up violations.
- Update scaffold docs and examples if generated templates expose the repo name or abbreviation.
- Update this plan with any intentionally retained historical old-name references and the reason each
  one is excluded from active-source enforcement.
- Update this plan with any intentionally retained PR-number or phase-number references and the
  reason each one is excluded from active-code enforcement.
- Update this plan with any intentionally retained active `legacy`, internal `v1`, or internal `v2`
  references and the reason each one is excluded from migration-label enforcement.

### 6. Acceptance criteria

- A clean search of active source surfaces has no unapproved `bucknix`, `Bucknix`, `BUCKNIX`,
  `bucknix-fresh`, `kiltyj/bucknix-fresh`, `bnx`, `Bnx`, `BNX`, `/srv/common`, `kiltyj/common`,
  or old remote URL hits.
- Active code, tests, Buck targets, fixtures, and command examples no longer use completed-plan
  identifiers such as `pr<N>`, `PR-<N>`, or `phase<N>` when a behavior-based name would be clearer.
- Active code, tests, Buck targets, fixtures, and command examples no longer use `legacy` labels for
  pre-launch compatibility paths unless there is an explicit reviewed reason.
- Internal helper, test, fixture, and contract names no longer use `v1`/`v2` to mean old/new,
  first/preferred, or migration-era versioning when a canonical behavior name would be clearer.
- Coordinated active identifier renames are recorded in the temporary rename inventory before or
  alongside the code changes that consume them.
- The temporary rename inventory is deleted before PR-4 merges, with all retained exceptions moved to
  explicit enforcement allowlists.
- Any remaining old-name hits are in an explicit allowlist with a narrow reason.
- Any remaining PR-number or phase-number hits are either in historical plan documents or in an
  explicit allowlist with a narrow reason.
- Any remaining active `legacy`, internal `v1`, or internal `v2` hits are either real external
  version identifiers or in an explicit allowlist with a narrow reason.
- Pre-commit rejects staged active-source files that introduce old names or completed plan/phase
  numbered identifiers or unapproved migration labels.
- The verify/test suite rejects old names, completed plan/phase numbered identifiers, and unapproved
  migration labels even when hooks are skipped.
- New scaffolded projects and active generated examples use the new naming contract.

### 7. Risks

- Repository-wide enforcement can create noisy failures if it scans third-party or historical
  artifacts without an allowlist.
- Regenerating checked-in outputs can create large diffs that obscure the actual rename.
- Over-tight checks can block legitimate words like `common` in shared-helper contexts.
- Over-tight plan-number checks can accidentally reject valid external issue IDs, protocol versions,
  changelog entries, phase names that describe active runtime concepts, or historical planning
  sections.
- Over-tight migration-label checks can reject legitimate external versions, package versions,
  Vault/Buck/Git-owned version strings, or intentionally versioned long-lived schemas.
- Pre-commit enforcement can frustrate small commits if it scans too broadly or emits vague
  diagnostics.

### 8. Mitigations

- Scope enforcement to identity strings rather than the bare English word `common`.
- Scope PR-number and phase-number enforcement to active code identifiers, test descriptions, target
  names, fixture names, and operational command examples rather than historical plan structure.
- Scope migration-label enforcement to active repo-owned identifiers and prose. Do not match
  third-party package versions, protocol paths, Vault/Buck/Git version strings, or reviewed schema
  versions whose number is part of the contract.
- Keep the temporary rename inventory reviewed and behavior-oriented while it exists; it should
  coordinate exact chosen names, not replace the classification step for contextual tokens.
- Make the pre-commit path-list mode scan only staged relevant files, while verify/CI performs the
  full active-source scan.
- Emit replacement-oriented diagnostics that name the matched token, file, and expected category of
  behavior-based replacement.
- Keep allowlists path-specific and reviewed in code.
- Regenerate only artifacts that are intentionally checked in and consumed by tests or docs.

### 9. Consequences of not implementing this PR

Old names, completed-plan PR-number or phase-number identifiers, and pre-launch migration labels
would gradually reappear through scaffolds, docs, generated examples, tests, or partial manual edits.

### 10. Downsides for implementing this PR

It adds ongoing maintenance for stale-name, plan-number, and migration-label allowlists and may
require updating tests whenever new historical docs are added.

## PR-5: GitHub owner-namespace rename from kiltyj to viberoots

### 1. Intent

Move the GitHub-side repository identity from the personal account `kiltyj/viberoots` to a dedicated
organization `viberoots/viberoots`, so the project's remote identity matches the project name and is
no longer tied to a personal account.

### 2. Scope of changes

- Move the GitHub repository from `kiltyj/viberoots` to `viberoots/viberoots`. The chosen mechanism
  (GitHub transfer with automatic redirect, or recreate-and-force-push under the new org) is recorded
  in this PR's implementation notes when it lands.
- Replace `kiltyj/viberoots` with `viberoots/viberoots` in all active source, tests, fixtures,
  operator runbooks, command examples, and Buck/Nix configuration that names the remote.
- Replace `git@github.com:kiltyj/viberoots.git` with `git@github.com:viberoots/viberoots.git`
  everywhere it appears as a reviewed default or operator example.
- Replace `https://github.com/kiltyj/viberoots` URLs in active docs, README badges, and any GitHub
  Pages or workflow references.
- Update OIDC issuers, identity-provider claim mappings, deployment-host workload-identity
  expectations, Vault role configs, and any deploy-key registrations that hard-code the `kiltyj`
  account name or organization claim.
- Update the local workstation `github` git remote URL.
- Update the `mini` host's `/srv/viberoots` checkout to use the new remote URL, including the
  `docs/history/migrations/mini-name-migration-instructions.md` runbook so operators land at `viberoots/viberoots`
  directly rather than transiting through `kiltyj/viberoots`.
- Add `kiltyj/viberoots` and `git@github.com:kiltyj/viberoots.git` to the stale-names lint's
  `STALE_PATTERNS`, with parallel updates to the test enforcement allowlist.
- Audit and remove any incidental forks, branches, or deploy keys under `kiltyj/viberoots` that
  would resurrect the old identity. Once the move is complete, the GitHub auto-redirect is acceptable
  only as a temporary fallback during cutover; it must not become a long-lived alias and no new
  `kiltyj/viberoots` repository may be created to take its place.

### 3. External prerequisites

- The `viberoots` GitHub organization must exist with the operator's account as owner.
- PR-1 through PR-4 must be merged so the repo lives at `kiltyj/viberoots` and is in a state where
  the only outstanding identity migration is the owner-namespace move.
- Registered GitHub Apps, deploy keys, branch protection rules, environments, repository-scoped
  secrets, and OIDC trust relationships that currently target `kiltyj/viberoots` must be re-registered
  or transferred under the new org before active automation switches over.
- CI systems (Jenkins, any GitHub Actions runners) and the `mini` host must be ready to use the new
  remote URL.
- Collaborators and external automation must be informed of the new clone URL and the cutover date.

### 4. Tests to be added

- Add `kiltyj/viberoots` and `git@github.com:kiltyj/viberoots.git` to the stale-names lint's
  `STALE_PATTERNS`, with negative tests proving they are rejected outside the planning-document
  allowlist.
- Update NixOS shared-host install, deployment auth, control-plane, and remote-execution tests that
  previously asserted `kiltyj/viberoots` to assert `viberoots/viberoots`.
- Add a targeted stale-identity test that fails on active deployment fixtures containing
  `kiltyj/viberoots` or the old remote URL.
- Update operator-docs and runbook tests that assert remote-URL strings.

### 5. Docs to be added or updated

- Update operator runbooks and deployment usage docs to reference `viberoots/viberoots`.
- Update `docs/history/migrations/mini-name-migration-instructions.md` to point directly at `viberoots/viberoots` and
  instruct operators to skip the transitional `kiltyj/viberoots` state on first migration.
- Update README badges, contribution docs, and any external-collaboration docs whose URLs include
  the owner namespace.
- Update the "Canonical replacements" section of this plan with the
  `kiltyj/viberoots -> viberoots/viberoots` entries.
- Update the "Retained references and enforcement allowlist notes" section to record that
  planning-document references to `kiltyj/viberoots` are retained for the same reason
  `kiltyj/common` references are retained: the plan must name the stale tokens it replaces.

### 6. Acceptance criteria

- Active source, tests, fixtures, operator docs, and command examples no longer use
  `kiltyj/viberoots` or `git@github.com:kiltyj/viberoots.git`.
- The stale-names lint rejects `kiltyj/viberoots` and the old remote URL outside the
  planning-document allowlist.
- The local workstation `github` remote and the `mini` host's checkout both push and fetch from
  `viberoots/viberoots`.
- OIDC, Vault, and deployment workload-identity configs that previously referenced the `kiltyj`
  account name have been updated, and a deployment dry-run completes against the new identity.
- No `kiltyj/viberoots` repository, fork, or deploy key exists under the `kiltyj` user namespace
  after cutover. The only persistence of the old identity is the GitHub automatic redirect, which is
  treated as a temporary safety net rather than a supported alias.

### 7. Risks

- GitHub's automatic redirect from `kiltyj/viberoots` to `viberoots/viberoots` masks half-migrated
  callers, making it easy to miss automation that still points at the old slug.
- OIDC identity claims, federated-trust configurations, and Vault role bindings that encode the
  account name will fail closed if not updated in lockstep with the move.
- Deploy keys registered against the old repo identity do not automatically transfer in all
  configurations and may need re-creation under the new org.
- The transferred repo retains commit history, but org-level settings (branch protection,
  environments, secrets) must be re-applied; missing one silently weakens governance.
- Pre-existing PRs from collaborators will need rebasing onto the new remote.

### 8. Mitigations

- Treat the move as a coordinated cutover with a short maintenance window: pause CI and active
  deployments, update remote URLs, re-run a deployment dry-run, then resume.
- Inventory every callable surface that references the old slug before the move, including OIDC
  trust policies, Vault roles, Jenkins job configs, and the `mini` host's git remote, and confirm
  each has been updated.
- Use the GitHub auto-redirect as a transitional safety net only; immediately add the old slug to
  `STALE_PATTERNS` so new code cannot reintroduce it.
- Re-register deploy keys, branch protection rules, environments, and repository-scoped secrets
  under `viberoots/viberoots` before deleting the old configurations.
- Sequence after PR-1..PR-4 so the only outstanding rename is the owner-namespace move, and the
  stale-names enforcement infrastructure is already in place to catch regressions.

### 9. Consequences of not implementing this PR

The canonical repository identity would remain tied to a personal GitHub account, blocking
cross-maintainer ownership, complicating long-term governance, and leaving an avoidable mismatch
between the project name and the remote URL.

### 10. Downsides for implementing this PR

It is a one-shot coordinated cutover that requires synchronized updates to remote URLs across every
clone, CI worker, OIDC trust policy, and deployment-host checkout. The work cannot be rolled out
incrementally without leaving callers half-migrated.

## PR-6: In-house input-contract layer finalization as SprinkleRef

### 1. Intent

Finalize `SprinkleRef` as the canonical in-house concept name for the deployment input contract in
code identifiers, file names, and doc glossary entries. The name covers required secrets through
`secret://` plus non-secret runtime inputs through `config://` and `runtime://`.

### 2. Scope of changes

- Ensure the TypeScript module `build-tools/tools/deployments/deployment-sprinkle-ref.ts`, its
  importers, and paired test paths use the canonical `SprinkleRef` vocabulary.
- Preserve existing secret-specific type names such as `DeploymentSecretBackendKind` and
  `DeploymentSecretContractBinding`; their `Secret*` prefixes describe `secret://` inputs and are
  not the concept-layer name.
- Update the contributor naming conventions doc so `SprinkleRef` is the only documented in-house
  input-contract concept name.
- Update active-prose sections of the operator and design docs, including `docs/secrets-usage.md`,
  `docs/deployment-secrets-api.md`, `docs/history/designs/deployments-design.md`, `docs/deployments-usage.md`,
  `docs/vault-production-bootstrap.md`, `docs/nixos-shared-host-setup.md`, and relevant
  `projects/docs/*` design docs.
- Update `docs/history/plans/deployment-plan.md` prose so completed-PR narratives also use `SprinkleRef`; the repo
  no longer retains historical exceptions for the former concept name.
- Update `docs/history/migrations/mini-name-migration-instructions.md`: bump the preconditions list from "PR-1..PR-5"
  to "PR-1..PR-6". `mini` is still in the pre-PR-3 state at the time PR-6 lands, so the runbook
  body continues to describe the original migration from `bucknix`/`bnx`/`kiltyj/common` to
  `viberoots`/`vbr`/`viberoots/viberoots`. The runbook does not currently reference the
  `SprinkleRef` layer name; verify during PR-6 implementation that no host-side surface needs
  operator instructions.
- Add stale-name lint coverage so the former concept name cannot be reintroduced.
- Leave the `secret://`, `config://`, and `runtime://` URI schemes unchanged. These are
  operator-visible identifiers serialized in deployment records and reviewed admission fixtures;
  renaming them would be a breaking change with no benefit.
- Do not generalize the existing secret-specific type system
  (`DeploymentSecretContractBinding` and friends) to cover `config://` / `runtime://` inputs as
  first-class peers. That work, if pursued, is a separate refactor with its own design discussion
  and is explicitly out of scope here.

### 3. External prerequisites

- PR-1 through PR-5 should be merged ahead of this PR so the rename does not conflict with
  concurrent identity migrations or operator-runbook churn.
- No further external coordination is required.

### 4. Tests to be added

- Add stale-name lint coverage with a negative test proving the former concept name is rejected.
- Update `cloudflare-pages.sprinkle-ref.e2e.test.ts` and any other test that asserts the concept
  name as a string to use `SprinkleRef`. Behavioral assertions are unchanged.

### 5. Docs to be added or updated

- Update the public docs listed in the scope section to use `SprinkleRef`.
- Update the contributor naming conventions doc with the canonical concept name and rationale.
- Update `docs/history/migrations/mini-name-migration-instructions.md` preconditions to reference PR-1..PR-6, with no
  change to the body since `mini` is still in the pre-PR-3 state and the runbook does not
  reference the `SprinkleRef` layer name today.
- Update the "Retained references and enforcement allowlist notes" section so no retained historical
  exception exists for the former concept name.

### 6. Acceptance criteria

- No active code identifier, filename, plan document, historical narrative, or operator-facing doc
  references the former in-house concept name.
- The TypeScript module, test file, and `.bzl` taxonomy references are aligned and pass
  type-checking and the test suite without behavioral changes.
- The stale-names lint rejects the former concept name without a retained-reference allowlist.
- `docs/history/migrations/mini-name-migration-instructions.md` lists "PR-1..PR-6" in its preconditions and is
  otherwise unchanged for the pre-PR-3 `mini` state.
- The `secret://`, `config://`, and `runtime://` URI schemes remain unchanged in deployment
  records and admission fixtures.

### 7. Risks

- The "Sprinkle" lexicon is whimsical and may face friction in security or compliance reviews if
  the prose reads as flippant when the contract is resolving production secrets.
- The diff is wide (many docs and code identifiers) which makes review slow and partial rebases
  risky.
- Concurrent in-flight work may reintroduce the former concept name; without lint enforcement, drift
  is likely.
- Completed-PR narratives now use `SprinkleRef` too, so the final repo has no historical exception
  for the former term.
- The mini runbook's body is unchanged by PR-6 today, but if the runbook later grows
  `SprinkleRef`-aware operator steps (for example, an explicit Vault role check), those would need
  to be authored using the new vocabulary.

### 8. Mitigations

- Use full noun phrases in compliance-facing prose ("the SprinkleRef contract for the production
  API token") rather than the bare verb to preserve gravity.
- Land the rename in a single coordinated cutover; do not split across multiple PRs.
- Add the lint rule in the same PR that lands the rename so drift is blocked immediately.
- Rewrite historical retrospective sections to use `SprinkleRef`, matching the no-retained-term
  closeout policy.
- During PR-6 implementation, grep `docs/history/migrations/mini-name-migration-instructions.md` for any new
  references to the old or new layer name and update both the preconditions list and any body
  references in lockstep.

### 9. Consequences of not implementing this PR

The codebase would retain mixed vocabulary for the deployment input contract. New contributors would
continue to see inconsistent glossary, file-name, and test-name examples for the same concept.

### 10. Downsides for implementing this PR

It is a wide, mostly-mechanical rename that touches many doc files and a smaller number of code
paths. The "Sprinkle" lexicon may need defending in security or compliance prose where bare verbs
risk understating the gravity of production secret resolution.

## PR-7: Rename closeout audit hardening and residual compatibility cleanup

### 1. Intent

Close the residual gaps found by the post-PR-6 rename assessment: the current checkout still has a
local `github` remote pointing at the old repository, path names with completed PR numbers can
bypass stale-name enforcement, and one active planner-visible Starlark helper still keeps a
migration-era compatibility alias for the old provider-realization vocabulary.

This PR is a closeout and hardening pass. It should not introduce new naming policy; it should make
the PR-1 through PR-6 policy true in the current checkout and enforceable in future changes.

### 2. Scope of changes

- Update the local workstation `github` remote from the old `kiltyj/common` URL to
  `git@github.com:viberoots/viberoots.git`, and add a lightweight checked-in verification or
  operator checklist entry so future closeout reviews explicitly check the local remote.
- Ensure `docs/history/plans/deployment-plan.md` uses `SprinkleRef` consistently, including the PR-37
  retrospective narrative and the later PR-101 host-secret section.
- Remove the retained-reference exception for the former input-contract term; no plan or historical
  narrative should keep that term.
- Extend stale-name linting so it checks tracked file paths as well as file contents for stale repo
  names, completed-plan `pr<N>` / `PR-<N>` identifiers, completed-phase `phase<N>` identifiers, and
  unapproved migration labels.
- Rename, remove, or explicitly archive active source paths that still encode completed PR numbers,
  including `build-tools/tools/dev/move-maps/reorg-pr3.txt` and
  `build-tools/tools/dev/move-maps/reorg-pr5.txt`.
- Remove the `realize_providers_into` compatibility alias from planner-visible Starlark wiring, and
  require callers to use the canonical `provider_realization_mode` vocabulary.
- Remove support for the legacy `"srcs"` provider-realization value and require `"inputs"` for the
  behavior where provider edges are realized into `srcs`.
- Update any call sites, tests, probes, docs, or diagnostics that mention the old alias or the
  legacy `"srcs"` vocabulary.
- Update the retained-reference notes in this plan so every remaining old-name, completed-plan,
  completed-phase, `legacy`, `v1`, or `v2` exception is narrow, current, and enforced by code rather
  than relying on a broad file-level exemption.

### 3. External prerequisites

- The canonical GitHub repository `viberoots/viberoots` must exist and be accessible from the
  workstation running the closeout.
- Any local clone that still uses `kiltyj/common`, `kiltyj/viberoots`, or a GitHub redirect must be
  ready for a direct remote URL update.
- PR-1 through PR-6 should already be landed so the closeout can be strict without blocking active
  migration work.

### 4. Tests to be added

- Add a stale-name lint test proving file paths are scanned, not only file contents. The test should
  fail on temporary tracked-path fixtures such as `reorg-pr3.txt`, `docs/pr3-helper.ts`,
  `build-tools/foo/pr3.test.ts`, and `legacy-helper.ts` unless they are under a reviewed narrow
  allowlist.
- Add a regression test proving `docs/history/plans/deployment-plan.md` has no retained exception for the former
  input-contract term.
- Add a negative test proving active prose cannot reintroduce the former input-contract term.
- Add Starlark wiring tests proving `realize_providers_into` is rejected or absent from the public
  helper surface and that `"srcs"` is no longer accepted as a provider-realization mode.
- Update existing planner-visible wiring probe tests to use `provider_realization_mode = "inputs"`
  for the canonical provider-to-inputs path.
- Add or update a repository-remote contract test or documented manual check that asserts the local
  `github` remote is expected to be `git@github.com:viberoots/viberoots.git` during rename closeout.
- Keep the existing pre-commit and verify-preflight wiring tests passing after the new path-scanning
  behavior is added.

### 5. Docs to be added or updated

- Update `docs/history/plans/deployment-plan.md` active prose and historical narratives to use `SprinkleRef`.
- Update this plan's retained-reference notes with the final narrow allowlist entries and remove any
  statement that implies the whole `docs/history/plans/deployment-plan.md` file is exempt.
- Update contributor naming conventions if the manual local-remote verification step should be part
  of future rename or repository-identity closeouts.
- Update any active build-system or Starlark wiring docs that still describe the
  `realize_providers_into` alias or legacy `"srcs"` vocabulary.

### 6. Acceptance criteria

- `git remote -v` for the local `github` remote points at
  `git@github.com:viberoots/viberoots.git` for both fetch and push in the closeout workspace.
- `docs/history/plans/deployment-plan.md` uses `SprinkleRef` consistently and has no retained historical exception
  for the former input-contract term.
- The stale-name lint fails on stale tokens in tracked file paths as well as file contents.
- Active checked-in paths no longer include completed-plan names such as `reorg-pr3.txt` or
  `reorg-pr5.txt` unless they are moved under an explicitly historical/archival boundary with a
  narrow reason.
- Planner-visible Starlark helper surfaces no longer expose `realize_providers_into`, and the
  legacy `"srcs"` provider-realization value is removed in favor of canonical `"inputs"`.
- The retained-reference notes in this plan match the implemented allowlists exactly enough that a
  reviewer can audit every remaining exception without reverse-engineering the lint code.
- Pre-commit and verify/CI continue to run stale-name enforcement, and the full active-source scan
  rejects old names, completed plan/phase numbered identifiers, and unapproved migration labels even
  when hooks are skipped.

### 7. Risks

- Tightening path scanning may reveal many filenames that were previously invisible to enforcement,
  especially historical move maps and test fixtures.
- Removing `realize_providers_into` and `"srcs"` could break Starlark macros or probes that still
  rely on the compatibility vocabulary.
- Removing retained input-contract terminology can be noisy because `docs/history/plans/deployment-plan.md` is
  large and contains both active planning and historical retrospective sections.
- Local git remote state is outside tracked source, so it cannot be fully enforced by ordinary
  checked-in tests.

### 8. Mitigations

- Start with path-scanning tests against small fixture repositories so diagnostics are clear before
  scanning the full repo.
- Rename or archive only the specific active paths discovered by the stricter scan; do not apply a
  blind path rewrite across historical docs.
- Replace `realize_providers_into` call sites mechanically with `provider_realization_mode`, then
  rely on targeted Starlark wiring tests to prove behavior stayed unchanged.
- Rewrite historical deployment-plan narratives to use `SprinkleRef` so no line- or section-specific
  exception remains for the former input-contract term.
- Treat local remote verification as a closeout command/checklist item plus optional developer
  diagnostic, rather than trying to make normal tests depend on one developer's local git config.

### 9. Consequences of not implementing this PR

The rename would appear complete under the current stale-name lint while still retaining old
repository remote state, path-level completed-plan identifiers, and a planner-visible compatibility
alias that contradicts the no-compatibility-alias closeout policy.

### 10. Downsides for implementing this PR

This is mostly enforcement and cleanup work, so it can feel stricter than the visible runtime
benefit. It may require small coordinated edits across Starlark helpers, tests, docs, and local git
configuration before the repo reaches a genuinely closed rename state.

## PR-8: Temp Buck isolation registration hardening and cleanup enforcement

### 1. Intent

Close the cleanup gap found during PR-7 validation: `runInTemp` now provides automatic temp Buck
isolation registration, but tests can still bypass that safety net by passing their own explicit
`buck2 --isolation-dir ...` inside a temp repo. The closeout should make the automatic path the
default contract for future tests and reserve independent nested Buck isolations for rare,
documented cases.

This PR should not require individual test authors to register new tests manually. It should harden
the shared helpers and enforcement so ordinary new `runInTemp` tests inherit registration,
reaping, and final cleanup automatically.

### 2. Scope of changes

- Audit all `runInTemp` tests that invoke Buck and replace computed or ad hoc explicit
  `--isolation-dir` values with the shared temp isolation, `inheritedBuckIsolation(...)`, or another
  already-registered helper path.
- Tighten the existing hardcoded-isolation enforcement so it catches any explicit
  `buck2 --isolation-dir` inside `runInTemp`, including template expressions and helper-generated
  names, unless the line uses an approved inherited isolation helper or a narrow allow comment.
- Require every allow comment for an independent nested Buck isolation to state why the test cannot
  reuse the registered temp isolation.
- Keep the `runInTemp` Buck shim as the primary path for plain `buck2 ...` commands, and make sure
  docs and tests describe that as the expected pattern.
- Make the registered-isolation cleanup tests cover both plain-shim Buck calls and explicit
  inherited-isolation calls, including the case where the live Buck daemon/forkserver displays the
  checkout name instead of the temp repo name.
- Add a final leak gate or documented verification step that scans for leftover verify/temp Buck
  daemon and forkserver processes after a full `v` run.

### 3. External prerequisites

- PR-7's registered Buck cleanup fix must be present so cleanup can use exact registered isolation
  ids rather than repo-root or display-name assumptions.
- The full-suite `v` run should be available locally because this PR is specifically about
  concurrency and cleanup behavior under the normal verify harness.

### 4. Tests to be added

- Extend `run-in-temp.no-hardcoded-buck-isolations.enforcement.test.ts` so it fails on computed
  explicit isolation forms such as `buck2 --isolation-dir ${iso}` and
  `buck2 --isolation-dir ${isoForTmp(tmp)}` inside `runInTemp`.
- Add positive fixtures proving plain `buck2 ...` inside `runInTemp` is accepted because the Buck
  shim injects the registered temp isolation automatically.
- Add positive fixtures proving `inheritedBuckIsolation(...)` remains accepted for tests that need
  to spell the isolation explicitly while still sharing the registered isolation.
- Update the C++ and Node invalidation tests that currently create unregistered explicit
  isolations so they use the registered path.
- Keep or add cleanup regression tests proving registered isolation cleanup kills temp Buck
  daemon/forkserver pairs even when the process command line reports the checkout display name.
- Validate with the full `v` suite and a post-run process scan for verify/temp Buck leftovers.

### 5. Docs to be added or updated

- Update the test-helper documentation or contributor testing guidance to state that `runInTemp`
  tests should call plain `buck2 ...` by default and rely on the shim-provided registered isolation.
- Document `inheritedBuckIsolation(...)` as the approved escape hatch when a test must pass
  `--isolation-dir` explicitly.
- Document the required post-full-suite leak check used during this closeout so future cleanup work
  has a concrete verification pattern.

### 6. Acceptance criteria

- No `runInTemp` test creates an unregistered ad hoc Buck isolation.
- The hardcoded-isolation enforcement catches literal, computed, and helper-generated explicit
  `buck2 --isolation-dir` forms inside `runInTemp` unless they use the approved inherited helper or
  a narrow documented allow comment.
- Ordinary new `runInTemp` tests require no per-test registration to get Buck cleanup coverage.
- Targeted cleanup and enforcement tests pass.
- A full-suite `v` run passes.
- A post-run process scan shows no leftover verify/temp Buck daemons or forkservers from the suite.

### 7. Risks

- Some tests may intentionally use separate Buck daemon state to prove invalidation behavior, and
  converting them blindly could reduce coverage.
- Overly broad linting could reject harmless non-executable examples or tests that are not actually
  inside a `runInTemp` callback.
- The process-leak scan is platform-sensitive because process listings differ between macOS and
  Linux.

### 8. Mitigations

- Review each explicit isolation call site and preserve independent-daemon semantics only when the
  test needs them, with a narrow allow comment.
- Implement the enforcement using source-aware matching around files that call `runInTemp`, and keep
  positive fixtures for the accepted patterns.
- Keep process matching based on registered isolation ids and known verify/temp isolation prefixes,
  not broad repo-name or display-name heuristics.
- Treat the post-run leak scan as validation evidence for this closeout rather than as a replacement
  for the registered cleanup tests.

### 9. Consequences of not implementing this PR

Future tests could accidentally bypass the registered cleanup layer with computed explicit Buck
isolations. That would recreate the same class of orphaned Buck daemon/forkserver leaks under
verify concurrency, even though the shared `runInTemp` helper itself is correct.

### 10. Downsides for implementing this PR

The enforcement is stricter than the current style and may require small edits across existing
tests that already pass. The benefit is primarily operational: fewer intermittent slowdowns,
orphaned processes, and filesystem-indexing churn during full-suite validation.

## PR-9: runInTemp Buck isolation enforcement bypass closeout

### 1. Intent

Close the remaining PR-8 enforcement gap by making the `runInTemp` Buck isolation lint source-aware
enough to catch explicit `buck2 --isolation-dir` usage that is split across lines, assembled with
template expressions, or hidden behind helper-generated command strings. The enforcement should cover
all files that define or feed `runInTemp` Buck commands, not just single-line matches in `.test.ts`
files.

### 2. Scope of changes

- Broaden the hardcoded-isolation enforcement from single-line text matching to command-aware
  detection that can identify `buck2 --isolation-dir` across multiline strings, template
  expressions, arrays, and helper-returned command fragments inside `runInTemp` flows.
- Expand the scanned file set beyond paths ending in `.test.ts` so shared helper files and fixtures
  that generate `runInTemp` Buck commands are covered.
- Keep the approved paths from PR-8 intact: plain `buck2 ...` should rely on the `runInTemp` shim,
  and explicit `--isolation-dir` should be accepted only when it uses an approved inherited
  isolation helper or a narrow documented allow comment.
- Add bypass fixtures for split and multiline command forms, template interpolation forms such as
  `${iso}` and `${isoForTmp(tmp)}`, and helper-generated isolation-name forms.
- Update any discovered helper-generated explicit isolation call sites so they use the registered
  temp isolation path, an approved inherited helper, or a justified allow comment.

### 3. External prerequisites

- PR-8's `runInTemp` isolation helper contract and allow-comment policy must be present.
- The existing lint/enforcement test harness must be available so bypass fixtures can exercise the
  same scan path used by normal validation.

### 4. Tests to be added

- Add negative enforcement fixtures for multiline and split `buck2 --isolation-dir` commands inside
  `runInTemp`.
- Add negative enforcement fixtures for template-expression and helper-generated isolation names
  inside `runInTemp`, including helpers in files that are not named `.test.ts`.
- Add positive fixtures proving approved inherited-isolation helpers and narrowly documented allow
  comments still pass under the broader scan.
- Add a regression fixture proving helper files that generate `runInTemp` Buck commands are scanned
  even when the helper file itself is not a test file.

### 5. Docs to be added or updated

- Update the contributor testing or test-helper documentation to state that the enforcement covers
  multiline, template-built, and helper-generated `buck2 --isolation-dir` commands in `runInTemp`
  flows.
- Document that shared helper files participating in `runInTemp` Buck command generation are part of
  the enforcement surface, even when they are not named `.test.ts`.

### 6. Acceptance criteria

- The hardcoded-isolation enforcement catches explicit `buck2 --isolation-dir` in `runInTemp` when
  the command is split across lines, assembled with template expressions, or generated by helper
  functions.
- Shared helper files that participate in `runInTemp` Buck command generation are scanned even when
  they are not named `.test.ts`.
- Approved inherited-isolation helpers and justified allow comments remain accepted.
- Targeted enforcement tests cover the newly closed bypass shapes.

### 7. Risks

- Broader command detection can produce false positives for inert examples, diagnostic strings, or
  helper code that is not actually used inside `runInTemp`.
- Following helper-generated command strings too broadly could make the lint slower or harder to
  reason about.
- A narrow file-list expansion could still miss future helper locations if the enforcement relies on
  naming conventions instead of usage.

### 8. Mitigations

- Anchor enforcement to source structure around `runInTemp` usage and helper call graphs rather than
  repository-wide raw string matching.
- Keep positive fixtures for accepted inherited-isolation and allow-comment paths beside the new
  negative bypass fixtures.
- Prefer a documented scanned-surface rule based on `runInTemp` participation over suffix-only file
  naming.

### 9. Consequences of not implementing this PR

Tests and helpers could continue to bypass registered temp Buck cleanup by hiding explicit
`--isolation-dir` usage in multiline, template-built, or helper-generated command forms. That would
leave the PR-8 closeout narrower than the plan requires.

### 10. Downsides for implementing this PR

The lint becomes more sophisticated and may need careful fixture maintenance when shared test helpers
change. The tradeoff is a smaller bypass surface for Buck daemon and forkserver cleanup leaks.

## PR-10: runInTemp Buck isolation lint graph and approval precision

### 1. Intent

Close the remaining PR-8/PR-9 end-of-range enforcement gaps by making the `runInTemp` Buck
isolation lint approve inherited-isolation usage at the offending command level, not at the
surrounding context-window level, and by scanning helper files outside `build-tools/tools/tests`
when they participate in `runInTemp` Buck command generation.

### 2. Scope of changes

- Replace the current context-window approval for explicit `buck2 --isolation-dir` hits with
  command-aware approval that accepts only the specific command using `inheritedBuckIsolation(...)`,
  `BUCK_NESTED_ISO`, or a narrow documented allow comment.
- Add a regression path where a bad command such as `buck2 --isolation-dir ${isoForTmp(tmp)}` is
  near a separate approved inherited-isolation command and still fails enforcement.
- Extend the scan surface from files rooted under `build-tools/tools/tests` to the participating
  helper files outside that tree that are in the `runInTemp` command-generation import graph.
- Include focused coverage for deployment-style query helpers or equivalent non-test-tree helpers
  that assemble Buck commands used by `runInTemp` tests.
- Keep the scan bounded to files that participate in `runInTemp` Buck command generation so inert
  examples and unrelated helper modules do not become enforcement targets.

### 3. External prerequisites

- PR-9's source-aware `runInTemp` Buck isolation lint must be present.
- The existing enforcement fixture harness must support colocating approved and rejected command
  forms in the same fixture file.
- The lint implementation must have access to enough TypeScript import information to identify
  non-test-tree helpers that feed `runInTemp` command generation.

### 4. Tests to be added

- Add a negative fixture proving a bad explicit isolation command fails even when an approved
  `inheritedBuckIsolation(...)` command appears within the old 11-line context window.
- Add a negative fixture proving `BUCK_NESTED_ISO` only approves the command that actually uses it,
  not a neighboring bad explicit isolation.
- Add positive fixtures proving approved inherited-isolation commands and documented allow comments
  still pass when approval is evaluated per command.
- Add focused fixtures where a `build-tools/tools/tests` `runInTemp` test imports a helper outside
  that tree, the helper assembles a Buck command, and an unapproved explicit isolation in that
  helper fails enforcement.
- Add a positive import-graph fixture proving unrelated outside-tree helpers are not scanned unless
  they participate in `runInTemp` Buck command generation.

### 5. Docs to be added or updated

- Update the contributor testing or test-helper documentation to state that approved inherited Buck
  isolation forms are evaluated per generated command, not per nearby source context.
- Document that non-test-tree helper files are included in the lint when they are imported into the
  `runInTemp` Buck command-generation graph.
- Document the intended boundedness of the graph scan so future helpers know when they are part of
  the enforcement surface.

### 6. Acceptance criteria

- A bad explicit `buck2 --isolation-dir` command inside a `runInTemp` command-generation flow cannot
  be waived merely because an approved inherited-isolation command appears nearby.
- `inheritedBuckIsolation(...)`, `BUCK_NESTED_ISO`, and documented allow comments approve only the
  command they apply to.
- Helper files outside `build-tools/tools/tests` are scanned when they participate in the
  `runInTemp` Buck command-generation import graph.
- Focused regression fixtures cover both neighboring-approved-command bypasses and outside-tree
  helper scan participation.

### 7. Risks

- Command-aware approval can be brittle if the lint cannot reliably identify command boundaries
  across template strings, arrays, and helper-returned fragments.
- Import-graph expansion can accidentally over-scan unrelated files if participation is inferred too
  broadly.
- Under-scanning remains possible if helper participation is based only on direct imports and misses
  wrapper modules.

### 8. Mitigations

- Keep the approval model tied to parsed or normalized command units rather than raw line windows.
- Add both positive and negative fixtures with approved and rejected commands close together in the
  same file.
- Bound the graph walk to modules reachable from `runInTemp` test files that contribute Buck command
  strings or command builders, and cover direct and wrapper-helper cases with fixtures.

### 9. Consequences of not implementing this PR

The lint can continue to waive a bad explicit isolation when an approved inherited command happens
to appear nearby, and helpers outside `build-tools/tools/tests` can keep assembling unregistered
Buck commands without being scanned. That leaves the cleanup enforcement dependent on file layout
and source proximity rather than the actual generated command.

### 10. Downsides for implementing this PR

The enforcement needs more precise command attribution and a small import-graph model, which adds
maintenance cost to the lint fixtures. The benefit is that approval and scan coverage line up with
the commands that can actually leak Buck daemon or forkserver state.

---

## Retained references and enforcement allowlist notes

This section documents every intentionally retained old-name reference, PR/phase-number
reference, or `legacy`/`v1`/`v2` reference in active source, along with the reason each is
excluded from the stale-names-lint enforcement.

### Historical old-name references excluded from active-source enforcement

- `docs/history/migrations/repo-rename.md` (this file): excluded via `ALLOWED_PATHS` in
  `build-tools/tools/dev/stale-names-lint-allowlists.ts` and the parallel allowlist in
  `build-tools/tools/tests/linting/no-stale-viberoots-names.enforcement.test.ts`.
  This file is the planning document for the rename itself and must name the stale tokens.
- `docs/history/migrations/runtime-prefix-migration.md`: excluded via `ALLOWED_PATHS`. This file records the
  `BNX_*` → `VBR_*` migration history and must reference old variable names for operator
  context.
- `docs/contributor-naming-conventions.md`: excluded via `ALLOWED_PATHS`. The conventions
  doc names the stale tokens in enforcement examples so contributors know what is blocked.
- `docs/history/migrations/mini-name-migration-instructions.md`: excluded via `ALLOWED_PATHS`. Operator
  runbook for migrating the `mini` shared host from the old names; must reference
  `/srv/common`, `BNX_*`, `kiltyj/common`, and `kiltyj/viberoots` to describe what is being
  replaced at each migration stage.
- `docs/history/investigations/mayday-test-time-debugging.md`: excluded via `ALLOWED_PATHS`. Historical debugging log;
  not active operator documentation.
- `pnpm-lock.yaml`: excluded via `ALLOWED_PATHS`. Third-party lockfile content-addressed
  integrity strings may coincidentally contain stale substrings and must not be renamed.
- Files under `docs/history/build-system/logs/` and `docs/history/designs/legacy/`: excluded via
  `ALLOWED_PREFIXES`. These are inert historical records, not active instructions.
- `docs/history/build-system/logs/move-maps/build-system-reorg-map.txt` and
  `docs/history/build-system/logs/move-maps/language-root-reorg-map.txt`: historical file move maps archived
  under the build-history boundary after PR-7 removed their completed-plan-number filenames from
  active dev-tool paths.
- `docs/history/migrations/repo-rename.md` references to `kiltyj/viberoots`: retained for the same reason as
  `kiltyj/common` references — the plan document must name the stale tokens it replaces. The
  PR-5 sections name `kiltyj/viberoots` and `git@github.com:kiltyj/viberoots.git` to describe
  what is being moved to the `viberoots` org.
- `build-tools/tools/tests/deployments/nixos-shared-host.control-plane-service-env.test.ts`:
  excluded via `ALLOWED_PATHS`. This test asserts that the old `BNX_DEPLOY_CONTROL_PLANE_TOKEN`
  variable is rejected; the old variable name must appear as a test fixture string.
- Files under `third_party/uv2nix/`: excluded via `ALLOWED_PREFIXES`. The `uv2nix` third-party
  library uses `nixpkgs.legacyPackages`, which is an upstream Nixpkgs API name and must not
  be renamed.

### PR-number and phase-number references excluded from active-code enforcement

Plan/phase numbers in ordinary `.md` prose are skipped by `stale-names-lint` unless the line is a
command-like example. The exact plan-document paths below are also excluded via
`PLAN_NUMBER_SKIP_PATHS` because they intentionally contain dense structural `PR-N` headings,
cross-references, or reviewed milestone labels that are planning metadata rather than active code
identifiers:

- `docs/history/plans/deployment-plan.md`: active deployment plan with structural PR headings and completed-PR
  cross-references; stale repository names still run through the separate content checks.
- `docs/history/plans/external-deployments-plan.md`: external deployments plan with structural PR headings,
  completed-PR cross-references, and reviewed Phase 0 rollout prose.
- `docs/history/build-system/nix-gaps-plan.md`: Nix migration closeout plan that intentionally names migration
  phases and old/new route concepts while documenting the completed migration.
- `docs/history/build-system/nix-gaps-prs.md`: Nix migration PR execution plan with structural PR headings,
  implementation snapshots, and superseded-PR notes.
- `build-tools/tools/tests/linting/stale-names-lint.behavior.test.ts`: deliberate negative fixtures
  for `PR-N`, `phase<N>`, `legacy`, and internal `v1`/`v2` enforcement behavior.
- `build-tools/tools/tests/linting/rename-inventory.closeout.test.ts`: deliberate stale-token
  fixtures proving duplicate `PR-N` inventory entries resolve to one reviewed replacement and
  contextual tokens cannot be marked blindly replaceable.
- `build-tools/tools/nix/shared-host-identity-provider-migration.nix`: retains a serialized
  `.deployment-host-keycloak-bootstrap-admin-created-v2` marker generated on hosts; the suffix is a
  reviewed host-state schema marker, not a migration-era helper name.

The following active source paths use `phase0` as an operational deployment concept (the
first deployment group in the release pipeline, not a completed plan phase number) and are
excluded via `PLAN_NUMBER_SKIP_PATHS` or `PLAN_NUMBER_SKIP_PREFIXES` in
`stale-names-lint-allowlists.ts`:

- `build-tools/tools/deployments/deployment-phase0-admission.ts`
- `build-tools/tools/deployments/deployment-phase0-prerequisite-chain.ts`
- `build-tools/tools/deployments/deployment-phase0-release.ts`
- `build-tools/tools/tests/deployments/deployment-phase0-admission.test.ts`
- `build-tools/tools/tests/deployments/deployment-phase0-release.test.ts`
- `build-tools/tools/tests/deployments/deployment-readiness-gates.phase0-access.fixture.ts`
- `build-tools/tools/tests/deployments/deployment-readiness-gates.phase0-access.test.ts`
- `build-tools/tools/tests/deployments/phase0-deployments.contract.test.ts`
- `build-tools/tools/tests/deployments/phase0-deployments.readiness-secrets.test.ts`
- `build-tools/tools/tests/deployments/phase0-deployments.smoke.test.ts`

Additional deployment and OpenTofu phase0 paths are excluded because `phase0` names the first
deployment/admission stage in the live deployment model, not a completed planning phase. The same
operational exception covers deployment OpenTofu `stack.json` phase labels and reviewed deployment
admission helpers, but not deleted speculative deployment packages.

Active `.md` and `.rst` docs still run plan-number and migration-label enforcement for command-like
example lines. Historical planning docs and plan documents with structural `PR-N` headings are
excluded through `ALLOWED_PREFIXES`, `ALLOWED_PATHS`, or `PLAN_NUMBER_SKIP_PATHS`.

### Retained legacy / v1 / v2 references and reasons

The following `v1`/`v2` references in active source are **intentionally retained real
external schema version strings** that are part of the deployment promotion compatibility
contract. Renaming them would silently break cross-version promotion compatibility checks
because the string values are compared across deployment records.

- **`"node-dist-server-v1"`** in `build-tools/tools/deployments/contract-types.ts`
  (type discriminant on `NixosSharedHostSsrRuntimeContract`): This is a versioned runtime
  contract discriminant that is serialised into deployment records and compared by the
  promotion compatibility checker. Renaming it would require a coordinated migration of all
  existing deployment records. It is an intentionally versioned long-lived schema version,
  not a migration-era internal label.

- **`"static-webapp:exact-environment-neutral-v1"`** in
  `build-tools/tools/deployments/deployment-promotion-contract.ts`
  (return value of `promotionCompatibilityFamily()`): This is a promotion compatibility
  family string used to match deployments that can be promoted interchangeably. The `v1`
  suffix is the schema version of the compatibility contract, serialised into deployment
  promotion records. Renaming it without a coordinated migration of all existing records
  would silently break promotion compatibility checks.

- **`"mobile-app:ios-store-bundle-v1"`** in `deployment-promotion-contract.ts`: Same
  rationale as above — external promotion compatibility family string for iOS App Store
  deployments.

- **`"mobile-app:android-store-bundle-v1"`** in `deployment-promotion-contract.ts`: Same
  rationale — external promotion compatibility family string for Google Play deployments.

- **`"service:kubernetes-runtime-v1"`** in `deployment-promotion-contract.ts`: Same
  rationale — external promotion compatibility family string for Kubernetes service
  deployments.

- **`"third-party-service:kubernetes-runtime-v1"`** in `deployment-promotion-contract.ts`:
  Same rationale — external promotion compatibility family string for third-party Kubernetes
  service deployments.

The migration-label `MIGRATION_LABEL_PATTERNS` in `stale-names-lint.ts` rejects internal snake-case
`v1` / `v2` helper-style identifiers, `v1_` / `v2_` prefixes, and reviewed Camel/Pascal helper,
contract, fixture, surface, wiring, profile, manifest, `parse*`, and `create*` version labels. It
deliberately does not reject external protocol paths such as `/api/v1`, Vault `kv-v2`, package
versions such as `@v1.2.3`, Buck `buck-out/v2`, or reviewed schema strings such as
`node-dist-server-v1`.

The following paths are excluded via `MIGRATION_LABEL_SKIP_PATHS` because they intentionally carry
reviewed fixture strings:

- `build-tools/tools/tests/deployments/deployment-admission.fixture.ts`
- `build-tools/tools/tests/deployments/deployment-admission.supply-chain.replay.test.ts`
- `build-tools/tools/tests/deployments/deployment-admission.supply-chain.test.ts`
- `build-tools/tools/tests/deployments/deployment-admin-keycloak.remote-profile.test.ts`
- `build-tools/tools/tests/deployments/nixos-shared-host.install.manifest.contract.test.ts`
- `build-tools/tools/tests/lang/importer-wiring.macros-avoid-direct-lockfile-parsing.enforcement.test.ts`
- `build-tools/tools/tests/lang/importer-wiring.no-v2-paths.enforcement.test.ts`
- `build-tools/tools/tests/lang/package-local-wiring.enforcement.no-bypass.test.ts`
- `build-tools/tools/tests/lib/providers.lockfile-collision-detection.test.ts`: synthetic
  lockfile integrity fixture contains `sha512-v2...`, which is package-manager data, not an
  internal `v2` migration label.
- `build-tools/tools/tests/linting/rename-inventory.closeout.test.ts`
- `build-tools/tools/tests/linting/stale-names-lint.behavior.test.ts`
- `build-tools/tools/tests/scaffolding/sync-providers-node.determinism.test.ts`: synthetic
  lockfile integrity fixture contains `sha512-v2...`, which is package-manager data, not an
  internal `v2` migration label.
- `build-tools/tools/tests/scaffolding/webapp.module-dep-label-normalization.contract.test.ts`
- `projects/apps/pleomino/src/game/persistence-state-v1.ts`

The NixOS shared-host install/client manifest paths below are retained because the suffix identifies
the serialized install/client manifest schema currently written to hosts and parsed by deployment
tools:

- `build-tools/tools/deployments/nixos-shared-host-client-manifest.ts`
- `build-tools/tools/deployments/nixos-shared-host-host-apply.ts`
- `build-tools/tools/deployments/nixos-shared-host-install-contract.ts`
- `build-tools/tools/deployments/nixos-shared-host-install-host-support.ts`
- `build-tools/tools/deployments/nixos-shared-host-install-host.ts`
