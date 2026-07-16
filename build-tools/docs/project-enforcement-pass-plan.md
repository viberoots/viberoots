# Project Enforcement Pass Implementation Plan

This plan implements
[`project-enforcement-pass-design.md`](project-enforcement-pass-design.md). It adds a consumer-scoped
early verify pass and migrates only bounded policy checks that inspect `projects/`.

## Reviewed Context

- [`project-enforcement-pass-design.md`](project-enforcement-pass-design.md)
- [`build-system-design.md`](build-system-design.md)
- [`../../docs/README.md`](../../docs/README.md)
- [`../../docs/handbook/getting-started-on-a-pr.md`](../../docs/handbook/getting-started-on-a-pr.md)
- [`../../docs/handbook/testing.md`](../../docs/handbook/testing.md)

## Non-Goals

- Do not move project builds, deployment integration, scaffolding, Nix, services, or temp-repo tests
  into the early pass.
- Do not broaden source snapshots, artifact routing, development-shell closures, or cache policy.
- Do not add checked-in enforcement targets to every consumer project.
- Do not make direct `buck2 test` infer Git changes.
- Do not add project Starlark enforcement for file types that do not yet exist under `projects/`.
- Do not add compatibility shims or hidden fallbacks.

## Implementation Guardrails

- Reuse changed-path collection, workspace-root resolution, pass planning, generated workspace
  state, progress rendering, and Buck execution-policy helpers.
- Keep source-owned runner discovery authoritative. Generated `workspace_buck` targets are outputs,
  not reviewed sources or a second hard-coded registry.
- Keep ordinary `build-tools/tools/tests/` coverage fixture-based. Only generated
  project-enforcement targets may inspect the verified live project root.
- Fail closed when change authority, consumer-root authority, target discovery, or registration
  freshness cannot be established.
- Refresh only project-enforcement registration before discovery. Do not invoke Nix or broaden
  prebuild work.
- Run the live-worktree pass locally with remote cache reads and writes disabled. Preserve every
  other pass's selected execution policy.
- Do not use changing isolation names, nonce environment variables, or broad project snapshots to
  force freshness.
- Keep existing lint preflights and ordinary enforcement. Share scanner logic instead of copying
  patterns or scanning the same scope through independent implementations.
- Keep touched source and test files at or below 250 lines.

## Validation Policy

- Run focused tests first for each changed selector, generator, pass planner, runner, and scanner.
- Measure each candidate before admission. A target must finish within 30 seconds and the warm pass
  within 60 seconds.
- Capture before/after sizes for `.viberoots/workspace`, `buck-out`, relevant temp roots, and new Nix
  store paths using the handbook procedure.
- Reject any target that realizes Nix outputs, creates temp consumers, populates dependency caches,
  or starts nested Buck daemons.
- Prove a second run after a project edit executes again and observes the edit without cache cleanup.
- Run `i && b && ALL_TESTS=1 v` for both PRs because they change central verify, generated workspace,
  source-mode, and execution-policy behavior.
- Perform an independent scope review before each PR is considered complete.

## De-Risking Checkpoints

### Checkpoint A: One Policy Works End To End

After PR-1, a project-only change must inject the generated stale-name target, show the new pass,
reject `PR-N`, and rerun after an edit without broad snapshots or new Nix store paths.

### Checkpoint B: Complete Bounded Policy Set

After PR-2, every required scanner must pass source-mode, CI, timing, disk, and
no-live-project-test checks. Heavy integration tests must remain in their existing lanes.

## Integration Debt Ledger

| Area     | Introduced by | Owner PR | Status | Notes                                      |
| -------- | ------------- | -------- | ------ | ------------------------------------------ |
| None yet | N/A           | N/A      | Open   | Record only explicitly approved deferrals. |

## PR-1: Consumer-Scoped Pass And Stale-Name Enforcement

### 1. Intent

Land the complete pass path with canonical stale-name enforcement, including completed-plan `PR-N`
names, as the first production policy.

### 2. Scope of changes

- Discover `*.project-enforcement.test.ts` runner sources and generate labeled targets in
  `workspace_buck` through source-owned prebuild code.
- Add bounded registration freshness before target discovery without invoking Nix.
- Add `verify:project-enforcement`, reject conflicting pass labels, and partition the targets into a
  `project-enforcement` pass.
- Extend sidecar scheduling and progress/status output without adding a finish-before-all barrier.
- Inject all generated targets for project changes, explicit project selectors, unavailable change
  authority, and `ALL_TESTS=1`; deduplicate normally selected targets and ignore
  `VERIFY_SKIP_LINT=1` for this pass.
- Derive a pass-local execution policy that is local and disables remote cache use while leaving
  other passes unchanged.
- Extend existing workspace-root authority with a fail-closed project-scan context.
- Refactor canonical stale-name scanning into shared pure logic and add the generated project runner.
- Preserve the stale-name preflight as a fail-fast caller and the ordinary no-live-project-test rule.

### 3. External prerequisites

None. Use the repository-pinned Buck and existing generated workspace cell.

### 4. Tests to be added

- Suffix/label generation, conflict rejection, registration freshness, and no-Nix generation tests.
- Selection tests for committed, staged, unstaged, untracked, renamed, deleted, explicit, unknown,
  full-suite, and deduplicated cases.
- Pass partition, earliest-wave scheduling, progress bar, and `s` row tests.
- Local/no-remote-cache argument tests that prove other pass policies are unchanged.
- Submodule, flake/remote-source, and temp-consumer root tests.
- `PR-N` positive/negative fixtures and a warm rerun-after-edit regression without cleanup.
- Enforcement that ordinary build-system tests cannot access live `projects/`.

### 5. Docs to be added or updated

Update the testing handbook, build-system design, and this design if implementation evidence changes
any stated contract.

### 5.5. Expected regression scope

Verify target selection, generated workspace freshness, pass scheduling/status, remote verify pass
policy, stale-name preflight, source modes, and scoped/full-suite discovery.

### 6. Acceptance criteria

- Checkpoint A passes with focused timing and disk evidence.
- Missing authority fails with actionable diagnostics and never silently omits the pass.
- Existing preflights and non-project pass execution remain behaviorally unchanged.
- Focused tests, full validation, and independent scope review pass.

### 7. Risks

Generated registration may be stale, infrastructure-cell targets may be omitted, or pass-local
policy may leak into other lanes.

### 8. Mitigations

Use one source-owned generator, explicit full-suite injection, fail-closed diagnostics, per-pass
argument tests, and edit-without-cleanup evidence.

### 9. Consequences of not implementing this PR

Project policy remains implicit in viberoots-owned tests and can be skipped by project-only scope.

### 10. Downsides for implementing this PR

Verify gains one generated target family, one target query, and one additional progress row.

## PR-2: Migrate Bounded Project Policies And Lock CI Parity

### 1. Intent

Move the remaining confirmed cheap live-project policies into the new pass and prove local/CI parity.

### 2. Scope of changes

- Split reusable pure scanner logic from live assertions for process-inspection commands, deployment
  environment branches, source-file size, and deployment-metadata secrets.
- Generate one project-enforcement target per admitted policy; keep fixture tests in the ordinary
  viberoots test suite.
- Keep mixed viberoots/project assertions in their existing lanes for viberoots-owned scope.
- Emit stable selection reasons for project change, explicit selector, full suite, and unavailable
  authority through the existing verify/CI diagnostics path.
- Make full and scoped CI consume the same target discovery and selection decision as local `v`.
- Keep phase-zero deployment contracts, `dogfood-current-layout`, and Buck-query tests in their
  current lanes. If a required scanner misses admission, stop and revise the design with evidence;
  do not weaken it or silently omit it.

### 3. External prerequisites

PR-1 must be complete with Checkpoint A evidence.

### 4. Tests to be added

- Positive, negative, allowlist, and project-root fixtures for every migrated scanner.
- Mixed-scope tests proving viberoots-only enforcement is not weakened or duplicated.
- CI/local decision parity and stable selection-reason tests.
- Full-suite tests in local and non-local source modes.
- Per-target and aggregate timing, disk, process, Nix-path, and warm-rerun evidence.

### 5. Docs to be added or updated

Update the testing handbook with membership criteria and status behavior. Update build-system docs
with generated target ownership, CI selection, and execution-policy boundaries.

### 5.5. Expected regression scope

Repo-wide linting, deployment policy, file-size methodology, secret scanning, verify/CI scope,
source modes, generated state, and full-suite performance.

### 6. Acceptance criteria

- Stale names, process inspection, deployment branches, project file size, and deployment metadata
  secrets run in `project-enforcement` for project changes and full suites.
- Checkpoint B passes; no migrated target performs prohibited heavy work or exceeds its budget.
- Ordinary viberoots tests use fixtures, and viberoots-only enforcement remains intact.
- Focused tests, full validation, and independent scope review pass.

### 7. Risks

Scanner splitting may change allowlists or coverage, and duplicated invocations may add avoidable time.

### 8. Mitigations

Share pure scanner cores, preserve existing callers until parity is proven, compare exact fixtures,
and measure each target before admission.

### 9. Consequences of not implementing this PR

The pass would cover naming only while other live-project policies remain implicit or inconsistently
scheduled.

### 10. Downsides for implementing this PR

Cheap policies may run both as fail-fast preflights and pass targets, adding bounded repeated work.

## PR-3: Close Pass Authority And Admission-Proof Gaps

### 1. Intent

Make project-enforcement membership, pass isolation, consumer-root behavior, and lightweight-runner
admission mechanically enforceable so future changes cannot silently weaken the completed pass.

### 2. Scope of changes

- Add an analysis-time Starlark convention that rejects any target combining
  `verify:project-enforcement` with `enforcement`, `isolated`, `isolated-bounded`,
  `resource-limited`, or `manual`; retain the runtime planner conflict check as defense in depth.
- Make `*.project-enforcement.test.ts` suffix discovery the sole reviewed runner-membership
  authority. If Buck still requires explicit generated exports, derive them from that discovery and
  fail closed on any parity mismatch instead of maintaining an independent list.
- Prove the canonical consumer-root authority separately for submodule source mode, flake/remote
  source mode with a Nix-store `VIBEROOTS_ROOT`, and temp consumers; generated runners must execute
  against the consumer project root in the remote-source layout.
- Prove `VERIFY_SKIP_LINT=1` cannot suppress project-enforcement discovery, selection, or execution.
- Add mechanically enforced admission checks that reject runners capable of Nix realization, temp
  consumer or dependency-cache population, service startup, nested Buck daemons, or handbook timing
  and disk-budget violations. Reuse canonical process, path, timing, and disk evidence rather than
  adding parallel authorities.
- Add project-root negative generated-runner coverage for process inspection, deployment branches,
  project file size, and deployment metadata secrets without duplicating broad integration suites.

### 3. External prerequisites

PR-2 must be complete with Checkpoint B evidence. No new external tools or services are required.

### 4. Tests to be added

- Starlark fixture cases for every forbidden mixed label and one valid project-enforcement-only
  target, plus the retained runtime planner conflict cases.
- Discovery/export parity tests that add and remove a suffix-owned runner and fail on stale or extra
  generated membership.
- Distinct submodule, Nix-store remote-source, and temp-consumer root tests, including generated
  runner execution from a remote-source layout and fail-closed root-authority cases.
- Selection and execution tests with `VERIFY_SKIP_LINT=1` proving all required generated runners
  remain present.
- Structural admission tests for prohibited Nix, temp-consumer, cache, service, and nested-Buck
  operations, plus bounded runtime tests that capture process, timing, disk-growth, and Nix-path
  evidence under the handbook procedure.
- Focused project-root negative fixtures for each of the four PR-2 scanners, retaining their
  existing pure-scanner fixture coverage and avoiding redundant full-consumer scenarios.

### 5. Docs to be added or updated

Update the testing handbook and build-system design with the single membership authority,
analysis-time label convention, consumer-root matrix, skip-lint boundary, and mechanically enforced
runner-admission procedure. Record measured time and disk evidence where the handbook requires it.

### 5.5. Expected regression scope

Generated runner discovery and exports, Buck target analysis, pass planning, skip-lint selection,
consumer-root and source-mode authority, temp-consumer fixtures, and project-enforcement admission
guardrails.

### 6. Acceptance criteria

- Buck analysis rejects every forbidden mixed label before execution, while the runtime planner
  continues to reject malformed discovered targets.
- Suffix discovery is the sole runner-membership authority or strict generated-export parity fails
  closed; adding a conforming runner requires no second manually maintained registration edit.
- Submodule, remote Nix-store source, and temp-consumer tests each prove the runner scans the intended
  consumer root, and `VERIFY_SKIP_LINT=1` cannot disable the pass.
- Every admitted runner has structural and measured evidence excluding prohibited heavy work and
  satisfying the handbook's execution-time and disk-growth budgets.
- All four migrated scanners reject representative invalid files through their generated runner at
  the project root; focused tests, full validation, and independent scope review pass.

### 7. Risks

Static admission checks may miss indirect heavy operations or reject legitimate shared helpers, and
remote-source fixtures may accidentally exercise a local source path.

### 8. Mitigations

Combine structural checks with bounded runtime evidence, reuse canonical authorities, assert the
actual Nix-store source and consumer roots in fixtures, and keep runtime planner checks as defense in
depth.

### 9. Consequences of not implementing this PR

Membership drift, conflicting pass labels, skip-lint omissions, source-mode root mistakes, or newly
heavy runners could bypass review while the existing happy-path suite remains green.

### 10. Downsides for implementing this PR

The pass gains analysis fixtures and focused source-mode/admission tests that add bounded validation
cost and require updates when the runner contract intentionally changes.

## Rollout And Sequencing

Land PR-1 first and stop at Checkpoint A if registration, freshness, source-mode, timing, or disk
evidence is inconclusive. Land PR-2 only after each scanner independently meets admission criteria.
Do not defer failing coverage or performance work through the debt ledger.

## Verification And Backout Strategy

Each PR runs focused validation, records handbook time/disk evidence, then runs
`i && b && ALL_TESTS=1 v`. Back out by reverting the owning PR's source generator, planner, runners,
tests, and docs together. Generated workspace files may then be regenerated through the normal
bounded freshness path; do not manually preserve or edit emitted targets.
