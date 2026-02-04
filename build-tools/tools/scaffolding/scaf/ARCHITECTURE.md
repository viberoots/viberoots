## scaf implementation layout (PR-2)

This directory contains the implementation of the `scaf` CLI.

`build-tools/tools/scaffolding/scaf.ts` is a thin entrypoint that calls into `build-tools/tools/scaffolding/scaf/main.ts`.

### Relocation map (from old monolith)

- Argument parsing and usage text:
  - `usage()` → `build-tools/tools/scaffolding/scaf/usage.ts`
  - `parseArgs(...)` → `build-tools/tools/scaffolding/scaf/argv.ts`

- Filesystem primitives and safety prompts:
  - `exists(...)` → `build-tools/tools/scaffolding/scaf/fs.ts`
  - `walk(...)` → `build-tools/tools/scaffolding/scaf/walk.ts`
  - `confirmOrExit(...)` → `build-tools/tools/scaffolding/scaf/confirm.ts`

- Template discovery and selection:
  - `isLanguageEnabled(...)` → `build-tools/tools/scaffolding/scaf/language-enablement.ts`
  - `readCopierVariables(...)` → `build-tools/tools/scaffolding/scaf/templates/variables.ts`
  - `readTemplateMeta(...)` → `build-tools/tools/scaffolding/scaf/templates/meta.ts`
  - `normalizeTemplateName(...)` → `build-tools/tools/scaffolding/scaf/templates/names.ts`
  - `resolveDestination(...)` → `build-tools/tools/scaffolding/scaf/templates/destination.ts`
  - `cmdTemplates(...)` → `build-tools/tools/scaffolding/scaf/commands/templates.ts`
  - `cmdTemplate(...)` → `build-tools/tools/scaffolding/scaf/commands/template.ts`

- Copier orchestration:
  - `runCopierCopy(...)` → `build-tools/tools/scaffolding/scaf/copier/copy.ts`
  - `runPostSteps(...)` → `build-tools/tools/scaffolding/scaf/copier/post-steps.ts`
  - `recordSource(...)` → `build-tools/tools/scaffolding/scaf/copier/record-source.ts`
  - `readRegenInfo(...)` → `build-tools/tools/scaffolding/scaf/copier/regen-info.ts`

- Scaffold discovery and bulk operations:
  - `discoverScaffolds(...)` → `build-tools/tools/scaffolding/scaf/scaffolds/discover.ts`
  - `cmdLs(...)` → `build-tools/tools/scaffolding/scaf/commands/ls.ts`
  - `cmdUpdateOrRegen(...)` → `build-tools/tools/scaffolding/scaf/commands/update-regen.ts`
  - `cmdDelete(...)` → `build-tools/tools/scaffolding/scaf/commands/delete.ts`
  - `cmdMove(...)` → `build-tools/tools/scaffolding/scaf/commands/move.ts`

- Command help and completions:
  - `cmdHelp(...)` → `build-tools/tools/scaffolding/scaf/commands/help.ts`
  - `cmdCompletions(...)` + `__complete` helpers → `build-tools/tools/scaffolding/scaf/commands/completions.ts`

- Language subcommands:
  - `cmdLanguage(...)` → `build-tools/tools/scaffolding/scaf/commands/language.ts`

- Go test generator:
  - `cmdGoTest(...)` + helpers → `build-tools/tools/scaffolding/scaf/commands/go-test.ts`

- Routing / entry:
  - `main()` → `build-tools/tools/scaffolding/scaf/main.ts` (`runScafCli()`)
