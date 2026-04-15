# PR Checklist

Use this checklist before saying the work is ready for a manual full-suite `v` run.

## Inputs

- [ ] Capture the PR identifier.
- [ ] Capture the plan document path.
- [ ] Capture any extra docs the user explicitly named.
- [ ] Do not infer repo-specific extra docs unless the user explicitly names them in the current prompt.
- [ ] Treat the invocation as a fresh start instead of relying on prior thread history or unstated remembered context.
- [ ] Ask a clarification question before coding only if ambiguity would materially change the implementation.
- [ ] If the prompt explicitly supplied a non-default plan document path, persist it as the new default.

## Context

- [ ] Read the supplied plan document, or read the configured default plan document when none was supplied.
- [ ] Re-read the required docs for this run instead of assuming they were already reviewed in an earlier thread.
- [ ] Read `build-tools/docs/build-system-design.md` when present.
- [ ] Read `docs/handbook/getting-started-on-a-pr.md` when present.
- [ ] Read `METHODOLOGY.XML` when present.
- [ ] Note any missing expected docs briefly instead of silently skipping them.

## Implementation

- [ ] Inspect existing code before editing.
- [ ] Prefer existing utilities, helpers, and patterns before rolling new code.
- [ ] Keep the implementation aligned with the plan document and guardrail docs.
- [ ] Keep the implementation readable, low-complexity, and self-documenting.
- [ ] Optimize where necessary to keep things as fast as possible.
- [ ] Be especially careful not to cause an execution-time regression.

## Tests And Review

- [ ] Add or update tests when the PR needs new coverage.
- [ ] Ensure new tests are wired into the repository's existing tooling.
- [ ] Self-review implementation correctness.
- [ ] Self-review against the plan document, repo rules, methodology, and any extra docs the user explicitly named.
- [ ] Self-review against `build-tools/docs/build-system-design.md`.
- [ ] Self-review against `docs/handbook/getting-started-on-a-pr.md`.
- [ ] Confirm the code remains low-complexity, highly readable, and self-documenting.

## Commands

- [ ] Run repository commands inside the repo dev shell, preferably via `direnv exec . bash -lc '...'` unless an equivalent shell is already loaded.
- [ ] Stage the current changes.
- [ ] Run lint.
- [ ] Run prettier.
- [ ] Run the applicable strict 250-line methodology file-size gate with the existing repo tooling.
- [ ] Use the repo-approved runner for file-size lint: `node ...` when directly executable in the active shell, otherwise `zx-wrapper build-tools/tools/dev/file-size-lint.ts --scope=source --fail=true`.
- [ ] Also run the corresponding `--scope=ssr-tests` gate when touched work includes SSR test modules or other work that must satisfy that gate.
- [ ] Restage if lint, prettier, or file-size-gate fixes changed files.
- [ ] Run exactly `i && b && v <new-tests>`.
- [ ] Treat `<new-tests>` as the new tests added for the PR.
- [ ] When `<new-tests>` are supplied as file paths, especially under `build-tools/tools/tests`, prefer exact Buck labels for generated root tests when available.
- [ ] If file-path selectors were used, confirm selector expansion with `v --explain-selection` or the verify log before trusting the run.
- [ ] If touched work includes `build-tools/tools/dev/verify/**`, validate both label-based and file-path-based `v` invocation for at least one affected target.
- [ ] If any step in `i && b && v <new-tests>` fails, treat the failure as caused by the current PR until disproven, unless the user explicitly instructs otherwise.
- [ ] Do not classify failures as unrelated merely because the failing target is outside the edited files.
- [ ] Reproduce the failing helper, wrapper, or tool directly when possible and inspect intermediate artifacts before broadening the fix.
- [ ] For Buck macro or build-config tests, confirm the temp harness is not replacing the root config under test.
- [ ] Fix root causes in the primary path instead of adding fallbacks that could hide bugs, unless the user explicitly asks for that behavior or the plan requires it.
- [ ] Make the primary path robust rather than papering over failures with alternate branches or escape hatches.
- [ ] After every iterative code change, rerun lint, prettier, the applicable strict 250-line methodology file-size gate, restage, and rerun the failing tests as a set.
- [ ] If the change touches shared tooling, generated-test wiring, deployment tooling, labels/macros, or `build-tools/tools/dev/verify/**`, rerun the smallest meaningful impacted set before handoff.

## Handoff

- [ ] Do not run full-suite `v`.
- [ ] Do not claim readiness, or tell the user to run `v`, unless the latest targeted validation passes.
- [ ] Before suggesting another broader or full-suite run, confirm the latest failing test passes individually or the latest meaningful failing set passes together.
- [ ] Report the exact targeted commands or selectors that were validated.
- [ ] Include either concrete `Pass:` target lines or a saved verify-log path showing the executed targets.
- [ ] Run `git status --short` after the latest validation pass and note any incidental fixes or surfaced regressions that are now part of the staged change set.
- [ ] Do not commit unless all tests are passing.
