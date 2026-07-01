---
name: design-plan
description: Translate an explicitly supplied design document into a repository implementation plan that follows viberoots PR-section conventions. Use when the agent should create or update a plan from a design, preserve repo guardrails, avoid documentation-only or test-only PRs, and make each PR responsible for implementing, testing, and documenting its own scope. Trigger on prompts like `$design-plan docs/design.md docs/plan.md` or requests to turn a design doc into a plan.
---

# Design Plan

Use this plugin skill as the direct entrypoint for translating a design document into a repository
implementation plan.

1. Read [WORKFLOW.md](WORKFLOW.md) and use it as the source of truth for the rest of the task.
2. Read only the references and target documents that `WORKFLOW.md` asks for.
3. Plan only. Do not start implementation.
