# Repo-Skills Token Efficiency

This document defines quality-preserving changes for reducing model-token use in repo-skills
workflows. We reduce the amount of duplicated and low-signal information sent to agents. We do not
reduce implementation scope, validation, independent review, failure investigation, or evidence
retention.

The intended users are maintainers changing `plugins/repo-skills/skills/pr`,
`plugins/repo-skills/skills/prs`, `plugins/repo-skills/skills/test`, and
`plugins/repo-skills/skills/investigate`.

## Quality Invariants

Token-efficiency work must preserve these requirements:

- Each planned PR receives complete implementation, focused validation, required full-suite
  validation, self-review, and an independent scope review.
- Reviewer and tester isolation remains a correctness boundary.
- Full logs remain available as files for diagnosis and audit.
- Failures remain attributable to the current change until evidence proves otherwise.
- Validation evidence is reusable only for the exact source state and command that produced it.
- Agents do not skip a test, weaken an assertion, truncate the only evidence copy, or accept a
  failure merely to save tokens.
- We do not select a less capable model as a token optimization.

## Confirmed Sources Of Waste

The observed high-burn workflow had several information-flow problems:

- Long-lived implementation and investigation agents accumulated large histories that were
  processed again after each tool result.
- Broad process listings and diffs returned thousands of low-signal tokens directly to agents.
- Repeated fixture reruns produced a new reasoning cycle for each harness defect.
- Subagents sometimes received or reconstructed context beyond their bounded role.
- Progress polling caused model turns even when the only new fact was that a process remained
  active.

Verbose test execution itself does not consume model tokens when output is redirected to a file and
the file is not read. Output becomes model input when a tool returns it or an agent opens it.

## Required Workflow Changes

### Keep verbose output file-only

Test, build, lint, formatting, and diagnostic commands must write complete stdout and stderr to a
log file. A successful command reports only:

- command or selector identity;
- source-state digest;
- exit code;
- elapsed time;
- concise pass summaries; and
- full-log path.

A failing command additionally reports a bounded failure index. Do not stream verbose output with
`tee`. A heartbeat may report elapsed time and the current phase, but it must not replay log lines.

### Build a bounded failure index

The tester should extract a small index after failure:

- first failing command or target;
- high-signal error and assertion headings;
- final summarized failure list;
- a short excerpt around the first actionable failure; and
- full-log path.

The investigator starts from this index. It reads targeted ranges or searches from the full log only
when the index is insufficient. It must not open an entire large log by default.

### Isolate agents with task packets

Spawn implementation, tester, reviewer, and assessment agents with `fork_turns="none"` when
supported. Do not copy the parent conversation into their prompts.

Use a task packet containing only the role's required inputs:

| Role         | Required task packet                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Implementer  | repository path, PR identifier, plan path, required design paths, push permission, timing baseline                          |
| Tester       | repository path, exact validation command or selectors, source-state digest, log directory                                  |
| Reviewer     | repository path, PR identifier and plan path, design/guardrail paths, exact diff or commit range, validation evidence paths |
| Investigator | repository path, source-state digest, failing command, bounded failure index, full-log path                                 |
| Assessor     | repository path, plan or design path, completed commit range, validation evidence paths                                     |

If an agent needs more context, provide the smallest missing artifact or fact. Do not respond by
forking or summarizing the full conversation.

### Bound agent lifetime

Use one fresh implementation agent per planned PR. End tester, reviewer, and investigator agents
after their bounded role completes. Do not reuse a long-running implementation thread for the next
PR.

Continue an existing agent only while it retains direct ownership of the same bounded task. When its
history becomes mostly prior failures or unrelated phases, write a concise handoff and start a fresh
agent for the remaining role.

### Limit command output

Prefer these read-only commands:

- `git status --short`;
- `git diff --stat`;
- `git diff --name-only`;
- targeted file diffs or hunks;
- process PID, elapsed time, state, and an abbreviated command; and
- targeted `rg` matches with surrounding context.

Avoid unrestricted full diffs, full process command lines, recursive listings, and full log reads.
Set a small output budget by default. Raise it only for a named artifact whose additional content is
needed for a decision.

### Record source-bound evidence

Each validation result must bind:

- repository and submodule commit or tree identity;
- staged and unstaged state as applicable;
- exact command or selector set;
- command digest;
- exit code and elapsed time;
- concise phase summaries; and
- log paths.

Evidence may be reused only when the relevant source-state and command digests match. Any relevant
code, configuration, generated authority, test, or selector change invalidates the affected result.

A compact ignored JSON or Markdown evidence record may carry this state between agents. It is a
handoff artifact, not a replacement for full logs or committed test coverage.

### Avoid duplicate validation

Before rerunning validation, compare the current source-state and command digests with the recorded
result. Reuse an identical passing result. Rerun the affected validation after any relevant change.

The implementer should not independently rerun a suite that the tester is already running for the
same source state. The reviewer does not run tests. It evaluates scope and the evidence produced by
the isolated tester.

### Bound fixture-debug cycles

Preserve the first failing evidence. After a failure is proven to be in the test harness, inspect the
fixture boundary before rerunning.

After two consecutive fixture-only failures in the same test:

1. stop automatic reruns;
2. list all established fixture defects;
3. inspect the fixture's authoritative setup path;
4. make one consolidated correction; and
5. run one bounded attempt.

If that attempt fails, report the exact blocker and obtain a fresh review of the fixture design
before continuing. This limit applies to speculative reruns, not to the requirement that the final
test pass.

### Make progress reporting event-driven

Report progress when a phase starts, a meaningful checkpoint completes, a failure is classified, or
the task ends. For long-running commands, prefer a low-output process heartbeat over repeatedly
asking an agent to interpret unchanged state.

Status messages should contain only elapsed time, phase, log path, and new high-signal evidence.

## Skill-Specific Changes

### `test`

- Redirect the complete validation command to one timestamped log.
- Return the bounded evidence schema instead of command output.
- Extract a failure index only after a nonzero exit.
- Poll process state without returning full command lines or log tails.
- Mark evidence with source-state and selector digests.

### `investigate`

- Accept the failure index alongside the existing log path.
- Begin with targeted searches around the first actionable failure.
- Preserve the original log and source-state identity.
- Consolidate fixture defects before another rerun.
- Return only root cause, changed paths, targeted rerun evidence, and remaining risk.

### `pr`

- Delegate validation once per source state.
- Keep implementation-agent reports to changed behavior, affected paths, self-review findings,
  validation evidence, and blockers.
- Do not embed verbose test output or repeat plan and design text in progress reports.
- Invalidate recorded validation when the implementation changes.

### `prs`

- Keep every role isolated with a minimal task packet.
- Start a fresh implementer for each PR.
- Pass evidence paths and digests between roles instead of conversation history.
- Keep the separate independent scope review and all required validation gates.
- Do not poll completed or unchanged work through repeated model turns.

## Adoption And Validation

Implement these changes in small, reviewable steps:

1. Add shared task-packet and evidence schemas to the repo-skills workflows.
2. Enforce file-only verbose validation output and bounded failure indexes.
3. Add source-state and command digests for safe evidence reuse.
4. Add output-budget and fixture-rerun rules.
5. Exercise one representative PR flow and compare it with a similar prior completed flow.

The comparison should record model-token usage when the platform exposes it, agent turns, returned
tool-output size, validation count, elapsed time, escaped defects, review findings, and final test
coverage. Do not claim a token reduction until comparable evidence exists.

Adoption passes only when the optimized flow retains the same required tests and independent review,
produces complete full-log artifacts, and reaches an equally supported commit decision. Any loss of
evidence, missed scope, stale-result reuse, or hidden failure is a regression.

## Main-Agent Handoff

When asking an agent to implement this document, use:

```text
Update the repo-skills workflows to implement
docs/handbook/repo-skills-token-efficiency.md. Preserve every quality invariant, independent
review boundary, required validation gate, and full-log artifact. Make the changes in small
coherent steps, add contract coverage for the task-packet, output, evidence-reuse, and fixture
rerun rules, and validate the affected repo-skills workflows. Do not reduce test scope or reviewer
independence as an optimization.
```
