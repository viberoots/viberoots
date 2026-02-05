import type { ScafFlags } from "../types.ts";

import path from "node:path";

import { readTemplateMeta } from "../templates/meta.ts";
import { normalizeTemplateName } from "../templates/names.ts";
import { readCopierVariables } from "../templates/variables.ts";
import { usage } from "../usage.ts";

function printJsonOrLines(flags: ScafFlags, payload: unknown, lines: string[]) {
  if (flags["json"] === "true") {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(lines.join("\n"));
}

async function helpForCommand(cmd: string, flags: ScafFlags): Promise<boolean> {
  if (cmd === "new") {
    const lines = [
      "Usage: scaf new <language> <template> <name> [--path=DEST] [--key=value ...]",
      "",
      "Examples:",
      "  scaf new go lib greeter-utilities",
      "  scaf new go cli greeter-cli",
      "",
    ];
    printJsonOrLines(flags, { command: cmd, usage: lines[0], examples: lines.slice(2) }, lines);
    return true;
  }
  if (cmd === "update") {
    const lines = [
      "Usage: scaf update <all|path1 path2 ...> [--yes] [--dry-run]",
      "",
      "Examples:",
      "  scaf update all --dry-run",
      "  scaf update projects/libs/demo-lib --yes",
    ];
    printJsonOrLines(flags, { command: cmd, usage: lines[0], examples: lines.slice(2) }, lines);
    return true;
  }
  if (cmd === "regen") {
    const lines = [
      "Usage: scaf regen <all|path1 path2 ...> [--yes] [--dry-run]",
      "",
      "Examples:",
      "  scaf regen all --dry-run",
      "  scaf regen projects/libs/demo-lib --yes",
    ];
    printJsonOrLines(flags, { command: cmd, usage: lines[0], examples: lines.slice(2) }, lines);
    return true;
  }
  if (cmd === "delete") {
    const lines = [
      "Usage: scaf delete <all|path1 path2 ...> [--yes] [--dry-run]",
      "",
      "Examples:",
      "  scaf delete all --dry-run",
      "  scaf delete projects/libs/demo-lib --yes",
    ];
    printJsonOrLines(flags, { command: cmd, usage: lines[0], examples: lines.slice(2) }, lines);
    return true;
  }
  return false;
}

function helpForGoTest(flags: ScafFlags) {
  const usageLine = "Usage: scaf new go test <name_of_test> [--path=DEST] [--yes] [--dry-run]";
  const notes = [
    "- Place tests under projects/libs/<lib>/pkg/<pkg>/ for libs, projects/apps/<app>/cmd/<app>/ for apps.",
    "- The file name will be suffixed with _test.go if missing.",
    "- Package is inferred from existing *.go, or 'main' under /cmd/, else directory name.",
    "- Default DEST is resolved from current directory:",
    "  • projects/apps/<app> → projects/apps/<app>/cmd/<app>/<name>_test.go",
    "  • projects/libs/<lib> → projects/libs/<lib>/pkg/<lib>/<name>_test.go",
    "  • inside those trees, writes into the current directory",
  ];
  const examples = [
    "scaf new go test handlers --path=projects/libs/demo-lib/pkg/demo-lib/handlers_test.go",
    "scaf new go test main_case --path=projects/apps/demo-cli/cmd/demo-cli/main_case_test.go",
  ];
  if (flags["json"] === "true") {
    console.log(
      JSON.stringify({ command: "new go test", usage: usageLine, notes, examples }, null, 2),
    );
    return;
  }
  console.log(
    [usageLine, "", ...notes, "", "Examples:", ...examples.map((e) => `  ${e}`)].join("\n"),
  );
}

async function helpForNewTemplate(language: string, templateRaw: string, flags: ScafFlags) {
  const template = normalizeTemplateName(templateRaw);
  const tmplDirPath = path.join(
    "build-tools",
    "tools",
    "scaffolding",
    "templates",
    language,
    template,
  );
  const variables = await readCopierVariables(tmplDirPath).catch(() => [] as string[]);
  if (flags["json"] === "true") {
    console.log(
      JSON.stringify(
        {
          command: "new",
          usage: "scaf new <language> <template> <name> [--path=DEST] [--key=value ...]",
          language,
          template,
          variables,
        },
        null,
        2,
      ),
    );
    return;
  }
  const lines: string[] = [];
  lines.push("Usage: scaf new <language> <template> <name> [--path=DEST] [--key=value ...]");
  lines.push("");
  lines.push("Variables:");
  if (variables.length) {
    for (const v of variables) {
      lines.push(`  - ${v}`);
    }
  } else {
    lines.push("  - (none detected)");
  }
  lines.push("");
  lines.push("Examples:");
  lines.push("  scaf new go lib greeter-utilities");
  lines.push("  scaf new go cli greeter-cli");
  console.log(lines.join("\n"));
}

async function helpForNewLanguage(language: string, flags: ScafFlags) {
  const metas = await readTemplateMeta(language);
  if (flags["json"] === "true") {
    console.log(
      JSON.stringify(
        metas.map((m) => ({
          language: m.language,
          template: m.template,
          description: m.description || "",
          variables: (m as any).variables || [],
        })),
        null,
        2,
      ),
    );
    return;
  }
  const lines: string[] = [];
  lines.push(`# Available ${language} templates:`);
  lines.push("");
  for (const m of metas) {
    lines.push(`- ${m.template}: ${m.description || ""}`);
  }
  console.log(lines.join("\n"));
}

export async function cmdHelp(args: string[], flags: ScafFlags) {
  const [a1, a2, a3] = args;
  if (a1 && (a1 === "new" || a1 === "update" || a1 === "regen" || a1 === "delete") && !a2) {
    const printed = await helpForCommand(a1, flags);
    if (printed) return;
  }
  if (a1 === "new" && a2 === "go" && a3 === "test") {
    helpForGoTest(flags);
    return;
  }
  if (a1 === "new" && a2 && a3) {
    await helpForNewTemplate(a2, a3, flags);
    return;
  }
  if (a1 === "new" && a2 && !a3) {
    await helpForNewLanguage(a2, flags);
    return;
  }

  const [language, template] = args;
  if (!language || !template) {
    usage();
    console.log("\nAvailable templates:");
    const metas = await readTemplateMeta();
    metas.forEach((m) => console.log(`  ${m.language} ${m.template}\t${m.description}`));
    return;
  }

  const metas = await readTemplateMeta(language);
  const meta = metas.find((m) => m.template === template);
  if (!meta) {
    console.error("template not found for help");
    process.exit(1);
  }
  const h: any = (meta as any).help || {};
  if (flags["json"] === "true") {
    const tmplDirPath = path.join(
      "build-tools",
      "tools",
      "scaffolding",
      "templates",
      language,
      template,
    );
    const variables = await readCopierVariables(tmplDirPath).catch(() => [] as string[]);
    console.log(
      JSON.stringify(
        { language, template, description: meta.description || "", help: h, variables },
        null,
        2,
      ),
    );
    return;
  }
  const lines: string[] = [];
  if (meta.description) {
    lines.push(`# ${meta.description}`);
    lines.push("");
  }
  lines.push(h.usage || `scaf new ${language} ${template} <name>`);
  if (h.notes && Array.isArray(h.notes) && h.notes.length) {
    lines.push("");
    lines.push(...h.notes);
  }
  if (h.examples && Array.isArray(h.examples) && h.examples.length) {
    lines.push("");
    lines.push("Examples:");
    lines.push(...h.examples.map((e: string) => `  ${e}`));
  }
  console.log(lines.join("\n"));
}
