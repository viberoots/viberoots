---
name: assess-design
description: Thoroughly review a target design document against the current repository implementation, existing test coverage, and repo guardrails while using an `assess-design`-specific persisted default that does not affect or inherit the shared `pr` and `augment` default. Use when the agent should assess whether everything described in a design spec file is fully implemented, meaningfully tested, and compliant with methodology requirements, especially in this repo where `build-tools/docs/build-system-design.md` and `AGENTS.md` are required review context. Trigger on prompts like `$assess-design` or `$assess-design docs/design.md`.
---

# Assess Design

Use this plugin skill as the direct entrypoint for the repo design assessment workflow.

1. Read [WORKFLOW.md](WORKFLOW.md) and use it as the source of truth for the rest of the task.
2. Read only the references and scripts that `WORKFLOW.md` asks for.
3. Keep persistent state in the repo-local files under this skill directory, not in user-global plugin or skill caches.
