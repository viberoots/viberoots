---
name: investigate
description: Investigate and fix test failures from a saved log while preserving the current thread context and recent change history. Use when a manual or targeted test run has already failed, the user provides a log path, and the agent should continue from the existing conversation rather than restarting from fresh context. Especially useful as a companion to `pr` after `i && b && v ...` or another validation step fails and the next job is to find the root cause, fix the primary path, rerun the failing tests individually or as a meaningful set, and avoid fallbacks that could hide bugs. If the invocation ends with `timing` or `time`, treat it as execution-time-regression mode and use the performance guardrails in `docs/handbook/getting-started-on-a-pr.md`.
---

# Investigate

Use this plugin skill as the direct entrypoint for investigation after a failed validation run.

1. Read [WORKFLOW.md](WORKFLOW.md) and use it as the source of truth for the rest of the task.
2. Read only the references and scripts that `WORKFLOW.md` asks for.
3. Keep any repo-specific context or state in the current clone, not in user-global plugin or skill caches.
