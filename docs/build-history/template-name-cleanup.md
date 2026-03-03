## Template Name Cleanup Plan — Unify `node` and `ts` Templates Under One TypeScript Family

This plan follows the PR section structure used in `docs/build-history/quad-alignment-25.md`.

## Table of Contents

1. [Context and Decision](#context-and-decision)
2. [Non-Goals](#non-goals)
3. [PR-1: Unify template identity and roots under `ts`](#pr-1-unify-template-identity-and-roots-under-ts)
4. [PR-2: Cut over CLI/API surface and complete naming cleanup](#pr-2-cut-over-cliapi-surface-and-complete-naming-cleanup)
5. [PR-3: Cut over dependent tooling and user docs to `ts` command paths](#pr-3-cut-over-dependent-tooling-and-user-docs-to-ts-command-paths)
6. [PR-4: Centralize taxonomy consumption and add anti-drift contracts](#pr-4-centralize-taxonomy-consumption-and-add-anti-drift-contracts)
7. [PR-5: Make taxonomy the runtime source for metadata and template-test conventions](#pr-5-make-taxonomy-the-runtime-source-for-metadata-and-template-test-conventions)
8. [PR-6: Close remaining `node` command-path drift in actively referenced docs and enforce it](#pr-6-close-remaining-node-command-path-drift-in-actively-referenced-docs-and-enforce-it)
9. [PR-7: Generate taxonomy adapters and resolver surfaces from canonical template manifests](#pr-7-generate-taxonomy-adapters-and-resolver-surfaces-from-canonical-template-manifests)
10. [PR-8: Remove manual template registration from template-test conventions and enforce generator freshness](#pr-8-remove-manual-template-registration-from-template-test-conventions-and-enforce-generator-freshness)
11. [Rollout and Sequencing](#rollout-and-sequencing)
12. [Completion Criteria](#completion-criteria)

## Context and Decision

After reviewing:

- `build-tools/docs/build-system-design.md`
- `docs/handbook/getting-started-on-a-pr.md`
- `METHODOLOGY.XML`
- all templates under `build-tools/tools/scaffolding/templates`

I want a single TypeScript template family and a tighter naming contract.

Current split:

- **`node/*`**: `cli`, `lib`, `webapp-static`, `webapp-ssr-next`, `cpp-addon`, `go-addon`, `wasm-inline` (historical: `webapp-ssr-express` was removed in HMR Phase 4 PR-3)
- **`ts/*`**: `wasm-app`, `wasm-linking-app`, `go-cpp-lib`

Problem:

- both families are TypeScript-first in scaffold output
- language identity is split between runtime naming (`node`) and language naming (`ts`)
- this creates drift in CLI UX, labels, resolver entries, tests, selector behavior, and docs

Decision:

- hard cutover to `ts` as the canonical TypeScript template language id
- no backward compatibility aliases for legacy `node` TypeScript template ids

As in prior parts, each PR includes the tests and docs required for the change. There are no PRs dedicated solely to testing or documentation.

## Non-Goals

- Renaming runtime macro surfaces such as `nix_node_*` or `node_webapp`.
- Preserving legacy `scaf new node {typescript-template}` compatibility.
- Broad refactors outside scaffolding identity, naming, and selector/test contracts.

---

## PR-1: Unify template identity and roots under `ts`

### Description

I will establish one canonical TypeScript template identity model and perform the physical root unification in the same PR. This keeps rename work coherent and avoids temporary split states.

Canonical TypeScript template set:

- `ts/lib` (from `node/lib`)
- `ts/cli` (from `node/cli`)
- `ts/webapp-static` (from `node/webapp-static`)
- `ts/webapp-ssr-express` (from `node/webapp-ssr-express`; removed in HMR Phase 4 PR-3)
- `ts/webapp-ssr-next` (from `node/webapp-ssr-next`)
- `ts/cpp-addon` (from `node/cpp-addon`)
- `ts/go-addon` (from `node/go-addon`)
- `ts/wasm-inline` (from `node/wasm-inline`)
- `ts/wasm-app` (existing)
- `ts/wasm-linking-app` (existing)
- `ts/go-cpp-lib` (existing)

### Scope & Changes

- Add a central template taxonomy source consumed by:
  - `scaf/templates/meta.ts`
  - `scaf/templates/names.ts`
  - resolver validation/wiring
  - template-test convention mapping
- Standardize id shape as `{language}/{template}` with language set to `ts` for all TypeScript templates.
- Remove ad hoc normalization rules and replace with table-driven mapping from the taxonomy source.
- Move template directories from `templates/node/*` into `templates/ts/*` for TypeScript templates.
- Update moved template `meta.json` and `copier.yaml` language fields to `ts`.
- Update `build-tools/tools/scaffolding/resolver.json` so TypeScript entries live under `ts` only.
- Keep generated scaffold internals unchanged where runtime naming is intentional (`nix_node_*`, `node_webapp`, and related macros).

### Tests (in this PR)

- Add a contract test that asserts the canonical TypeScript id set matches the taxonomy source.
- Add a uniqueness test that fails on duplicate template ids across families.
- Update template label and template-input-root tests from `template:node/...` to `template:ts/...` for moved templates.
- Update selector integration coverage to resolve moved ids correctly.
- Add resolver contract checks so TypeScript template mappings remain under `ts` after cutover.
- Add a filesystem contract test that fails if TypeScript templates remain under `templates/node/`.

### Docs (in this PR)

- Update `build-tools/docs/scaffolding.md` to define:
  - canonical taxonomy source
  - canonical id format
  - `ts` ownership for TypeScript templates
- Update TypeScript template-id references in docs from `node/...` to `ts/...`.

### Acceptance Criteria

- TypeScript templates exist only under `build-tools/tools/scaffolding/templates/ts/*`.
- TypeScript template labels use only `template:ts/...`.
- Taxonomy, resolver, and test metadata agree on the same TypeScript ids.

### Risks

Moderate. Main risk is an incomplete rename across tests and selector mappings.

### Consequence of Not Implementing

The split model persists, and every new template change keeps paying a naming and review cost.

### Downsides for Implementing

This is the largest rename PR in the sequence.

### Recommendation

Implement.

---

## PR-2: Cut over CLI/API surface and complete naming cleanup

### Description

I will make `scaf new ts ...` the only TypeScript template command path and finish metadata naming cleanup so user-facing behavior matches the new identity model.

### Scope & Changes

- Update `scaf/commands/new.ts` so TypeScript templates are available only when language is `ts`.
- Remove TypeScript-template command availability when language is `node`.
- Update help and usage output to present TypeScript templates under `ts/*`.
- Normalize template metadata and help text wording for TypeScript templates.
- Standardize shared copier variable naming where semantics are equivalent (importer/lockfile/test toggles).
- Keep template ids from PR-1 stable. This PR is command-surface and naming cleanup, not another id wave.

### Tests (in this PR)

- Replace naming-contract tests that currently check `node webapp-static` with `ts webapp-static`.
- Add negative command tests:
  - `scaf new node {typescript-template}` fails clearly.
  - `scaf help node {typescript-template}` fails clearly.
- Add positive command tests for representative moved templates (`ts/lib`, `ts/cli`, `ts/webapp-static`).
- Add metadata lint checks for TypeScript templates:
  - `language` is `ts` in `meta.json`
  - `language: "ts"` in `copier.yaml`
  - required help fields present (`usage`, `notes`, `examples`)

### Docs (in this PR)

- Update `docs/handbook/getting-started-on-a-pr.md` examples to `scaf new ts ...`.
- Add a clear statement in scaffolding docs:
  - TypeScript scaffolds use `ts` as language id
  - `node` remains runtime/toolchain terminology only

### Acceptance Criteria

- All TypeScript scaffolding commands use `scaf new ts ...`.
- `scaf new node {typescript-template}` no longer works.
- Metadata and help text for TypeScript templates are consistent with the canonical model.
- Selector behavior still resolves TypeScript template ids correctly after command-surface cutover.

### Risks

Low to moderate. Main risk is hidden scripts that still call old `node` template commands.

### Consequence of Not Implementing

Directory unification lands, but user-facing API and naming stay ambiguous.

### Downsides for Implementing

One-time churn in command tests and help snapshots.

### Recommendation

Implement.

---

## PR-3: Cut over dependent tooling and user docs to `ts` command paths

### Description

I will remove remaining internal and user-facing command-surface drift where TypeScript scaffolding still routes through legacy `node` commands, and align related docs in the same PR.

### Scope & Changes

- Update helper tooling that still shells through legacy commands (for example `new-pnpm-project.ts`) to call `scaf new ts ...`.
- Update any language/tooling manifest metadata that still points TypeScript scaffolding roots to `templates/node` so discoverability reflects the `ts/*` canonical model.
- Keep runtime/toolchain naming (`node`, `nix_node_*`, `node_webapp`) unchanged where it is not template identity.
- Update handbook and build-tool docs that still instruct `scaf new node {typescript-template}` to use `scaf new ts {template}`.

### Tests (in this PR)

- Add command-path regression tests for helper entrypoints that scaffold TypeScript templates (for example `new-pnpm-project`) to ensure they use `ts` and do not route through `node`.
- Add a repo contract test for tooling scripts/manifests that fails when TypeScript scaffold invocations still use `scaf new node {typescript-template}`.
- Add doc command-contract checks for updated handbook/build-tool docs so canonical examples for TypeScript scaffolding remain `scaf new ts ...`.

### Docs (in this PR)

- Update stale TypeScript scaffolding command examples in:
  - `docs/handbook/node-tests.md`
  - `build-tools/docs/node-call-cpp.md`
  - `build-tools/docs/node-cpp-addon-plan.md`
  - related design-history docs that are still used as implementation references
- Clarify in those docs that template identity is `ts/*` while `node` naming remains runtime/toolchain terminology.

### Acceptance Criteria

- Internal helper tooling scaffolds TypeScript templates only via `scaf new ts ...`.
- No actively referenced handbook/build-tool doc tells users to run `scaf new node {typescript-template}`.
- Contract tests fail if TypeScript scaffold command drift to `node` is reintroduced in tooling or docs.

### Risks

Low. Main risk is over-broad text replacement in historical docs that are intentionally archival.

### Consequence of Not Implementing

Users and helper tooling keep conflicting command guidance, causing avoidable failures and confusion.

### Downsides for Implementing

One-time update churn across helper tooling and documentation references.

### Recommendation

Implement.

---

## PR-4: Centralize taxonomy consumption and add anti-drift contracts

### Description

I will complete the central-source contract for template identity by wiring remaining consumers to taxonomy-driven data and adding explicit anti-drift tests.

### Scope & Changes

- Refactor remaining scaffolding metadata/convention surfaces so template identity derives from the canonical taxonomy source instead of duplicated, hand-maintained tables.
- Ensure test convention wiring and metadata readers agree on canonical ids and canonical TypeScript ownership under `ts/*`.
- Add explicit validation/wiring for cross-family id uniqueness so duplicate `{language}/{template}` identities fail fast.
- Keep PR-1/PR-2 ids stable; this PR is contract hardening, not another rename.

### Tests (in this PR)

- Add a dedicated uniqueness contract test that fails on duplicate template ids across families.
- Add parity tests that assert taxonomy-driven consumers (metadata listing, convention mapping, resolver expectations) agree on canonical TypeScript ids.
- Add anti-drift contract checks that fail if a new TypeScript template is added outside taxonomy-driven wiring.

### Docs (in this PR)

- Update `build-tools/docs/scaffolding.md` with an explicit source-of-truth matrix showing:
  - canonical taxonomy source
  - consumers that must derive from it
  - anti-drift contracts that enforce parity
- Document the duplicate-id failure contract and the expected update workflow when adding a new TypeScript template.

### Acceptance Criteria

- Taxonomy is the authoritative source for TypeScript template identity across metadata and test-convention consumers.
- Duplicate template ids across families are blocked by a dedicated contract test.
- Adding a new TypeScript template requires updating taxonomy-consumed wiring and fails fast when incomplete.

### Risks

Low to moderate. Main risk is touching both TypeScript and Starlark-facing convention wiring in one PR.

### Consequence of Not Implementing

Identity drift remains possible between taxonomy, conventions, and metadata consumers.

### Downsides for Implementing

Small upfront complexity in wiring adapters to a shared canonical source.

### Recommendation

Implement.

---

## PR-5: Make taxonomy the runtime source for metadata and template-test conventions

### Description

I will complete the unresolved part of the taxonomy contract by moving key consumers from parity checks to direct taxonomy-driven wiring at runtime. This removes duplicate, hand-maintained template-id tables as drift vectors.

### Scope & Changes

- Refactor `scaf/templates/meta.ts` so template listing for language/template identity is derived from taxonomy ids first, with filesystem checks used only to validate that expected template roots exist.
- Refactor template-test convention wiring to consume canonical template ids from a single generated or imported taxonomy adapter, replacing duplicated id literals where possible.
- Keep test classification metadata (`template:smoke|contract|shared`) explicit, but remove duplicated canonical id lists from convention sources.
- Add fail-fast validation that reports missing template roots or convention entries keyed by canonical taxonomy ids.
- Keep PR-1 to PR-4 ids and command surfaces stable. This PR hardens consumer architecture, not user-facing naming.

### Tests (in this PR)

- Add a contract test that fails when `scaf templates <language>` omits a canonical taxonomy id or includes an id not present in taxonomy.
- Add a contract test that fails when template-convention wiring is out of sync with canonical taxonomy ids for template-owned test mappings.
- Add a negative-path test that simulates a missing template root for a canonical id and verifies deterministic failure output.
- Keep existing PR-1 and PR-4 parity contracts and update them to assert the new runtime-wiring path (not just value parity).

### Docs (in this PR)

- Update `build-tools/docs/scaffolding.md` to distinguish:
  - taxonomy-driven runtime consumers
  - validation-only parity checks
  - expected failure modes for missing canonical template roots
- Document the update workflow when adding a template id so developers update taxonomy first, then template root and test-convention classification.

### Acceptance Criteria

- Metadata listing and template-test convention id wiring consume canonical template ids from taxonomy-driven sources, not duplicated literal tables.
- Missing template roots for canonical ids fail fast with deterministic contract errors.
- Existing command behavior remains unchanged (`scaf new ts ...`, legacy node path rejection for TypeScript templates).

### Risks

Moderate. Main risk is cross-language wiring churn between TypeScript tooling and Starlark convention surfaces.

### Consequence of Not Implementing

Taxonomy remains partially authoritative in practice, and duplicated id tables can still drift even when parity tests exist.

### Downsides for Implementing

One-time refactor cost in metadata and convention adapters.

### Recommendation

Implement.

---

## PR-6: Close remaining `node` command-path drift in actively referenced docs and enforce it

### Description

I will close the remaining documentation drift where TypeScript template examples still use `scaf new node ...` in actively referenced docs, and I will enforce this boundary with an explicit doc contract inventory.

### Scope & Changes

- Define and maintain an explicit inventory of actively referenced docs that must not contain `scaf new node {typescript-template}` examples.
- Migrate remaining TypeScript template command examples in actively referenced docs to canonical `scaf new ts ...`.
- Preserve historical/archival intent where needed by marking files as archival in a way that excludes them from active-command contracts.
- Keep runtime/toolchain naming (`node`, `nix_node_*`, `node_webapp`) unchanged outside template command identity.

### Tests (in this PR)

- Add a repo doc-command contract test that scans the active-doc inventory and fails on `scaf new node {typescript-template}` usage.
- Add positive assertions for required canonical `scaf new ts ...` examples in those same docs.
- Add a guard test that fails if an active doc is added without being classified in the inventory (active vs archival), so enforcement scope cannot silently drift.

### Docs (in this PR)

- Update active docs that still show legacy TypeScript template command paths to canonical `scaf new ts ...`.
- Add a short section to `docs/handbook/getting-started-on-a-pr.md` (or equivalent handbook location) that defines:
  - active-doc command contract scope
  - archival-doc handling policy
  - expected update workflow for new docs

### Acceptance Criteria

- No active docs instruct `scaf new node {typescript-template}`.
- Active-doc contract tests fail fast when legacy TypeScript command paths are reintroduced.
- Archival docs remain allowed when explicitly classified as archival and not implementation guidance.

### Risks

Low to moderate. Main risk is misclassifying docs that are still consumed during implementation.

### Consequence of Not Implementing

Contributors continue seeing conflicting command guidance, causing avoidable setup and scaffold failures.

### Downsides for Implementing

Small ongoing maintenance overhead for doc inventory classification.

### Recommendation

Implement.

---

## PR-7: Generate taxonomy adapters and resolver surfaces from canonical template manifests

### Description

I will remove manual cross-file template registration by generating downstream taxonomy consumers from canonical template manifests. This keeps template identity updates single-source and deterministic.

### Scope & Changes

- Add a canonical machine-readable manifest for scaffold templates (language, template id, destination defaults, template root).
- Generate Starlark taxonomy adapter outputs from this manifest (replacing hand-maintained canonical id lists).
- Generate resolver surfaces used by `scaf` from the same manifest (or validate generated output parity if resolver remains partially handwritten for non-template defaults).
- Keep runtime consumers (`scaf/templates/meta.ts`, conventions wiring) reading generated artifacts, not duplicated literal maps.
- Keep command behavior unchanged (`scaf new ts ...` and existing non-TypeScript command contracts remain stable).
- PR-7 boundary: this PR owns producer-side generation plumbing (manifest + generators + generated adapter/resolver artifacts). It does not refactor template-test convention ownership semantics beyond switching convention inputs to generated outputs.

### Tests (in this PR)

- Add a generator parity contract that fails when generated taxonomy adapter output is stale against canonical template manifest data.
- Add a resolver parity contract that fails when resolver template entries drift from canonical template manifest data.
- Add a scaffold smoke test that adds a synthetic template manifest entry in a temp repo and verifies generated surfaces expose it without manual adapter edits.

### Docs (in this PR)

- Update `build-tools/docs/scaffolding.md` with a source-of-truth workflow that starts at canonical manifest data and flows through generated taxonomy/resolver consumers.
- Document when generated files are refreshed (local dev and verify/CI) and how deterministic drift failures are reported.

### Acceptance Criteria

- Adding a new template id does not require manually editing taxonomy adapter files.
- Resolver/template identity surfaces stay aligned with canonical manifest data via generation or strict parity checks.
- Generator drift is caught by deterministic contracts before merge.
- Registration outcome at end of PR-7: resolver/adapter registration is generator-driven, but template-test convention registration may still be partially manual until PR-8 lands.

### Risks

Moderate. Main risk is migration churn while replacing handwritten maps with generated artifacts.

### Consequence of Not Implementing

Template registration remains multi-file manual work and drift risk persists.

### Downsides for Implementing

Adds generator code and generated-artifact lifecycle management.

### Recommendation

Implement.

---

## PR-8: Remove manual template registration from template-test conventions and enforce generator freshness

### Description

I will remove manual template-id registration from template-test convention wiring and make path-convention auto-discovery the primary onboarding model, so adding a new template is directory-first and does not require manual wiring edits.

### Scope & Changes

- Refactor template-test conventions so template ids are resolved from canonical/generated taxonomy data at evaluation time.
- Preserve explicit test classification metadata (`template:smoke|template:contract|template:shared`) while removing manual template-id registration in convention maps.
- Add generator freshness enforcement in verify/CI for template taxonomy/convention artifacts so stale generated files fail fast.
- Make template discovery authoritative from path conventions under `build-tools/tools/scaffolding/templates/<language>/<template>/...`.
- Keep optional onboarding convenience tooling (for example `scaf template add ...`) as non-required sugar; correctness must not depend on it.
- Keep existing test target names and label contracts stable.
- PR-8 boundary: this PR owns consumer-side convention migration and closes remaining manual registration surfaces left intentionally out of PR-7.

### Tests (in this PR)

- Add contract tests that fail when convention wiring requires manual template-id registration for newly added canonical templates.
- Add a generator freshness test that fails when required taxonomy/convention generated outputs are stale.
- Add a temp-repo onboarding e2e test that adds a new template by copying/creating a template directory at the canonical path and verifies taxonomy wiring, resolver mapping, and convention labels are fully wired without manual registration edits.
- Add a parity test that proves optional convenience tooling (if present) yields the same generated outputs as the directory-first path.

### Docs (in this PR)

- Update `build-tools/docs/scaffolding.md` with the post-PR registration workflow:
  - create/copy template directory under canonical path
  - update template-local files (`copier.yaml`, `meta.json`, scaffold files)
  - run generators/verify
  - no manual edits required for registration/wiring files
- Document optional convenience tooling (if provided) as an ergonomic wrapper over the same directory-first workflow, not a required step.
- Document verify/CI freshness enforcement and expected remediation command(s).

### Acceptance Criteria

- New template onboarding does not require manual template-id registration in convention sources.
- Convention metadata remains explicit where intentional (classification), but canonical id wiring is derived from generated/canonical taxonomy data.
- Verify/CI fails fast on stale generation outputs.
- End-state guarantee: by the end of PR-8, adding a new template via canonical directory conventions requires no manual registration/wiring edits; discovery and downstream wiring are generated and contract-enforced.

### Risks

Low to moderate. Main risk is preserving readability of convention ownership while removing manual id declarations.

### Consequence of Not Implementing

Manual registration cost and drift risk remain in template-test convention wiring.

### Downsides for Implementing

Requires careful convention refactor to keep ownership signals clear.

### Recommendation

Implement.

---

## Rollout and Sequencing

Dependency-ordered sequence:

1. PR-1 unifies identity and roots.
2. PR-2 finalizes command surface and naming cleanup.
3. PR-3 cuts over dependent tooling/doc command paths to `ts`.
4. PR-4 hardens taxonomy-centralized wiring and anti-drift contracts.
5. PR-5 makes taxonomy runtime-authoritative for metadata and convention id wiring.
6. PR-6 closes active-doc command drift and enforces active vs archival doc contracts.
7. PR-7 generates taxonomy adapters and resolver surfaces from canonical manifests.
8. PR-8 removes manual template-id registration from conventions and enforces generation freshness.

This keeps the plan modular while closing remaining drift without adding testing-only or docs-only PRs.

---

## Completion Criteria

Cleanup is complete when all are true:

- TypeScript templates exist only under `build-tools/tools/scaffolding/templates/ts/*`.
- TypeScript template labels are only `template:ts/{template}`.
- `scaf new ts ...` is the only TypeScript scaffold entrypoint.
- Resolver, template metadata, selector diagnostics, and tests use the same canonical ids.
- No backward compatibility aliases remain for legacy `node` TypeScript template ids.
- Internal helper tooling and actively referenced docs do not instruct `scaf new node {typescript-template}`.
- Taxonomy-consumed wiring and uniqueness contracts fail fast on identity drift.
- Metadata and template-test convention id wiring derive canonical template ids from taxonomy-driven runtime sources, not duplicated literal tables.
- Active-doc command contract inventory is enforced, and archival docs are explicitly classified outside active command guidance.
- New template onboarding does not require manual edits to taxonomy adapter/resolver/convention id registration tables.
- Generator freshness for taxonomy-driven scaffolding artifacts is enforced in verify/CI.
- Template onboarding is path-convention first: creating/copying a template directory and running generation/verify is sufficient, with no manual registration/wiring edits required.
