---
name: prs
description: Work through a numeric range of planned PRs from the shared plan document in sequence. Use when the user invokes `$prs <range> [plan-document]`, such as `$prs 1-10 docs/external-deployments-plan.md` or `$prs 11-15`, and wants each PR implemented by a dedicated subagent using the `pr` skill, committed through the `cc` skill only after self-review, full-suite validation, full-suite timing-regression checks, and a separate scope-review subagent pass, then notified via ntfy with PR summary evidence, assessed with `assess-plan` and known `assess-design`, augmented with follow-up PRs when gaps remain, and never pushed unless explicitly requested.
---

# PRs

Use this plugin skill as the direct entrypoint for sequential planned PR implementation.

1. Read [WORKFLOW.md](WORKFLOW.md) and use it as the source of truth for the rest of the task.
2. Read only the references and scripts that `WORKFLOW.md` asks for.
3. Share plan-document state with the `pr` skill through `../pr/references/defaults.local.md` when present, otherwise `../pr/references/defaults.md`.
4. Keep full-suite timing memory in `references/full-suite-timing.local.md`, bootstrapped from [references/full-suite-timing.md](references/full-suite-timing.md) when needed.
