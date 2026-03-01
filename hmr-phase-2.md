# HMR Phase 2 Implementation Plan - PR Breakdown

This plan covers implementation of Phase 2 from `hmr-plan.md`: wasm dev update pipeline for
template-generated webapps.

Each PR includes code, tests, and documentation updates together.

Scope: `ts/webapp-static`, `ts/webapp-ssr-vite`, and `ts/webapp-ssr-next` support non-TypeScript
local dependency edits (producer source -> wasm) without restarting dev servers.

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no `chokidar-cli` path
- no broad runtime feature additions outside dev update loop

Completion criteria: all three templates support deterministic wasm producer edit propagation in
dev mode with test coverage in the same PRs that add behavior.

---

## PR-1: Phase 2 foundation + static template wasm dev update pipeline

### Description

I will establish the shared Phase 2 producer-bridge contract and land static-template behavior
first. This PR introduces deterministic watcher orchestration for wasm producer rebuild/sync and
proves it through scaffold contract checks and one static dev-loop E2E.

### Scope & Changes

- Producer bridge baseline for this PR:
  - If Phase 0 helper set already exists, reuse it directly.
  - If not, include only the minimal helper subset required by this PR:
    - start/wait/stop helper for multi-process dev loop
    - file mutation helper for producer source edits
    - update detection helper for browser-visible wasm behavior
- Update `ts/webapp-static` template wiring to make wasm consumption Vite-trackable:
  - ensure app runtime reads staged wasm from a deterministic app-visible path
  - ensure producer output is synced to that path in dev without restart
- Add producer watcher command (Node-based, deterministic queue):
  - watch producer source inputs
  - run existing producer wasm build command
  - sync updated wasm output into static app-consumed dev path
  - emit stable structured logs for start, rebuild, sync, and failure
- Keep wasm reload policy strict by default:
  - wasm edit path must use HMR/module invalidation without page navigation
  - do not add hybrid/full-reload fallback in this PR
- Plugin gating for this PR:
  - do not add a Vite invalidation plugin when direct wasm output watching is deterministic
  - add plugin work only if tests demonstrate inconsistent reload signaling
- Compose static dev scripts to run Vite + producer watcher with clean shutdown semantics.
- Keep implementation scoped to static template and shared helper(s) only when reuse is required.
- Update static scaffold fixture/example wiring so producer edits are represented in the app.

### Tests (in this PR)

- Add/extend scaffold contract tests to assert static generated scripts/config include:
  - producer watcher command wiring
  - deterministic wasm output path contract
- Add static wasm producer dev-loop E2E that:
  - scaffolds static app with non-TS wasm producer dependency
  - starts composed dev loop (vite + watcher)
  - mutates producer source
  - asserts producer rebuild + sync markers in logs
  - asserts browser-visible wasm behavior updates without manual restart or navigation
  - asserts strict HMR path (no full-page reload marker and state continuity probe)
- Add failure-path check in the same E2E suite:
  - intentional producer build failure yields deterministic recovery message
- Add repeated-run determinism probe:
  - run the wasm producer update scenario repeatedly and assert stable pass/fail behavior
  - assert no overlapping watcher builds under burst edits (single-queue invariant)

### Docs (in this PR)

- Update static template docs for Phase 2 wasm producer dev update behavior.
- Document expected watcher logs and concise recovery commands.
- Add troubleshooting note for stale/missing synced wasm output path.

### Verification Commands

- `buck2 test //:scaffolding_webapp_static_scaffold_includes_sample_test`
- `buck2 test //:scaffolding_webapp_static_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- Static template emits deterministic producer watcher/dev script wiring.
- Producer source edit rebuilds/syncs wasm and updates browser-visible behavior in one dev session.
- Wasm edit handling follows strict HMR/module invalidation path (no page navigation fallback).
- Coverage includes scaffold contract checks and one static wasm dev-loop E2E.
- Determinism is demonstrated across repeated runs with stable watcher queue behavior.

### Risks

Watcher event storms or overlapping rebuilds can produce nondeterministic output states.

### Mitigation

Use single-queue watcher processing with explicit serialized rebuild/sync phases and stable logs.

### Consequence of Not Implementing

Phase 2 cannot start from a validated baseline and static template remains wasm-dev stale.

### Downsides for Implementing

Adds dev-loop process orchestration complexity and E2E runtime cost.

### Recommendation

Implement first as the Phase 2 baseline contract PR.

---

## PR-2: SSR Vite wasm producer pipeline for client and server paths

### Description

I will apply the Phase 2 producer-bridge contract to `ts/webapp-ssr-vite`, validating that wasm
producer edits propagate correctly for SSR-related runtime paths during one dev session.

### Scope & Changes

- Update `ts/webapp-ssr-vite` template dev wiring:
  - consume synced wasm through deterministic SSR-vite app-visible path(s)
  - run producer watcher alongside `dev:ssr` in a composed command
- Ensure SSR-vite dev runtime sees updated wasm in paths used by:
  - browser/client behavior
  - server-rendered behavior where applicable to template contract
- Keep watcher implementation aligned with PR-1 deterministic queue/log contract.
- Keep strict wasm HMR policy for SSR-vite paths:
  - no navigation-based fallback in normal producer edit loop
- Plugin gating for SSR-vite:
  - keep direct watch path as primary
  - only introduce invalidation plugin work if deterministic tests show direct watch inconsistency
- Keep SSR-vite-specific logic scoped to template scripts/runtime wiring only.
- Update SSR-vite sample fixture wiring so producer edits are observable in test probes.

### Tests (in this PR)

- Extend scaffold contract tests for SSR-vite generated scripts and wasm path wiring.
- Add SSR-vite wasm producer dev-loop E2E that:
  - scaffolds SSR-vite app + non-TS wasm producer dependency
  - mutates producer source
  - asserts deterministic watcher rebuild/sync logs
  - asserts client-visible and SSR-visible wasm behavior updates without restart or navigation
  - asserts strict HMR/module invalidation path for wasm edits
- Include one deterministic negative probe:
  - missing synced wasm artifact reports explicit contract failure text
- Add repeated-run determinism probe for SSR-vite wasm loop:
  - repeated producer edit cycles remain stable with no queue overlap

### Docs (in this PR)

- Update SSR-vite template docs with Phase 2 producer watcher flow and expected behavior.
- Add troubleshooting for stale sync output and producer build failure signatures.

### Verification Commands

- `buck2 test //:scaffolding_webapp_ssr_vite_scaffold_includes_sample_test`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- SSR-vite template emits required producer watcher/dev composition contract.
- Producer edits rebuild/sync wasm and update SSR-vite observable behavior in one session.
- Tests in this PR cover script/config generation and live wasm update behavior.
- Wasm updates follow strict HMR/module invalidation path, not navigation fallback.
- Repeated-run determinism is proven for the SSR-vite wasm loop.

### Risks

SSR middleware timing may race with synced wasm availability after rebuild.

### Mitigation

Gate sync completion before signaling readiness and assert readiness through deterministic probes.

### Consequence of Not Implementing

Phase 2 remains incomplete for SSR-vite and SSR wasm parity is unproven.

### Downsides for Implementing

Adds SSR-specific dev orchestration and additional E2E runtime.

### Recommendation

Implement second after static baseline is stable.

---

## PR-3: SSR Next wasm producer alignment + Phase 2 closeout

### Description

I will land `ts/webapp-ssr-next` Phase 2 support and close Phase 2 with aligned producer-bridge
coverage across static, SSR-vite, and SSR-next templates.

### Scope & Changes

- Update `ts/webapp-ssr-next` dev wiring to compose Next dev server + producer watcher.
- Ensure Next template consumes synced wasm through deterministic app-visible path(s).
- Keep Next in parity with selected strict wasm HMR policy:
  - no full-page-reload-first behavior in normal producer edit loop
- Ensure producer edits are observable in both:
  - client-visible probe
  - server-rendered probe
- Keep producer watcher behavior aligned with PR-1/PR-2 deterministic queue/log contract.
- Add shared helper usage only where repeated logic would otherwise drift.
- Preserve Phase 1 TS-local-dependency probes in the combined Next scenario to avoid regressions while
  adding wasm pipeline behavior.
- Add Phase 2 cross-template policy guard to keep required producer contract keys aligned.

### Tests (in this PR)

- Extend scaffold contract tests for Next template producer watcher/dev composition wiring.
- Add SSR-next combined TS+wasm dev-loop E2E that:
  - scaffolds Next app with local TS dependency and non-TS wasm producer dependency
  - mutates TS dependency and asserts client/server probes update without restart
  - mutates producer source and asserts watcher rebuild/sync markers
  - asserts wasm-driven client/server probes update without restart or navigation
  - asserts strict wasm HMR/module invalidation path
- Add/extend Phase 2 policy test:
  - validates all three templates still emit required producer-bridge contract keys and
    troubleshooting contract text.
- Add repeated-run determinism probe for Next combined flow:
  - repeated TS+wasm edit cycles remain stable with deterministic watcher behavior

### Docs (in this PR)

- Update Next template docs and shared scaffolding guidance so all in-scope templates describe the
  same Phase 2 contract.
- Add concise maintainer verification snippet for producer edit -> wasm update loop.

### Verification Commands

- `buck2 test //:scaffolding_webapp_ssr_next_contracts`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- SSR-next producer edits update wasm behavior in client and server probes in one dev session.
- Contract tests and E2E coverage exist for Next in this PR.
- Cross-template docs and policy checks reflect complete Phase 2 contract.
- Combined Next TS+wasm scenario is covered so wasm changes do not regress TS live-update behavior.
- Wasm updates follow strict HMR/module invalidation path, with repeated-run determinism evidence.

### Risks

Next dev behavior can differ from Vite SSR in rebuild visibility timing.

### Mitigation

Use deterministic probes with explicit readiness boundaries and assert no manual restart needed.

### Consequence of Not Implementing

Phase 2 remains partially delivered and template parity is not achieved.

### Downsides for Implementing

Additional template-specific maintenance and E2E time.

### Recommendation

Implement as the final Phase 2 closeout PR.
