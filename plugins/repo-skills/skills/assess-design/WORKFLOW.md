---
name: assess-design
description: Thoroughly review a target design document against the current repository implementation, existing test coverage, and repo guardrails while using an `assess-design`-specific persisted default that does not affect or inherit the shared `pr` and `augment` default. Use when the agent should assess whether everything described in a design spec file is fully implemented, meaningfully tested, and compliant with methodology requirements, especially in this repo where `build-tools/docs/build-system-design.md` and `METHODOLOGY.XML` are required review context. Trigger on prompts like `$assess-design` or `$assess-design docs/design.md`.
---

# Assess Design

## Overview

Review one target design path at a time. Treat the supplied `[spec]` path as the only parameter and use the current repository context rather than re-explaining project background.

Use an `assess-design`-specific persistent default document. Do not read from or write to the shared `pr` and `augment` defaults.

## Required Inputs

Read `references/defaults.local.md` when it exists; otherwise read [references/defaults.md](references/defaults.md) first.

Use the `default_design_document` value from that file when the prompt does not provide a spec path.

If the prompt explicitly supplies a spec path, persist it as the new `assess-design` default before continuing by running:

```bash
repo_root="$(git rev-parse --show-toplevel)"
python3 "$repo_root/plugins/repo-skills/skills/assess-design/scripts/update_default_design.py" docs/another-design.md
```

After updating the defaults file, use that explicit path for the current task and treat it as the new default for future `$assess-design` invocations only.

Read these files for every assessment after resolving the target spec path:

- `build-tools/docs/build-system-design.md`
- `METHODOLOGY.XML`
- `[spec]`

## Workflow

### 1. Build the Requirement Checklist

Resolve the target spec path from the prompt argument when present, otherwise from the `assess-design` default in `references/defaults.local.md` when present, otherwise `references/defaults.md`.

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

Use the default design spec when no argument is provided.

`Use $assess-design to review the saved design spec and determine whether it is fully implemented, covered by existing tests, and compliant with our methodology and guardrails.`

`Use $assess-design to review docs/history/designs/deployments-design.md and determine whether it is fully implemented, covered by existing tests, and compliant with our methodology and guardrails.`
