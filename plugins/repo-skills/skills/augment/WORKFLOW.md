---
name: augment
description: Add one or more new PR sections to an existing specification or plan document to close gaps already identified in the current context. Use when the user asks to extend a spec or plan with PR planning only, wants the new sections appended at the end in numerical and logical order, and does not want implementation to start yet. Trigger on prompts like `$augment`, `$augment docs/spec.md`, or requests to add PR sections for gaps already found.
---

# Augment

## Overview

Use this skill to turn already-identified gaps into one or more new PR sections appended to an existing spec or plan document.

Treat the current thread context as the source of truth for the gaps that still need coverage. Plan only. Do not start implementation.

## Resolve The Default Spec

Read `../pr/references/defaults.local.md` when it exists; otherwise read [../pr/references/defaults.md](../pr/references/defaults.md) first.

Use the `default_plan_document` value from that file when the prompt does not provide a spec path.

If the prompt explicitly supplies a spec path, persist it as the new shared default before continuing by running:

```bash
repo_root="$(git rev-parse --show-toplevel)"
python3 "$repo_root/plugins/repo-skills/skills/pr/scripts/update_default_plan.py" docs/another-spec.md
```

After updating the defaults file, use that explicit path for the current task and treat it as the new default for future `$augment`, `$assess-plan`, and `$pr` invocations. When the saved default plan document changes, that script also resets `$pr`'s recorded numeric argument to `0`.

## Workflow

1. Resolve the target spec path from the prompt argument when present, otherwise from the shared default in `../pr/references/defaults.local.md` when present, otherwise `../pr/references/defaults.md`.
2. Read the target document and inspect the existing PR numbering, section order, and formatting pattern.
3. Use the current thread context to identify which previously noted gaps still need PR coverage.
4. Add a single PR section when one section cleanly closes all remaining gaps. Otherwise add the minimum number of sections needed.
5. Append the new section or sections at the end of the existing PR list in numerical, logical order.
6. Match the structure, tone, and detail level of the existing PR sections in the document.
7. Make sure every new PR section explicitly covers both testing and documentation for the functionality being added or changed.
8. Stop after updating the plan document. Do not start implementation.

## Guardrails

- Keep all new sections at the end of the list.
- Preserve the document's existing heading hierarchy and naming conventions.
- Base the additions on gaps already identified in the current context. Do not invent unrelated work.
- If the current context does not clearly establish the gaps to close, stop and ask for that missing context instead of guessing.
- Prefer the fewest coherent PR sections that fully close the known gaps.
- Do not make code changes outside the target spec as part of this skill.

## Prompt Shape

Use the skill with either no argument or one argument: the spec path.

Use the default spec when no argument is provided.

```text
$augment
```

```text
$augment docs/spec.md
```

Interpret that invocation as:

- Add one or more PR sections to the target spec to close all gaps already identified in context.
- Use the same structure as the existing PRs in that document.
- Include testing and documentation in the planned work.
- Do not start implementation.
- Ensure the new section or sections are appended at the end in numerical, logical order.
