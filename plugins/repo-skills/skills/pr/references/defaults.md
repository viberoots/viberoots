# Shared Spec And Plan Defaults Template

This checked-in file is the template for repo-local skill state. The mutable clone-local state lives in `defaults.local.md`, which the helper scripts create automatically from this template when needed.

Run `repo_root="$(git rev-parse --show-toplevel)"; python3 "$repo_root/plugins/repo-skills/skills/pr/scripts/update_default_plan.py" <path>` from anywhere inside the repo to change the clone-local fallback spec or plan document for `$assess-plan`, `$pr`, and `$augment`. When that saved default plan document changes, the script also resets `$pr`'s recorded numeric argument to `0`.

Run `repo_root="$(git rev-parse --show-toplevel)"; python3 "$repo_root/plugins/repo-skills/skills/pr/scripts/resolve_pr_identifier.py" <pr-number>` from anywhere inside the repo to record an explicit clone-local `$pr` numeric argument, or the same command without `<pr-number>` to advance from the last recorded value and print the next default PR identifier.

- `default_plan_document`: `docs/deployment-plan.md`
- `last_pr_numeric_argument`: `unset`
