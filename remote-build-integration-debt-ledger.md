# Remote Build Integration Debt Ledger

Turbo mode defers full validation for selected remote-build PRs. Review this ledger before the
PR-8/9 milestone validation and final PR-18 reconciliation.

| PR | Scope | Focused validation evidence | Full validation status |
| --- | --- | --- | --- |
| PR-5 | Verify Buck argv/artifact wiring | `buck-out/tmp/pr5-r3-explain-selection.log`; `buck-out/tmp/pr5-r3-focused-v.log`; `buck-out/tmp/pr5-r3-focused-label-v.log` | Deferred to PR-8/9 milestone and PR-18 final reconciliation |
| PR-6 | CI buck-test verify delegation/timeout/inventory routing | `buck-out/tmp/codex-test-logs/pr6-gates-inventoryfix-20260528-133049.log`; `buck-out/tmp/codex-test-logs/i-b-v-pr6-focused-inventoryfix-20260528-133104.log` | Deferred to PR-8/9 milestone and PR-18 final reconciliation |
