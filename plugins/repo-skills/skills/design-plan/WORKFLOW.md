---
name: design-plan
description: Translate an explicitly supplied design document into a repository implementation plan that follows viberoots PR-section conventions. Use when the agent should create or update a plan from a design, preserve repo guardrails, avoid documentation-only or test-only PRs, and make each PR responsible for implementing, testing, and documenting its own scope.
---

# Design Plan

## Overview

Use this skill to translate one design document into a concrete implementation plan. The output is a
plan document, not code. Do not start implementation.

This skill is for design-to-plan translation. Use `$augment` instead when the task is only to append
new PR sections for already-identified gaps in an existing plan.

## Required Inputs

Require an explicit design document path.

Require an explicit output plan path unless the user clearly asks to update an existing named plan.
Do not use the shared `$pr`, `$augment`, or `$assess-plan` default as an implicit output path for a
new plan.

Accept additional explicitly named context docs when the user supplies them. Do not infer extra
design requirements from older thread history unless those requirements are also present in the
design document or named supporting docs.

## Read Required Docs

Read these files before drafting the plan:

- `AGENTS.md`
- `docs/README.md`
- `docs/handbook/getting-started-on-a-pr.md`
- `docs/handbook/testing.md`
- `build-tools/docs/build-system-design.md` when the design or plan touches build-system behavior
- the supplied design document
- the existing output plan document when updating one
- nearby current plans in the same docs area, to match section style and level of detail

When no nearer local convention exists, inspect the most recent relevant current plans before
drafting. Recent plan examples include:

- `build-tools/docs/nixpkgs-source-selection-plan.md`
- `docs/resource-graph-plan.md`
- `docs/history/plans/control-plane-selector-plan.md`
- `docs/history/plans/external-deployments-plan.md`
- `docs/viberoots-flake-plan.md`

If a listed file is missing, note that briefly and continue with the remaining applicable docs.

## Workflow

### 1. Resolve Scope And Placement

Identify the design's ownership boundary before writing:

- build-system plans belong under `build-tools/docs/`
- repo-wide deployment, control-plane, source-mode, bootstrap, and operator plans belong under
  `docs/`
- product or project plans belong under `projects/docs/` or beside the owning package
- inactive or historical plans belong under `docs/history/`

Use the repo's documentation placement rules rather than putting all plans in one directory.

### 2. Extract The Design Contract

Build a checklist from the design before planning PRs.

- Capture explicit goals, non-goals, public APIs, internal contracts, migration requirements,
  diagnostics, validation expectations, documentation updates, and rollout constraints.
- Separate explicit design requirements from reasonable implementation inferences.
- Preserve user decisions and terminology from the design.
- Do not add product behavior that the design does not authorize.
- Call out unresolved design questions before converting them into implementation work. If an open
  question materially changes PR structure, ask the user rather than guessing.

### 3. Choose Plan-Level Sections

Use the section style common to current viberoots plans. A new plan should normally include:

- Title
- short statement of which design it implements
- `Reviewed Context`
- `Non-goals` when the design rules out tempting alternatives or compatibility paths
- a sequencing or transition note when the work intentionally pauses, depends on, or supersedes
  another plan
- `Implementation Guardrails`
- `Validation Policy`
- a turbo-mode or reduced-validation policy only when the user explicitly authorizes it or the
  design/plan context already requires it
- `De-Risking Checkpoints` when the work has meaningful integration risk or staged adoption
- `Integration Debt Ledger`
- numbered PR sections
- `Rollout And Sequencing`
- `Verification And Backout Strategy`

Omit a section only when it is genuinely not applicable. If an existing plan in the same area uses a
more specific local convention, follow that convention while preserving the guardrails below.

For older or historical-style plans, `Reviewed context`, `Non-goals`, de-risking checkpoints, turbo
validation cadence, and verify-scope organization may appear as prose sections instead of titled
`##` headings. Preserve that local shape when updating an existing plan, but use clear titled
sections for new current plans unless nearby current documents use another style.

### 4. Split Into PR Sections

Create the fewest coherent PRs that can land independently while keeping the repo in a working state.

Current viberoots plans use two PR subsection templates. Prefer the fuller template for deployment,
control-plane, source-mode, bootstrap, remote/cache, schema, migration, or other cross-cutting work:

1. `Intent`
2. `Scope of changes`
3. `External prerequisites`
4. `Tests to be added`
5. `Docs to be added or updated`
5.5. `Expected regression scope`
6. `Acceptance criteria`
7. `Risks`
8. `Mitigations`
9. `Consequences of not implementing this PR`
10. `Downsides for implementing this PR`

Use the compact template only when nearby current plans use it for the same domain and the PRs are
mostly build-system-internal slices:

1. `Intent`
2. `Scope of changes`
3. `Tests`
4. `Acceptance criteria`
5. `Risks`
6. `Consequence of not implementing`
7. `Recommendation`

If updating an existing plan, match its current PR subsection structure exactly unless the user asks
to modernize the structure.

### 5. Enforce PR Shape Guardrails

Do not create documentation-only PRs.

Do not create test-only PRs.

Each PR must own the implementation, tests, and documentation for its scope. Documentation updates
and test coverage should be listed inside the PR that changes the corresponding behavior.

Keep PRs behaviorally coherent:

- A schema change PR should include the code that uses or validates the schema, tests for the schema,
  and docs for the new contract.
- A public API or macro change PR should include propagation, validation, tests, diagnostics, and
  user-facing docs for that API.
- A migration or rollout PR should include the migration path, compatibility or rejection behavior,
  tests for both old and new states when applicable, and operator docs.
- A diagnostic or inspection PR should include the producing code, tests for the output, and docs for
  how users interpret it.
- A cache, remote execution, generated-state, or source-mode PR should include parity tests,
  cleanup/regeneration behavior, ownership boundaries, and docs for operators or contributors.
- A control-plane or deployment PR should include admission/fail-closed behavior, secret-safety
  tests, operator docs, and expected regression scope.

Avoid plans that defer all testing, all documentation, or all integration proof to a final cleanup
PR. A final hardening PR is acceptable only when earlier PRs already tested and documented their own
scope.

### 6. Preserve Repo Principles

Apply these guardrails while drafting:

- Prefer existing repo patterns, helpers, wrappers, and validation flows over new abstractions.
- Keep generated artifacts out of source-of-truth language.
- Do not introduce fallbacks that hide bugs in the primary path.
- Fail closed for missing authority, ambiguous inputs, or unsupported states.
- Keep user-facing names stable and avoid temporary milestone names in code-facing APIs.
- Do not plan compatibility shims unless the design names an external user or migration window.
- Keep plan text clear about what is implementation work, what is validation, and what is
  documentation.

### 7. Validate The Draft By Inspection

Before reporting completion:

- Check that every design requirement maps to at least one PR or an explicit non-goal.
- Check that every PR includes testing and documentation responsibility for its own scope.
- Check that no PR is documentation-only or test-only.
- Check that every fuller-template PR has external prerequisites, docs, expected regression scope,
  mitigations, consequences, and downsides unless matching a compact local convention.
- Check that validation policy, checkpoints, rollout sequencing, and backout strategy identify where
  broad or full-suite validation is required.
- Check that PR ordering avoids avoidable rewrites and leaves useful de-risking checkpoints.
- Check that the plan does not introduce meaningless planning labels into code-facing APIs,
  diagnostics, fixture names, or generated fields.
- Check Markdown structure and links.

## Prompt Shape

Use two explicit paths when creating a plan:

```text
$design-plan docs/example-design.md docs/example-plan.md
```

Use one design path plus an explicit instruction when updating an existing plan:

```text
Use $design-plan to update docs/example-plan.md from docs/example-design.md.
```

Interpret the invocation as:

- Read the design and required repo context.
- Create or update the plan document at the requested path.
- Use the repo's standard plan section structure.
- Include implementation, tests, documentation, validation, sequencing, and backout guidance.
- Do not start implementation.
