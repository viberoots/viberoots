# Project Enforcement Pass Design

This document proposes a dedicated verify pass for cheap policy tests that inspect consumer-owned
`projects/`. It starts in verify's first wave and runs whenever the change set touches `projects/`.

## Problem

The current `verify:enforcement` label does not distinguish tests that enforce viberoots source
from tests that enforce consumer projects. Several reach `projects/` directly or indirectly.

This creates three problems:

- A project-only scoped verify can omit a viberoots-owned enforcement target even though that target
  is responsible for checking the changed project files.
- The status view does not show project policy checks as a distinct group.
- Ordinary tests under `build-tools/tools/tests/` are prohibited from depending on live
  `projects/` contents, so project policy needs a consumer-scoped execution boundary rather than an
  exception hidden inside a viberoots unit test.

Tests that build targets, create temp repos, invoke Nix, or exercise deployment flows remain in
their existing lanes. The new pass is only for bounded policy enforcement.

## Goals

- Add a `project-enforcement` pass with its own progress and status row.
- Start project enforcement in the first execution wave, like existing enforcement.
- Include all project-enforcement targets whenever the effective change set touches `projects/`.
- Preserve focused verify behavior while preventing a project-only change from bypassing policy.
- Make consumer-root resolution and fresh execution explicit, tested contracts.
- Preserve the rule that ordinary build-system tests use fixtures or temp consumers instead of the
  live project tree.
- Keep the pass fast, read-only, deterministic, and bounded in disk use.
- Split mixed scanners without weakening enforcement for viberoots-only changes.

## Non-Goals

- Do not move all project tests into the first wave.
- Do not turn build, deployment, scaffold, dev-server, Nix, or temp-repo integration tests into
  enforcement tests.
- Do not replace existing verify preflights or the ordinary enforcement pass.
- Do not broaden source snapshots, artifact routing, development-shell closures, or cache policy.
- Do not make direct `buck2 test` infer a Git change set. The automatic inclusion guarantee belongs
  to `v` and CI entry points that use the verify planner.

## Classification Contract

The new Buck label is `verify:project-enforcement`.

The corresponding filename suffix is `*.project-enforcement.test.ts`.

Reusable runner sources use that suffix but are not ordinary viberoots test targets. The prebuild
generator emits labeled consumer-scoped targets into `workspace_buck`, keeping them available in
submodule, flake, and remote-source modes without checked-in targets in each consumer project.

A convention check fails when:

- the suffix is present without the label;
- the label is present without the suffix; or
- the target also has `verify:enforcement`, `verify:isolated`,
  `verify:isolated-bounded`, `verify:resource-limited`, or `verify:manual`.

Rejecting conflicting labels keeps pass precedence out of individual test authors' hands.

A generated project-enforcement target must satisfy all of these conditions:

- It enforces a repository policy against files or metadata under `projects/`.
- It is read-only and deterministic for a fixed consumer tree.
- It does not use the network, realize Nix outputs, start services, or create broad temp repos.
- It uses the project-enforcement execution policy that prevents stale Buck test results.
- Its runner resolves the consumer workspace through existing workspace-root authority and fails
  closed when that root cannot be established.
- It stays within the focused execution-time and disk-growth budgets below.

Tests that only verify that `v`, CI, or a preflight invokes an underlying scanner remain ordinary
enforcement tests. The project-enforcement target is the test that actually applies the policy to
the consumer project tree.

## Selection

The verify planner uses the existing changed-path authority rather than introducing another Git
diff implementation. That authority unions merge-base changes with the dirty worktree and includes
both sides of renames.

Project enforcement is required when any normalized changed path is exactly `projects` or begins
with `projects/`. This includes committed, staged, unstaged, untracked, renamed, and deleted project
paths represented by the changed-path authority.

The planner also requires project enforcement when an explicit verify selector addresses
`//projects/...` or a target below `//projects/`. This covers a clean worktree where the developer
asks to verify project scope directly.

When project enforcement is required, the planner queries the generated `workspace_buck` package
for every test target labeled `verify:project-enforcement` and unions those targets into the
requested target set before pass planning. It must not rely on ordinary project scope or local
viberoots-cell discovery. The generated targets come from suffix discovery of reusable runner
sources, not a second hard-coded target registry.

Before that query, `v` performs a bounded freshness check for this generated registration. It may
repair ignored workspace metadata, but it must not invoke Nix or broaden normal prebuild work.

The planner deduplicates targets that were already selected. `ALL_TESTS=1 v` explicitly injects
the generated targets because ordinary broad `//...` selection excludes infrastructure cells.

If changed-path discovery fails or cannot establish whether `projects/` changed, the planner fails
closed by including project enforcement and reports why it broadened the selection. Missing change
authority must not silently omit policy checks.

`VERIFY_SKIP_LINT=1` does not disable project enforcement. It remains part of test pass planning,
not an optional lint preflight.

## Scheduling And Status

`project-enforcement` is a serial sidecar pass, like `enforcement`. The first execution group may
contain `isolated | enforcement | project-enforcement`.

The sidecars may run concurrently with each other and with the first isolated lane. If no isolated
lane exists, current scheduling places sidecars in the earliest concurrent group with the other
selected passes. This design preserves that behavior; it does not add a finish-before-all barrier.

The verify progress model exposes `test project-enforcement [progress bar] passed / total` without
special presentation logic.

The `s` pass-group view uses the same row without the `test ` prefix, consistent with its existing
summary format.

## Consumer Root And Input Correctness

Project-enforcement runners are defined by viberoots but registered in the generated consumer
workspace cell. They must not assume that `process.cwd()` is always the consumer root, and they
must not fall back to a raw viberoots source directory when consumer-root resolution fails.

We will extend the existing workspace-root authority with one project-scan context containing:

- the verified consumer workspace root;
- the normalized `projects/` root below it; and
- the execution evidence used to prevent stale test results.

The context must work in submodule, flake/remote-source, and temp-consumer layouts. An absent or
ambiguous consumer root is an actionable failure.

The current `zx_test` rule can execute from the project root, but a live filesystem read is not a
declared Buck input. Broadly snapshotting `projects/` to solve that mismatch would violate the
source-boundary and disk-growth guardrails. The project-enforcement pass therefore runs locally and
with remote cache reads and writes disabled. Remote verify keeps this one live-worktree pass local;
other passes retain their selected execution policy.

This policy must apply only to `project-enforcement`. The implementation must use the pinned Buck
interface rather than an undocumented cache-busting environment variable or a changing isolation
name, both of which could create unbounded cache or disk growth.

No implementation is accepted based only on reading the current working tree successfully. A
focused regression must run a target once, edit a relevant project file, rerun without cleaning
Buck state, and prove that the target executes again and observes the violation.

## Initial Test Migration

The first implementation should migrate only confirmed cheap project policy checks.

Good initial candidates are:

- the project scope of the canonical stale-names lint, including completed-plan `PR-N` naming;
- the project portion of forbidden process-inspection command checks;
- stale deployment environment branch checks under `projects/deployments`;
- the strict project source-file size check; and
- the project deployment-metadata secret guard.

The existing `no-stale-viberoots-names` test does not enforce completed-plan `PR-N` naming; that
rule lives in `stale-names-lint.ts`. Migration must use the canonical production scanner rather
than copy patterns from the narrower test.

Existing lint preflights remain fail-fast callers; the new targets share scanner logic with them
rather than duplicate policy patterns.

Repo-wide scanners should be split around shared pure scanner logic. Ordinary viberoots tests keep
fixture coverage, while generated project-enforcement targets invoke the same logic against the
verified consumer project root. The existing
[`build-system-tests.no-live-project-repo-deps`](../tools/tests/linting/build-system-tests.no-live-project-repo-deps.enforcement.test.ts)
rule remains in force and rejects live project access outside the generated runner boundary.

Mixed test files should move only their project policy assertion. For example, the project secret
guard should be extracted from a broader deployment guardrail file while unrelated assertions stay
in their existing lane.

The phase-zero deployment contract and similar tests require measurement before admission. A test
that runs Buck queries or broader repository resolution stays in its normal pass if it exceeds the
budget or has integration semantics. `dogfood-current-layout` and other project build/integration
tests explicitly remain outside project enforcement.

Starlark-wide policies that would inspect project `.bzl` files are not migrated merely because
their glob could reach `projects/` in the future. When projects gain those files, we should add a
project-scoped enforcement target with explicit `TARGETS` and `.bzl` coverage rather than relying
on an incidental repo-wide glob.

## CI Contract

CI uses the same generated target discovery, project-path predicate, and changed-path authority as
local `v`. It must not maintain a second list of project enforcement targets. Full-suite CI always
includes the pass, including non-local source modes where nested viberoots tests are intentionally
absent from ordinary `ALL_TESTS=1` discovery. Scoped CI includes it whenever project changes are
present.

The CI contract records whether the pass was selected because of a project change, an explicit
project selector, a broad/full run, or conservative handling of unavailable change authority.

## Performance And Disk Budgets

Admission is evidence-based. On a warm development shell, each test should complete within 30
seconds and the complete project-enforcement pass should complete within 60 seconds. A test that
cannot meet the individual budget belongs in another pass even if it enforces a useful policy.

The pass must not realize Nix store outputs, create temp consumer copies, populate dependency
caches, or start nested Buck daemons. Expected disk growth is limited to ordinary verify logs and
bounded Buck test metadata. Validation records before/after sizes for `.viberoots/workspace`,
`buck-out`, relevant temp roots, and new Nix store paths using the
[PR guardrail procedure](../../docs/handbook/getting-started-on-a-pr.md).

Unexpected time or disk growth blocks migration of the responsible target. We investigate the
first concrete target rather than increasing the budget or adding cleanup that hides the growth.

## Validation

Focused tests must prove:

- suffix-to-label assignment and rejection of suffix, label, or pass conflicts;
- project changes inject all project-enforcement targets into an otherwise focused verify;
- staged, unstaged, untracked, renamed, and deleted project paths trigger inclusion;
- unrelated changes do not inject the pass;
- explicit project selectors trigger inclusion in a clean tree;
- unavailable change authority conservatively includes the pass;
- injected and normally selected targets are deduplicated;
- the pass joins the earliest execution group without adding a new scheduling barrier;
- ordinary build-system tests still reject live `projects/` dependencies;
- project enforcement stays local and disables remote cache use without changing other passes;
- progress and `s` output show a distinct project-enforcement row;
- a second run after a project edit cannot reuse a stale passing result;
- consumer-root resolution works for supported source modes and temp consumers; and
- focused execution-time and disk-growth evidence stays within the stated budgets.

## Rollout

1. Add generated `workspace_buck` target registration, the label, pass partition, first-wave
   scheduling, status coverage, and changed-project selection tests.
2. Extend the existing workspace-root authority with the project-scan context and prove fresh local
   execution before migrating any scanner.
3. Split and migrate the initial cheap policy checks, measuring each target before admission.
4. Wire CI to the shared selection authority and record focused time and disk evidence.

Each step keeps ordinary enforcement intact until its project-scoped replacement has focused
coverage. We do not broaden validation or migrate heavier tests merely to increase the new pass's
membership.
