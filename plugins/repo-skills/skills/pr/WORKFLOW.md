---
name: pr
description: Implement a numbered PR item from the repository's plan document while supporting both explicit `$pr 4.5.1` invocation and bare `$pr` auto-advance from the last recorded identifier. Use when the agent should start from fresh context, resolve the PR identifier and default plan document from the repo-local defaults, review the standard repo docs and any extra docs explicitly named in the current prompt, implement the plan item, prefer existing utilities, wire tests, self-review, stage changes, run lint and prettier, delegate focused and full-suite validation to the `test` skill, use the `investigate` skill for validation failures, and report passing full-suite results and timing before commit readiness.
---

# PR

## Overview

Use this skill to take over a fresh repository context and drive one planned PR item through focused validation, full-suite validation, and commit-readiness evidence without skipping the repo's design and methodology guardrails.

Use this skill as the short front door for planned PR implementation work.

Treat `$pr 4.5.1` as the normal explicit invocation shape.

Treat bare `$pr` as shorthand for "use the next numeric PR identifier after the most recently recorded `$pr` numeric argument."

Keep the task-specific prompt short.

Provide the PR identifier only when you want to pin one explicitly.

Provide the plan document path only when it differs from the configured default in `references/defaults.local.md` when present, otherwise [references/defaults.md](references/defaults.md).

Treat every invocation as a fresh start for implementation context. Do not rely on prior thread history, prior conversational decisions, or unstated remembered context. Rebuild context from the current prompt, the current repository state, the configured default plan document, and the docs read during this run.

The only intentional carry-forward state is explicit persistent configuration, such as `default_plan_document` in `references/defaults.local.md` when present, otherwise [references/defaults.md](references/defaults.md).

In this flattened `pr` skill, that carry-forward state also includes `last_pr_numeric_argument` in `references/defaults.local.md` when present, otherwise [references/defaults.md](references/defaults.md).

## Resolve The PR Identifier

Read `references/defaults.local.md` when it exists; otherwise read [references/defaults.md](references/defaults.md).

Resolve the PR identifier immediately, before reading repo docs or inspecting code:

- If the prompt includes an explicit numeric PR identifier, persist and echo it by running from anywhere inside the repo:

```bash
repo_root="$(git rev-parse --show-toplevel)"
python3 "$repo_root/plugins/repo-skills/skills/pr/scripts/resolve_pr_identifier.py" 4.5.1
```

- If the prompt omits the numeric PR identifier and uses bare `$pr`, derive the default from the last recorded identifier by running from anywhere inside the repo:

```bash
repo_root="$(git rev-parse --show-toplevel)"
python3 "$repo_root/plugins/repo-skills/skills/pr/scripts/resolve_pr_identifier.py"
```

Use the printed identifier as the PR identifier for the current run.

The helper script persists the resolved identifier to `references/defaults.local.md`, bootstrapping that file from [references/defaults.md](references/defaults.md) when needed, so the next bare `$pr` invocation advances from the most recently used numeric argument.

If no prior numeric PR identifier has been recorded yet, do not guess. Require one explicit numeric `$pr` invocation first so the default has a starting point.

## Collect Inputs

Require:

- PR identifier, either supplied explicitly or resolved from bare `$pr` using the last recorded numeric argument

Default:

- Plan document path: read `default_plan_document` from `references/defaults.local.md` when present, otherwise [references/defaults.md](references/defaults.md)

Accept when provided:

- Alternate plan document path
- Extra design or handbook docs to read first. Only treat a doc as an extra requirement when the user explicitly names it in the current prompt; do not infer repo-specific extras from older thread history or nearby files.
- Known test selectors or test file paths

Proceed without routine clarification when the prompt is specific enough. Ask a question up front only when ambiguity would materially change the implementation.

If the current thread contains older task details that are not restated in the current prompt, do not treat them as requirements for this run unless they are also reflected in the current repository state or explicit persistent skill configuration.

## Resolve The Default Plan Document

Use the `default_plan_document` value from that file unless the prompt explicitly supplies another plan document path.

If the prompt explicitly provides an alternate plan document path, persist it as the new clone-local default before continuing by running from anywhere inside the repo:

```bash
repo_root="$(git rev-parse --show-toplevel)"
python3 "$repo_root/plugins/repo-skills/skills/pr/scripts/update_default_plan.py" docs/another-plan.md
```

After updating the defaults file, use that explicit path for the current task and treat it as the new default for future `$pr`, `$augment`, and `$assess-plan` invocations.

When the saved default plan document changes, that script also resets `last_pr_numeric_argument` to `0` in `references/defaults.local.md`. That reset makes the next bare `$pr` invocation resolve to `1` unless the current prompt supplies an explicit numeric PR identifier first.

After resolving the plan document path, the rest of this workflow carries forward the full original prompt contract from the prior split `pr` and `planned-pr-implementation` skills.

## Read Required Docs

Read the supplied plan document, or the configured `default_plan_document` in `references/defaults.local.md` when present, otherwise [references/defaults.md](references/defaults.md), and, when present, also read these repository documents before coding:

- `build-tools/docs/build-system-design.md`
- `docs/handbook/getting-started-on-a-pr.md`
- `METHODOLOGY.XML`

If the user explicitly names additional docs, read those too.

Treat the supplied or default plan document as the parameterized "plan" input. Do not infer additional repo-specific docs beyond the standard required docs; only read truly extra docs when the user explicitly names them in the current prompt.

If a listed file is missing, note that briefly and continue with the remaining applicable docs.

Do not assume these docs were already reviewed in an earlier thread. Read them again for the current run.

## Implement

Locate the requested PR section in the plan document. Treat the plan document as the task contract unless repo code or guardrail docs clearly require a narrower interpretation.

Inspect the codebase before editing. Reuse existing utilities, helpers, commands, and patterns before adding new abstractions.

Keep changes readable, low-complexity, self-documenting, and aligned with the design docs, methodology, and PR guardrails.

Optimize where necessary to keep things as fast as possible. Be especially careful not to cause an execution-time regression. Avoid speculative micro-optimization.

## Wire Validation

Add or update tests only when they materially cover the PR.

Ensure every new test is wired into the repository's existing tooling so the requested targeted validation can run cleanly.

Perform a self-review against:

- Implementation correctness
- Plan document requirements
- The repository's rules, methodology, and PR guardrails
- `build-tools/docs/build-system-design.md`
- `docs/handbook/getting-started-on-a-pr.md`
- Any extra docs the user explicitly named
- Low cyclomatic complexity, high readability, and self-documenting code
- Execution-time regression risk

## Run Commands

Run repository commands inside the repo dev shell. Prefer `direnv exec . bash -lc '...'` unless the current shell is already equivalently loaded.

During validation, use the `test` skill's logging and progress behavior. Keep full build and test output in saved logs, but provide concise chat updates during long runs. The tester should not run validation as one blocking foreground command; it should start the logged validation process in the background and poll it. Progress updates should include useful state such as elapsed time, log path, current phase, or a short high-signal summary; avoid empty pings and do not paste verbose logs.

When invoked by `$prs` in pre-full-suite review mode, stop after self-review, gates, and focused validation pass. Report ready-for-review evidence and do not run full-suite validation until `$prs` reports that the separate scope-review subagent passed and explicitly authorizes full-suite validation.

Before full-suite validation, and before any focused validation attempt, run the formatting and methodology gates first:

1. Stage all current changes.
2. Run lint and prettier.
3. Run the applicable strict 250-line methodology file-size gate with the existing repo tooling. Use the repo-approved runner for the environment. Prefer `node build-tools/tools/dev/file-size-lint.ts --scope=source --fail=true` when the entrypoint is directly executable under `node`, otherwise use `zx-wrapper build-tools/tools/dev/file-size-lint.ts --scope=source --fail=true`. Also run the corresponding `--scope=ssr-tests` gate when touched work includes SSR test modules or other work that must satisfy that gate.
4. Restage if lint, prettier, or file-size-gate fixes modify files.
5. Invoke the `test` skill to run the build and targeted tests with `<new-tests>` as the requested selector. The `test` skill owns the actual validation command execution and logging.
6. Treat `<new-tests>` as the new tests added for the PR, and pass that selector through to the `test` skill.
7. When `<new-tests>` are supplied as file paths, especially under `build-tools/tools/tests`, prefer exact Buck labels for generated root tests when available. If you do use file paths, confirm the selector expansion with `v --explain-selection` or the verify log before trusting the run.
8. If touched work includes `build-tools/tools/dev/verify/**`, validate both label-based and file-path-based `v` invocation for at least one affected target.
9. After self-review, focused validation, and any resulting investigations all pass, invoke the `test` skill without a selector to run the full-suite validation sequence. The `test` skill owns the actual full-suite command execution, logging, and timing. If `$prs` invoked this run in pre-full-suite review mode, defer this step until `$prs` authorizes it after scope review.

Never run `v` directly as part of this workflow. Use the `test` skill for both focused and full-suite validation.

## Handle Failures

If the `test` skill reports that any step in the selected validation flow failed after your changes, treat that failure as caused by the current PR until you have direct evidence otherwise, unless the user explicitly instructs you to treat failures differently.

If the focused validation fails, continue investigating in the current PR workflow unless the user provided a saved log and explicitly asks to use the `investigate` skill. If the full-suite validation fails, invoke the `investigate` skill with the saved full-suite log path from the `test` skill report.

After the `investigate` skill identifies and fixes the full-suite failure, rerun the failing tests or smallest meaningful failing set with the `test` skill and the appropriate selector. Iterate through investigate, fix, and focused rerun until the failing tests pass. Then invoke the `test` skill without a selector to rerun the full suite. Iterate until the full suite passes or you are genuinely blocked.

Do not assume a failure is unrelated just because the failing target or file is outside the edited surface. Changes to shared build tooling, build graph inputs, labels, macros, test generation, root config files, or broad `build-tools/**` inputs can invalidate previously cached paths and expose regressions elsewhere.

Before broadening the investigation, reproduce the failing helper or tool directly when possible and inspect the intermediate artifacts or generated inputs. Prefer direct repros of the failing path over speculative changes to surrounding systems.

If the failure involves Buck macro wiring, generated labels, or root build configuration behavior, verify that the chosen temp-repo harness does not replace or bypass the config file under test.

Investigate and fix the root cause in the primary path. Do not add fallbacks, alternate branches, retries, cache-bypass behavior, or environment-specific escape hatches that merely hide bugs in the main path unless the user explicitly asks for that behavior or the plan document requires it.

Prefer removing incorrect assumptions and making the primary path robust so the failure cannot recur silently.

After every code change made during iteration, rerun lint, prettier, and the applicable strict 250-line methodology file-size gate, restage the changes, and then use the `test` skill to rerun the failing tests as a set before reporting back.

If the change touches shared tooling, generated-test wiring, deployment tooling, labels/macros, or `build-tools/tools/dev/verify/**`, do not stop at a single passing repro. Rerun the smallest meaningful impacted set before handoff.

Only describe a failure as unrelated when you have explicit evidence that the failure predates the current change set or the user explicitly tells you not to treat it as PR-caused.

Do not hand off with a commit-readiness status until the latest full-suite validation run passes, or you are genuinely blocked.

## Report Back

If focused validation passes, continue to full-suite validation through the `test` skill. Do not stop merely because focused validation passed.

If full-suite validation passes, report that the branch is ready for a commit and include the focused and full-suite validation evidence: exact selectors or command shape validated, saved log paths, concise pass summaries, and timing for the full-suite run.

If validation still fails, summarize the remaining failure set and the next fix to make.

Do not commit unless all focused and full-suite validation has passed. After a passing full-suite run, stop short of committing unless the user explicitly asked for a commit.

## Reference

Use the pre-handoff checklist in [references/checklist.md](references/checklist.md) before reporting readiness.

Use [references/checklist.md](references/checklist.md) as a literal pre-handoff checklist. Do not claim readiness if an applicable item is still unchecked.

## Prompt Shape

Use a short prompt such as:

```text
$pr
```

Use the explicit form whenever you want to pin a specific PR identifier instead of advancing from the last recorded value:

```text
$pr 4.5.1
```

If the plan document is not the default, use:

```text
$pr 4.5.1 from docs/another-plan.md
```

If the run also depends on an extra doc outside the standard required set, name it explicitly in the prompt, for example:

```text
$pr 4.5.1 and also read docs/history/designs/mini-deployment.md
```

The equivalent longer sentence forms are also valid:

```text
Use $pr for PR 4.5.1.
```

```text
Use $pr for PR 4.5.1 from docs/another-plan.md.
```

```text
Use $pr for PR 4.5.1 and also read docs/history/designs/mini-deployment.md.
```
