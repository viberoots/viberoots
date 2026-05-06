---
name: test
description: Run this repository's validation flow in a delegated tester subagent, optionally with a verify test selector. Use when the user invokes `$test` or asks the agent to validate current repo changes with `i && b && v`, or `i && b && v` followed by a specific `v` selector, while capturing verbose output to logs and reporting concise progress, failures, and summaries. Report elapsed timing for each validation run.
---

# Test

Use this plugin skill as the direct entrypoint for delegated repo validation.

1. Read [WORKFLOW.md](WORKFLOW.md) and use it as the source of truth for the rest of the task.
2. Spawn a tester subagent and keep verbose validation output in repo-local log files.
3. Keep persistent state out of user-global plugin or skill caches; this repo-local plugin skill is the shared source.
