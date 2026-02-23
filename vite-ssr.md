# Vite SSR Plan - Add a Vite-First SSR Template Without Breaking Existing SSR Contracts

This plan adds a new TypeScript scaffold template for Vite-based SSR while keeping the current
`webapp-ssr-express` and `webapp-ssr-next` templates stable.

I will keep this sequence dependency-ordered and modular. Each PR includes implementation, tests, and
docs together. There are no docs-only or tests-only PRs. No functionality is introduced without tests
in the same PR.

Scope:

- Add a new canonical template: `ts/webapp-ssr-vite`.
- Implement Vite-native SSR development flow where Vite serves HTML and SSR rendering hooks.
- Keep production startup aligned with repo contracts: plain Node entrypoint from packaged output.
- Wire planner/runnable/build metadata so the new template behaves like first-class SSR in Buck/Nix.

Non-goals:

- No migration of existing `webapp-ssr-express` or `webapp-ssr-next` projects in this sequence.
- No backward-compatibility aliases beyond existing template naming rules.
- No runtime fallback to static hosting for SSR targets.

Completion criteria:

- `scaf new ts webapp-ssr-vite <name>` scaffolds a working Vite SSR app.
- Dev SSR serves `/` through Vite SSR hooks (not a plain static fallback).
- Production output keeps canonical runnable contract (`node <serverEntry>`).
- Planner/runnable/test/doc contracts include the new template in the same PRs where behavior is added.
- After PR-3, feature iteration can stay template-local (`templates/ts/webapp-ssr-vite/**` plus
  template-owned tests) so verification can remain template-scoped.

Dependency chain (must execute in order):

- PR-1 establishes template identity and initial scaffold boundaries.
- PR-2 introduces Vite-first SSR dev/runtime scripts and validates route behavior.
- PR-3 wires Buck/planner/runnable plus template-selection/convention contracts for `framework:vite`.
- PR-4 starts the template-local iteration phase for packaging and behavior hardening.
- PR-5 closes remaining docs/tooling command-path and negative-path contract gaps.

Template-local iteration boundary:

- Earliest practical boundary is end of PR-3.
- From PR-4 onward, functional iteration should be contained to:
  - `build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite/**`
  - template-owned test files mapped to `template:ts/webapp-ssr-vite`
- Shared-surface edits after PR-3 are allowed only for explicit final lock-in gaps in PR-5.

---

## PR-1: Add canonical `ts/webapp-ssr-vite` template identity and scaffold baseline

### Description

I will add a new Vite SSR template identity and scaffold baseline without changing existing SSR
templates.

### Scope & Changes

- Add `build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite/` with initial scaffold files:
  - `meta.json`, `copier.yaml`, `TARGETS.jinja`, `package.json.jinja`
  - minimal client/server SSR entry files and HTML template shell
  - lockfile + TypeScript config files matching current template conventions
- Update scaffold metadata wiring so template discovery/help includes `webapp-ssr-vite`.
- Keep naming explicit:
  - `webapp-ssr-vite` is framework-specific and separate from `webapp-ssr-express`/`webapp-ssr-next`.
- Keep new template behavior minimal in PR-1:
  - no planner/runnable format changes yet
  - no changes to existing SSR templates.

### Tests (in this PR)

- Add scaffold contract tests that assert:
  - `scaf templates ts` includes `webapp-ssr-vite`
  - `scaf help ts webapp-ssr-vite` exposes expected usage/notes/examples
  - scaffolded file tree contains required baseline SSR files
- Add metadata contract checks for:
  - `meta.json` language/template/help fields
  - `copier.yaml` language and required variables
  - template label conventions in generated test targets.

### Docs (in this PR)

- Update scaffolding docs to list `webapp-ssr-vite` and its intended use.
- Add concise command examples with canonical `scaf new ts webapp-ssr-vite ...` paths.

### Acceptance Criteria

- New template can be scaffolded with `scaf new ts webapp-ssr-vite <name>`.
- Template appears in listing/help and metadata contracts.
- Existing SSR templates remain unchanged and passing.

### Risks

Initial scaffold shape can drift from existing template conventions.

### Mitigation

Lock baseline shape with scaffold contract tests and metadata lint checks in the same PR.

### Consequence of Not Implementing

Vite-first SSR cannot be onboarded without modifying existing templates in place.

### Downsides for Implementing

Adds one more SSR template to maintain.

### Recommendation

Implement.

---

## PR-2: Implement Vite-first SSR dev flow and runtime behavior in scaffold output

### Description

I will make the new template run SSR in development using Vite SSR hooks so `/` returns rendered HTML
in dev mode.

### Scope & Changes

- Implement scaffold runtime files for Vite SSR dev behavior:
  - server dev entry using Vite SSR APIs (middleware mode / `ssrLoadModule` / HTML transform flow)
  - shared renderer contract between server and entry modules
- Update generated scripts for deterministic local workflow:
  - `dev:ssr`, `build:ssr`, `start:ssr`
  - explicit host/port behavior with strict port usage
- Preserve deterministic error behavior:
  - no fallback to static-host serving for SSR route failures.

### Tests (in this PR)

- Add runtime smoke tests in temp repos that assert:
  - `pnpm run dev:ssr` responds on `/` with SSR marker content
  - response path proves SSR execution (server marker, not static HTML fallback)
- Add contract-negative tests that assert:
  - missing SSR entry module fails with deterministic error
  - invalid SSR render export fails with deterministic error text.

### Docs (in this PR)

- Add template-specific runtime notes:
  - what `dev:ssr` does
  - expected local URL/port
  - expected failure signatures for broken SSR entry wiring.

### Acceptance Criteria

- New scaffold returns SSR HTML on `/` during `dev:ssr`.
- Dev SSR path fails fast and clearly when SSR modules are invalid.
- No planner/runnable packaging-contract changes yet.

### Risks

Dev-only SSR wiring can diverge from production behavior.

### Mitigation

Use explicit runtime smoke + negative-path assertions for both `dev:ssr` and build/start surfaces.

### Consequence of Not Implementing

New template would reproduce the current `Cannot GET /` confusion in dev mode.

### Downsides for Implementing

Higher test runtime due to dev-server smoke tests.

### Recommendation

Implement.

---

## PR-3: Wire planner/runnable plus selector/convention contracts for `framework:vite`

### Description

I will complete all shared-surface contract work needed for fast iteration so Vite SSR templates are
first-class in manifest/runnable tooling and template-scoped test selection.

### Scope & Changes

- Add/extend SSR framework discriminator handling for `vite` in planner/runnable metadata.
- Ensure generated runnable contract fields are explicit:
  - `runnable.kind = "webapp-ssr"`
  - `runnable.framework = "vite"`
  - `run.dev` and `run.prod` argv mappings
  - required SSR artifact fields (`serverEntry`, `clientDir`)
- Keep canonical production startup invariant:
  - production command remains `node <serverEntry>`.
- Keep static and existing SSR framework behavior unchanged.
- Integrate template-selection and convention contracts now (not later):
  - add `ts/webapp-ssr-vite` template-owned mappings in template conventions
  - ensure selector/template-only scope recognizes `ts/webapp-ssr-vite`
  - add anti-drift parity checks for taxonomy/convention coverage.

### Tests (in this PR)

- Add planner/runnable contract tests that assert:
  - `framework:vite` classification
  - required artifact fields are present
  - production startup argv remains plain Node command
  - runnable parsers/formatters handle `framework:vite` deterministically.
- Add/extend selector/convention contract tests that assert:
  - template-owned labels/classification for Vite SSR tests
  - template-only selector mode works when only Vite SSR template files change
  - taxonomy parity and no-manual-registration contracts include `ts/webapp-ssr-vite`.

### Docs (in this PR)

- Update runnable contract docs to include `framework:vite`.
- Add a concrete manifest example for Vite SSR runnable entries.
- Update scaffolding workflow docs to include `ts/webapp-ssr-vite` in template-scope onboarding.

### Acceptance Criteria

- Planner output includes valid runnable metadata for Vite SSR targets.
- Dev/prod runnable commands are generated and parseable.
- Template conventions and selector contracts include `ts/webapp-ssr-vite`.
- Existing express/next/static runnable contracts remain unchanged.

### Risks

Framework discriminator expansion can accidentally loosen existing contract validation.

### Mitigation

Add strict assertions for existing frameworks in the same contract test modules.

### Consequence of Not Implementing

Template could scaffold and run locally but remain second-class in planner/runnable tooling.

### Downsides for Implementing

Increases runnable-contract matrix size.

### Recommendation

Implement.

---

## PR-4: Template-local iteration phase for packaging and artifact hardening

### Description

I will iterate only inside the Vite SSR template and its template-owned tests so packaging and runtime
behavior can be refined quickly without reopening shared contract surfaces.

### Scope & Changes

- Update scaffold build scripts and server packaging paths to produce deterministic artifacts:
  - canonical `dist/server/index.js`
  - canonical client output directory
- Ensure Buck template `TARGETS` and asset staging map to those outputs.
- Keep SSR no-fallback behavior strict:
  - missing `serverEntry` or `clientDir` remains a hard error.
- PR-4 edit boundary:
  - touch only `templates/ts/webapp-ssr-vite/**` and Vite template-owned tests.
  - no edits to planner/runnable schema, selector framework, or taxonomy adapters.

### Tests (in this PR)

- Add scaffold-and-build tests that assert:
  - output directories/files match contract paths
  - production startup (`node dist/server/index.js`) serves SSR response
  - missing critical artifact paths fail with deterministic contract errors.

### Docs (in this PR)

- Update SSR packaging docs with Vite variant artifact layout.
- Document expected startup command and troubleshooting checks for missing packaged assets.

### Acceptance Criteria

- Vite SSR template builds into canonical SSR artifact structure.
- Production run path works through plain Node entrypoint.
- Contract-negative failures are explicit and deterministic.
- Diffs stay within template-local iteration boundary.

### Risks

Packaging assumptions may drift between template scripts and planner/runnable expectations.

### Mitigation

Add direct artifact-shape assertions and runtime startup smoke tests in temp repos.

### Consequence of Not Implementing

Vite SSR onboarding remains fragile and inconsistent with existing SSR runtime contracts.

### Downsides for Implementing

More integration tests touching build + run paths.

### Recommendation

Implement.

---

## PR-5: Close remaining tooling/doc contract gaps and harden negative-path behavior

### Description

I will close remaining command-path/tooling/doc drift and finalize negative-path coverage for the new
template so behavior is explicit and enforced.

### Scope & Changes

- Update active docs and helper tooling examples to include canonical Vite SSR template commands where
  relevant.
- Add or extend negative-path guardrails for:
  - invalid framework labels for Vite SSR target shape
  - malformed runnable artifacts in Vite SSR manifests
  - accidental static-host fallback semantics for Vite SSR routes.
- Keep archival docs policy unchanged, with active-doc inventory classification maintained.

### Tests (in this PR)

- Add doc-command contract assertions for active docs that mention Vite SSR commands.
- Add targeted negative-path tests for Vite SSR framework/manifest contract violations.
- Re-run and keep existing express/next/static negative-path suites green.

### Docs (in this PR)

- Update active docs with canonical `scaf new ts webapp-ssr-vite ...` examples.
- Add explicit troubleshooting notes for top failure signatures introduced by the new template.

### Acceptance Criteria

- Active docs and tooling examples are consistent with canonical Vite SSR command paths.
- Vite SSR negative-path behavior is deterministic and contract-enforced.
- Existing SSR variants remain green with no behavior regressions.

### Risks

Broad doc updates can unintentionally modify historical content that should remain archival.

### Mitigation

Use active-doc inventory classification and keep archival files out of enforcement scope.

### Consequence of Not Implementing

Contributors may see conflicting guidance and weaker failure diagnostics for Vite SSR onboarding.

### Downsides for Implementing

One-time documentation and contract-test churn.

### Recommendation

Implement.

---

## Rollout and Sequencing

Dependency-ordered sequence:

1. PR-1 adds canonical template identity and baseline scaffold.
2. PR-2 introduces Vite-first SSR dev/runtime behavior.
3. PR-3 completes all shared contract wiring (planner/runnable + selector/conventions).
4. PR-4 runs template-local iteration for packaging/runtime hardening.
5. PR-5 closes final docs/tooling drift and negative-path lock-in.

Iteration policy after PR-3:

- Functional refinements should stay template-local for faster loops and template-scoped verify.
- Shared-surface edits are deferred unless needed for final lock-in in PR-5.
- If a PR after PR-3 requires shared-surface edits beyond PR-5 lock-in scope, it is out of this plan
  and should be split into a separate follow-up sequence.

Every PR includes implementation, tests, and docs for the behavior it adds or changes.

---

## Completion Criteria

Implementation is complete when all are true:

- `scaf new ts webapp-ssr-vite <name>` scaffolds successfully with canonical metadata/help paths.
- `dev:ssr` serves `/` through Vite SSR rendering flow (no plain static fallback semantics).
- Production startup remains canonical and deterministic: `node <serverEntry>`.
- Planner/runnable metadata supports `framework:vite` with required SSR artifact fields.
- Packaging outputs and Buck target wiring align to canonical SSR artifact contracts.
- Template conventions, selector behavior, taxonomy parity, and anti-drift contracts include
  `ts/webapp-ssr-vite`.
- Template-local iteration boundary is reached by end of PR-3 and used for subsequent refinement PRs.
- Active docs and tooling command examples are canonical and enforced by contract tests.
- Negative-path failures for Vite SSR contract violations are deterministic and tested.
