# HMR Phase 3 Implementation Plan - PR Breakdown

This plan covers implementation of Phase 3 from `hmr-plan.md`: SSR and runtime consistency on top of the locked Phase 2 baseline.

Each PR includes code, tests, and documentation updates together.

Scope: `ts/webapp-static`, `ts/webapp-ssr-vite`, and `ts/webapp-ssr-next` preserve Phase 1 and Phase 2 behavior while hardening SSR runtime consistency in dev mode.

Non-goals:

- no docs-only PRs
- no tests-only PRs
- no producer automation redesign (canonical path remains `build-tools/tools/dev/build-wasm-producer.ts`)
- no fallback paths that hide primary-path bugs
- no template scope expansion beyond `ts/webapp-static`, `ts/webapp-ssr-vite`, `ts/webapp-ssr-next`

Completion criteria: SSR client/server update consistency is deterministic across repeated edit cycles, startup behavior remains non-blocking, and all Phase 1 and Phase 2 non-regression coverage stays green.

---

## PR-1: SSR Vite runtime consistency and repeated-cycle determinism

### Description

I will harden `ts/webapp-ssr-vite` runtime consistency so client module edits, server module edits, and wasm producer edits all propagate in a single dev session without restart and without startup regressions.

### Scope & Changes

- Keep the Phase 2 wasm producer bridge contract unchanged:
  - `dev:wasm:watch` remains watcher + canonical TypeScript producer command path
  - no fallback routes or alternate producer script implementations
- Verify and harden SSR-vite primary path behavior:
  - client import edit updates rendered client output
  - server render path edit updates SSR output
  - wasm producer edit updates SSR-visible wasm path
- Add deterministic repeated-cycle coverage for SSR-vite:
  - multiple sequential edit cycles for client/server/wasm in one session
  - explicit assertions that the dev process stays alive and PID-stable during updates
- Ensure startup remains non-blocking:
  - fail on startup stalls with clear primary-path diagnostics
  - keep prewarm work out of the critical startup path
- Keep change surface focused:
  - only touch SSR-vite runtime, test helpers, and SSR-vite docs relevant to this flow

### Tests (in this PR)

- Add/extend SSR-vite Phase 3 runtime consistency E2E:
  - scaffold SSR-vite app
  - perform client edit, server edit, wasm producer edit in one session
  - assert deterministic updates with no restart
- Add repeated-cycle determinism probe for SSR-vite:
  - run at least two full edit cycles (client + server + wasm) in same process
  - assert process identity remains stable
- Keep Phase 2 non-regression checks in the verification set:
  - `//:scaffolding_webapp_ssr_vite_dev_reload_wasm_producer`
  - `//:scaffolding_webapp_ssr_vite_dev_hmr_local_ts_dep`
  - `//:scaffolding_webapp_phase2_wasm_producer_policy_contract`

### Docs (in this PR)

- Update SSR-vite template guidance with Phase 3 runtime consistency checks:
  - expected client/server/wasm update behavior in one dev session
  - startup diagnostics and recovery commands for primary-path failures
- Re-state invariant that producer automation path remains canonical TypeScript.

### Verification Commands

- `buck2 test //:scaffolding_webapp_ssr_vite_dev_runtime_consistency_phase3`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_phase2_wasm_producer_policy_contract`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`

### Acceptance Criteria

- SSR-vite client, server, and wasm updates are deterministic in one dev session.
- Repeated edit cycles complete without restart or process hang.
- Startup remains non-blocking with clear failure diagnostics.
- Phase 2 producer-bridge invariants remain unchanged and green.

### Risks

SSR-vite middleware timing can still race under repeated edits and expose intermittent stale render output.

### Mitigation

Use deterministic readiness checks in tests and keep runtime update ordering explicit in the primary path.

### Consequence of Not Implementing

Phase 3 remains incomplete for SSR-vite and regressions can pass unnoticed until later phases.

### Downsides for Implementing

Adds additional repeated-cycle runtime assertions, increasing E2E runtime for this template.

### Recommendation

Implement first to establish a stable SSR-vite Phase 3 baseline.

---

## PR-2: SSR Next runtime consistency and no-hang hardening

### Description

I will harden `ts/webapp-ssr-next` runtime consistency with explicit no-hang and no-restart guarantees across repeated client/server/wasm edit cycles in one dev session.

### Scope & Changes

- Keep existing Phase 1 and Phase 2 behavior intact:
  - workspace-linked local dependency path remains primary
  - canonical producer automation path remains unchanged
- Harden Next dev primary path:
  - client-side dependency edit updates client-visible output
  - server render edit updates SSR-visible output
  - wasm producer edit updates server/client-visible wasm probes
- Address deterministic no-hang behavior directly:
  - remove or fix any root cause that can stall update completion
  - no fallback mode that hides a primary-path defect
- Add repeated-cycle stress coverage:
  - run repeated mixed edit cycles (TS client/server + wasm producer)
  - assert completion time bounds and process stability

### Tests (in this PR)

- Add/extend Next Phase 3 runtime consistency E2E:
  - sequential client/server/wasm edits in one session
  - deterministic update assertions for each path
- Add no-hang determinism test:
  - repeated mixed cycles in one process
  - explicit fail on timeout/stall behavior
- Keep existing Next non-regression in verification set:
  - `//:scaffolding_webapp_ssr_next_dev_hmr_local_ts_dep`
  - `//:scaffolding_webapp_ssr_next_dev_reload_wasm_producer`
  - `//:scaffolding_webapp_ssr_next_contracts`

### Docs (in this PR)

- Update Next template troubleshooting for Phase 3:
  - deterministic checks for client/server/wasm update progression
  - explicit no-hang diagnostics and recovery commands
- Preserve and document invariant that producer automation is canonical TypeScript.

### Verification Commands

- `buck2 test //:scaffolding_webapp_ssr_next_dev_runtime_consistency_phase3`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_next_contracts`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`

### Acceptance Criteria

- Next client/server/wasm updates are deterministic in one dev session.
- Repeated mixed edit cycles complete without timeout/hang or restart.
- Existing Next Phase 1 and Phase 2 coverage remains green.

### Risks

Next build/runtime internals may introduce intermittent timing drift under repeated edits.

### Mitigation

Use deterministic probes and explicit timeout boundaries in tests, then fix root causes in primary-path runtime flow.

### Consequence of Not Implementing

Phase 3 remains partially delivered and Next runtime consistency risks continue into later phases.

### Downsides for Implementing

Adds mixed-cycle E2E coverage with higher runtime cost for Next tests.

### Recommendation

Implement second after SSR-vite Phase 3 baseline is stable.

---

## PR-3: Phase 3 cross-template closeout and non-regression lock-in

### Description

I will close Phase 3 by locking cross-template runtime consistency requirements and ensuring Phase 1 and Phase 2 behavior stays green while Phase 3 expectations are enforced.

### Scope & Changes

- Add cross-template Phase 3 consistency guard:
  - enforce required runtime-consistency contract keys and diagnostics for SSR templates
  - ensure Phase 2 producer-path invariants remain unchanged
- Keep startup non-blocking behavior enforced across in-scope templates.
- Ensure no regressions to static-template local-dependency and wasm-loop behavior while finalizing Phase 3.
- Keep changes minimal and policy-driven:
  - no new runtime features outside Phase 3 consistency requirements
  - no fallback behavior that masks primary-path failures

### Tests (in this PR)

- Add cross-template Phase 3 policy contract test:
  - verifies runtime-consistency contract text and key script/path invariants
- Run full Phase 3 verification set as PR gate:
  - SSR-vite Phase 3 runtime consistency target
  - SSR-next Phase 3 runtime consistency target
  - existing Phase 1 and Phase 2 non-regression targets for static, SSR-vite, and SSR-next
- Keep template-convention metadata cquery gate green for touched tests.

### Docs (in this PR)

- Update `hmr-plan.md` and template-facing docs to mark Phase 3 closure outcomes:
  - SSR runtime consistency expectations
  - startup non-blocking requirement
  - continued Phase 2 invariants (canonical producer path, strict update policy)
- Add concise maintainer verification snippet for repeated edit-cycle checks.

### Verification Commands

- `buck2 test //:scaffolding_webapp_phase3_runtime_consistency_policy_contract`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_runtime_consistency_phase3`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_runtime_consistency_phase3`
- `buck2 test //:scaffolding_webapp_static_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_static_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_ssr_vite_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_hmr_local_ts_dep`
- `buck2 test //:scaffolding_webapp_ssr_next_dev_reload_wasm_producer`
- `buck2 test //:scaffolding_webapp_phase2_wasm_producer_policy_contract`
- `buck2 test //:scaffolding_template_conventions_metadata_cquery`
- `buck2 test //:scaffolding_ts_command_path_docs_contract`

### Acceptance Criteria

- Phase 3 runtime consistency is enforced for SSR-vite and SSR-next.
- Startup non-blocking contract is validated in tests and docs.
- Phase 1 and Phase 2 non-regression set remains green.
- Cross-template policy tests prevent drift from canonical producer automation path.

### Risks

Cross-template policy guards can drift from implementation details if updated without matching tests/docs.

### Mitigation

Keep policy assertions concrete and aligned to runtime behavior validated by Phase 3 E2E coverage.

### Consequence of Not Implementing

Phase 3 cannot be considered complete and regression risk remains high for future phases.

### Downsides for Implementing

Adds one closeout PR with additional policy assertions and maintenance overhead.

### Recommendation

Implement as final Phase 3 closeout after SSR-vite and SSR-next runtime consistency PRs are green.
