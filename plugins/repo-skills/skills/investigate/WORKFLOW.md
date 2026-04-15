---
name: investigate
description: Investigate and fix test failures from a saved log while preserving the current thread context and recent change history. Use when a manual or targeted test run has already failed, the user provides a log path, and Codex should continue from the existing conversation rather than restarting from fresh context. Especially useful as a companion to `pr` after `i && b && v ...` or another validation step fails and the next job is to find the root cause, fix the primary path, rerun the failing tests individually or as a meaningful set, and avoid fallbacks that could hide bugs. If the invocation ends with `timing` or `time`, treat it as execution-time-regression mode and use the performance guardrails in `docs/handbook/getting-started-on-a-pr.md`.
---

# Investigate

## Overview

Use this skill to continue the current debugging thread after a test run fails and the user has a saved log.

Keep the existing thread context. Treat recent edits, prior validation attempts, earlier docs, and known repo conventions from this conversation as relevant unless the user explicitly resets the task.

Treat `$investigate path/to/log-file` as the normal invocation shape.

Treat `$investigate path/to/log-file timing` and `$investigate path/to/log-file time` as execution-time-regression mode.

## Inputs

Require:

- Path to the saved failure log

Accept when available:

- Known failing test selectors or file paths
- The command that produced the log
- Notes about what changed immediately before the failure
- Optional trailing mode token: `timing` or `time`

Proceed without routine clarification when the log and thread context are enough to start.

## Preserve Context

Do not treat this as a fresh start.

If the current thread already established repo-specific commands, guardrails, plan docs, or validation expectations, keep using them. This skill is the companion to [../pr/SKILL.md](../pr/SKILL.md) when manual investigation is needed after a failure, but it can also be used outside that workflow.

Use the existing thread context to narrow the likely blast radius before expanding the search. Rebuild missing facts from the repo and the log, not from assumptions.

## Read The Log First

Open the supplied log path before making changes.

Identify:

- The exact failing command or target
- The earliest meaningful error, assertion, or stack trace
- Whether later failures are likely cascades
- Any concrete test selector or file path that lets you rerun a minimal repro

If the log is noisy, focus on the first actionable failure and the final summarized failure list. Prefer evidence from the log over speculation.

If the invocation includes `timing` or `time`, also identify any timing summaries, timeout signals, or per-target duration clues that indicate an execution-time regression.

## Timing Mode

If the invocation ends with `timing` or `time`, treat the run as both a failing validation and an execution-time regression until the evidence proves otherwise.

Before changing code, read the `Performance guardrails for new PRs` section in `docs/handbook/getting-started-on-a-pr.md` and use it as investigation input.

Use that section for ideas on isolating the dominant cost, collecting timing evidence, and choosing fixes that remove the slowdown in the primary path rather than masking it.

If the actual regression pattern or fix falls outside the current guardrails, augment that `Performance guardrails for new PRs` section with a concise new bullet or correction before handoff so the handbook captures the newly-learned failure mode.

## Reproduce Narrowly

Reproduce the failure with the smallest meaningful command:

- One failing test when possible
- The smallest failing set when tests interact
- The underlying helper or generated artifact directly when that is faster and more reliable than rerunning a broad suite

Treat the failure as caused by the current change set until there is direct evidence otherwise.

In timing mode, prefer focused repros that preserve the performance signal. Use structured timing or like-for-like timing evidence when available, and avoid profiling setups that obviously distort the result.

## Fix The Root Cause

Investigate the primary path and fix the real defect or defects.

Do not add fallbacks, alternate branches, retries, cache-bypass behavior, or defensive behavior that only masks bugs in the main path unless the user explicitly asks for that tradeoff.

Prefer:

- Removing bad assumptions
- Correcting shared helpers or wiring
- Making the main execution path robust
- Keeping changes minimal, readable, and easy to validate

## Validate Before Handoff

After each code change:

1. Rerun the relevant repo guardrails already established in the current thread, such as lint, formatting, or file-size checks, when applicable.
2. Rerun the latest failing test individually or the latest meaningful failing set.
3. Keep iterating until the reproduced failure passes or you are genuinely blocked.

If the log shows multiple failing tests, keep going until each still-relevant failing test passes individually or the smallest meaningful failing set passes together.

In timing mode, also verify that the targeted rerun no longer shows the execution-time regression you investigated, using the best focused timing evidence available for that path.

Do not tell the user to start another broad or full-suite run until that current failing surface now passes.

## Report Back

When the targeted rerun passes, report:

- What the root cause was
- What changed
- Which focused command or selector now passes
- In timing mode, what timing evidence improved and whether the handbook section was updated

If you are blocked, report the current blocker, the evidence collected, and the next highest-confidence step.

## Prompt Shape

Use the short form:

```text
$investigate build/test-failure.log
```

Use timing mode for execution-time regressions:

```text
$investigate build/test-failure.log timing
```

```text
$investigate build/test-failure.log time
```

If needed, accept extra surrounding text, but keep the skill invocation itself to the log path plus the optional trailing timing token:

```text
$investigate /tmp/v.log
```
