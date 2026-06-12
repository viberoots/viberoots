# Assess Design Defaults Template

This checked-in file is the template for repo-local skill state. The mutable clone-local state lives in `defaults.local.md`, which the helper script creates automatically from this template when needed.

Run `repo_root="$(git rev-parse --show-toplevel)"; python3 "$repo_root/plugins/repo-skills/skills/assess-design/scripts/update_default_design.py" <path>` from anywhere inside the repo to change the clone-local fallback design document for `$assess-design` without affecting `$assess-plan`, `$pr`, or `$augment`.

- `default_design_document`: `docs/history/plans/deployment-plan.md`
