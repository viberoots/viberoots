---
name: pr
description: Implement a numbered PR item from the repository's plan document while supporting both explicit `$pr 4.5.1` invocation and bare `$pr` auto-advance from the last recorded identifier. Use when Codex should start from fresh context, resolve the PR identifier and default plan document from the repo-local defaults, review the standard repo docs and any extra docs explicitly named in the current prompt, implement the plan item, prefer existing utilities, wire tests, self-review, stage changes, run lint and prettier, delegate focused and full-suite validation to the `test` skill, use the `investigate` skill for validation failures, and report passing full-suite results and timing before commit readiness.
---

# PR

Use this plugin skill as the direct entrypoint for the repo PR implementation workflow.

This flat `pr` skill also serves as the canonical repo implementation workflow for planned PRs.

1. Read [WORKFLOW.md](WORKFLOW.md) and use it as the source of truth for the rest of the task.
2. Read only the references and scripts that `WORKFLOW.md` asks for.
3. Keep persistent state in the repo-local files under this skill directory, not in `~/.codex/skills`.
