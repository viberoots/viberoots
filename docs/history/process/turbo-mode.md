# Turbo Mode

Status: historical process note for a completed remote-build PR range. Do not use this as the
default validation policy. Current validation expectations live in `TESTING.md`,
`docs/handbook/testing.md`, and the active PR instructions.

This mode trades a small amount of short-term integration certainty for faster execution through the
PR sequence. It should be used only when the team explicitly accepts that full validation will be
deferred, not skipped.

When turbo mode uses `v` scoped verification, always set the correct viberoots base ref for the
current PR range. `v` selects changed paths from the merge-base diff plus the dirty worktree, and it
uses `GITHUB_BASE_REF` before the default branch candidates. If the range starts from a specific
commit, invoke scoped validation with that commit as the base, for example:

```bash
GITHUB_BASE_REF=<viberoots-base-commit> v
```

Do not reuse a stale base ref from a previous turbo run. A wrong base can make scoped validation
either too narrow to catch regressions or too broad to preserve the intended speedup.

Every time a full-suite run passes and its changes are committed, that resulting commit becomes the
new base ref for subsequent scoped `v` invocations in the same turbo run. This keeps focused
validation scoped to changes made since the last full-confidence checkpoint instead of repeatedly
including already-validated work.

## Goal

Move through PRs quickly while preserving enough evidence per PR to avoid blind commits, then restore full confidence with a hard validation and assessment pass after PR-18.

## Per-PR Requirements

Each PR still needs a focused quality gate before commit:

- Run formatting, linting, or build checks that are directly required by the touched area.
- Run the smallest meaningful `v` selector for changed behavior.
- Rerun any tests that previously failed in the same subsystem.
- Complete scope review before committing.
- Scope review is mandatory for every PR, even when full validation is deferred.
- Do not add fallbacks or broad defensive behavior to hide failures.
- If a focused test fails, investigate the root cause before moving on.

## Reduced Full Validation

Full `i && b && ALL_TESTS=1 v` does not need to run after every PR while turbo mode is active.

Recommended cadence:

- Run focused validation for every PR.
- Run scope review for every PR to confirm the planned feature surface was not accidentally skipped.
- Run full validation at explicit milestones for the current PR range.
- After each passing full-validation milestone is committed, update the scoped `v` base ref to that
  commit.
- Always run full validation after PR-18.

Higher-risk PRs can still require broader validation immediately. Examples include shared build graph behavior, toolchain changes, remote execution policy, dependency resolution, or cross-cutting test infrastructure.

## Current Transition Point

The current full validation for PR-3 should finish and count as the first milestone validation. Turbo mode begins after PR-3 validation passes.

For this PR range, use this cadence:

- PR-3: full validation baseline.
- PRs 4-8: focused validation per PR unless a PR is high risk.
- PR-8 or PR-9: full validation milestone.
- PRs 9-13 or 10-13: focused validation per PR unless a PR is high risk.
- PR-13 or PR-14: full validation milestone.
- PRs 14-18 or 15-18: focused validation per PR unless a PR is high risk.
- PR-18: mandatory final full validation and reconciliation.

Start the integration debt ledger at PR-4, since PRs 1-3 have full validation evidence.

## Risk Tiers

Use the touched files and behavioral surface to decide how much validation is needed.

- Low risk: docs, comments, isolated tests, dormant config. Focused validation is usually enough.
- Medium risk: isolated production code or local tool behavior. Run focused validation plus nearby tests.
- High risk: shared build logic, execution policy, caching, dependency hashing, platform/toolchain behavior, or test harness changes. Run broader targeted validation, and consider full validation before commit.

## Integration Debt Ledger

For each PR where full validation is deferred, record:

- PR number.
- Commit hash once committed.
- Focused validation command and log path.
- Any skipped broader validation.
- Any assumptions or known integration risk.

This ledger must be reviewed before the final PR-18 reconciliation pass.

## Parallel Work

Parallelize only where ownership boundaries are clear:

- While focused validation runs, prepare the next PR if it touches independent files.
- Do not run parallel edits against overlapping modules.
- Do not let a later PR depend on an unresolved failure from an earlier PR.
- Keep commits separate so regressions can be isolated.

## Final PR-18 Reconciliation

After PR-18 lands, turbo mode ends. The final pass must restore full confidence before the range is considered complete:

- Run full `i && b && ALL_TESTS=1 v`.
- Rerun targeted selectors for all high-risk touched subsystems.
- Review the integration debt ledger and close every listed risk.
- Run `assess-plan` against `docs/history/plans/remote-build-plan.md`.
- Run any relevant design assessment if design documents were supplied.
- Investigate failures to root cause; do not mask them with fallbacks.
- Only report the PR range complete after the final validation and assessment gates pass.

## Recommended Default

Use focused validation for every PR, full validation at the baseline, at the next two milestone checkpoints, and mandatory full validation after the final planned remote-build item. This is the preferred balance between speed and safety for the current run.
