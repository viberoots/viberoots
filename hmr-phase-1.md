# HMR Phase 1 Implementation Plan - PR Breakdown

This plan covers implementation of Phase 1 from `hmr-plan.md`: local workspace TypeScript dependency
HMR for webapp templates.

Each PR includes code, tests, and documentation updates together.

Scope: `ts/webapp-static`, `ts/webapp-ssr-vite`, and `ts/webapp-ssr-next` support local workspace TS
dependency edits without restarting dev servers.

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no `chokidar-cli` path
- no wasm producer loop work (Phase 2)

Completion criteria: all three templates support local TS dependency updates in dev mode with test
coverage in the same PRs that add behavior.

---

## PR-1: Phase 1 foundation + static template local TS dependency HMR

### Description

I will establish the shared Phase 1 contract and land the static-template implementation first. This
PR introduces the reusable Vite config pattern for workspace-linked dependencies and proves it via
template tests and one dev-loop E2E.

### Scope & Changes

- Dependency handling for this PR:
  - If Phase 0 harness is already merged, reuse it directly.
  - If not merged yet, include only the minimal harness subset required by this PR's E2E:
    - dev server lifecycle helper (start/wait/stop)
    - file mutation helper
    - update detection helper
- Update `build-tools/tools/scaffolding/templates/ts/webapp-static/vite.config.ts.jinja`:
  - add `server.fs.allow` for workspace roots required by linked local deps
  - add `optimizeDeps.exclude` for workspace dependency packages
  - keep changes minimal and template-owned
- Keep the local-dependency config shape explicit and reusable; introduce a shared helper only if PR-2
  and PR-3 show repeated logic that cannot stay template-local without drift.
- Add or update static scaffold test fixtures to include a local TS dependency import path that
  participates in Vite graph tracking.
- Update scaffold docs and template README content to document linking expectations for local deps.

### Tests (in this PR)

- Add/extend scaffold template tests to assert generated `vite.config.ts` includes required Phase 1
  fields.
- Add a static dev-loop E2E that:
  - scaffolds static app + local TS lib dependency
  - starts dev server
  - mutates exported value in the dependency
  - asserts rendered UI updates without dev restart

### Docs (in this PR)

- Update template-facing docs for static template local dependency behavior and prerequisites.
- Add short troubleshooting note for missing workspace link in static template docs.

### Verification Commands

- `buck2 test //:scaffolding_webapp_static_scaffold_includes_sample_test`
- `buck2 test //:scaffolding_webapp_static_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`

### Acceptance Criteria

- Static template generated config contains the agreed Phase 1 Vite settings.
- Static local TS dependency edits update output during a running dev session.
- Behavior is covered by both scaffold contract tests and one dev-loop E2E.

### Risks

Over-broad `server.fs.allow` could accidentally loosen file visibility.

### Mitigation

Use a bounded allowlist derived from workspace roots and verify generated config content in tests.

### Consequence of Not Implementing

Static template remains inconsistent with Phase 1 and cannot serve as a validated baseline.

### Downsides for Implementing

Adds template config complexity and another dev-loop E2E to maintain.

### Recommendation

Implement first as the baseline Phase 1 contract PR.

---

## PR-2: SSR Vite local TS dependency HMR for both client and server paths

### Description

I will apply the same Phase 1 contract to `ts/webapp-ssr-vite`, including SSR-specific handling for
local dependencies so client and server render paths both live-update.

### Scope & Changes

- Update `build-tools/tools/scaffolding/templates/ts/webapp-ssr-vite/vite.config.ts.jinja`:
  - align `server.fs.allow` and `optimizeDeps.exclude` with Phase 1 contract
  - add/adjust `ssr.noExternal` for local workspace packages
- Ensure generated template example imports local dependency from both client path and server render
  path to validate end-to-end SSR behavior.
- Keep SSR-vite-specific logic scoped to template config and avoid unrelated runtime changes.
- Update SSR vite template docs to describe expected live-update behavior for local dependencies.

### Tests (in this PR)

- Extend scaffold contract tests for `webapp-ssr-vite` generated config fields.
- Add SSR vite dev-loop E2E that:
  - scaffolds SSR vite app + local TS dep
  - edits dependency used by client-facing code and verifies update
  - edits dependency used by server render code and verifies update
  - asserts no dev server restart between edits

### Docs (in this PR)

- Update SSR vite template docs with local dependency HMR behavior and required linking setup.
- Add troubleshooting note for `ssr.noExternal` misconfiguration symptoms.

### Verification Commands

- `buck2 test //:scaffolding_webapp_ssr_vite_dev_hmr_local_ts_dep` (new in PR-2)
- `buck2 test //:scaffolding_webapp_ssr_vite_scaffold_includes_sample_test`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`

### Acceptance Criteria

- SSR vite generated config includes required Phase 1 fields and SSR local-dep handling.
- Both client and server render paths reflect local TS dependency edits in one dev session.
- Tests in this PR cover config generation and live-update behavior.

### Risks

SSR dependency externalization settings can regress startup behavior if too broad.

### Mitigation

Keep `ssr.noExternal` narrowly targeted to local packages and enforce via template config tests.

### Consequence of Not Implementing

Phase 1 remains incomplete for SSR vite and client/server parity is unproven.

### Downsides for Implementing

Adds SSR-specific configuration surface and E2E runtime cost.

### Recommendation

Implement second after static baseline is stable.

---

## PR-3: SSR Next local TS dependency HMR alignment + Phase 1 closeout

### Description

I will land `ts/webapp-ssr-next` Phase 1 support and close Phase 1 with aligned contract coverage
across static, SSR vite, and SSR next templates.

### Scope & Changes

- Update next template dev config and template wiring to honor local workspace dependency updates in
  development.
- Apply explicit Next-side Phase 1 config checks:
  - allow reading linked workspace source from configured workspace roots
  - ensure local workspace deps are not prebundled as immutable externals during dev
  - ensure server-side render path resolves live workspace source during dev
- Ensure local dependency import shape is Vite/Next graph trackable and consistent with prior PR
  contract decisions.
- Align shared helper usage introduced in PR-1 so next template does not drift from static/SSR vite.
- Update next template docs to define local dependency live-update expectations and constraints.

### Tests (in this PR)

- Extend scaffold contract tests for next template config/wiring expectations tied to Phase 1.
- Add SSR next dev-loop E2E that:
  - scaffolds next SSR app + local TS dependency
  - mutates dependency used in client and server paths
  - asserts both updates apply without manual dev restart
- Add explicit SSR-next pass/fail probes in that E2E:
  - client probe: browser-visible value changes after dependency edit without restart
  - server probe: server-rendered value changes after dependency edit without restart
- Add or update a Phase 1 policy test that verifies all three templates still emit required config
  keys and contract text.

### Docs (in this PR)

- Update next template docs and shared scaffold guidance so all three templates describe the same
  Phase 1 contract.
- Add a concise "how to verify local dependency live update" snippet for maintainers.

### Verification Commands

- `buck2 test //:scaffolding_webapp_ssr_next_dev_hmr_local_ts_dep` (new in PR-3)
- `buck2 test //:scaffolding_webapp_ssr_next_contracts`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`

### Acceptance Criteria

- SSR next local TS dependency updates are live in both client and server paths.
- Contract tests and E2E coverage exist for next template in this PR.
- Shared docs now reflect a complete Phase 1 contract across all in-scope templates.

### Risks

Next dev server behavior may differ from SSR vite in edge import patterns.

### Mitigation

Keep import examples minimal and explicit; validate both paths in one deterministic E2E.

### Consequence of Not Implementing

Phase 1 remains partially delivered and template parity is not achieved.

### Downsides for Implementing

Additional template-specific maintenance and E2E execution time.

### Recommendation

Implement as the final Phase 1 closeout PR.
