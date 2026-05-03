---
name: prs
description: Work through a numeric range of planned PRs from the shared plan document in sequence. Use when the user invokes `$prs <range> [plan-document]`, such as `$prs 1-10 docs/external-deployments-plan.md` or `$prs 11-15`, and wants each PR implemented by a dedicated subagent using the `pr` skill, committed through the `cc` skill only after self-review, full-suite validation, full-suite timing-regression checks, and a separate scope-review subagent pass, then notified via ntfy with PR summary evidence, assessed with `assess-plan` and known `assess-design`, augmented with follow-up PRs when gaps remain, and never pushed unless explicitly requested.
---

# PRs

## Overview

Use this skill to execute a consecutive range of planned PRs from a plan document, one PR at a time.

For each PR number in the range, spawn a fresh implementation subagent and instruct it to run the `pr` skill for exactly that PR number and plan document. Before the time-consuming full-suite run, spawn a separate reviewer subagent to compare the implementation against the PR's plan-document scope. Advance to full-suite validation only after focused validation and scope review pass. Advance to the next PR only after the current PR reports that all self-reviews, focused validation, the pre-full-suite scope review, full-suite validation, the full-suite timing-regression check, and the commit succeeded. After the current range completes, assess the plan and any known design document; if gaps remain, augment the plan with follow-up PRs, extend the range, update progress, and keep working.

Never push to a remote unless the original user prompt explicitly asks for a push. Do not infer push permission from a request to process a PR range.

## Prompt Shape

Use the skill with a required numeric PR identifier or inclusive numeric range, plus an optional plan document path:

```text
$prs 1-10 docs/external-deployments-plan.md
```

```text
$prs 11-15
```

```text
$prs 4.5.1-4.5.3 docs/build-plan.md
```

Accept a single PR number as a one-item range:

```text
$prs 7 docs/deployment-plan.md
```

## Resolve Inputs

Require:

- A PR number or inclusive range.

Default:

- Plan document path: read `default_plan_document` from `../pr/references/defaults.local.md` when present, otherwise [../pr/references/defaults.md](../pr/references/defaults.md).

Accept when provided:

- Explicit plan document path.
- Explicit design document path for end-of-range `$assess-design`.
- Explicit permission to push after each successful commit or after the whole range.
- Explicit alternate ntfy endpoint for completion notifications. Default: `https://ntfy.home.kilty.io/codex`.

If the prompt explicitly provides a plan document path, persist it as the new shared clone-local default before continuing by running from anywhere inside the repo:

```bash
repo_root="$(git rev-parse --show-toplevel)"
python3 "$repo_root/plugins/repo-skills/skills/pr/scripts/update_default_plan.py" docs/another-plan.md
```

After updating the shared default, use that explicit path for the current range and treat it as the default for future `$pr`, `$prs`, `$augment`, and `$assess-plan` invocations.

If the prompt explicitly provides a design document path, persist it as the new `assess-design` default before continuing by running from anywhere inside the repo:

```bash
repo_root="$(git rev-parse --show-toplevel)"
python3 "$repo_root/plugins/repo-skills/skills/assess-design/scripts/update_default_design.py" docs/another-design.md
```

Use the explicit design path for this `$prs` run and treat it as the default for future `$assess-design` invocations only.

## Parse The Range

Interpret ranges as inclusive and ordered from the start number to the end number.

Support plain integer ranges such as `1-10`.

Support dotted numeric ranges when the prefix is identical and the final component increases, such as `4.5.1-4.5.3`, which expands to `4.5.1`, `4.5.2`, and `4.5.3`.

If the range is descending, has incompatible dotted prefixes, contains non-numeric components, or is otherwise ambiguous, ask for a corrected range before spawning any subagents.

Do not skip numbers in the requested range unless the user explicitly updates the range.

## Preflight

Before spawning the first PR subagent:

1. Read the target plan document enough to confirm each requested PR number appears to exist.
2. Run `git status --short`.
3. If the worktree contains uncommitted changes that are not clearly part of an already-in-progress PR range, stop and ask the user whether to continue. A range runner commits after each PR, so pre-existing unrelated changes can accidentally be swept into the first commit.
4. Confirm the `pr`, `test`, `investigate`, `cc`, `assess-plan`, `assess-design`, and `augment` skills are available in the plugin skill list or present under `plugins/repo-skills/skills/`.
5. Read `references/full-suite-timing.local.md` when present, otherwise [references/full-suite-timing.md](references/full-suite-timing.md), to find the most recent successful full-suite execution time. If the local file is absent, create it from the checked-in template before recording a new successful time.
6. Determine whether a design document is known by checking an explicit prompt path first, then `../assess-design/references/defaults.local.md` when present, otherwise [../assess-design/references/defaults.md](../assess-design/references/defaults.md). Treat a non-empty `default_design_document` as known only when that path exists in the repository. If no design document is known, skip `$assess-design` and say it was skipped because no design document was known.

## Full-Suite Timing Memory

Keep mutable full-suite timing memory in `references/full-suite-timing.local.md`.

Use [references/full-suite-timing.md](references/full-suite-timing.md) only as the checked-in template and convention. Do not update the checked-in template during normal `$prs` runs.

Compare each PR's successful full-suite total execution time against the most recent recorded successful full-suite execution time before authorizing the PR commit.

Treat a full-suite timing increase as significant when it is both at least 25% slower and at least 120 seconds slower than the most recent recorded successful run. If repository docs or the user's prompt define a stricter threshold, use the stricter threshold.

If there is no prior successful full-suite timing recorded, do not block the first PR on timing. After the PR commits, record its successful full-suite execution time as the new baseline.

If the full-suite timing jump is significant, treat it as a bug in the current PR. Do not authorize a commit. Use the `investigate` skill in timing-regression mode with the successful full-suite log path and the prior timing baseline, using an invocation shaped like `$investigate <full-suite-log-path> timing`. Fix the regression, rerun the smallest meaningful affected set through the `test` skill when possible, then rerun the full suite through the `test` skill. Iterate until the full-suite run passes and its total execution time is no longer a significant jump, or until genuinely blocked.

After a PR commit succeeds, update `references/full-suite-timing.local.md` with the successful full-suite execution time that authorized the commit, plus the PR number, commit hash, full-suite log path, and date.

## Per-PR Execution

For each PR number, in order:

1. Spawn one fresh subagent.
2. Tell the subagent it is not alone in the codebase, must preserve user changes, and must not revert unrelated work.
3. Tell the subagent to use the `pr` skill for the exact PR number and plan document in pre-full-suite review mode.
4. Give the subagent the current full-suite timing baseline from `references/full-suite-timing.local.md` when present, otherwise [references/full-suite-timing.md](references/full-suite-timing.md).
5. Explicitly ask the subagent to stop before full-suite validation and report ready-for-review evidence after self-review and focused validation pass.
6. Explicitly tell the subagent not to run full-suite validation until `$prs` says the scope review passed.
7. Tell the subagent not to push to any remote unless the original `$prs` prompt explicitly allowed pushing.
8. Spawn a separate reviewer subagent to review the implementation against the PR description in the plan document.
9. If the reviewer finds incomplete scope, send the findings back to the implementation subagent and tell it to finish the missing work, rerun self-review and focused validation, and report ready-for-review evidence again.
10. Repeat implementation, validation, and review until the reviewer passes or the PR is genuinely blocked.
11. After the reviewer passes, tell the implementation subagent to run full-suite validation through the `test` skill, check full-suite timing against the current baseline, run any required investigation loop, and report full-suite evidence.
12. After full-suite validation and timing checks pass, tell the implementation subagent to use the `cc` skill to create the conventional commit for this PR and report commit evidence.
13. Wait for that subagent to finish before starting the next PR.

While implementation subagents are waiting on focused or full-suite validation, wait quietly. Do not ask them for periodic status updates and do not relay "still running" messages to the user. Conserve tokens and report only when a validation run completes, fails, needs action, or produces evidence needed for PR advancement.

Use a subagent prompt shaped like this, adjusted only for the repo path, PR number, plan document, and push permission:

```text
You are implementing one PR in a sequential `$prs` run for /absolute/path/to/repo.

You are not alone in the codebase. Preserve user changes, do not revert unrelated work, and work only on PR <pr-number> from <plan-document>.

Use the `pr` skill for PR <pr-number> from <plan-document> in pre-full-suite review mode.

Stay quiet while tests or full-suite validation are running. Do not send periodic status updates, progress pings, or "still running" messages. Report only when validation completes, fails, needs action, or produces evidence needed for review, timing, or commit authorization.

Because this is a `$prs` run, stop before the time-consuming full-suite validation. After self-review and focused validation pass, report ready-for-review evidence and wait for `$prs` to run a separate scope-review subagent.

Do not run full-suite validation until `$prs` tells you the scope review passed.

If the reviewer reports missing scope, finish the missing work, rerun self-review and focused validation, and report ready-for-review evidence again.

After `$prs` tells you the scope review passed, run full-suite validation through the `test` skill. When full-suite validation passes, compare the successful full-suite total execution time against this baseline:

- Previous successful full-suite execution time: <baseline-or-unset>
- Significant timing jump threshold: at least 25% slower and at least 120 seconds slower, unless repo docs or the user gave a stricter threshold.

If the timing jump is significant, treat it as a bug. Do not commit. Use the `investigate` skill in timing-regression mode with an invocation shaped like `$investigate <full-suite-log-path> timing`, include the prior baseline in the investigation context, fix the regression, rerun affected tests through the `test` skill, rerun the full suite through the `test` skill, and repeat until the full suite passes without a significant timing jump.

Only after the pre-full-suite scope review passed and full-suite validation plus timing checks pass, use the `cc` skill to create the conventional commit representing exactly this PR's changes. Do not commit by running raw `git commit` yourself unless the `cc` skill is unavailable and the user explicitly authorizes a fallback.

Do not push to any remote.

When finished, report:
- PR number and commit hash
- commit subject
- confirmation that the commit was created through the `cc` skill
- focused validation selectors and log paths
- successful full-suite validation log path
- total test execution time for the successful full-suite run that authorized the commit
- previous successful full-suite execution time used as the baseline, or `unset`
- whether the timing-regression check passed, and any timing-regression investigation summary
- scope-review result and any follow-up work done for review findings
- concise pass summary
- whether anything unexpected was included in the commit
```

If the original user prompt explicitly allowed pushing, replace `Do not push to any remote.` with the exact push scope the user allowed.

## Pre-Full-Suite Scope Review

Before authorizing full-suite validation for each PR, spawn one fresh reviewer subagent.

The reviewer subagent must:

- Read the target PR section in the plan document.
- Inspect the implementation diff and any relevant files.
- Compare the implemented behavior, tests, docs, and wiring against the full scope described for that PR.
- Assume focused validation is already passing. Do not run tests or validation commands.
- Do not modify files.
- Report either `Scope review passed` or a concise list of missing/incomplete PR requirements with file or behavior references.

Use a reviewer prompt shaped like this:

```text
You are the scope reviewer for PR <pr-number> from <plan-document> in /absolute/path/to/repo.

Read the PR <pr-number> section in <plan-document>. Then inspect the current implementation diff and relevant files.

Review only whether the implementation fully covers the PR description from the plan document, including behavior, tests, docs, and wiring that the PR requires.

Assume self-review and focused validation are already passing. Do not run tests, builds, formatters, full-suite validation, or validation commands. Do not modify files.

Report one of:
- `Scope review passed`, with a concise explanation.
- `Scope review failed`, with the missing or incomplete requirements and the concrete evidence behind each finding.
```

If the scope review fails, do not authorize full-suite validation or a commit. Send the findings to the implementation subagent and tell it to complete the missing PR scope. After any implementation change, require the implementation subagent to rerun self-review and focused validation before another scope review. Full-suite validation stays deferred until the scope review passes.

## Advancement Rules

Advance to the next PR only when the current PR subagent reports all of these:

- Self-review passed.
- Focused validation passed through the `test` skill.
- A separate scope-review subagent passed the implementation against the PR description in the plan document before full-suite validation ran.
- Full-suite validation passed through the `test` skill.
- Full-suite execution time did not significantly regress compared with the most recent recorded successful run, or no previous successful timing was recorded.
- Any validation failures were investigated and fixed.
- A conventional commit was created successfully through the `cc` skill.
- No push occurred unless explicitly allowed.

If any item is missing, inspect the subagent's report or ask it for the missing evidence before continuing.

If the subagent reports a blocker, failed validation, failed commit, unexpected dirty worktree state, or a possible unrelated change, stop the range and report the blocker. Do not start the next PR.

After a PR completes successfully, update `references/full-suite-timing.local.md` with the successful full-suite execution time that authorized the commit before spawning the next PR. Use that new time as the baseline for the next PR.

## Notifications

After each PR completes successfully and its commit evidence has been recorded, send a notification to the ntfy endpoint.

Default endpoint:

```text
https://ntfy.home.kilty.io/codex
```

If the user explicitly provides a different ntfy endpoint in the `$prs` prompt, use that endpoint for the current run.

Use `curl` with a POST body that includes the concise PR summary evidence:

- PR number
- commit hash and subject
- confirmation that `cc` created the commit
- focused validation selectors and log paths
- successful full-suite validation log path
- total test execution time for the successful full-suite run that authorized the commit
- timing-regression result and baseline
- scope-review result
- any investigation or follow-up work summary

Use a notification command shaped like this:

```bash
curl -fsS -X POST "$ntfy_endpoint" \
  -H "Title: PR <pr-number> complete" \
  -H "Priority: default" \
  -d "$summary"
```

If notification delivery fails, report the notification failure in the chat summary, but do not mark the PR implementation or commit as failed solely because ntfy is unavailable. Continue the range unless the user explicitly says notifications are required as a hard gate.

## End-Of-Range Assessment And Augmentation

After the current requested or extended range completes successfully, run assessment before declaring the `$prs` run complete:

1. Spawn a subagent to use `$assess-plan <plan-document>` against the shared plan document.
2. If a design document is known, spawn a subagent to use `$assess-design <design-document>`. If no design document is known, skip this step and report that it was skipped.
3. The assessment subagents must not run tests. They should follow their skills' workflows and assume the validation suite is already passing.
4. If neither assessment reports findings that require additional implementation, declare the range complete.
5. If either assessment reports findings that require additional implementation, use the `augment` skill to append new PR sections to the plan document for those findings.
6. After `augment` updates the plan document, inspect the newly added PR section numbers.
7. Extend the active `$prs` range to include the new PR numbers in numerical order.
8. Update the progress bar denominator and range label to include the extended range.
9. Continue the normal per-PR execution loop for the newly added PRs.

Use an assessment prompt shaped like this for the plan:

```text
Use `$assess-plan <plan-document>` to assess whether the completed PR range fully implements, tests, and complies with the plan. Do not run tests; assume validation is passing. Report findings that require additional implementation separately from residual notes.
```

Use an assessment prompt shaped like this for the design document when known:

```text
Use `$assess-design <design-document>` to assess whether the completed PR range fully implements, tests, and complies with the design document. Do not run tests; assume validation is passing. Report findings that require additional implementation separately from residual notes.
```

If either assessment finds additional implementation work, use an augmentation prompt shaped like this:

```text
Use `$augment <plan-document>` to append new PR sections that close the implementation findings from the completed end-of-range assessments. Add only the minimum PR sections needed, preserve the plan document's numbering and style, and do not start implementation.
```

If `augment` adds no PR sections even though assessment findings remain, stop and report the mismatch instead of claiming completion.

Only claim the `$prs` run complete after an end-of-range assessment pass produces no implementation findings.

## Reporting

After each PR completes successfully, print a concise progress summary before spawning the next PR:

- Progress bar for the requested range, using a 20-character bar such as `[████████░░░░░░░░░░░░] 4/10 complete`.
- When the user wants a room-readable display or the range is long-running, include the large progress format below in addition to the concise evidence.
- PR number
- commit hash and subject
- confirmation that `cc` created the commit
- focused validation evidence
- full-suite validation evidence, including the successful full-suite log path and total test execution time from the run that authorized the commit
- timing-regression evidence, including the previous baseline and whether the successful full-suite run stayed within the allowed threshold
- pre-full-suite scope-review evidence, including whether the reviewer requested follow-up work before passing
- ntfy notification result
- notable fixes made during investigation, if any

At the end of the range, report:

- completed PR numbers
- commit hashes and subjects
- successful full-suite log paths and total test execution times
- timing baselines used for each PR and the final remembered full-suite execution time
- scope-review results for each PR
- end-of-range `$assess-plan` result
- end-of-range `$assess-design` result, or that design assessment was skipped because no design document was known
- any `$augment` additions and any range extensions
- final progress bar for the requested range
- ntfy notification results for each completed PR
- whether any push was performed
- current `git status --short`

Do not claim the range is complete unless every requested PR passed full-suite validation and was committed.

Use a progress format like this after each completed PR:

```text
PR range: 1-10

[████████░░░░░░░░░░░░] 4/10 complete

Done:
  1  a13f9c2  full suite 18m 42s
  2  b8d41aa  full suite 18m 55s
  3  c7702df  full suite 19m 03s
  4  e29ac10  full suite 18m 51s

Current:
  5  starting

Remaining:
  6, 7, 8, 9, 10
```

When space matters, use this compact form:

```text
$prs 1-10
[████████░░░░░░░░░░░░] 4/10 | last: PR 4 e29ac10 | full suite: 18m 51s | next: PR 5
```

Use this large Markdown format when visibility matters. Prefer Markdown headings for the large text and avoid borders because code-block box-drawing can render unevenly in some clients:

````markdown
# Working on PRs 1-10

# 40%

```
██████████████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
```

## 4 / 10 COMPLETE

## Last: PR 4 `e29ac10`

## Full suite: `18m 51s`

## Next: PR 5
````

For the final successful range summary, change the top heading to:

```markdown
# PRs 1-10 complete!
```

Keep the large format visually stable: use the same single-line bar width each time, put the large bar inside an unlabeled fenced code block for monospace alignment, update only the top heading, filled bar, percentage, count, last PR, timing, and next PR fields, and keep long commit subjects out of the large display.

When `augment` extends the range, immediately update the visible range and denominator. For example, if `$prs 1-10` adds PRs 11 and 12, switch from `Working on PRs 1-10` with `10` total items to `Working on PRs 1-12` with `12` total items before starting PR 11.

## Guardrails

- Keep the range sequential. Do not run multiple PR implementation subagents in parallel.
- Do not bypass the `pr` skill's self-review, focused validation, full-suite validation, or investigate loop.
- Do not authorize a commit when the successful full-suite run has a significant execution-time jump versus the most recent recorded successful run.
- Do not authorize full-suite validation or a commit without a passing pre-full-suite scope review from a separate reviewer subagent.
- Do not let the reviewer subagent run tests or modify files; it reviews scope only and assumes focused validation has already passed.
- Use the `cc` skill for every commit. Do not commit directly with raw git commands unless the user explicitly authorizes a fallback.
- Do not skip the end-of-range `assess-plan` pass.
- Run `assess-design` at the end of the range when a design document is known; skip it only when no explicit or persisted design document is known.
- Use `augment` when end-of-range assessment findings require additional PR work, then extend the active range and continue.
- Send an ntfy notification after each completed PR with the PR summary evidence.
- Do not run validation commands directly from the `prs` skill; validation belongs to the `pr` and `test` skills.
- Do not commit in the main agent for a PR if the subagent was responsible for the PR, unless the subagent explicitly failed after producing complete passing evidence and the user asks the main agent to finish the commit; even then, use the `cc` skill unless the user explicitly authorizes a raw-git fallback.
- Do not push without explicit permission in the original user prompt.
- If a plan document path is supplied, keep the shared default synchronized through the `pr` skill's `update_default_plan.py` helper.
- Keep full-suite timing memory clone-local in `references/full-suite-timing.local.md`; do not commit that mutable memory file unless the user explicitly asks.
