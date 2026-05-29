# Remote Build Integration Debt Ledger

Turbo mode defers full validation for selected remote-build PRs. PR-7 ran an unplanned full
validation milestone, so the next full validation checkpoint moves to the PR-13/14 window unless an
earlier PR proves high risk enough to require one. Review this ledger before that milestone and the
final PR-18 reconciliation.

| PR | Scope | Focused validation evidence | Full validation status |
| --- | --- | --- | --- |
| PR-5 | Verify Buck argv/artifact wiring | `buck-out/tmp/pr5-r3-explain-selection.log`; `buck-out/tmp/pr5-r3-focused-v.log`; `buck-out/tmp/pr5-r3-focused-label-v.log` | Covered by PR-7 full validation; keep for PR-18 final reconciliation context |
| PR-6 | CI buck-test verify delegation/timeout/inventory routing | `buck-out/tmp/codex-test-logs/pr6-gates-inventoryfix-20260528-133049.log`; `buck-out/tmp/codex-test-logs/i-b-v-pr6-focused-inventoryfix-20260528-133104.log` | Covered by PR-7 full validation; keep for PR-18 final reconciliation context |
| PR-8 | Repo-owned wrapper executor propagation | `buck-out/tmp/codex-test-logs/pr8-wrapper-executor-propagation-scopefix.log`; `buck-out/tmp/codex-test-logs/pr8-v-wrapper-executor-propagation-scopefix.log` | Deferred because PR-7 full validation passed after PR-7; carry to PR-13/14 milestone and PR-18 final reconciliation |
| PR-9 | Remote-safe verify test environment handling | `buck-out/tmp/codex-test-logs/pr9-reviewfix2-direct-remote-env.log`; `buck-out/tmp/codex-test-logs/pr9-reviewfix2-direct-spawn-snapshot.log`; `buck-out/tmp/codex-test-logs/pr9-reviewfix2-direct-local-env.log`; `buck-out/tmp/codex-test-logs/pr9-reviewfix2-v-labels.log`; `buck-out/tmp/codex-test-logs/pr9-reviewfix2-v-filepaths.log`; `buck-out/tmp/codex-test-logs/pr9-reviewfix2-v-nearby-remote-policy.log` | Deferred because PR-7 full validation passed after PR-7 and PR-9 scope review passed; carry to PR-13/14 milestone and PR-18 final reconciliation |
