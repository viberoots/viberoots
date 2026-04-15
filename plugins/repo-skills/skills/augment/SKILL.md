---
name: augment
description: Add one or more new PR sections to an existing specification or plan document to close gaps already identified in the current context. Use when the user asks to extend a spec or plan with PR planning only, wants the new sections appended at the end in numerical and logical order, and does not want implementation to start yet. Trigger on prompts like `$augment`, `$augment docs/spec.md`, or requests to add PR sections for gaps already found.
---

# Augment

Use this plugin skill as the direct entrypoint for the repo plan augmentation workflow.

1. Read [WORKFLOW.md](WORKFLOW.md) and use it as the source of truth for the rest of the task.
2. Read only the references and scripts that `WORKFLOW.md` asks for.
3. Keep persistent state in the repo-local files under this skill directory, not in `~/.codex/skills`.
