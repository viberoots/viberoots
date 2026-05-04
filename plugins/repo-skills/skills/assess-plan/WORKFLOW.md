---
name: assess-plan
description: Thoroughly review a target spec or plan document against the current repository implementation, existing test coverage, and repo guardrails while using the shared persisted default document also used by `pr` and `augment`. Use when the agent should assess whether everything described in the shared plan or an explicitly supplied spec file is fully implemented, meaningfully tested, and compliant with methodology requirements, especially in this repo where `build-tools/docs/build-system-design.md` and `METHODOLOGY.XML` are required review context. Trigger on prompts like `$assess-plan` or `$assess-plan docs/spec.md`.
---

# Assess Plan

## Overview

Review one target spec path at a time. Treat the supplied `[spec]` path as the only parameter and use the current repository context rather than re-explaining project background.

Use the same shared persistent default document as `$pr` and `$augment`.

## Required Inputs

Read `../pr/references/defaults.local.md` when it exists; otherwise read [../pr/references/defaults.md](../pr/references/defaults.md) first.

Use the `default_plan_document` value from that file when the prompt does not provide a spec path.

If the prompt explicitly supplies a spec path, persist it as the new shared default before continuing by running:

```bash
repo_root="$(git rev-parse --show-toplevel)"
python3 "$repo_root/plugins/repo-skills/skills/pr/scripts/update_default_plan.py" docs/another-spec.md
```

After updating the defaults file, use that explicit path for the current task and treat it as the new default for future `$assess-plan`, `$augment`, and `$pr` invocations. When the saved default plan document changes, that script also resets `$pr`'s recorded numeric argument to `0`.

Read these files for every assessment after resolving the target spec path:

- `build-tools/docs/build-system-design.md`
- `METHODOLOGY.XML`
- `[spec]`

## Workflow

### 1. Build the Requirement Checklist

Resolve the target spec path from the prompt argument when present, otherwise from the shared default in `../pr/references/defaults.local.md` when present, otherwise `../pr/references/defaults.md`.

Extract concrete requirements from `[spec]` before judging the implementation.

- Separate explicit requirements from reasonable inferences.
- Capture behavior, config, interfaces, migrations, deployment expectations, and testing expectations.
- Keep the checklist grounded in the spec text instead of broad product assumptions.

### 2. Inspect the Implementation Surface

Trace each requirement to the current codebase.

- Use `rg` for discovery.
- Inspect implementation code, configuration, integration points, and existing tests.
- Look for partial implementations, dead paths, stale flags, missing wiring, and docs that overstate shipped behavior.
- Treat "tests are passing" as non-evidence unless the relevant behavior is actually covered.

### 3. Respect Repo Execution Constraints

If you need to run commands:

- Load `direnv` first and/or use `nix develop`.
- Do not run tests unless the user explicitly asks. Assume the existing suite is already passing consistently.
- Do not worry about Markdown or XML files that exceed file-size limits when those files are part of the review context.

### 4. Evaluate Against Methodology and Guardrails

Use `METHODOLOGY.XML` and the build-system design doc as active review criteria, not background reading.

- Check whether the implementation follows the intended architecture and operating model.
- Call out methodology or guardrail violations even when functionality appears complete.
- Distinguish clearly between "implemented," "tested," and "compliant." These are separate questions.

### 5. Report Like a Review

Lead with findings, ordered by severity.

- For each finding, cite the relevant requirement in `[spec]` and the code, config, or test evidence behind the conclusion.
- Highlight missing implementation, incomplete rollout, absent or weak test coverage, and methodology/guardrail violations separately when useful.
- If something appears fully implemented, say so explicitly and note any residual uncertainty.
- Keep summaries brief. The main value is the evidence-backed assessment.

## Example Invocation

Use the default spec when no argument is provided.

`Use $assess-plan to review the shared default spec and determine whether it is fully implemented, covered by existing tests, and compliant with our methodology and guardrails.`

`Use $assess-plan to review docs/deployments-design.md and determine whether it is fully implemented, covered by existing tests, and compliant with our methodology and guardrails.`
