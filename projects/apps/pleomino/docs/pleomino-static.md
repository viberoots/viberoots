# Pleomino Static PWA Design Note (`projects/apps/pleomino/docs/pleomino-static.md`)

Current status: this migration has landed. `projects/apps/pleomino/TARGETS` exposes a static PWA app
through `node_webapp(name = "app_raw")` plus `node_asset_stage(name = "app", labels =
["lang:node", "kind:app", "webapp:static", "webapp:pwa"])`, and the app no longer depends on an
app-local SSR/Express runtime. The PR sections below are retained as implementation history and
acceptance rationale, not as open work unless an item is explicitly marked incomplete.

## Conclusion

Pleomino is a static PWA template consumer and served as the proof case for the reusable
`ts/webapp-static-pwa` shape.

What the historical SSR-backed Pleomino shape used server code for:

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

Historically, Pleomino shipped with an app-local server wrapper that only handled static-asset
delivery plus SSR shell generation. The actual game logic, persistence, worker runtime, wasm
solver, and offline behavior all live on the client.

That historical shape is why Pleomino migrated off the former `ts/webapp-ssr-vite` app shape and
onto the stronger `ts/webapp-static-pwa` contract, with explicit support for:

- installability
- offline reloads
- worker + wasm staging
- hash/local persistence bootstrapping
- predictable no-flash app startup

## Why The Existing `ts/webapp-static` Template Is Not Enough

We already have a static scaffold:
[`build-tools/tools/scaffolding/templates/ts/webapp-static`](/Users/kiltyj/Code/viberoots/build-tools/tools/scaffolding/templates/ts/webapp-static)

But based on Pleomino, it is missing important production-grade PWA contracts:

- no first-class manifest/icon/service-worker setup
- no generated offline caching strategy
- no built-in worker/wasm cold-start guidance
- no startup-shell guidance for persisted client state
- no explicit static-PWA testing contract
- no documented migration path for SSR apps that are actually client-owned

The implemented path was:

1. create a **new static PWA-oriented template** by extending the existing static webapp path rather
   than replacing it blindly
2. migrate Pleomino onto that template once the template contract is proven

## Goals

1. Maintain the reusable `ts/webapp-static-pwa` scaffold derived from repo learnings.
2. Keep Pleomino aligned with that scaffold with no functional regressions.
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

- [`build-tools/tools/scaffolding/templates/ts/webapp-static-pwa`](/Users/kiltyj/Code/viberoots/build-tools/tools/scaffolding/templates/ts)

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

Implementation status:

- complete in `projects/apps/pleomino`
- app delivery is now static-PWA aligned and no longer depends on an app-local Express runtime

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

Implementation status:

- complete in `projects/apps/pleomino`
- startup reveal now stays hidden until restored client state is rendered and the first paint
  settles
- dead app-local server residue is removed from the active app tree
- focused PR-4 validation target is wired in `TARGETS` as `:pr4_static_pwa_hardening`
- regression coverage includes:
  - `test/game-screen-startup-browser.test.tsx`
  - `test/game-screen-persistence-browser.test.tsx`
  - `test/static-delivery-contract.test.ts`

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

---

## PR-5: Complete Static-PWA Template Runtime Verification

Implementation status:

- complete in `build-tools/tools/tests/scaffolding`
- runtime verification now covers:
  - offline cold-load from the generated `webapp-static-pwa` service-worker/app-shell contract
  - local-workspace TypeScript dependency updates in a single dev session
  - existing naming/scaffold contract coverage remains in place

### Why This PR Exists

The current migration and shared utility extraction cover scaffold shape, metadata, and precache
generation, but the template plan still has one incomplete area:

- Phase 4 requires template-level verification for:
  - cold offline load after one online load
  - local workspace dependency updates in dev

Today those behaviors are better covered in Pleomino than in the reusable
`ts/webapp-static-pwa` template itself. That leaves part of the reusable contract implied rather
than proven in build-tools coverage.

### Scope

- Add missing build-tools template/runtime tests for `ts/webapp-static-pwa`.
- Verify the generated template can:
  - load offline after one successful online load
  - preserve the production service-worker/offline contract at template level
  - keep local-workspace Vite dependency behavior working in dev

### Implementation Notes

- Keep the new coverage in build-tools tests, not Pleomino-only tests.
- Reuse existing temp-repo and scaffold runtime test helpers where possible.
- Prefer deterministic local-origin validation over broad browser-only smoke tests.
- Do not fold unrelated Pleomino app changes into this PR.

### Tests

- Build-tools runtime/scaffold tests:
  - generated static-PWA app cold-loads offline after one online visit
  - generated static-PWA app still registers and serves the app shell from the service worker
  - generated static-PWA app still supports local-workspace dependency updates in dev

### Verify Strategy

- Keep this PR build-tools/template scoped.
- Do not modify `projects/apps/pleomino` here except possibly doc references if needed.
- Expected verify scope:
  - build-system scoped
  - no mixed-scoped PR run required if Pleomino app code stays untouched

### Acceptance Criteria

- The `ts/webapp-static-pwa` template satisfies all Phase 4 verification bullets in build-tools
  coverage.
- Template runtime correctness is proven without relying on Pleomino-only tests.

---

## PR-6: Project-Scoped Methodology Exceptions for Large Generated Artifacts

Implementation status:

- complete in `build-tools/tools/dev/file-size-lint.ts` and
  `build-tools/tools/dev/file-size-lint-exceptions.ts`
- Pleomino declares its generated source-file exception in
  `projects/apps/pleomino/methodology-exceptions.json`
- regression coverage proves:
  - only the owning project receives the exception
  - project-local exception edits stay on the project-impact verify path

### Why This PR Exists

Pleomino currently includes a large generated interesting-solution pool source file. That is
acceptable as an exception for this project, but the exception handling should be improved so that:

- exceptions are declared at project scope rather than as broad repo-level policy
- adding a project-local exception does not force a mixed-scope verify path across unrelated areas

This keeps exception review surgical and aligns validation cost with the project that owns the
exception.

### Scope

- Introduce project-scoped exception plumbing for methodology/file-size enforcement.
- Allow Pleomino to declare its generated artifact exception at the project level.
- Keep the default methodology policy strict for projects without explicit exceptions.

### Implementation Notes

- Prefer exception ownership keyed by project/importer path rather than one flat repo-wide list.
- Ensure the validation and selector logic can distinguish:
  - a project-local exception change
  - a repo-wide methodology/build-system rule change
- Keep the exception contract explicit, reviewed, and deterministic.
- Do not weaken the default file-size policy for the rest of the repo.

### Tests

- Build-tools/tests for methodology exception routing:
  - project-local exception changes select project-impact verification rather than mixed build-system
    scope when no shared policy changes are involved
  - unrelated projects do not inherit Pleomino’s exception
  - file-size enforcement remains strict for projects without exceptions

### Verify Strategy

- Keep this PR focused on build-tools enforcement/selection logic plus Pleomino’s project-local
  exception declaration.
- Avoid unrelated scaffold or app-runtime refactors here.
- Expected verify scope:
  - mixed/build-system scoped while the exception-routing mechanism itself is introduced
  - future project-local exception updates should then be project-impact scoped

### Acceptance Criteria

- Pleomino’s generated artifact exception is representable at project scope.
- The repo can validate project-local exceptions without treating every exception change as a
  repo-wide mixed-scope change.
- Methodology enforcement remains strict by default everywhere else.

---

## PR-7: Move `webapp-static-pwa` Onto Shared Precache Materialization

### Why This PR Exists

The reusable `ts/webapp-static-pwa` scaffold still leaves a core Pleomino learning only partially
captured:

- Pleomino now uses shared build-time precache materialization driven from built outputs
- the template still keeps a handwritten service-worker cache version and static precache list

That means the app-specific migration is ahead of the reusable template contract. The template
should adopt the same shared static-PWA precache path so offline completeness does not depend on
manual cache-list maintenance.

### Scope

- Update `ts/webapp-static-pwa` to use the shared static-PWA precache materialization flow.
- Replace handwritten service-worker cache versioning and fixed precache lists with placeholder
  injection driven from built output.
- Keep the template runtime behavior framework-neutral and zero-backend by default.

### Implementation Notes

- Reuse the existing shared helper surfaces:
  - `build-tools/tools/lib/static-pwa-precache.ts`
  - `build-tools/tools/dev/materialize-static-pwa-precache.ts`
- Add the same build-time materialization hook pattern Pleomino uses today rather than introducing
  a second implementation path.
- Keep the template service worker authored as a placeholder-based source template, not as a
  generated checked-in artifact.

### Tests

- Scaffold/template contract tests:
  - generated `vite.config.ts` invokes the shared materialization entrypoint during build
  - generated `public/service-worker.js` uses shared cache-version and precache placeholders
- Shared utility tests remain the authority for:
  - emitted JS chunk inclusion
  - worker/wasm inclusion
  - deterministic service-worker output for fixed built inputs

### Verify Strategy

- Keep this PR build-tools/template scoped.
- Do not modify Pleomino app code except for doc references if needed.
- Expected verify scope:
  - build-system scoped
  - no mixed-scoped PR run required if app code remains untouched

### Acceptance Criteria

- `ts/webapp-static-pwa` no longer depends on handwritten precache lists.
- Template build output uses the same shared precache materialization path as Pleomino.
- Offline asset completeness is driven from built outputs rather than template-maintained lists.

---

## PR-8: Tighten Template Runtime Verification for Install-Time Offline Completeness

### Why This PR Exists

The current `webapp-static-pwa` runtime coverage proves offline behavior, but it does not yet
strictly prove the strongest contract from this plan:

- required runtime assets should already be available after service-worker install/activation
- correctness should not depend on an extra online fetch warming runtime cache after install

Today the template runtime test fetches script and wasm assets online before asserting offline
availability, which can allow runtime-cache fallback to mask install-time precache gaps.

### Scope

- Strengthen template runtime verification so install-time offline completeness is explicitly
  asserted.
- Prove that required JS and wasm assets are available offline immediately after install/activate
  and before any extra online asset fetches.
- Keep the harness deterministic and local-origin based.

### Implementation Notes

- Reuse the existing static-PWA service-worker harness and precache-state helpers.
- Assert both:
  - the generated precache manifest contains required runtime assets
  - offline script/wasm fetches succeed without prior online runtime warming fetches
- Keep the test focused on contract behavior, not on Pleomino-specific app semantics.

### Tests

- Build-tools runtime test updates:
  - generated static-PWA app cold-loads offline after one online shell visit and service-worker
    install
  - emitted JS entry/chunks remain offline-available without a prior online runtime fetch
  - wasm runtime assets remain offline-available without a prior online runtime fetch
- Negative-path assertions where useful:
  - test should fail if service-worker placeholders are left unresolved
  - test should fail if emitted runtime assets drop out of the precache set

### Verify Strategy

- Keep this PR build-tools test scoped.
- Avoid unrelated scaffold or Pleomino app changes in the same PR.
- Expected verify scope:
  - build-system scoped
  - no mixed-scoped PR run required

### Acceptance Criteria

- Template runtime verification proves install-time offline completeness rather than runtime-cache
  fallback only.
- Offline JS and wasm availability is enforced as part of the reusable template contract.
- Phase 4 verification bullets are proven by template-level tests with no Pleomino-only reliance.

---

## PR-9: Complete Static-PWA Template Documentation Gaps

### Why This PR Exists

The template now has baseline selection/help text, but the original plan called for a fuller
documentation contract that still has gaps:

- limitations of hash-only client state for SSR apps
- best practices for local-origin PWA validation
- clearer guidance on when static PWA delivery is preferable to SSR

Those lessons matter because Pleomino’s migration specifically benefited from moving away from
SSR/hash mismatch complexity.

### Scope

- Expand `webapp-static-pwa` docs to cover the missing decision and validation guidance.
- Document:
  - when to choose `webapp-static` vs `webapp-static-pwa` vs SSR
  - why hash-persisted client state is a poor fit for SSR-first ownership
  - how to validate install/offline behavior on a real local origin
  - how wasm producers and workers fit into the static-PWA contract safely

### Implementation Notes

- Prefer updating the existing scaffold-facing docs rather than creating parallel guidance.
- Keep examples aligned with canonical repo commands and current template names.
- Make the guidance generic and reusable; do not make the template docs Pleomino-branded.

### Tests

- Doc/metadata contract tests:
  - template help and scaffold docs mention static-vs-SSR selection guidance accurately
  - docs mention local-origin PWA validation guidance
  - docs mention SSR/hash-state limitation guidance for client-owned persisted state

### Verify Strategy

- Keep this PR docs/template-metadata scoped.
- Do not combine it with runtime behavior changes unless a tiny doc-follow-up is unavoidable.
- Expected verify scope:
  - template/build-system scoped
  - no mixed-scoped PR run required if app code stays untouched

### Acceptance Criteria

- The static-PWA template docs satisfy the Phase 1 documentation bullets from this plan.
- Engineers can choose between static, static-PWA, and SSR templates using documented criteria.
- Local-origin PWA validation and SSR/hash-state limitations are explicitly documented.

---

## PR-10: Lock Pleomino Offline Browser Acceptance Into Deterministic Verify Coverage

Implementation status:

- complete in `projects/apps/pleomino`
- deterministic app-owned acceptance coverage is now wired through:
  - `test/game-offline-relaunch-solve-browser.test.tsx`
  - `test/pwa-service-worker-registration.test.ts`
  - `test/wasm-runtime-offline-cache.test.ts`
- focused target wiring:
  - `TARGETS` → `:pr10_offline_acceptance`
- the older temp Playwright repro scripts remain optional investigation aids, but the required
  verify path is now the app-owned deterministic target above

### Why This PR Exists

The static-PWA migration is functionally close to complete, but one final acceptance gap remains in
how Pleomino proves its browser-offline behavior:

- the cold-offline partial-board solve check exists, but it appears flaky and is not yet treated as
  a stable required verify path
- the production offline reload check is too weak to prove that the app shell actually rehydrated
  and stayed interactive after the server went away
- these browser-offline acceptance checks are not currently wired into Pleomino-owned automated
  targets in the same way the focused Vitest regression targets are

Because later PRs closed most migration and template gaps, the remaining work here is not another
delivery refactor. It is a validation lock-in PR that makes the final acceptance criteria reliable,
deterministic, and enforced.

### Scope

- Investigate and de-flake Pleomino’s cold-offline solve acceptance path.
- Strengthen the offline reload browser acceptance test so it proves hydrated interactive behavior
  rather than just absence of a generic connection error page.
- Wire the required offline browser acceptance checks into Pleomino-owned automated targets so they
  are not optional/manual-only validation.

### Implementation Notes

- Treat `e2e/cold-offline-solve-temp.e2e.ts` as a flakiness investigation first, not as proof of a
  product defect:
  - determine whether startup timing, preview-server readiness, locator selection, localhost/origin
    behavior, or service-worker takeover timing is causing nondeterminism
  - keep the final assertion focused on the acceptance contract:
    - partial-board state restores after warm online visit
    - cold offline reopen succeeds
    - solve still completes offline after relaunch
- Tighten `e2e/prod-reload-offline-temp.e2e.ts` so it proves:
  - the app shell is present
  - client hydration completed
  - interactive Pleomino UI is available after reload with the server offline
- Prefer Pleomino-owned target wiring for these browser acceptance checks rather than leaving them
  as ad hoc scripts only.
- Keep this PR app/test wiring focused. Do not fold shared template/build-tools runtime changes into
  it unless a tiny harness fix is required for deterministic execution.

### Tests

- Pleomino browser-offline acceptance coverage:
  - cold offline relaunch with a partial board can still solve after one successful online visit
  - production offline reload proves app-shell hydration/interactivity, not just generic offline
    fallback rendering
- Wiring/automation coverage:
  - required offline browser checks run from Pleomino-owned test targets or equivalent enforced app
    verification entrypoints
  - test scripts/config stay aligned with local-origin preview validation guidance

### Verify Strategy

- Keep this PR limited to Pleomino app code, Pleomino browser acceptance tests, and Pleomino-owned
  test wiring/docs.
- Avoid mixing in scaffold/template/build-tools refactors unless needed to make the Pleomino
  acceptance path deterministic.
- Expected verify scope:
  - default project-impact scoped verify for `projects/apps/pleomino` if ownership boundaries stay
    app-local
  - mixed-scoped verify only if shared build-system harness changes become necessary to close the
    flake deterministically

### Acceptance Criteria

- The cold-offline partial-board solve acceptance test is deterministic enough to serve as required
  validation and no longer behaves as a known flaky/manual-only check.
- The offline reload acceptance test proves hydrated Pleomino interactivity after server shutdown.
- Pleomino’s final browser-offline acceptance checks are wired into normal automated validation,
  closing the remaining gap in the static-PWA migration proof.

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
