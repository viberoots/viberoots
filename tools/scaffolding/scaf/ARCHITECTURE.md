## scaf implementation layout (PR-2)

This directory contains the implementation of the `scaf` CLI.

`tools/scaffolding/scaf.ts` is a thin entrypoint that calls into `tools/scaffolding/scaf/main.ts`.

### Relocation map (from old monolith)

- Argument parsing and usage text:
  - `usage()` → `tools/scaffolding/scaf/usage.ts`
  - `parseArgs(...)` → `tools/scaffolding/scaf/argv.ts`

- Filesystem primitives and safety prompts:
  - `exists(...)` → `tools/scaffolding/scaf/fs.ts`
  - `walk(...)` → `tools/scaffolding/scaf/walk.ts`
  - `confirmOrExit(...)` → `tools/scaffolding/scaf/confirm.ts`

- Template discovery and selection:
  - `isLanguageEnabled(...)` → `tools/scaffolding/scaf/language-enablement.ts`
  - `readCopierVariables(...)` → `tools/scaffolding/scaf/templates/variables.ts`
  - `readTemplateMeta(...)` → `tools/scaffolding/scaf/templates/meta.ts`
  - `normalizeTemplateName(...)` → `tools/scaffolding/scaf/templates/names.ts`
  - `resolveDestination(...)` → `tools/scaffolding/scaf/templates/destination.ts`
  - `cmdTemplates(...)` → `tools/scaffolding/scaf/commands/templates.ts`
  - `cmdTemplate(...)` → `tools/scaffolding/scaf/commands/template.ts`

- Copier orchestration:
  - `runCopierCopy(...)` → `tools/scaffolding/scaf/copier/copy.ts`
  - `runPostSteps(...)` → `tools/scaffolding/scaf/copier/post-steps.ts`
  - `recordSource(...)` → `tools/scaffolding/scaf/copier/record-source.ts`
  - `readRegenInfo(...)` → `tools/scaffolding/scaf/copier/regen-info.ts`

- Scaffold discovery and bulk operations:
  - `discoverScaffolds(...)` → `tools/scaffolding/scaf/scaffolds/discover.ts`
  - `cmdLs(...)` → `tools/scaffolding/scaf/commands/ls.ts`
  - `cmdUpdateOrRegen(...)` → `tools/scaffolding/scaf/commands/update-regen.ts`
  - `cmdDelete(...)` → `tools/scaffolding/scaf/commands/delete.ts`
  - `cmdMove(...)` → `tools/scaffolding/scaf/commands/move.ts`

- Command help and completions:
  - `cmdHelp(...)` → `tools/scaffolding/scaf/commands/help.ts`
  - `cmdCompletions(...)` + `__complete` helpers → `tools/scaffolding/scaf/commands/completions.ts`

- Language subcommands:
  - `cmdLanguage(...)` → `tools/scaffolding/scaf/commands/language.ts`

- Go test generator:
  - `cmdGoTest(...)` + helpers → `tools/scaffolding/scaf/commands/go-test.ts`

- Routing / entry:
  - `main()` → `tools/scaffolding/scaf/main.ts` (`runScafCli()`)
