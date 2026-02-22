## Template Name Cleanup Plan — Unify `node` and `ts` Templates Under One TypeScript Family

This plan follows the PR section structure used in `docs/build-history/quad-alignment-25.md`.

## Table of Contents

1. [Context and Decision](#context-and-decision)
2. [Non-Goals](#non-goals)
3. [PR-1: Unify template identity and roots under `ts`](#pr-1-unify-template-identity-and-roots-under-ts)
4. [PR-2: Cut over CLI/API surface and complete naming cleanup](#pr-2-cut-over-cliapi-surface-and-complete-naming-cleanup)
5. [PR-3: Cut over dependent tooling and user docs to `ts` command paths](#pr-3-cut-over-dependent-tooling-and-user-docs-to-ts-command-paths)
6. [PR-4: Centralize taxonomy consumption and add anti-drift contracts](#pr-4-centralize-taxonomy-consumption-and-add-anti-drift-contracts)
7. [Rollout and Sequencing](#rollout-and-sequencing)
8. [Completion Criteria](#completion-criteria)

## Context and Decision

After reviewing:

- `build-tools/docs/build-system-design.md`
- `docs/handbook/getting-started-on-a-pr.md`
- `METHODOLOGY.XML`
- all templates under `build-tools/tools/scaffolding/templates`

I want a single TypeScript template family and a tighter naming contract.

Current split:

- **`node/*`**: `cli`, `lib`, `webapp-static`, `webapp-ssr-express`, `webapp-ssr-next`, `cpp-addon`, `go-addon`, `wasm-inline`
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
- `ts/webapp-ssr-express` (from `node/webapp-ssr-express`)
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

## Rollout and Sequencing

Dependency-ordered sequence:

1. PR-1 unifies identity and roots.
2. PR-2 finalizes command surface and naming cleanup.
3. PR-3 cuts over dependent tooling/doc command paths to `ts`.
4. PR-4 hardens taxonomy-centralized wiring and anti-drift contracts.

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
