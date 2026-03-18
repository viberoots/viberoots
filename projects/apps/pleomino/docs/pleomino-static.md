# Pleomino Static PWA Plan (`docs/pleomino-static.md`)

## Conclusion

Yes, Pleomino appears to be a strong candidate for a static PWA template.

What Pleomino currently uses server code for:

- serving the HTML shell and static assets
- injecting SSR markup into `#app`
- emitting static PWA head tags
- serving the client bundle from `dist/client`

What Pleomino does **not** appear to need:

- request-dependent rendering
- server-side game state
- server-side solve/search execution
- backend APIs
- user/session/auth logic

The current server at
[`projects/apps/pleomino/server/index.ts`](/Users/kiltyj/Code/bucknix-fresh/projects/apps/pleomino/server/index.ts)
is effectively a delivery wrapper around static assets plus SSR shell generation. The actual game logic, persistence, worker runtime, wasm solver, and offline behavior all live on the client.

That means Pleomino should be able to migrate off the current `ts/webapp-ssr-vite` app shape and onto a stronger `ts/webapp-static-pwa` scaffold, provided the new template bakes in the right contracts for:

- installability
- offline reloads
- worker + wasm staging
- hash/local persistence bootstrapping
- predictable no-flash app startup

## Why The Existing `ts/webapp-static` Template Is Not Enough

We already have a static scaffold:
[`build-tools/tools/scaffolding/templates/ts/webapp-static`](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/scaffolding/templates/ts/webapp-static)

But based on Pleomino, it is missing important production-grade PWA contracts:

- no first-class manifest/icon/service-worker setup
- no generated offline caching strategy
- no built-in worker/wasm cold-start guidance
- no startup-shell guidance for persisted client state
- no explicit static-PWA testing contract
- no documented migration path for SSR apps that are actually client-owned

So the plan should be:

1. create a **new static PWA-oriented template** by extending the existing static webapp path rather than replacing it blindly
2. migrate Pleomino onto that template once the template contract is proven

## Goals

1. Create a reusable `ts/webapp-static-pwa` scaffold derived from repo learnings.
2. Move Pleomino from `webapp-ssr-vite` to that new scaffold with no functional regressions.
3. Preserve:
   - offline play
   - offline solve
   - installability
   - wasm/worker solver performance
   - deterministic build/test behavior
4. Reduce:
   - app-specific server code
   - SSR/hash mismatch complexity
   - hydration/reload edge cases

## Non-Goals

- adding backend services
- changing Pleomino gameplay rules
- rewriting solver logic
- weakening offline correctness in exchange for template simplicity

## Phase 1: Define The Static PWA Template Contract

### Template name

- `ts/webapp-static-pwa`

### Base

- derive from `ts/webapp-static`
- reuse existing Buck/Nix/Vite static-webapp plumbing wherever possible

### Required generated surface

- static Vite app shell
- PWA manifest
- service worker source
- icon set placeholders
- client registration for service worker
- explicit worker/wasm staging examples
- tests for offline metadata and service-worker contracts

### Required build/runtime contracts

- no app-specific Node/Express server required for production serving
- all runtime-critical assets available from the staged static output
- worker and wasm assets staged under deterministic paths
- offline reload works after one successful online load
- installed PWA remains interactive offline

### Template docs must cover

- when to choose `webapp-static-pwa` vs `webapp-ssr-vite`
- limitations of hash-only client state for SSR apps
- best practices for local-origin PWA validation
- how to add wasm producers and workers safely

## Phase 2: Extract Pleomino Learnings Into Template Features

The new template should incorporate these lessons from Pleomino:

### 1. Offline asset completeness is non-negotiable

The template must precache not just HTML, but also:

- client entry bundle
- emitted JS chunks
- worker scripts
- wasm assets
- manifest/icons

This should be generated from built outputs rather than maintained by hand.

### 2. Service worker registration should be immediate and production-safe

- register early on the client
- avoid dev-mode behavior that pretends offline support is reliable when it is not
- keep production-only assumptions explicit

### 3. Wasm runtime should not depend on fragile late network fetches

The template should document and preferably support:

- embedded wasm bytes or equivalent robust static loading
- worker-compatible runtime loading
- cold offline launch behavior

### 4. Static apps with persisted client state need startup discipline

Pleomino exposed that SSR + hash-persisted state can cause:

- empty-board flashes
- client/server mismatch risk
- delayed interactivity

The static PWA template should embrace a client-owned startup model and avoid SSR-specific mismatch complexity entirely.

### 5. Generated build output must not poison verify/lint flows

The template and tooling should keep generated `dist/` artifacts out of source-format verification paths.

## Phase 3: Implement The New Template

### Scaffold work

Add a new scaffold under:

- [`build-tools/tools/scaffolding/templates/ts/webapp-static-pwa`](/Users/kiltyj/Code/bucknix-fresh/build-tools/tools/scaffolding/templates/ts)

Expected files:

- `meta.json`
- `copier.yaml`
- `TARGETS.jinja`
- `package.json.jinja`
- `vite.config.ts.jinja`
- `index.html.jinja`
- `public/manifest.webmanifest.jinja`
- `public/service-worker.js.jinja`
- `public/icons/...`
- `src/main.ts` or `src/entry-client.ts`
- template tests/docs

### Build integration

Reuse static-webapp primitives before adding new ones.

Only add new utilities if the existing ones cannot express:

- static PWA asset staging
- worker/wasm manifest generation
- offline precache materialization

### Tooling work

If needed, generalize Pleomino’s service-worker precache generation into a reusable helper instead of leaving it app-local.

Candidates for extraction:

- service-worker precache generation
- static asset list hashing/versioning
- worker/wasm inclusion rules for static PWAs

## Phase 4: Add Template-Level Verification

The new template should ship with deterministic contract tests for:

1. scaffold output shape
2. manifest presence and correctness
3. service-worker registration path
4. precache generation includes worker/wasm/runtime assets
5. installed app can cold-load offline after one online load
6. local workspace dependency updates still work in dev

This should be added in build-tools test coverage, not left as Pleomino-only tests.

## Phase 5: Migrate Pleomino

### Migration strategy

Do this as a controlled refactor, not an in-place big-bang rewrite.

#### Step 1

Land the new template and prove it with scaffold tests first.

#### Step 2

Create a temporary Pleomino migration branch/path that swaps:

- `webapp-ssr-vite` assumptions
- server entry usage
- SSR-only startup behavior

for:

- static app shell
- static PWA bootstrap
- client-owned restore/render path

#### Step 3

Remove Pleomino server-only code that becomes unnecessary, especially:

- Express server wrapper
- SSR shell rendering path
- SSR-specific hydration guards that only exist because server markup cannot know `location.hash`

#### Step 4

Retain and adapt:

- manifest/icons
- service worker
- wasm worker orchestration
- offline solve coverage
- PWA metadata tests

#### Step 5

Re-run full Pleomino validation and compare behavior/perf against current app.

## Pleomino Migration Acceptance Criteria

Pleomino is considered successfully migrated when all of the following are true:

1. No Pleomino-specific server runtime is required to serve the app.
2. The installed PWA works online and offline after initial online load.
3. Solve works:
   - online
   - offline
   - after cold relaunch
   - with partial boards
4. Existing randomness/interestingness behavior is preserved.
5. Persisted board state restores correctly on reload/relaunch.
6. No startup flash/regression is introduced.
7. Build/test wiring remains aligned with repo verify rules and file-size guardrails.

## PR List

## PR-1: Add Static PWA Scaffold Contract Based on Pleomino Learnings

### Scope

- Add a new scaffold:
  - `ts/webapp-static-pwa`
- Base it on the existing static template surface rather than duplicating webapp plumbing.
- Generate a production-oriented static PWA baseline including:
  - manifest
  - service worker
  - icon placeholders
  - client registration path
  - static asset-stage integration
- Document template selection guidance:
  - when to use `webapp-static`
  - when to use `webapp-static-pwa`
  - when SSR remains appropriate

### Implementation Notes

- Reuse existing static webapp Buck/Nix/Vite utilities before introducing any new build abstraction.
- Keep the template framework-neutral and avoid Pleomino-specific naming or assumptions.
- Ensure the generated app remains zero-backend by default.

### Tests

- Scaffold tests:
  - generated file set includes manifest, service worker, and icon placeholders.
  - generated `TARGETS` stays aligned with existing static webapp contracts.
- Doc/metadata tests:
  - template help text and notes mention PWA/offline expectations accurately.

### Verify Strategy

- Keep this PR template-only:
  - scaffold files
  - scaffold docs
  - scaffold/build-tools tests
- Do not change `projects/apps/pleomino` in this PR.
- Expected verify scope:
  - template/build-system scoped
  - no mixed-scoped PR run required if boundaries stay clean

### Acceptance Criteria

- A new static PWA scaffold exists and is documented.
- The template is reusable outside Pleomino.
- The generated app does not require app-specific server code.

---

## PR-2: Extract Shared Static-PWA Build and Offline Utilities

### Scope

- Extract reusable utilities from Pleomino where justified for static PWA support.
- Generalize build-time precache generation for static assets so apps do not hand-maintain cache lists.
- Ensure worker and wasm runtime assets are included in the static runtime contract.

### Implementation Notes

- Prefer shared helpers for:
  - service-worker precache generation
  - static asset hashing/versioning
  - worker/wasm asset inclusion
- Do not extract Pleomino-specific gameplay or persistence logic.
- Keep the contract deterministic and driven from built outputs, not handwritten lists.

### Tests

- Build-tools regression tests:
  - generated precache list includes emitted JS chunks.
  - worker and wasm assets are included when present.
  - generated service worker output is deterministic for fixed inputs.

### Verify Strategy

- Keep this PR shared-tooling only:
  - build-tools helpers
  - shared tests
- Do not migrate Pleomino to the new utilities in the same PR.
- Expected verify scope:
  - build-system scoped
  - no mixed-scoped PR run required if Pleomino consumption is deferred to the next PR

### Acceptance Criteria

- Static PWA runtime asset inclusion is centralized and reusable.
- Offline bootstrap correctness does not depend on app-local manual asset lists.
- Shared utilities are covered by build-system tests.

---

## PR-3: Migrate Pleomino from SSR Vite to Static PWA Template

### Scope

- Move Pleomino from `ts/webapp-ssr-vite` assumptions to the new static PWA template shape.
- Remove the Pleomino-specific Node/Express server runtime from the app path.
- Preserve:
  - client gameplay behavior
  - PWA installability
  - offline solve
  - wasm worker runtime
  - persisted state restore

### Migration Notes

- Replace SSR shell delivery with static app-shell delivery.
- Move startup assumptions to a client-owned render path.
- Remove SSR-only guards added to compensate for server ignorance of `location.hash`.
- Retain existing wasm solver, worker orchestration, and offline runtime logic unless the shared template utilities supersede them cleanly.

### Tests

- Pleomino integration tests:
  - reload preserves board state.
  - online solve works from empty and partial boards.
  - offline solve works after initial online load.
  - cold relaunch offline solve works.
- PWA tests:
  - manifest and service worker registration remain present.
  - static output contains required runtime assets.

### Verify Strategy

- Keep this PR app-only after PR-1 and PR-2 have landed.
- Avoid simultaneous edits to scaffold/build-tools/template files here.
- Expected verify scope:
  - default project-impact scoped verify for `projects/apps/pleomino`
  - no mixed-scoped PR run required if build-system/template edits are excluded

### Acceptance Criteria

- Pleomino no longer requires an app-specific server runtime.
- Functional behavior matches or improves on the current SSR-backed app.
- No regressions in offline or solver behavior are introduced.

---

## PR-4: Pleomino Static-PWA Parity Cleanup and Hardening

### Scope

- Remove dead SSR-era code and contracts after migration.
- Tighten regression coverage around the static-PWA startup path.
- Verify performance, readability, and guardrail alignment after the migration settles.

### Cleanup Targets

- Remove unused server-only files and SSR-specific startup code.
- Simplify startup/reload logic where static ownership eliminates prior mismatch handling.
- Re-check module sizing and keep post-migration file structure aligned with repo guardrails.

### Tests

- Regression tests:
  - no startup flash on reload or relaunch.
  - no stale solve-state or persistence regressions.
  - offline interactive behavior remains intact.
- Verify the migrated app still satisfies:
  - lint/format
  - file-size rules
  - targeted Pleomino verify targets

### Verify Strategy

- Keep this PR limited to Pleomino app code, app docs, and Pleomino-owned tests.
- Do not fold template or shared build-tool refactors into this cleanup pass.
- Expected verify scope:
  - project-impact scoped verify for `projects/apps/pleomino`
  - no mixed-scoped PR run required

### Acceptance Criteria

- Pleomino is cleanly aligned with the new static PWA template.
- No dead SSR path remains in active use.
- Static-PWA runtime behavior is regression-proofed and maintainable.

## Risks

### Risk 1: We lose useful SSR-only metadata behavior

Mitigation:

- ensure the static template emits the same manifest/meta/icon surface from `index.html`

### Risk 2: Offline correctness regresses during migration

Mitigation:

- keep Pleomino’s current PWA/offline tests
- add cold-launch offline solve checks as migration gates

### Risk 3: Worker/wasm staging becomes template-fragile

Mitigation:

- centralize the staging/precache contract
- add build-tools regression tests

### Risk 4: We accidentally make the template too Pleomino-specific

Mitigation:

- only extract patterns that are clearly generic:
  - manifest/service-worker/icon plumbing
  - static precache generation
  - worker/wasm runtime asset inclusion

## Recommendation

Proceed with a new `ts/webapp-static-pwa` template and then migrate Pleomino onto it.

That is the cleanest path because:

- Pleomino does not need request-time server logic
- the current complexity is mostly from SSR/static-shell mismatch management
- the repo already has a static webapp scaffold to extend
- the PWA/offline lessons from Pleomino are reusable and worth capturing centrally

## Decision Record

If we agree with this direction, the next implementation step should be:

1. template contract PR first
2. Pleomino migration second

That sequencing keeps the reusable abstraction honest and avoids baking more app-specific behavior into the current SSR path.
