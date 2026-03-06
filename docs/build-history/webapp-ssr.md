# Webapp SSR Plan - Node Entrypoint SSR, Framework-Agnostic Build/Run Wiring

This document is a historical plan record.
Current scaffold support in this repository does not include `webapp-ssr-express`.
Use `webapp-ssr-vite` or `webapp-ssr-next` for active SSR scaffolding paths.

This plan introduces SSR support with a strict runtime contract: production always starts a plain
Node process at a generated server entrypoint. Framework differences are resolved during scaffolding
and build planning, not at runtime.

Each PR includes code, tests, and documentation updates together.

Scope: rename the current static Vite template for clarity, add SSR template variants for a generic
Express server and Next.js, and wire scaffolding/building/runnable plumbing so all SSR variants run
through a canonical `node <serverEntry>` production path.

Non-goals: no framework-level migration to Hatch in this sequence, no docs-only or tests-only PRs,
and no fallback execution paths that hide primary-path defects.

Completion criteria: `scaf` can create static and SSR webapp variants with consistent naming,
SSR targets build via Buck/Nix, production run paths execute via plain Node entrypoints, and
scaffold/build/run contracts are guarded by tests and docs in the same PRs.
WASM modules can be consumed from client and server-side components across static and SSR variants
through a shared build and artifact contract.
SSR contracts remain adapter-extensible so a future Hatch-based SSR variant can be added without
refactoring core planner/runnable runtime logic.

Dependency chain (must execute in order):

- PR-1 -> foundational naming and template contract required by all later PRs.
- PR-2 -> SSR template generation required before planner/build wiring can target those variants.
- PR-3 -> runnable/manifest SSR contract required before packaging and runtime integration tests.
- PR-4 -> SSR packaging/runtime contract required before WASM parity can be validated end-to-end.
- PR-5 -> shared client-side WASM contract required before server-side + parity enforcement.
- PR-6 -> server-side WASM and cross-variant parity finalization.
- PR-7 -> close remaining contract-negative coverage and strict methodology compliance gaps.
- PR-8 -> close remaining SSR test-module methodology gate and documentation parity gaps.

---

## PR-1: Rename static webapp template with a clean-break naming contract

### Description

I will rename the current Node webapp template to an explicit static name and apply a clean-break
naming contract before introducing SSR behavior. This removes ambiguity in scaffold output and avoids
compatibility-only complexity.

### Scope & Changes

- Rename template identity from `node/webapp` to `node/webapp-static`:
  - Update template metadata, help usage text, examples, and listing output.
  - Update generated target names if needed for clarity without preserving old API compatibility.
- Remove compatibility alias behavior in `scaf`:
  - `webapp` is no longer accepted as a template name.
  - `webapp-static` becomes the only static template entrypoint.
- Reserve consistent SSR naming up front:
  - `webapp-ssr-express` for generic Express-based SSR.
  - `webapp-ssr-next` for Next.js-based SSR.
- Ensure template validation and discovery paths continue to work after rename.

### Tests (in this PR)

- Add/extend scaffolding tests to assert:
  - `scaf templates` shows `webapp-static`.
  - `scaf new ts webapp-static <name>` succeeds and produces expected static files.
  - `scaf new ts webapp <name>` fails with a clear "unknown template" error.
- Add/extend help text tests to verify usage/examples include `webapp-static`.

### Docs (in this PR)

- Update Node scaffolding docs/help contract to describe naming split with no compatibility alias.
- Update references that currently use `scaf new ts webapp ...` to use
  `scaf new ts webapp-static ...`.

### Acceptance Criteria

- `webapp-static` is the canonical static template name.
- `webapp` is no longer a valid template name.
- Static template scaffold output matches the updated contract and naming.
- Rename-related tests and docs pass in the same PR.

### Risks

CLI completion/help or docs drift can leave users uncertain after the clean-break rename.

### Mitigation

Add direct contract tests for template listing/help and include explicit error expectations for old
template names.

### Consequence of Not Implementing

The current `webapp` name remains overloaded and blocks a clean, unambiguous static/SSR split.

### Downsides for Implementing

Breaking template API names may require updating in-flight local scripts immediately.

### Recommendation

Implement.

### Closure Status

Implemented and validated:

- Strict SSR test-module size gates are wired in verify and CI (`--scope=ssr-tests --fail=true`).
- Touched SSR scaffold/runnable test modules were decomposed to remain under 250 lines.
- Handbook and build-system docs now reflect that strict methodology gates apply to touched test
  modules.
- Existing SSR positive and negative contract suites remained green after the refactor.

---

## PR-8: Close remaining SSR methodology-gate and test-module decomposition gaps

### Description

I will close the remaining compliance gaps left after PR-7 by enforcing methodology sizing rules on
touched SSR test modules and by finishing the related documentation contract so test-module rules are
explicit in the same places as runtime-module rules.

### Scope & Changes

- Complete methodology compliance for touched SSR test modules:
  - split any touched SSR test file that exceeds the 250-line methodology limit into focused helper
    modules.
  - keep each resulting module single-purpose and readable, with no behavior expansion.
- Add strict methodology gate coverage for test modules:
  - add a deterministic file-size check path that applies to touched test modules (not only source
    modules).
  - wire the check into existing verify/CI quality-gate flow with fail-fast behavior.
- Close documentation parity for methodology scope:
  - add explicit wording in build-system docs that strict methodology size/decomposition expectations
    apply to test modules as well as runtime modules.
  - keep contributor guidance aligned with the same contract language.
- Keep PR scope narrow:
  - no runtime/planner/packaging behavior changes.
  - no fallback logic or compatibility expansion.

### Tests (in this PR)

- Add/extend tests to assert:
  - touched SSR test modules remain under methodology file-size limits.
  - new/updated test-module file-size gate runs in strict mode and fails on violations.
  - refactored SSR test helpers preserve existing positive-path and negative-path assertions.
- Keep existing SSR contract-negative suites green:
  - missing/invalid framework contract checks.
  - missing `serverEntry` and `clientDir` checks.
  - SSR no-static-fallback routing checks.

### Docs (in this PR)

- Update build-system documentation to explicitly state methodology gates apply to test modules.
- Update this plan with closure status notes for PR-7 follow-up gaps.
- Keep handbook contributor guidance aligned with the strict methodology gate behavior.

### Acceptance Criteria

- All touched SSR test modules are decomposed to comply with the 250-line methodology limit.
- Strict verify/CI gate coverage exists for touched test-module sizing violations and fails
  deterministically on regressions.
- Existing SSR positive and negative contract suites remain green with no runtime behavior changes.
- Build-system docs, handbook guidance, and this plan reflect the same methodology scope for test
  modules.

### Risks

Test-file decomposition can accidentally change fixtures or execution ordering if helper extraction is
not surgical.

### Mitigation

Keep refactors mechanical, preserve existing test assertions, and add focused regression checks around
shared helper extraction points.

### Consequence of Not Implementing

Methodology drift remains in touched SSR test modules, and strict compliance expectations differ
between docs and enforced gates.

### Downsides for Implementing

Slightly higher test-module surface area and additional maintenance for strict gate coverage.

### Recommendation

Implement.

### Closure Status

Implemented and validated:

- SSR contract-negative checks now fail deterministically for invalid/missing framework and missing
  canonical SSR artifacts (`serverEntry`, `clientDir`).
- SSR runnable routing fails fast on contract violations and no longer allows static-host fallback
  semantics for SSR targets.
- Added strict SSR contract-negative test coverage and kept existing positive SSR suites green.
- Added documentation updates describing expected negative failure signatures and remediation paths.

---

## PR-2: Add SSR scaffold variants (`webapp-ssr-express`, `webapp-ssr-next`) with Node-first startup

### Description

I will add two SSR scaffold variants that both target Node process startup in production while
keeping framework-specific implementation details inside template artifacts.

### Scope & Changes

- Add `build-tools/tools/scaffolding/templates/node/webapp-ssr-express/`:
  - Vite SSR entrypoints (`entry-client`, `entry-server`) and minimal app shell.
  - `server/index.ts` Express server that imports SSR renderer and serves assets.
  - package scripts: `dev:ssr`, `build:ssr`, `start:ssr`.
- Add `build-tools/tools/scaffolding/templates/node/webapp-ssr-next/`:
  - Next.js app/router skeleton and minimal page route.
  - explicit Node server entrypoint wrapper (`server/index.ts`) that boots Next in production.
  - package scripts aligned to SSR dev/build/start semantics.
- Keep both variants explicit and deterministic:
  - no runtime fallback to static hosting
  - no framework auto-detection at run time
  - one primary server entrypoint per scaffold.
- Ensure importer/lockfile labeling and provider wiring match existing Node template conventions.

### Tests (in this PR)

- Add scaffold contract tests for both SSR variants:
  - expected file tree exists
  - expected scripts exist in generated `package.json`
  - generated `TARGETS` include intended SSR-oriented shape/labels.
- Add minimal runtime smoke tests for each variant in temp repos:
  - server starts
  - HTTP response contains expected SSR output marker.

### Docs (in this PR)

- Add help text and examples for both SSR variants.
- Update Node template README guidance to include static plus both SSR options and when to use each.

### Acceptance Criteria

- `scaf new ts webapp-ssr-express <name>` and `scaf new ts webapp-ssr-next <name>` both succeed.
- Both generated templates start and serve SSR responses in smoke tests.
- Template naming and purpose are unambiguous across static and SSR options.

### Risks

Framework-specific bootstrap details can drift from generated scripts and entrypoint assumptions.

### Mitigation

Use per-template scaffold contract tests and runtime smoke tests that assert concrete startup files and
response content.

### Consequence of Not Implementing

SSR intent remains under-specified in scaffolding, blocking framework-specific onboarding.

### Downsides for Implementing

Additional template surface area and longer scaffold test runtime.

### Recommendation

Implement.

---

## PR-3: Wire planner and runnable contracts for SSR with canonical Node entrypoints

### Description

I will extend planner/manifest/runnable plumbing so SSR targets are first-class outputs with a
shared production contract: `node <serverEntry>`.

### Scope & Changes

- Extend planner kind classification to distinguish:
  - static webapp outputs (`webapp-static`)
  - Express SSR outputs (`webapp-ssr-express`)
  - Next SSR outputs (`webapp-ssr-next`)
- Update runnable manifest generation (`manifest.nix`) for SSR entries:
  - `runnable.kind = "webapp-ssr"`
  - `runnable.framework = "express" | "next" | "hatch"` (hatch reserved for future adapter).
  - `runnable.run.prod.argv = ["node", "<serverEntry>"]`
  - `runnable.run.dev.argv` points to variant-specific dev script.
  - `runnable.artifacts` includes canonical SSR keys (`serverEntry`, `clientDir`).
  - `runnable.artifacts` allows optional adapter fields (`assetManifest`, `publicDir`).
  - optional runtime metadata keys supported in contract: `serverCwd`, `envFiles`, `nodeArgs`.
  - concrete `serverEntry` location is adapter-defined and mapped during packaging.
- Update TypeScript runnable contracts/parsers/formatters to read these SSR fields directly.
- Keep static webapp run contract as static-hosting behavior for `webapp-static`.
- Keep runtime logic simple:
  - no custom runner/daemon
  - no runtime framework switching
  - direct `node` process start for prod.
- Enforce adapter boundary:
  - framework-specific output mapping stays in adapter-specific planner/build modules.
  - core planner/runnable layers consume only canonical SSR contract fields.
  - runtime routing keys off `runnable.kind + runnable.framework`, not framework-specific planner kind names.

### Tests (in this PR)

- Add/extend runnable manifest contract tests to assert SSR fields and production argv shape.
- Add routing tests to confirm:
  - `p` for SSR targets resolves to `node <serverEntry>`.
  - `d` for SSR targets resolves to framework-specific dev commands.
  - static template remains on static run contract.
- Add regression tests that fail if SSR prod commands regress to Python/static host commands.
- Add contract tests that accept reserved hatch discriminator and optional metadata keys without
  changing runtime behavior for express/next.

### Docs (in this PR)

- Update runnable contract and planner docs to include:
  - `webapp-ssr` contract
  - framework discriminator
  - canonical `node <serverEntry>` production semantics.
- Update runnable output examples to show static, SSR-express, and SSR-next targets.

### Acceptance Criteria

- Planner emits SSR manifests with canonical Node production startup.
- `p` and `d` execute expected commands for each SSR variant with no runtime fallback logic.
- Existing static template runnable behavior remains stable.
- Manifest schema supports adding a future hatch adapter without core runtime changes.

### Risks

Contract drift between planner output and TypeScript parser can silently break SSR run paths or block
future adapter additions.

### Mitigation

Add strict manifest schema/parse tests and explicit routing assertions, including reserved adapter
fields for future hatch onboarding.

### Consequence of Not Implementing

SSR scaffolds may exist but cannot run predictably through shared tooling and Docker-like startup.

### Downsides for Implementing

Planner/runnable contracts gain additional SSR metadata and validation surface.

### Recommendation

Implement.

---

## PR-4: Add Nix/Buck packaging for SSR variants and Docker-aligned build/run smoke coverage

### Description

I will make SSR variants first-class in Nix/Buck packaging with output shapes aligned to container
deployment: build-time framework differences, runtime Node entrypoint consistency.

### Scope & Changes

- Add SSR-oriented package plumbing in flake/package templates for both variants:
  - build client artifacts and server bundle in deterministic output layout.
  - emit canonical server entry path consumed by `node <serverEntry>`.
- Wire Node macro/build rules to select SSR package shape per variant.
- Ensure graph generator/materialize outputs include SSR runnable entries and artifact metadata.
- Add reusable SSR adapter packaging boundary:
  - adapter-specific build modules map framework outputs to canonical artifact keys.
  - core packaging validation runs against canonical artifact keys only.
- Enforce primary-path failure semantics:
  - missing server entry or client artifacts fail build directly
  - no fallback to static host command for SSR targets.
- Add Docker-readiness contract in build outputs:
  - production startup is always one plain Node command
  - no runtime planner/runnable dependency required in container.

### Tests (in this PR)

- Add scaffold-and-build smoke tests for `webapp-ssr-express` and `webapp-ssr-next`:
  - scaffold temp repo
  - build target via Buck/Nix
  - assert `serverEntry` and client artifact layout
  - execute `node <serverEntry>` and validate HTTP response.
- Add materialize/runnable listing tests asserting both SSR variants appear with expected metadata.
- Add a Docker-aligned smoke check that validates startup command and minimal runtime file set.
- Add reusable SSR adapter conformance test harness:
  - each adapter must satisfy canonical artifact + startup contract checks.
  - express/next must pass now; hatch can be added later by implementing the same harness.

### Docs (in this PR)

- Update build-system and scaffolding docs with SSR output shape, run commands, and container startup
  contract.
- Add troubleshooting notes for SSR-specific wiring failures (server entry path, runtime boot, manifest
  mismatch).

### Acceptance Criteria

- Both SSR variants build and run through Buck/Nix with canonical Node startup.
- Artifact shape is validated by tests and suitable for container runtime wiring.
- Materialize/runnable output clearly identifies SSR framework metadata and startup command.
- Adapter conformance harness exists and validates canonical contracts independent of framework internals.

### Risks

Variant-specific package paths can diverge from shared startup contract and make future adapter
addition costly.

### Mitigation

Validate shared canonical contracts with both integration smoke tests and adapter conformance tests.

### Consequence of Not Implementing

SSR remains scaffold-level only and does not provide stable deployment-ready build outputs.

### Downsides for Implementing

Longer integration smoke tests and additional adapter conformance tests to maintain.

### Recommendation

Implement.

---

## PR-5: Add shared WASM client wiring for static, SSR-express, and SSR-next webapp variants

### Description

I will add a shared client-side WASM contract that works consistently across all webapp variants so
webapp code can import and execute WASM from browser components without variant-specific glue.

### Scope & Changes

- Add a shared webapp WASM client contract:
  - deterministic artifact location for webapp-consumable WASM outputs
  - stable import path expectations for app code and staged assets.
- Extend static and SSR template generators to include a minimal client-side WASM usage path:
  - one tiny browser-side example module import (or helper wrapper) per variant.
- Update planner/build packaging so WASM assets required by client components are present in:
  - `webapp-static` build outputs
  - `webapp-ssr-express` client outputs
  - `webapp-ssr-next` client outputs.
- Ensure no variant uses bespoke client-side WASM copy logic outside the shared contract.

### Tests (in this PR)

- Add/extend scaffold-and-build tests per variant to assert:
  - expected client WASM artifacts are present in output.
  - client entry code can resolve/import the staged WASM artifact path.
- Add/extend existing wasm-linking-style smoke checks to cover all three webapp kinds with the same
  client-side contract expectations.

### Docs (in this PR)

- Update webapp and WASM docs to document the shared client-side WASM contract and output locations.
- Document per-variant examples showing identical client-side WASM usage pattern.

### Acceptance Criteria

- Static, SSR-express, and SSR-next webapps all expose the same client-side WASM consumption contract.
- Client-side WASM smoke tests pass for all three variants.
- No variant-specific client WASM staging drift remains.

### Risks

Framework-specific asset handling may cause path mismatches between build outputs and runtime imports.

### Mitigation

Use variant-specific integration checks that assert both file presence and import resolution behavior.

### Consequence of Not Implementing

Client-side WASM usage remains inconsistent and harder to port between webapp variants.

### Downsides for Implementing

Additional integration test coverage and stricter artifact-shape assertions.

### Recommendation

Implement.

---

## PR-6: Add shared server-side WASM execution contract for SSR variants plus static artifact parity guard

### Description

I will add a server-side WASM contract for Node runtime execution in SSR variants and enforce
artifact parity checks for static webapps so WASM packaging remains server-capable across all webapp
classes.

### Scope & Changes

- Define server-side WASM execution contract for Node-based server components:
  - canonical server import/loader path in output artifacts
  - deterministic runtime availability for `node <serverEntry>` startup.
- Wire server-side WASM support for:
  - `webapp-ssr-express` server runtime
  - `webapp-ssr-next` server runtime.
- Add static-webapp artifact parity path:
  - ensure static webapp builds also expose WASM artifacts in a Node-consumable layout contract
    (for shared libraries and deployment portability), even though static webapps do not run a
    long-lived server process.
- Keep server-side WASM execution in primary paths only:
  - no fallback to alternative runtimes when server-side WASM loading fails.

### Tests (in this PR)

- Add SSR server runtime smoke tests for express and next variants:
  - start Node server
  - execute a server-side WASM-backed code path
  - assert expected HTTP response/output.
- Add static webapp parity test:
  - verify built artifacts include Node-consumable WASM placement contract used by SSR variants.
- Add regression tests that fail if server-side WASM wiring diverges between express/next/static
  packaging contracts.

### Docs (in this PR)

- Update SSR and WASM docs with server-side loading contract and runtime expectations.
- Clarify static webapp parity scope: no server process runtime, but server-capable WASM artifact
  contract is preserved for shared module portability.

### Acceptance Criteria

- SSR-express and SSR-next can execute server-side WASM code through Node startup paths.
- Static webapp builds preserve the same server-capable WASM artifact contract shape.
- Parity tests pass across static and SSR variants.

### Risks

Server-side WASM runtime constraints can differ between framework stacks and Node execution contexts.

### Mitigation

Use explicit runtime smoke coverage per SSR framework plus shared artifact-parity tests for all
variants.

### Consequence of Not Implementing

Server-side WASM behavior will remain framework-specific and fragile, and static/SSR portability will
drift.

### Downsides for Implementing

Longer cross-variant integration test matrix and tighter packaging constraints.

### Recommendation

Implement.

---

## PR-7: Close SSR negative-contract and methodology-compliance gaps

### Description

I will close the remaining gaps by adding explicit negative-path contract tests for SSR build/runtime
failure semantics and by aligning touched test modules with strict methodology file-size expectations.

### Scope & Changes

- Add explicit negative-path contract coverage for SSR framework and artifact contracts:
  - fail when `webapp:ssr` targets omit a valid `framework:*` label.
  - fail when SSR packaging outputs are missing canonical `serverEntry` (`dist/server/index.js`).
  - fail when SSR packaging outputs are missing canonical `clientDir` (`dist/client`).
  - fail when SSR runtime routing would otherwise drift to static-host fallback semantics.
- Add planner/runtime contract-negative routing assertions:
  - SSR targets without valid contracts must not resolve to static-webapp run commands.
  - missing SSR run metadata must fail with explicit actionable errors.
- Enforce methodology-oriented module sizing and decomposition for newly added or modified test code:
  - split oversized SSR test files into focused helper modules where practical.
  - keep each file aligned with strict file-size gate expectations and single-purpose boundaries.
- Keep all changes surgical and contract-focused:
  - no runtime behavior broadening.
  - no compatibility fallback paths that mask primary-path defects.

### Tests (in this PR)

- Add/extend negative tests to assert hard failures for:
  - `webapp:ssr` with missing/invalid framework label.
  - missing `dist/server/index.js` in SSR packaging output.
  - missing `dist/client` in SSR packaging output.
  - attempted static fallback behavior on SSR targets.
- Add/extend runnable/planner routing tests to confirm:
  - invalid SSR contracts fail fast with clear error messages.
  - SSR targets never map to static-host production commands.
- Add methodology compliance guard coverage for touched SSR test modules:
  - file-size lint gate passes in strict mode.
  - refactored test helpers preserve existing positive-path assertions.

### Docs (in this PR)

- Update SSR troubleshooting notes to include explicit negative-contract failure signatures and expected
  remediation.
- Update contributor/testing guidance to document the required negative-path checks for SSR contract
  changes.
- Add a short note in this plan and related build docs that strict methodology gates apply to test
  modules as well as runtime modules.

### Acceptance Criteria

- SSR contract-negative scenarios fail deterministically with explicit error output.
- SSR routing cannot regress to static-host fallback behavior without test failures.
- Existing positive SSR scaffold/build/run/WASM parity tests remain green.
- Touched SSR test modules comply with strict methodology file-size and modular-boundary expectations.
- Docs and tests for these guarantees land in the same PR.

### Risks

Negative-path tests can be brittle if assertions depend on unstable command output text.

### Mitigation

Assert stable contract markers and failure classes, and isolate reusable expectations in shared helper
utilities to avoid duplicated brittle checks.

### Consequence of Not Implementing

Primary SSR contract regressions can slip through positive-path-only coverage, and methodology drift in
test modules can accumulate unnoticed.

### Downsides for Implementing

Additional negative-path coverage and module-splitting increases test maintenance surface.

### Recommendation

Implement.
