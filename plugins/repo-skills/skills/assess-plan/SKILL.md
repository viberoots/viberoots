---
name: assess-plan
description: Thoroughly review a target spec or plan document against the current repository implementation, existing test coverage, and repo guardrails while using the shared persisted default document also used by `pr` and `augment`. Use when Codex should assess whether everything described in the shared plan or an explicitly supplied spec file is fully implemented, meaningfully tested, and compliant with methodology requirements, especially in this repo where `build-tools/docs/build-system-design.md` and `METHODOLOGY.XML` are required review context. Trigger on prompts like `$assess-plan` or `$assess-plan docs/spec.md`.
---

# Assess Plan

Use this plugin skill as the direct entrypoint for the repo plan assessment workflow.

1. Read [WORKFLOW.md](WORKFLOW.md) and use it as the source of truth for the rest of the task.
2. Read only the references and scripts that `WORKFLOW.md` asks for.
3. Keep persistent state in the repo-local files under this skill directory, not in `~/.codex/skills`.
